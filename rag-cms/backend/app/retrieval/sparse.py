"""Sparse retrieval via Postgres full-text search (ts_rank_cd).

Replaces the former Qdrant BM25/fastembed implementation.  Language is picked
from ``rag.settings.fts_language``; unknown configs fall back to ``simple``
so the query never errors even for unsupported language names.

Uzbek script expansion
----------------------
``simple`` does no stemming, so matching is literal: ``ipoteka`` can never hit a
chunk that spells the word ``ипотека``. In a corpus split 252/198 between the
two Uzbek scripts with a 3.6% term overlap, that costs a Latin query 44.3% of
its relevant documents and a Cyrillic one 52.1%.

Rather than rebuild the index, we widen the *query*: each search runs against
the OR of its Latin and Cyrillic renderings, so both halves of the corpus stay
reachable from either script. Set ``rag.settings.uz_script_expansion = false``
to turn it off (used for A/B measurement).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.lang.uz_translit import query_variants
from app.models import Rag

# Guards the OR-expansion so a pathological query can't build a huge tsquery.
_MAX_QUERY_VARIANTS = 3

# Postgres text-search configurations we trust.  Anything outside this set
# falls back to 'simple' (language-agnostic stemming).
_ALLOWED_TS_CONFIGS = frozenset(
    {"simple", "english", "russian", "german", "french", "spanish",
     "italian", "portuguese", "dutch", "danish", "swedish", "norwegian",
     "finnish", "turkish", "arabic", "romanian", "hungarian", "greek"}
)


def _safe_ts_config(lang: str | None) -> str:
    """Return a validated Postgres ts_config name, defaulting to 'simple'."""
    if not lang:
        return "simple"
    s = lang.strip().lower()
    return s if s in _ALLOWED_TS_CONFIGS else "simple"


@dataclass
class SparseHit:
    chunk_id: uuid.UUID
    score: float


def _tsquery_expr(ts_config: str, n_variants: int) -> str:
    """OR the per-variant tsqueries: ``plainto_tsquery(c,:q0) || ... ``.

    Variant text arrives as bind parameters, so only the whitelisted
    ``ts_config`` is ever interpolated into SQL.
    """
    return " || ".join(
        f"plainto_tsquery('{ts_config}', :q{i})" for i in range(n_variants)
    )


async def sparse_search(
    db: AsyncSession,
    rag_id: uuid.UUID,
    query: str,
    top_k: int,
    *,
    language: str | None = None,
    expand_scripts: bool | None = None,
) -> list[SparseHit]:
    """FTS sparse leg using ``plainto_tsquery`` + ``ts_rank_cd``.

    ``expand_scripts`` overrides ``rag.settings.uz_script_expansion``; both
    default to on. When enabled the query is matched against the OR of its
    Uzbek Latin and Cyrillic renderings.
    """
    if not query.strip():
        return []

    settings: dict = {}
    if language is None or expand_scripts is None:
        rag = (await db.execute(select(Rag).where(Rag.id == rag_id))).scalar_one_or_none()
        settings = (rag.settings or {}) if rag is not None else {}
    if language is None:
        language = settings.get("fts_language")
    if expand_scripts is None:
        expand_scripts = bool(settings.get("uz_script_expansion", True))

    ts_config = _safe_ts_config(language)

    variants = query_variants(query) if expand_scripts else [query]
    variants = variants[:_MAX_QUERY_VARIANTS] or [query]
    tsq = _tsquery_expr(ts_config, len(variants))

    # ts_rank_cd(tsvector, tsquery) returns a float in [0, 1].
    # We search over coalesce(heading, '') || ' ' || text so headings are
    # included in ranking but the chunk is still matched even without one.
    stmt = text(
        f"""
        WITH doc AS (
            SELECT id,
                   to_tsvector('{ts_config}',
                               coalesce(heading, '') || ' ' || text) AS tsv
            FROM   chunks
            WHERE  rag_id = :rid
        )
        SELECT id, ts_rank_cd(tsv, {tsq}) AS score
        FROM   doc
        WHERE  tsv @@ ({tsq})
        ORDER  BY score DESC
        LIMIT  :k
        """
    )
    params: dict[str, object] = {"rid": str(rag_id), "k": top_k}
    params.update({f"q{i}": v for i, v in enumerate(variants)})

    rows = (await db.execute(stmt, params)).all()
    return [SparseHit(chunk_id=uuid.UUID(str(r.id)), score=float(r.score)) for r in rows]
