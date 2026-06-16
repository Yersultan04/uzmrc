"""Unit tests for token-aware sub-batching in embed_documents_batched.

The OpenAI-compatible path must cap each request by BOTH chunk count
(batch_size) and estimated tokens (embed_tpm * 0.6), so a single request never
trips a provider's per-minute token cap (e.g. Gemini free = 30K TPM).

_est_tokens(t) == max(1, len(t) // 3) — deterministic, so batch boundaries
below are exact.
"""

from types import SimpleNamespace

import pytest

from app.clients import embeddings


@pytest.fixture
def captured(monkeypatch):
    """Force the OpenAI path and record the chunks passed to _openai_embed."""
    monkeypatch.setattr(
        embeddings,
        "_resolve_cfg",
        lambda rag_models=None: {"provider": "openai", "model": "x", "dim": 3},
    )
    calls: list[list[str]] = []

    async def fake_embed(chunk, cfg):
        calls.append(list(chunk))
        return [[0.0, 0.0, 0.0] for _ in chunk]

    monkeypatch.setattr(embeddings, "_openai_embed", fake_embed)
    return calls


def _set_tpm(monkeypatch, tpm: int):
    monkeypatch.setattr(embeddings, "get_settings", lambda: SimpleNamespace(embed_tpm=tpm))


@pytest.mark.asyncio
async def test_token_budget_splits_batches(captured, monkeypatch):
    # embed_tpm=100 -> token_budget = int(100*0.6) = 60.
    # Each text: len 90 -> est 30 tokens. Two fit (60), third overflows.
    _set_tpm(monkeypatch, 100)
    texts = ["x" * 90 for _ in range(4)]

    out = await embeddings.embed_documents_batched(texts, batch_size=64)

    assert len(out) == 4
    assert [len(c) for c in captured] == [2, 2]  # token cap, not count


@pytest.mark.asyncio
async def test_count_limit_respected(captured, monkeypatch):
    # Big token budget -> only batch_size (count) bounds the request.
    _set_tpm(monkeypatch, 1_000_000)
    texts = ["abc" for _ in range(5)]  # est 1 token each

    out = await embeddings.embed_documents_batched(texts, batch_size=2)

    assert len(out) == 5
    assert [len(c) for c in captured] == [2, 2, 1]


@pytest.mark.asyncio
async def test_oversized_single_item_gets_own_batch(captured, monkeypatch):
    # One chunk alone exceeds the budget; it must still go through (alone),
    # never silently dropped.
    _set_tpm(monkeypatch, 100)  # budget 60
    texts = ["x" * 300, "y" * 6]  # est 100 tokens, then 2 tokens

    out = await embeddings.embed_documents_batched(texts, batch_size=64)

    assert len(out) == 2
    assert [len(c) for c in captured] == [1, 1]


@pytest.mark.asyncio
async def test_default_budget_when_tpm_unset(captured, monkeypatch):
    # embed_tpm=0 -> fallback budget 18000. 64 small chunks fit by count first.
    _set_tpm(monkeypatch, 0)
    texts = ["abc" for _ in range(64)]

    out = await embeddings.embed_documents_batched(texts, batch_size=64)

    assert len(out) == 64
    assert [len(c) for c in captured] == [64]


@pytest.mark.asyncio
async def test_order_preserved(captured, monkeypatch):
    _set_tpm(monkeypatch, 100)
    texts = [f"text-{i}-" + "x" * 90 for i in range(5)]

    await embeddings.embed_documents_batched(texts, batch_size=64)

    flattened = [t for chunk in captured for t in chunk]
    assert flattened == texts


@pytest.mark.asyncio
async def test_empty_input(captured, monkeypatch):
    _set_tpm(monkeypatch, 100)
    out = await embeddings.embed_documents_batched([], batch_size=64)
    assert out == []
    assert captured == []
