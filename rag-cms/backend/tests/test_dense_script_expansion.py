"""Dense leg query expansion across Uzbek scripts.

Guards app/retrieval/dense.py. The embedder bridges the scripts only partially:
measured on voyage-3.5, same term across scripts averages 0.733 cosine against a
0.336 unrelated baseline, but native Uzbek vocabulary drops far lower
(hisobot/ҳисобот 0.427) while Russian loanwords stay high (kredit/кредит 0.885).
So the query is embedded in both scripts and each chunk scored by its best match.

No database or embedder needed — these assert on the SQL, the bind parameters
and which embedding call is made.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from app.retrieval import dense as dense_mod
from app.retrieval.dense import _score_expr, _vec_literal, dense_search

RID = uuid.uuid4()
CID = uuid.uuid4()


@dataclass
class _Row:
    id: str
    score: float


class _Result:
    def __init__(self, rows: list[Any]) -> None:
        self._rows = rows

    def all(self) -> list[Any]:
        return self._rows


class StubSession:
    def __init__(self, rows: list[Any] | None = None) -> None:
        self.rows = rows if rows is not None else [_Row(id=str(CID), score=0.9)]
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt: Any, params: dict | None = None) -> _Result:
        self.calls.append((str(stmt), params or {}))
        return _Result(self.rows)


@pytest.fixture
def spy_embedder(monkeypatch: pytest.MonkeyPatch) -> dict:
    """Record which embedding entry point was used and with what texts."""
    seen: dict = {"queries": None, "query": None}

    async def fake_embed_queries(texts: list[str], **_: Any) -> list[list[float]]:
        seen["queries"] = list(texts)
        return [[0.1, 0.2, 0.3] for _ in texts]

    async def fake_embed_query(text: str, **_: Any) -> list[float]:
        seen["query"] = text
        return [0.4, 0.5, 0.6]

    monkeypatch.setattr(dense_mod, "embed_queries", fake_embed_queries)
    monkeypatch.setattr(dense_mod, "embed_query", fake_embed_query)
    return seen


# ── score expression ───────────────────────────────────────────────────────
def test_score_expr_single_variant_has_no_greatest() -> None:
    expr = _score_expr(1)
    assert "GREATEST" not in expr
    assert ":qvec0" in expr


def test_score_expr_takes_best_matching_variant() -> None:
    expr = _score_expr(3)
    assert expr.startswith("GREATEST(")
    assert all(f":qvec{i}" in expr for i in range(3))


def test_vec_literal_formats_pgvector() -> None:
    assert _vec_literal([1, 0.5, -2]) == "[1.0,0.5,-2.0]"


# ── expansion behaviour ────────────────────────────────────────────────────
async def test_latin_query_embeds_both_scripts(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "hisobot", top_k=5)  # type: ignore[arg-type]
    assert spy_embedder["queries"] is not None, "должен использоваться батч-эмбеддинг"
    assert "hisobot" in spy_embedder["queries"]
    assert "ҳисобот" in spy_embedder["queries"]


async def test_cyrillic_query_embeds_both_scripts(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "ҳисобот", top_k=5)  # type: ignore[arg-type]
    assert "hisobot" in spy_embedder["queries"]


async def test_variants_are_embedded_in_one_batched_call(spy_embedder: dict) -> None:
    """Both renderings must ride one API call — that is what keeps it free."""
    db = StubSession()
    await dense_search(db, RID, "shartnoma", top_k=5)  # type: ignore[arg-type]
    assert spy_embedder["query"] is None
    assert len(spy_embedder["queries"]) == 2


async def test_expansion_disabled_uses_single_embedding(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "hisobot", top_k=5, expand_scripts=False)  # type: ignore[arg-type]
    assert spy_embedder["query"] == "hisobot"
    assert spy_embedder["queries"] is None


async def test_precomputed_vector_skips_expansion(spy_embedder: dict) -> None:
    """compare pre-embeds many clauses; the caller owns that decision."""
    db = StubSession()
    await dense_search(db, RID, "hisobot", top_k=5, query_vector=[0.9, 0.9, 0.9])  # type: ignore[arg-type]
    assert spy_embedder["queries"] is None and spy_embedder["query"] is None
    _, params = db.calls[0]
    assert params["qvec0"] == "[0.9,0.9,0.9]"
    assert "qvec1" not in params


async def test_script_neutral_query_does_not_fan_out(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "415", top_k=5)  # type: ignore[arg-type]
    assert spy_embedder["query"] == "415"


# ── SQL shape ──────────────────────────────────────────────────────────────
async def test_sql_binds_one_vector_per_variant(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "hisobot", top_k=5)  # type: ignore[arg-type]
    sql, params = db.calls[0]
    n = len([k for k in params if k.startswith("qvec")])
    assert n == 2
    for i in range(n):
        assert f":qvec{i}" in sql
    assert ":qvec2" not in sql


async def test_single_variant_keeps_distance_ordering(spy_embedder: dict) -> None:
    """Distance ordering is what a future ANN index can serve."""
    db = StubSession()
    await dense_search(db, RID, "415", top_k=5)  # type: ignore[arg-type]
    sql, _ = db.calls[0]
    assert "ORDER  BY embedding <=> CAST(:qvec0 AS vector) ASC" in sql


async def test_multi_variant_orders_by_best_score(spy_embedder: dict) -> None:
    db = StubSession()
    await dense_search(db, RID, "hisobot", top_k=5)  # type: ignore[arg-type]
    sql, _ = db.calls[0]
    assert "GREATEST" in sql
    assert "ORDER  BY score DESC" in sql


async def test_results_are_mapped_to_hits(spy_embedder: dict) -> None:
    db = StubSession(rows=[_Row(id=str(CID), score=0.73)])
    hits = await dense_search(db, RID, "hisobot", top_k=5)  # type: ignore[arg-type]
    assert len(hits) == 1
    assert hits[0].chunk_id == CID
    assert hits[0].score == pytest.approx(0.73)
