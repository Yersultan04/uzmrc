"""Module 2 endpoint — compare an uploaded regulation against a RAG's norms.

The uploaded document is parsed and compared in-memory; it is NOT ingested into
the RAG (no chunks, no Qdrant points). We persist the blob only for the duration
of the request, then delete it.
"""
from __future__ import annotations

import logging
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import get_accessible_rag
from app.compare.schemas import CompareReport
from app.compare.service import compare_document
from app.config import get_settings
from app.db import get_db
from app.ingestion.parser import parse_file
from app.models import Rag

log = logging.getLogger("api.compare")

router = APIRouter()

ALLOWED_SUFFIXES = {".pdf", ".txt", ".md", ".xlsx"}


def _tmp_dir(rag_id: uuid.UUID) -> Path:
    s = get_settings()
    p = s.data_dir / "rags" / str(rag_id) / "compare_tmp"
    p.mkdir(parents=True, exist_ok=True)
    return p


@router.post("/{rag_id}/compare", response_model=CompareReport)
async def compare_against_rag(
    file: UploadFile,
    rag: Rag = Depends(get_accessible_rag),
    db: AsyncSession = Depends(get_db),
) -> CompareReport:
    if not file.filename:
        raise HTTPException(400, "missing filename")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_SUFFIXES:
        raise HTTPException(400, f"unsupported file type: {suffix}")

    s = get_settings()
    max_bytes = s.max_upload_mb * 1024 * 1024
    contents = await file.read()
    if not contents:
        raise HTTPException(400, "empty file")
    if len(contents) > max_bytes:
        raise HTTPException(413, f"file exceeds {s.max_upload_mb}MB")

    target = _tmp_dir(rag.id) / f"{uuid.uuid4()}{suffix}"
    target.write_bytes(contents)
    try:
        pages = parse_file(target, file.content_type)
        report = await compare_document(db, rag.id, pages, file.filename)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except Exception as e:
        log.exception("comparison failed")
        raise HTTPException(500, f"comparison failed: {e}") from e
    finally:
        try:
            target.unlink(missing_ok=True)
        except OSError:
            pass
    return report
