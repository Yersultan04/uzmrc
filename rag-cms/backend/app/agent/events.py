from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncIterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings


def _run_dir(rag_id: uuid.UUID, run_id: uuid.UUID) -> Path:
    s = get_settings()
    p = s.data_dir / "rags" / str(rag_id) / "runs" / str(run_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def events_path(rag_id: uuid.UUID, run_id: uuid.UUID) -> Path:
    return _run_dir(rag_id, run_id) / "events.jsonl"


class EventBroker:
    """Per-run pub/sub for live SSE plus durable JSONL log.

    - publish() appends to the JSONL and pushes to all active subscribers.
    - subscribe() returns an async iterator yielding all past events (from disk)
      then live ones until close().
    """

    _brokers: dict[uuid.UUID, "EventBroker"] = {}
    _lock = asyncio.Lock()

    def __init__(self, rag_id: uuid.UUID, run_id: uuid.UUID):
        self.rag_id = rag_id
        self.run_id = run_id
        self.path = events_path(rag_id, run_id)
        self._subs: set[asyncio.Queue[dict | None]] = set()
        self._closed = False
        self._seq = 0

    @classmethod
    async def get_or_create(cls, rag_id: uuid.UUID, run_id: uuid.UUID) -> "EventBroker":
        async with cls._lock:
            b = cls._brokers.get(run_id)
            if b is None:
                b = cls(rag_id, run_id)
                cls._brokers[run_id] = b
            return b

    @classmethod
    async def pop(cls, run_id: uuid.UUID) -> None:
        async with cls._lock:
            cls._brokers.pop(run_id, None)

    async def publish(
        self, event_type: str, payload: dict[str, Any], *, persist: bool = True
    ) -> None:
        """Append to the JSONL log (when ``persist``) and fan out to subscribers.

        ``persist=False`` is for high-frequency, live-only events (e.g. answer
        token deltas): they stream to connected clients but are NOT written to
        disk, so they don't bloat the durable log or get replayed on reconnect —
        the persisted ``final_answer`` event is the durable record of the answer.
        """
        if self._closed:
            return
        self._seq += 1
        envelope = {
            "seq": self._seq,
            "ts": datetime.now(timezone.utc).isoformat(),
            "type": event_type,
            "payload": payload,
        }
        # Persist (skipped for ephemeral live-only events)
        if persist:
            with self.path.open("a", encoding="utf-8") as fh:
                fh.write(json.dumps(envelope, ensure_ascii=False, default=str) + "\n")
        # Fanout
        for q in list(self._subs):
            try:
                q.put_nowait(envelope)
            except asyncio.QueueFull:
                pass

    async def close(self) -> None:
        self._closed = True
        for q in list(self._subs):
            try:
                q.put_nowait(None)
            except asyncio.QueueFull:
                pass

    async def subscribe(self, since_seq: int = 0) -> AsyncIterator[dict | None]:
        """Yield historical events (seq > since_seq) from disk then live events.

        Yields None as a sentinel when the run is complete.
        """
        q: asyncio.Queue[dict | None] = asyncio.Queue(maxsize=1024)
        self._subs.add(q)
        try:
            if self.path.exists():
                with self.path.open("r", encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            ev = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        if ev.get("seq", 0) > since_seq:
                            yield ev
            if self._closed:
                yield None
                return
            while True:
                ev = await q.get()
                if ev is None:
                    yield None
                    return
                yield ev
        finally:
            self._subs.discard(q)


def replay_from_disk(rag_id: uuid.UUID, run_id: uuid.UUID) -> list[dict]:
    p = events_path(rag_id, run_id)
    if not p.exists():
        return []
    out: list[dict] = []
    with p.open("r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out
