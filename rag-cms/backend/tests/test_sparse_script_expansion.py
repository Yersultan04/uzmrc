"""Sparse leg query expansion across Uzbek scripts.

Guards the contract in app/retrieval/sparse.py: the FTS query is matched against
the OR of its Latin and Cyrillic renderings, so a query typed in one script
still reaches chunks written in the other. Measured gain on the UzMRC corpus is
x1.94 sparse-leg coverage (eval/bench_script_expansion.py).

No database needed — these assert on the SQL and bind parameters the function
builds, which is where the expansion actually lives.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Any

import pytest

from app.retrieval.sparse import _safe_ts_config, _tsquery_expr, sparse_search


# ── stub session ───────────────────────────────────────────────────────────
@dataclass
class _Row:
    id: str
    score: float


class _Result:
    def __init__(self, rows: list[Any], scalar: Any = None) -> None:
        self._rows, self._scalar = rows, scalar

    def all(self) -> list[Any]:
        return self._rows

    def scalar_one_or_none(self) -> Any:
        return self._scalar


class _Rag:
    def __init__(self, settings: dict | None) -> None:
        self.settings = settings


class StubSession:
    """Records executed statements so the built SQL can be asserted on."""

    def __init__(self, rag_settings: dict | None = None, rows: list[Any] | None = None) -> None:
        self.rag_settings = rag_settings
        self.rows = rows if rows is not None else []
        self.calls: list[tuple[str, dict]] = []

    async def execute(self, stmt: Any, params: dict | None = None) -> _Result:
        if params is None:  # the Rag lookup
            return _Result([], scalar=_Rag(self.rag_settings))
        self.calls.append((str(stmt), params))
        return _Result(self.rows)


RID = uuid.uuid4()


def _q_params(params: dict) -> list[str]:
    return [v for k, v in sorted(params.items()) if k.startswith("q")]


# ── tsquery expression ─────────────────────────────────────────────────────
def test_tsquery_expr_single_variant() -> None:
    assert _tsquery_expr("simple", 1) == "plainto_tsquery('simple', :q0)"


def test_tsquery_expr_ors_variants() -> None:
    expr = _tsquery_expr("simple", 3)
    assert expr.count("plainto_tsquery") == 3
    assert expr.count("||") == 2
    assert ":q0" in expr and ":q1" in expr and ":q2" in expr


def test_tsquery_expr_only_interpolates_config() -> None:
    """Variant text must travel as bind params, never inlined into SQL."""
    expr = _tsquery_expr("russian", 2)
    assert "russian" in expr
    assert expr.count(":q") == 2


# ── expansion behaviour ────────────────────────────────────────────────────
async def test_latin_query_also_searches_cyrillic() -> None:
    db = StubSession()
    await sparse_search(db, RID, "ipoteka krediti", top_k=5)  # type: ignore[arg-type]
    _, params = db.calls[0]
    variants = _q_params(params)
    assert "ipoteka krediti" in variants
    assert "ипотека кредити" in variants


async def test_cyrillic_query_also_searches_latin() -> None:
    db = StubSession()
    await sparse_search(db, RID, "ипотека кредити", top_k=5)  # type: ignore[arg-type]
    _, params = db.calls[0]
    variants = _q_params(params)
    assert "ипотека кредити" in variants
    assert "ipoteka krediti" in variants


async def test_expansion_can_be_disabled_by_argument() -> None:
    db = StubSession()
    await sparse_search(db, RID, "ipoteka", top_k=5, expand_scripts=False)  # type: ignore[arg-type]
    _, params = db.calls[0]
    assert _q_params(params) == ["ipoteka"]


async def test_expansion_can_be_disabled_by_rag_setting() -> None:
    """rag.settings.uz_script_expansion = false turns it off — used for A/B."""
    db = StubSession(rag_settings={"uz_script_expansion": False})
    await sparse_search(db, RID, "ipoteka", top_k=5)  # type: ignore[arg-type]
    _, params = db.calls[0]
    assert _q_params(params) == ["ipoteka"]


async def test_expansion_is_on_by_default() -> None:
    db = StubSession(rag_settings={})
    await sparse_search(db, RID, "ipoteka", top_k=5)  # type: ignore[arg-type]
    _, params = db.calls[0]
    assert len(_q_params(params)) > 1


async def test_variant_count_is_capped() -> None:
    db = StubSession()
    await sparse_search(db, RID, "bank банк aralash", top_k=5)  # type: ignore[arg-type]
    _, params = db.calls[0]
    assert len(_q_params(params)) <= 3


async def test_sql_binds_one_param_per_variant() -> None:
    """The generated SQL must reference exactly the params that were bound —
    a mismatch is a runtime error in Postgres, not a test-only detail."""
    db = StubSession()
    await sparse_search(db, RID, "ipoteka", top_k=5)  # type: ignore[arg-type]
    sql, params = db.calls[0]
    for i in range(len(_q_params(params))):
        assert f":q{i}" in sql
    assert f":q{len(_q_params(params))}" not in sql


async def test_blank_query_short_circuits() -> None:
    db = StubSession()
    assert await sparse_search(db, RID, "   ", top_k=5) == []  # type: ignore[arg-type]
    assert db.calls == []


async def test_results_are_mapped_to_hits() -> None:
    cid = uuid.uuid4()
    db = StubSession(rows=[_Row(id=str(cid), score=0.42)])
    hits = await sparse_search(db, RID, "ipoteka", top_k=5)  # type: ignore[arg-type]
    assert len(hits) == 1
    assert hits[0].chunk_id == cid
    assert hits[0].score == pytest.approx(0.42)


# ── existing guard: unknown language never reaches SQL ─────────────────────
@pytest.mark.parametrize(
    "lang,expected",
    [("russian", "russian"), ("uzbek", "simple"), (None, "simple"), ("'; DROP--", "simple")],
)
def test_ts_config_whitelist(lang: str | None, expected: str) -> None:
    assert _safe_ts_config(lang) == expected
