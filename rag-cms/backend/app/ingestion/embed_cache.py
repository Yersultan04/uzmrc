"""Content-addressed embedding cache (Tier-0 zero-budget fix).

Wraps ``embed_documents_batched`` with a persistent Postgres cache keyed by
``sha256(model_sig | text)``. Re-indexing the same corpus with the same embedder
becomes a pure cache hit — no provider calls, no free-tier quota burn (the pain
that 4 re-indexes of the same corpus caused). Only cache-misses reach the
embedder.
"""

from __future__ import annotations

import hashlib
import logging

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients.embeddings import embed_documents_batched, model_signature
from app.models import EmbeddingCache

log = logging.getLogger("ingestion")

# Cap the IN(...) list size so a huge corpus doesn't build a pathological query.
_LOOKUP_CHUNK = 1000


def cache_key(model_sig: str, text: str) -> str:
    """sha256 over model signature + text, NUL-separated to avoid collisions."""
    h = hashlib.sha256()
    h.update(model_sig.encode("utf-8"))
    h.update(b"\x00")
    h.update(text.encode("utf-8"))
    return h.hexdigest()


async def embed_with_cache(
    db: AsyncSession,
    texts: list[str],
    *,
    rag_models: dict | None = None,
    batch_size: int = 64,
    on_batch=None,
) -> list[list[float]]:
    """Embed ``texts`` returning one vector per input, hitting the cache first.

    Order- and duplicate-preserving: the returned list matches ``texts`` 1:1,
    even when the corpus repeats identical chunks. ``on_batch`` reports progress
    over the *miss* set (the work actually done); an all-hit call reports 1/1.
    """
    if not texts:
        return []

    model_sig = model_signature(rag_models)
    dim = int(model_sig.rsplit(":", 1)[1])
    keys = [cache_key(model_sig, t) for t in texts]

    # 1) Bulk-load whatever is already cached (de-duped lookup).
    unique_keys = list(dict.fromkeys(keys))
    cached: dict[str, list[float]] = {}
    for i in range(0, len(unique_keys), _LOOKUP_CHUNK):
        batch = unique_keys[i : i + _LOOKUP_CHUNK]
        rows = await db.execute(
            select(EmbeddingCache.hash, EmbeddingCache.vector).where(
                EmbeddingCache.hash.in_(batch)
            )
        )
        for h, vec in rows.all():
            cached[h] = vec

    # 2) Collect unique misses, preserving first-seen order.
    miss_keys: list[str] = []
    miss_texts: list[str] = []
    seen: set[str] = set()
    for k, t in zip(keys, texts, strict=True):
        if k in cached or k in seen:
            continue
        seen.add(k)
        miss_keys.append(k)
        miss_texts.append(t)

    log.info(
        "embed cache: %d texts, %d unique, %d hits, %d to embed (model_sig=%s)",
        len(texts),
        len(unique_keys),
        len(unique_keys) - len(miss_keys),
        len(miss_keys),
        model_sig,
    )

    # 3) Embed only the misses, then persist them.
    if miss_texts:
        new_vectors = await embed_documents_batched(
            miss_texts,
            batch_size=batch_size,
            on_batch=on_batch,
            rag_models=rag_models,
        )
        rows_to_insert = []
        for k, vec in zip(miss_keys, new_vectors, strict=True):
            cached[k] = vec
            rows_to_insert.append(
                {"hash": k, "model_sig": model_sig, "dim": dim, "vector": vec}
            )
        # ON CONFLICT DO NOTHING: another concurrent ingest may insert the same
        # hash; first writer wins, vectors are identical anyway.
        stmt = pg_insert(EmbeddingCache).values(rows_to_insert)
        stmt = stmt.on_conflict_do_nothing(index_elements=["hash"])
        await db.execute(stmt)
        await db.commit()
    elif on_batch is not None:
        # Everything was cached — signal instant completion so the progress UI
        # doesn't appear stuck at 0%.
        res = on_batch(1, 1)
        if hasattr(res, "__await__"):
            await res

    # 4) Reassemble in original order (duplicates included).
    return [cached[k] for k in keys]
