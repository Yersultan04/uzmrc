from __future__ import annotations

import asyncio
import hashlib
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_accessible_rag, get_owned_rag
from app.config import get_settings
from app.db import get_db
from app.ingestion.classify import classify_document
from app.models import Chunk
from app.models import File as FileModel
from app.models import FileStatus, Rag
from app.schemas import FileOut

router = APIRouter()

ALLOWED_SUFFIXES = {".pdf", ".txt", ".md", ".xlsx"}


def _file_dir(rag_id: uuid.UUID) -> Path:
    s = get_settings()
    p = s.data_dir / "rags" / str(rag_id) / "files"
    p.mkdir(parents=True, exist_ok=True)
    return p


@router.post("/{rag_id}/files", response_model=list[FileOut], status_code=201)
async def upload_files(
    files: list[UploadFile],
    rag: Rag = Depends(get_owned_rag),
    db: AsyncSession = Depends(get_db),
) -> list[FileModel]:
    s = get_settings()
    max_bytes = s.max_upload_mb * 1024 * 1024
    out: list[FileModel] = []

    target_dir = _file_dir(rag.id)

    for up in files:
        if not up.filename:
            raise HTTPException(400, "missing filename")
        suffix = Path(up.filename).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise HTTPException(400, f"unsupported file type: {suffix}")

        contents = await up.read()
        size = len(contents)
        if size == 0:
            raise HTTPException(400, f"{up.filename} is empty")
        if size > max_bytes:
            raise HTTPException(413, f"{up.filename} exceeds {s.max_upload_mb}MB")

        sha = hashlib.sha256(contents).hexdigest()

        existing = (
            await db.execute(
                select(FileModel).where(FileModel.rag_id == rag.id, FileModel.sha256 == sha)
            )
        ).scalar_one_or_none()
        if existing is not None:
            out.append(existing)
            continue

        file_id = uuid.uuid4()
        target = target_dir / f"{file_id}{suffix}"
        target.write_bytes(contents)

        row = FileModel(
            id=file_id,
            rag_id=rag.id,
            filename=up.filename,
            mime_type=up.content_type,
            size_bytes=size,
            sha256=sha,
            storage_path=str(target),
            status=FileStatus.uploaded,
        )
        db.add(row)
        out.append(row)

    await db.commit()
    for r in out:
        await db.refresh(r)
    return out


@router.get("/{rag_id}/files", response_model=list[FileOut])
async def list_files(
    rag: Rag = Depends(get_owned_rag), db: AsyncSession = Depends(get_db)
) -> list[FileModel]:
    res = await db.execute(
        select(FileModel).where(FileModel.rag_id == rag.id).order_by(FileModel.created_at.desc())
    )
    return list(res.scalars().all())


@router.post("/{rag_id}/files/classify")
async def classify_files(
    rag: Rag = Depends(get_owned_rag),
    db: AsyncSession = Depends(get_db),
    only_missing: bool = False,
) -> dict:
    """Owner-only. Classify each file into a doc_type via a cheap LLM, using the
    filename + a short text excerpt. Concurrency-safe: all DB reads happen first,
    LLM calls run concurrently, then results are written back in one pass.
    """
    s = get_settings()
    if not s.openrouter_api_key:
        raise HTTPException(400, "OPENROUTER_API_KEY not configured")

    q = select(FileModel).where(FileModel.rag_id == rag.id)
    if only_missing:
        q = q.where(FileModel.doc_type.is_(None))
    files = list((await db.execute(q)).scalars().all())
    if not files:
        return {"classified": 0, "by_type": {}}

    # One query: first two chunks' text per file (for a representative excerpt).
    samples: dict[uuid.UUID, str] = {}
    rows = (await db.execute(
        select(Chunk.file_id, Chunk.text)
        .where(Chunk.rag_id == rag.id, Chunk.chunk_index < 2)
        .order_by(Chunk.file_id, Chunk.chunk_index)
    )).all()
    for fid, text in rows:
        samples[fid] = (samples.get(fid, "") + " " + (text or ""))[:1800]

    model = "openai/gpt-4o-mini"
    base = s.openrouter_base_url
    key = s.openrouter_api_key
    sem = asyncio.Semaphore(8)

    async def _one(f: FileModel) -> tuple[FileModel, str]:
        async with sem:
            t = await classify_document(
                f.filename, samples.get(f.id, ""),
                model=model, base_url=base, api_key=key,
            )
            return f, t

    results = await asyncio.gather(*[_one(f) for f in files])
    by_type: dict[str, int] = {}
    for f, t in results:
        f.doc_type = t
        by_type[t] = by_type.get(t, 0) + 1
    await db.commit()
    return {"classified": len(results), "by_type": by_type}


@router.get("/{rag_id}/files/{file_id}/blob")
async def get_file_blob(
    file_id: uuid.UUID,
    rag: Rag = Depends(get_accessible_rag),
    db: AsyncSession = Depends(get_db),
) -> FileResponse:
    """Stream the original file blob (PDF/XLSX/TXT/MD).
    Accessible by owner / admin / active member — same scope as chat answers.
    """
    row = (
        await db.execute(
            select(FileModel).where(FileModel.id == file_id, FileModel.rag_id == rag.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "file not found")
    path = Path(row.storage_path)
    if not path.is_file():
        raise HTTPException(410, "file blob missing on disk")
    return FileResponse(
        path=path,
        media_type=row.mime_type or "application/octet-stream",
        filename=row.filename,
        headers={"Content-Disposition": f'inline; filename="{row.filename}"'},
    )


@router.delete("/{rag_id}/files/{file_id}", status_code=204)
async def delete_file(
    file_id: uuid.UUID,
    rag: Rag = Depends(get_owned_rag),
    db: AsyncSession = Depends(get_db),
) -> None:
    row = (
        await db.execute(
            select(FileModel).where(FileModel.id == file_id, FileModel.rag_id == rag.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "file not found")

    # Chunk rows are deleted via CASCADE when the file row is deleted below.
    try:
        Path(row.storage_path).unlink(missing_ok=True)
    except OSError:
        pass
    await db.delete(row)
    await db.commit()
