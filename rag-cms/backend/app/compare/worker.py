"""Background worker for async document comparison (Module 2).

Opens its own DB session (not reusing the request session — background tasks
run after the request session is already closed). On completion the CompareRun
is updated with the serialised report and status=succeeded. On any unhandled
exception the run is marked failed and an error event is published.

Lifecycle:
  POST /compare → creates CompareRun(queued) → add_task(run_comparison) → 202
  run_comparison: sets status=running → parse → compare_document (with on_progress)
                  → publishes progress events → publishes report + stream_end
                  → sets status=succeeded → broker.close() → broker.pop()
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from pathlib import Path

from app.compare.events import CompareEventBroker
from app.compare.schemas import CompareReport
from app.compare.service import compare_document
from app.db import SessionLocal
from app.ingestion.parser import parse_file
from app.models import CompareRun, CompareRunStatus

log = logging.getLogger("compare.worker")


async def run_comparison(
    rag_id: uuid.UUID,
    run_id: uuid.UUID,
    tmp_path: Path,
    filename: str,
    content_type: str | None,
) -> None:
    """Entry point for BackgroundTasks. Opens own DB session."""
    broker = await CompareEventBroker.get_or_create(rag_id, run_id)

    async with SessionLocal() as db:
        run = await db.get(CompareRun, run_id)
        if run is None:
            log.error("CompareRun %s not found — aborting worker", run_id)
            await broker.close()
            await CompareEventBroker.pop(run_id)
            return

        run.status = CompareRunStatus.running
        await db.commit()

    try:
        pages = parse_file(tmp_path, content_type)

        async def on_progress(done: int, total: int) -> None:
            await broker.publish("progress", {"done": done, "total": total})

        async with SessionLocal() as db:
            report: CompareReport = await compare_document(
                db, rag_id, pages, filename, on_progress=on_progress
            )

        report_dict = report.model_dump(mode="json")

        async with SessionLocal() as db:
            run = await db.get(CompareRun, run_id)
            if run is not None:
                run.status = CompareRunStatus.succeeded
                run.report = report_dict
                run.finished_at = datetime.now(UTC)
                await db.commit()

        await broker.publish("report", report_dict)
        await broker.publish("stream_end", {})

    except Exception:
        log.exception("compare worker failed for run %s", run_id)
        async with SessionLocal() as db:
            run = await db.get(CompareRun, run_id)
            if run is not None:
                run.status = CompareRunStatus.failed
                run.error = "comparison failed — see server logs"
                run.finished_at = datetime.now(UTC)
                await db.commit()
        await broker.publish("error", {"message": "comparison failed — see server logs"})
        await broker.publish("stream_end", {})

    finally:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        await broker.close()
        await CompareEventBroker.pop(run_id)
