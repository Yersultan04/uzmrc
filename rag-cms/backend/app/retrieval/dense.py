from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.embeddings import embed_query


@dataclass
class DenseHit:
    chunk_id: uuid.UUID
    score: float


async def dense_search(
    db: AsyncSession,
    rag_id: uuid.UUID,
    query: str,
    top_k: int,
    *,
    rag_models: dict | None = None,
    query_vector: list[float] | None = None,
) -> list[DenseHit]:
    """Dense retrieval via pgvector cosine similarity.

    Uses a brute-force scan (no ANN index) — correct for small corpora that
    fit in RAM.  The cast ``::vector`` is safe because we build the literal
    from a Python list of floats, not from user input.
    """
    vec = query_vector if query_vector is not None else await embed_query(
        query, rag_models=rag_models
    )

    # Build the Postgres vector literal from a Python list.  We use a bound
    # parameter for the rag_id (UUID) and construct the vector literal inline
    # (no SQL injection risk — values are float, not user-supplied strings).
    vec_literal = "[" + ",".join(str(float(v)) for v in vec) + "]"

    stmt = text(
        """
        SELECT id,
               1 - (embedding <=> CAST(:qvec AS vector)) AS score
        FROM   chunks
        WHERE  rag_id = :rid
          AND  embedding IS NOT NULL
        ORDER  BY embedding <=> CAST(:qvec AS vector)
        LIMIT  :k
        """
    )
    rows = (
        await db.execute(
            stmt,
            {"qvec": vec_literal, "rid": str(rag_id), "k": top_k},
        )
    ).all()

    return [DenseHit(chunk_id=uuid.UUID(str(r.id)), score=float(r.score)) for r in rows]
