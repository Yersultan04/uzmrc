"""Unit tests for the content-addressed embedding cache.

A FakeDB stands in for AsyncSession: SELECT returns everything stored (the
helper only consumes the keys it asked for, so extra rows are harmless), INSERT
persists the rows so a second call can hit them.
"""

import pytest
from sqlalchemy.sql.dml import Insert
from sqlalchemy.sql.selectable import Select

from app.ingestion import embed_cache


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class FakeDB:
    def __init__(self):
        self.store: dict[str, list[float]] = {}
        self.commits = 0

    async def execute(self, stmt):
        if isinstance(stmt, Select):
            return _Result(list(self.store.items()))
        if isinstance(stmt, Insert):
            rows = stmt._multi_values[0]
            for r in rows:
                # pg_insert on an ORM model keys the dict by Column objects.
                row = {(getattr(k, "name", k)): v for k, v in r.items()}
                self.store.setdefault(row["hash"], row["vector"])
            return _Result([])
        return _Result([])

    async def commit(self):
        self.commits += 1


@pytest.fixture
def patch_embed(monkeypatch):
    """Force a fixed model_sig and record what gets sent to the embedder."""
    monkeypatch.setattr(embed_cache, "model_signature", lambda rag_models=None: "openai:m:3")
    calls: list[list[str]] = []

    async def fake_embed(texts, *, batch_size=64, on_batch=None, rag_models=None):
        calls.append(list(texts))
        # Deterministic distinct vector per text.
        return [[float(len(t)), 0.0, 0.0] for t in texts]

    monkeypatch.setattr(embed_cache, "embed_documents_batched", fake_embed)
    return calls


@pytest.mark.asyncio
async def test_cold_then_warm(patch_embed):
    db = FakeDB()
    texts = ["alpha", "beta", "gamma"]

    # Cold: all miss -> embedder called once with all texts.
    out1 = await embed_cache.embed_with_cache(db, texts)
    assert len(out1) == 3
    assert patch_embed == [texts]
    assert db.commits == 1
    assert len(db.store) == 3  # persisted

    # Warm: same corpus -> zero embedder calls (quota saved).
    out2 = await embed_cache.embed_with_cache(db, texts)
    assert out2 == out1
    assert patch_embed == [texts]  # unchanged — no new call
    assert db.commits == 1  # no insert, no commit


@pytest.mark.asyncio
async def test_partial_hit_only_embeds_misses(patch_embed):
    db = FakeDB()
    await embed_cache.embed_with_cache(db, ["alpha", "beta"])
    patch_embed.clear()

    # "beta" cached, "delta" new -> only "delta" embedded.
    out = await embed_cache.embed_with_cache(db, ["beta", "delta"])
    assert patch_embed == [["delta"]]
    assert len(out) == 2
    assert out[0] == [4.0, 0.0, 0.0]  # beta from cache (len 4)
    assert out[1] == [5.0, 0.0, 0.0]  # delta fresh (len 5)


@pytest.mark.asyncio
async def test_duplicates_embedded_once_returned_each(patch_embed):
    db = FakeDB()
    texts = ["same", "same", "same"]

    out = await embed_cache.embed_with_cache(db, texts)

    # Embedder sees the unique text once...
    assert patch_embed == [["same"]]
    # ...but the caller gets one vector per input position.
    assert len(out) == 3
    assert out[0] == out[1] == out[2]


@pytest.mark.asyncio
async def test_different_model_sig_isolates_cache(monkeypatch):
    db = FakeDB()
    calls: list[list[str]] = []

    async def fake_embed(texts, *, batch_size=64, on_batch=None, rag_models=None):
        calls.append(list(texts))
        return [[1.0] for _ in texts]

    monkeypatch.setattr(embed_cache, "embed_documents_batched", fake_embed)

    monkeypatch.setattr(embed_cache, "model_signature", lambda rag_models=None: "openai:m1:1")
    await embed_cache.embed_with_cache(db, ["x"])

    # Switch embedder identity -> same text must miss (different space).
    monkeypatch.setattr(embed_cache, "model_signature", lambda rag_models=None: "openai:m2:1")
    await embed_cache.embed_with_cache(db, ["x"])

    assert calls == [["x"], ["x"]]  # embedded twice, once per model_sig


@pytest.mark.asyncio
async def test_empty_input(patch_embed):
    db = FakeDB()
    out = await embed_cache.embed_with_cache(db, [])
    assert out == []
    assert patch_embed == []


@pytest.mark.asyncio
async def test_all_hit_reports_progress(patch_embed):
    db = FakeDB()
    await embed_cache.embed_with_cache(db, ["alpha"])

    seen: list[tuple[int, int]] = []

    def on_batch(done, total):
        seen.append((done, total))

    await embed_cache.embed_with_cache(db, ["alpha"], on_batch=on_batch)
    assert seen == [(1, 1)]  # instant-completion signal on full hit


def test_cache_key_is_namespaced():
    # Same text, different model_sig -> different key.
    assert embed_cache.cache_key("a:b:1", "hello") != embed_cache.cache_key("a:c:1", "hello")
    # Stable for identical inputs.
    assert embed_cache.cache_key("a:b:1", "hello") == embed_cache.cache_key("a:b:1", "hello")
