"""Sparse retrieval via Postgres full-text search (ts_rank_cd).

Replaces the former Qdrant BM25/fastembed implementation.  Language is picked
from ``rag.settings.fts_language``; unknown configs fall back to ``simple``
so the query never errors even for unsupported language names.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Rag

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


async def sparse_search(
    db: AsyncSession,
    rag_id: uuid.UUID,
    query: str,
    top_k: int,
    *,
    language: str | None = None,
) -> list[SparseHit]:
    """FTS sparse leg using ``plainto_tsquery`` + ``ts_rank_cd``."""
    if not query.strip():
        return []

    if not language:
        rag = (await db.execute(select(Rag).where(Rag.id == rag_id))).scalar_one_or_none()
        language = (rag.settings or {}).get("fts_language") if rag is not None else None

    ts_config = _safe_ts_config(language)

    # ts_rank_cd(tsvector, tsquery) returns a float in [0, 1].
    # We search over coalesce(heading, '') || ' ' || text so headings are
    # included in ranking but the chunk is still matched even without one.
    stmt = text(
        f"""
        SELECT id,
               ts_rank_cd(
                   to_tsvector('{ts_config}',
                               coalesce(heading, '') || ' ' || text),
                   plainto_tsquery('{ts_config}', :q)
               ) AS score
        FROM   chunks
        WHERE  rag_id = :rid
          AND  to_tsvector('{ts_config}',
                           coalesce(heading, '') || ' ' || text)
               @@ plainto_tsquery('{ts_config}', :q)
        ORDER  BY score DESC
        LIMIT  :k
        """
    )
    rows = (await db.execute(stmt, {"q": query, "rid": str(rag_id), "k": top_k})).all()
    return [SparseHit(chunk_id=uuid.UUID(str(r.id)), score=float(r.score)) for r in rows]
