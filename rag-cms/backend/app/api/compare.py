"""Module 2 — async document comparison endpoints.

POST /{rag_id}/compare
    Accepts a file upload. Saves it to a temp path, creates a CompareRun
    (status=queued), fires a background worker, and immediately returns
    202 + {run_id, stream_token, status}.

GET /{rag_id}/compare/runs/{run_id}
    Returns CompareRunOut (includes report JSON once status=succeeded).

GET /{rag_id}/compare/runs/{run_id}/stream?token=&since=
    SSE stream. Replays persisted events from disk if the run is already
    terminal, otherwise subscribes to the live CompareEventBroker.
    Events: progress {done, total} | report {…CompareReport fields…} |
            error {message} | stream_end {}
"""
from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user, get_accessible_rag, new_stream_token
from app.compare.events import CompareEventBroker, replay_from_disk
from app.compare.worker import run_comparison
from app.config import get_settings
from app.db import get_db
from app.models import CompareRun, CompareRunStatus, Rag, User
from app.ratelimit import compare_run_rate_limit
from app.schemas import CompareRunOut

log = logging.getLogger("api.compare")

router = APIRouter()

ALLOWED_SUFFIXES = {".pdf", ".txt", ".md", ".xlsx"}


def _tmp_dir(rag_id: uuid.UUID) -> Path:
    s = get_settings()
    p = s.data_dir / "rags" / str(rag_id) / "compare_tmp"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _sse(event: dict) -> bytes:
    event_type = event.get("type", "message")
    seq = event.get("seq")
    data = json.dumps(event, ensure_ascii=False, default=str)
    head = f"event: {event_type}\n"
    if seq is not None:
        head += f"id: {seq}\n"
    return (head + f"data: {data}\n\n").encode("utf-8")


@router.post("/{rag_id}/compare", response_model=CompareRunOut, status_code=202)
async def start_compare(
    file: UploadFile,
    background: BackgroundTasks,
    rag: Rag = Depends(get_accessible_rag),
    user: User = Depends(current_user),
    db: AsyncSession = Depends(get_db),
) -> CompareRun:
    compare_run_rate_limit(user.id)
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

    tmp_path = _tmp_dir(rag.id) / f"{uuid.uuid4()}{suffix}"
    tmp_path.write_bytes(contents)

    run = CompareRun(
        id=uuid.uuid4(),
        rag_id=rag.id,
        status=CompareRunStatus.queued,
        filename=file.filename,
        stream_token=new_stream_token(),
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    background.add_task(
        run_comparison,
        rag.id,
        run.id,
        tmp_path,
        file.filename,
        file.content_type,
    )
    return run


@router.get("/{rag_id}/compare/runs/{run_id}", response_model=CompareRunOut)
async def get_compare_run(
    run_id: uuid.UUID,
    rag: Rag = Depends(get_accessible_rag),
    db: AsyncSession = Depends(get_db),
) -> CompareRun:
    row = (
        await db.execute(
            select(CompareRun).where(CompareRun.id == run_id, CompareRun.rag_id == rag.id)
        )
    ).scalar_one_or_none()
    if row is None:
        raise HTTPException(404, "compare run not found")
    return row


@router.get("/{rag_id}/compare/runs/{run_id}/stream")
async def stream_compare_run(
    rag_id: uuid.UUID,
    run_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    token: str = Query(..., description="stream_token from POST /compare response"),
    since: int = Query(0, ge=0),
) -> StreamingResponse:
    row = (
        await db.execute(
            select(CompareRun).where(CompareRun.id == run_id, CompareRun.rag_id == rag_id)
        )
    ).scalar_one_or_none()
    if row is None or row.stream_token != token:
        raise HTTPException(404, "run not found")

    is_terminal = row.status in (CompareRunStatus.succeeded, CompareRunStatus.failed)

    async def gen() -> AsyncIterator[bytes]:
        if is_terminal:
            for ev in replay_from_disk(rag_id, run_id):
                if ev.get("seq", 0) > since:
                    yield _sse(ev)
            yield _sse({"type": "stream_end", "payload": {}})
            return
        broker = await CompareEventBroker.get_or_create(rag_id, run_id)
        try:
            async for ev in broker.subscribe(since_seq=since):
                if ev is None:
                    yield _sse({"type": "stream_end", "payload": {}})
                    return
                yield _sse(ev)
        except asyncio.CancelledError:
            return

    return StreamingResponse(
        gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )
