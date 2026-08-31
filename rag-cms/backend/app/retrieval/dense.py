"""Dense retrieval via pgvector cosine similarity.

Uzbek script expansion
----------------------
The embedder bridges the two Uzbek scripts only partially. Measured on
voyage-3.5 over domain terms (eval/bench_dense_script_gap.py): same term across
scripts averages 0.733 cosine against a 0.336 unrelated-term baseline, so the
model is clearly not script-blind. But the spread is wide and it splits along a
predictable line — Russian loanwords score high (``kredit``/``кредит`` 0.885,
``bank``/``банк`` 0.874) while native Uzbek vocabulary drops sharply
(``hisobot``/``ҳисобот`` 0.427, ``nazorat kengashi`` 0.600).

At 0.427 a relevant chunk can fall outside top-k purely because the query was
typed in the other script. So the query is embedded in both renderings and each
chunk scored by its best match. Cost is one extra short query embedding, batched
into the same API call, and no extra table scan — ``GREATEST`` folds the
variants into the single existing pass.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.embeddings import embed_queries, embed_query
from app.lang.uz_translit import query_variants

# Mirrors the sparse leg's cap: keeps a pathological query from fanning out.
_MAX_QUERY_VARIANTS = 3


@dataclass
class DenseHit:
    chunk_id: uuid.UUID
    score: float


def _vec_literal(vec: list[float]) -> str:
    """Postgres vector literal from a Python float list."""
    return "[" + ",".join(str(float(v)) for v in vec) + "]"


def _score_expr(n: int) -> str:
    """Cosine score against the best-matching query variant."""
    sims = [f"1 - (embedding <=> CAST(:qvec{i} AS vector))" for i in range(n)]
    return sims[0] if n == 1 else f"GREATEST({', '.join(sims)})"


async def dense_search(
    db: AsyncSession,
    rag_id: uuid.UUID,
    query: str,
    top_k: int,
    *,
    rag_models: dict | None = None,
    query_vector: list[float] | None = None,
    expand_scripts: bool = True,
) -> list[DenseHit]:
    """Dense retrieval via pgvector cosine similarity.

    Uses a brute-force scan (no ANN index) — correct for small corpora that
    fit in RAM.  The cast ``::vector`` is safe because we build the literal
    from a Python list of floats, not from user input.

    When ``query_vector`` is supplied the caller has already embedded the query
    (e.g. compare batching many clauses), so it is used as-is and no script
    expansion happens — the caller owns that decision.
    """
    if query_vector is not None:
        vectors = [query_vector]
    else:
        variants = query_variants(query)[:_MAX_QUERY_VARIANTS] if expand_scripts else []
        if len(variants) > 1:
            vectors = await embed_queries(variants, rag_models=rag_models)
        else:
            vectors = [await embed_query(query, rag_models=rag_models)]

    # Build the Postgres vector literals from Python lists.  We use bound
    # parameters for the rag_id (UUID) and the vectors (no SQL injection risk —
    # values are float, not user-supplied strings).
    params: dict[str, object] = {"rid": str(rag_id), "k": top_k}
    params.update({f"qvec{i}": _vec_literal(v) for i, v in enumerate(vectors)})
    score = _score_expr(len(vectors))

    # Single variant keeps the distance-ordered form so a future ANN index
    # (ivfflat/hnsw) can serve it; GREATEST over several variants cannot use
    # one anyway, and the scan is brute-force today either way.
    order = (
        "embedding <=> CAST(:qvec0 AS vector) ASC"
        if len(vectors) == 1
        else "score DESC"
    )
    stmt = text(
        f"""
        SELECT id, {score} AS score
        FROM   chunks
        WHERE  rag_id = :rid
          AND  embedding IS NOT NULL
        ORDER  BY {order}
        LIMIT  :k
        """
    )
    rows = (await db.execute(stmt, params)).all()

    return [DenseHit(chunk_id=uuid.UUID(str(r.id)), score=float(r.score)) for r in rows]
