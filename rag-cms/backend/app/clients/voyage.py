from __future__ import annotations

import asyncio
import time
from functools import lru_cache

import voyageai
from tenacity import retry, retry_if_exception_type, stop_after_attempt, wait_exponential

from app.config import get_settings

# Each Voyage request stays under this token budget so a single call never trips
# the free-tier per-minute token cap (10K TPM → keep one request well below it).
_TOKEN_BUDGET = 8000


@lru_cache
def get_voyage_client() -> voyageai.AsyncClient:
    s = get_settings()
    if not s.voyage_api_key:
        raise RuntimeError("VOYAGE_API_KEY is not set")
    return voyageai.AsyncClient(api_key=s.voyage_api_key)


def _effective_model(explicit: str | None) -> str:
    if explicit:
        return explicit
    return get_settings().voyage_embed_model


def _est_tokens(text: str) -> int:
    """Cheap, deliberately-conservative token estimate (~4 chars/token, +slack)."""
    return max(1, len(text) // 3)


class _RateLimiter:
    """Throttle Voyage requests to a requests-per-minute AND tokens-per-minute
    budget. Both ingest (many doc batches) and live queries go through this, so
    the free tier (3 RPM / 10K TPM) no longer dies on RateLimitError."""

    def __init__(self, rpm: int, tpm: int) -> None:
        self.min_interval = (60.0 / rpm) if rpm and rpm > 0 else 0.0
        self.tpm = tpm if tpm and tpm > 0 else 0
        self._lock = asyncio.Lock()
        self._next_at = 0.0
        self._window: list[tuple[float, int]] = []  # (ts, tokens) within trailing 60s

    async def acquire(self, tokens: int) -> None:
        if not self.min_interval and not self.tpm:
            return
        async with self._lock:
            while True:
                now = time.monotonic()
                self._window = [(t, n) for (t, n) in self._window if now - t < 60.0]
                used = sum(n for _, n in self._window)
                wait = max(0.0, self._next_at - now)
                if self.tpm and self._window and used + tokens > self.tpm:
                    oldest = self._window[0][0]
                    wait = max(wait, 60.0 - (now - oldest) + 0.1)
                if wait <= 0:
                    break
                await asyncio.sleep(min(wait, 5.0))
            now = time.monotonic()
            self._next_at = now + self.min_interval
            self._window.append((now, tokens))


@lru_cache
def _limiter() -> _RateLimiter:
    s = get_settings()
    return _RateLimiter(s.voyage_rpm, s.voyage_tpm)


@retry(
    retry=retry_if_exception_type(voyageai.error.RateLimitError),
    stop=stop_after_attempt(8),
    wait=wait_exponential(multiplier=1, min=2, max=60),
)
async def _raw_embed(texts: list[str], input_type: str, model: str | None) -> list[list[float]]:
    client = get_voyage_client()
    res = await client.embed(texts, model=_effective_model(model), input_type=input_type)
    return res.embeddings


async def _embed(
    texts: list[str], input_type: str, *, model: str | None = None, on_batch=None
) -> list[list[float]]:
    """Token-budgeted, rate-limited embedding. Splits `texts` into sub-batches
    each under the per-request token budget and paces them via the limiter."""
    if not texts:
        return []
    # Pre-split into token-bounded batches so we know the total for progress.
    batches: list[list[str]] = []
    cur: list[str] = []
    cur_tok = 0
    for t in texts:
        tk = _est_tokens(t)
        if cur and cur_tok + tk > _TOKEN_BUDGET:
            batches.append(cur)
            cur, cur_tok = [], 0
        cur.append(t)
        cur_tok += tk
    if cur:
        batches.append(cur)

    out: list[list[float]] = []
    for done, batch in enumerate(batches, 1):
        await _limiter().acquire(sum(_est_tokens(t) for t in batch))
        out.extend(await _raw_embed(batch, input_type, model))
        if on_batch is not None:
            try:
                res = on_batch(done, len(batches))
                if hasattr(res, "__await__"):
                    await res
            except Exception:
                pass
        await asyncio.sleep(0)
    return out


# ---------------- public API (unchanged signatures) ----------------


async def embed_documents(texts: list[str], *, model: str | None = None) -> list[list[float]]:
    return await _embed(texts, "document", model=model)


async def embed_query(text: str, *, model: str | None = None) -> list[float]:
    return (await _embed([text], "query", model=model))[0]


async def embed_documents_batched(
    texts: list[str],
    batch_size: int = 64,  # kept for signature compat; batching is token-driven now
    on_batch=None,
    *,
    model: str | None = None,
) -> list[list[float]]:
    return await _embed(texts, "document", model=model, on_batch=on_batch)


async def embed_queries_batched(
    texts: list[str], batch_size: int = 128, *, model: str | None = None
) -> list[list[float]]:
    """Embed many query texts with as few API calls as possible (token-batched +
    rate-limited). Used by Module 2 (compare) to pre-embed all clause queries."""
    return await _embed(texts, "query", model=model)


@retry(
    reraise=True,
    stop=stop_after_attempt(4),
    wait=wait_exponential(multiplier=1, min=1, max=20),
    retry=retry_if_exception_type(voyageai.error.RateLimitError),
)
async def rerank(
    query: str,
    documents: list[str],
    *,
    top_k: int | None = None,
    model: str | None = None,
) -> list[tuple[int, float]]:
    """Rerank `documents` against `query` with Voyage's dedicated reranker.

    Returns (original_index, relevance_score) pairs, highest score first, limited
    to top_k. Purpose-built and multilingual — much faster and more robust than an
    LLM reranker, with no per-call JSON parsing or RPM storm under fan-out.
    """
    if not documents:
        return []
    s = get_settings()
    mdl = model or s.voyage_rerank_model
    client = get_voyage_client()
    res = await client.rerank(query, documents, model=mdl, top_k=top_k)
    return [(r.index, r.relevance_score) for r in res.results]
