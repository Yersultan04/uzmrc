"""Tests for async compare flow: CompareEventBroker + run_comparison worker.

Uses pytest-asyncio in auto mode (asyncio_mode = "auto" in pyproject.toml).
All async def test_* functions run automatically — no marker needed.

DB / LLM / filesystem interactions are patched:
  - SessionLocal → in-memory fake that returns a MagicMock CompareRun
  - parse_file → returns [] (or raises for failure path)
  - compare_document → returns a hard-coded CompareReport instantly
  - data_dir → tmp_path so real filesystem is used but isolated per test
"""
from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from unittest.mock import MagicMock
from types import SimpleNamespace

import pytest

from app.compare.events import CompareEventBroker, replay_from_disk
from app.compare.schemas import (
    ClauseFinding,
    ClauseRelation,
    CompareReport,
    CompareSummary,
)
from app.models import CompareRunStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _settings_with(data_dir: Path):
    return SimpleNamespace(data_dir=data_dir)


def _make_report(rag_id: uuid.UUID, filename: str = "test.txt") -> CompareReport:
    return CompareReport(
        rag_id=rag_id,
        filename=filename,
        summary=CompareSummary(total_clauses=1, conflict=1),
        findings=[
            ClauseFinding(
                clause_index=0,
                clause_label="Статья 1",
                clause_text="Тестовое положение.",
                relation=ClauseRelation.conflict,
                rationale="расходится",
                recommendation="согласовать",
                confidence=0.9,
                matched_norm=None,
            )
        ],
    )


# ---------------------------------------------------------------------------
# CompareEventBroker unit tests
# ---------------------------------------------------------------------------


async def test_broker_publish_and_subscribe(tmp_path: Path, monkeypatch):
    """publish() persists events; subscribe() replays them then yields live."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))

    broker = CompareEventBroker(rag_id, run_id)
    CompareEventBroker._brokers.pop(run_id, None)

    await broker.publish("progress", {"done": 1, "total": 5})
    await broker.publish("progress", {"done": 5, "total": 5})

    collected: list[dict] = []

    async def _drain():
        async for ev in broker.subscribe(since_seq=0):
            if ev is None:
                break
            collected.append(ev)

    drain_task = asyncio.create_task(_drain())
    await broker.close()
    await drain_task

    assert len(collected) == 2
    assert collected[0]["type"] == "progress"
    assert collected[0]["payload"]["done"] == 1
    assert collected[1]["payload"]["done"] == 5


async def test_broker_replay_from_disk(tmp_path: Path, monkeypatch):
    """replay_from_disk returns persisted events without needing a live broker."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))

    broker = CompareEventBroker(rag_id, run_id)
    await broker.publish("progress", {"done": 3, "total": 10})
    await broker.publish("stream_end", {})
    await broker.close()

    events = replay_from_disk(rag_id, run_id)
    types = [e["type"] for e in events]
    assert len(events) == 2
    assert "progress" in types
    assert "stream_end" in types


async def test_broker_since_seq_filters(tmp_path: Path, monkeypatch):
    """subscribe(since_seq=N) skips events with seq <= N."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))

    broker = CompareEventBroker(rag_id, run_id)
    await broker.publish("progress", {"done": 1, "total": 3})  # seq=1
    await broker.publish("progress", {"done": 2, "total": 3})  # seq=2
    await broker.publish("progress", {"done": 3, "total": 3})  # seq=3
    await broker.close()

    collected: list[dict] = []
    async for ev in broker.subscribe(since_seq=1):
        if ev is None:
            break
        collected.append(ev)

    assert len(collected) == 2
    assert collected[0]["seq"] == 2


async def test_broker_pop_removes_from_registry(tmp_path: Path, monkeypatch):
    """pop() removes the broker from the class-level dict."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))

    await CompareEventBroker.get_or_create(rag_id, run_id)
    assert run_id in CompareEventBroker._brokers

    await CompareEventBroker.pop(run_id)
    assert run_id not in CompareEventBroker._brokers


# ---------------------------------------------------------------------------
# run_comparison worker integration tests
# ---------------------------------------------------------------------------


def _make_fake_db(fake_run):
    """Returns a class whose instances behave as an async context manager DB session."""

    class _FakeDB:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_):
            pass

        async def get(self, model, pk):
            return fake_run

        async def commit(self):
            pass

    return _FakeDB


async def test_run_comparison_success(tmp_path: Path, monkeypatch):
    """Happy path: worker publishes progress→report→stream_end, sets status=succeeded."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()
    report = _make_report(rag_id)

    fake_run = MagicMock()
    fake_run.id = run_id
    fake_run.status = CompareRunStatus.queued

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))
    monkeypatch.setattr("app.compare.worker.SessionLocal", _make_fake_db(fake_run))
    monkeypatch.setattr("app.compare.worker.parse_file", lambda path, ct: [])

    async def fake_compare(db, rag_id, pages, filename, *, on_progress=None):
        if on_progress is not None:
            await on_progress(1, 1)
        return report

    monkeypatch.setattr("app.compare.worker.compare_document", fake_compare)

    tmp_file = tmp_path / "upload.txt"
    tmp_file.write_text("test content")

    # Clear any stale broker from previous test
    CompareEventBroker._brokers.pop(run_id, None)

    from app.compare.worker import run_comparison
    await run_comparison(rag_id, run_id, tmp_file, "test.txt", "text/plain")

    # Temp file must be deleted in finally
    assert not tmp_file.exists()

    # Broker must be removed from registry after pop()
    assert run_id not in CompareEventBroker._brokers

    # ORM object must be updated
    assert fake_run.status == CompareRunStatus.succeeded
    assert fake_run.report is not None

    # All key event types must be on disk
    events = replay_from_disk(rag_id, run_id)
    types = [e["type"] for e in events]
    assert "progress" in types
    assert "report" in types
    assert "stream_end" in types


async def test_run_comparison_failure(tmp_path: Path, monkeypatch):
    """On exception: status=failed, error+stream_end published, tmp file deleted."""
    rag_id = uuid.uuid4()
    run_id = uuid.uuid4()

    fake_run = MagicMock()
    fake_run.id = run_id
    fake_run.status = CompareRunStatus.queued

    monkeypatch.setattr("app.compare.events.get_settings", lambda: _settings_with(tmp_path))
    monkeypatch.setattr("app.compare.worker.SessionLocal", _make_fake_db(fake_run))

    def _boom(path, ct):
        raise RuntimeError("parse exploded")

    monkeypatch.setattr("app.compare.worker.parse_file", _boom)

    tmp_file = tmp_path / "upload2.txt"
    tmp_file.write_text("bad content")

    CompareEventBroker._brokers.pop(run_id, None)

    from app.compare.worker import run_comparison
    await run_comparison(rag_id, run_id, tmp_file, "upload2.txt", "text/plain")

    assert not tmp_file.exists()
    assert run_id not in CompareEventBroker._brokers
    assert fake_run.status == CompareRunStatus.failed

    events = replay_from_disk(rag_id, run_id)
    types = [e["type"] for e in events]
    assert "error" in types
    assert "stream_end" in types
