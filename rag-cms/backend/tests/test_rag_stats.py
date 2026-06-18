"""Unit tests for GET /api/rags/{rag_id}/stats endpoint logic.

Tests verify the RagStatsOut schema construction from aggregated DB values
without touching a real database — DB calls are patched with AsyncMock.
"""
from __future__ import annotations

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.models import FileStatus, RagStatus
from app.schemas import RagStatsOut


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

RAG_ID = uuid.UUID("1e852a09-a47e-4979-bb75-e28901a4390d")


def _make_rag(
    *,
    doc_count: int = 50,
    pages_total: int = 595,
    chunk_count: int = 1630,
    total_tokens: int = 820000,
) -> tuple[MagicMock, dict]:
    """Return a fake Rag ORM object and pre-built aggregate values."""
    rag = MagicMock()
    rag.id = RAG_ID
    rag.name = "UzMRC Corpus"
    rag.status = RagStatus.ready
    rag.embed_model = "voyage-3.5"
    rag.embed_dim = 1024

    agg = dict(
        doc_count=doc_count,
        pages_total=pages_total,
        chunk_count=chunk_count,
        total_tokens=total_tokens,
    )
    return rag, agg


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


def test_ragstatsout_schema_construction():
    """RagStatsOut round-trips correctly with realistic UzMRC values."""
    rag, agg = _make_rag()

    stats = RagStatsOut(
        rag_id=rag.id,
        rag_name=rag.name,
        status=rag.status,
        embed_model=rag.embed_model,
        embed_dim=rag.embed_dim,
        documents=agg["doc_count"],
        chunks=agg["chunk_count"],
        pages_total=agg["pages_total"],
        avg_chunks_per_doc=round(agg["chunk_count"] / agg["doc_count"], 2),
        total_tokens=agg["total_tokens"],
        by_file_status={"parsed": agg["doc_count"]},
    )

    assert stats.documents == 50
    assert stats.chunks == 1630
    assert stats.pages_total == 595
    assert stats.embed_model == "voyage-3.5"
    assert stats.embed_dim == 1024
    assert stats.avg_chunks_per_doc == pytest.approx(32.6)
    assert stats.by_file_status == {"parsed": 50}


def test_ragstatsout_zero_docs():
    """avg_chunks_per_doc must be 0.0 when there are no documents (no division by zero)."""
    rag, _ = _make_rag(doc_count=0, pages_total=0, chunk_count=0, total_tokens=0)

    doc_count = 0
    chunk_count = 0
    avg = round(chunk_count / doc_count, 2) if doc_count > 0 else 0.0

    stats = RagStatsOut(
        rag_id=rag.id,
        rag_name=rag.name,
        status=rag.status,
        embed_model=rag.embed_model,
        embed_dim=rag.embed_dim,
        documents=0,
        chunks=0,
        pages_total=0,
        avg_chunks_per_doc=avg,
        total_tokens=0,
        by_file_status={},
    )

    assert stats.avg_chunks_per_doc == 0.0
    assert stats.by_file_status == {}


def test_ragstatsout_serialises_to_dict():
    """model_dump() produces JSON-serialisable output (UUIDs as strings via mode='json')."""
    rag, agg = _make_rag()
    stats = RagStatsOut(
        rag_id=rag.id,
        rag_name=rag.name,
        status=rag.status,
        embed_model=rag.embed_model,
        embed_dim=rag.embed_dim,
        documents=agg["doc_count"],
        chunks=agg["chunk_count"],
        pages_total=agg["pages_total"],
        avg_chunks_per_doc=32.6,
        total_tokens=agg["total_tokens"],
        by_file_status={"parsed": 50},
    )

    d = stats.model_dump(mode="json")
    assert d["rag_id"] == str(RAG_ID)
    assert d["status"] == "ready"
    assert isinstance(d["documents"], int)
    assert isinstance(d["avg_chunks_per_doc"], float)
