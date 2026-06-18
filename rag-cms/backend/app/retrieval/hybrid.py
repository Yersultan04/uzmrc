"""Hybrid retrieval: pgvector dense + Postgres FTS sparse with
client-side WEIGHTED score blend.

The blend uses min-max normalization within each leg's result set so the
weights (0.8 dense / 0.2 sparse by default) actually behave proportionally —
without normalization, FTS ts_rank_cd scores (0-1 float) could be swamped by
dense cosine scores in edge cases.
"""
from __future__ import annotations

import asyncio
import uuid
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.clients.embeddings import embed_query
from app.config import get_settings
from app.models import Chunk, Rag
from app.presets import resolve_models_for_rag
from app.retrieval.dense import DenseHit, dense_search
from app.retrieval.sparse import SparseHit, sparse_search


@dataclass
class FusedHit:
    chunk_id: uuid.UUID
    score: float
    dense_score: float | None
    sparse_score: float | None


def _minmax(scores: list[float]) -> list[float]:
    """Return min-max normalized copy of ``scores`` (output in [0, 1]).
    Empty / single-element list passes through unchanged."""
    if not scores:
        return []
    lo, hi = min(scores), max(scores)
    if hi - lo < 1e-9:
        return [1.0] * len(scores)
    return [(s - lo) / (hi - lo) for s in scores]


def weighted_blend(
    dense_hits: list[DenseHit],
    sparse_hits: list[SparseHit],
    *,
    w_dense: float = 0.8,
    w_sparse: float = 0.2,
) -> list[FusedHit]:
    """Score-based weighted blend with per-leg min-max normalization."""
    d_norm = _minmax([h.score for h in dense_hits])
    s_norm = _minmax([h.score for h in sparse_hits])

    table: dict[uuid.UUID, dict] = {}
    for h, n in zip(dense_hits, d_norm, strict=True):
        table.setdefault(h.chunk_id, {"score": 0.0, "dense": None, "sparse": None})
        table[h.chunk_id]["dense"] = h.score
        table[h.chunk_id]["score"] += w_dense * n
    for h, n in zip(sparse_hits, s_norm, strict=True):
        table.setdefault(h.chunk_id, {"score": 0.0, "dense": None, "sparse": None})
        table[h.chunk_id]["sparse"] = h.score
        table[h.chunk_id]["score"] += w_sparse * n

    out: list[FusedHit] = [
        FusedHit(
            chunk_id=cid,
            score=v["score"],
            dense_score=v["dense"],
            sparse_score=v["sparse"],
        )
        for cid, v in table.items()
    ]
    out.sort(key=lambda h: h.score, reverse=True)
    return out


async def hybrid_search(
    db: AsyncSession,
    rag_id: uuid.UUID,
    query: str,
    top_k: int,
    mode: str = "hybrid",
    *,
    query_vector: list[float] | None = None,
) -> list[tuple[Chunk, FusedHit]]:
    """When ``query_vector`` is provided the dense leg reuses it instead of
    calling the embedder — lets callers (e.g. compare) pre-embed many queries
    in one batched request and stay under embedder rate limits."""
    s = get_settings()

    fts_lang: str = "simple"
    rag_models: dict | None = None
    rag_row = (await db.execute(select(Rag).where(Rag.id == rag_id))).scalar_one_or_none()
    if rag_row is not None:
        fts_lang = (rag_row.settings or {}).get("fts_language") or "simple"
        rag_models = resolve_models_for_rag(rag_row)

    async def _dense_leg() -> list[DenseHit]:
        if mode not in ("dense", "hybrid"):
            return []
        return await dense_search(
            db,
            rag_id,
            query,
            top_k=s.retrieval_top_k_dense,
            rag_models=rag_models,
            query_vector=query_vector,
        )

    async def _sparse_leg() -> list[SparseHit]:
        if mode not in ("sparse", "hybrid"):
            return []
        return await sparse_search(
            db,
            rag_id,
            query,
            top_k=s.retrieval_top_k_sparse,
            language=fts_lang,
        )

    dense_hits, sparse_hits = await asyncio.gather(_dense_leg(), _sparse_leg())

    if mode == "dense":
        fused: list[FusedHit] = [
            FusedHit(chunk_id=h.chunk_id, score=h.score, dense_score=h.score, sparse_score=None)
            for h in dense_hits
        ]
    elif mode == "sparse":
        fused = [
            FusedHit(chunk_id=h.chunk_id, score=h.score, dense_score=None, sparse_score=h.score)
            for h in sparse_hits
        ]
    else:
        fused = weighted_blend(dense_hits, sparse_hits)

    fused = fused[:top_k]
    if not fused:
        return []

    ids = [f.chunk_id for f in fused]
    rows = await db.execute(
        select(Chunk).options(selectinload(Chunk.file)).where(Chunk.id.in_(ids))
    )
    chunks_by_id = {c.id: c for c in rows.scalars().all()}
    out: list[tuple[Chunk, FusedHit]] = []
    for f in fused:
        c = chunks_by_id.get(f.chunk_id)
        if c is not None:
            out.append((c, f))
    return out
