from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.compare import judge as judge_mod
from app.compare import service as service_mod
from app.compare.schemas import ClauseRelation, JudgeVerdict
from app.ingestion.parser import ParsedPage


class _FakeResult:
    def scalar_one_or_none(self):
        return None  # no Rag row → rag_models falls back to None


class _FakeDB:
    async def execute(self, *_a, **_k):
        return _FakeResult()


def _make_chunk(text: str, filename: str = "norm.pdf", page: int = 1):
    return SimpleNamespace(
        id=uuid.uuid4(),
        file_id=uuid.uuid4(),
        file=SimpleNamespace(filename=filename),
        page_start=page,
        page_end=page,
        text=text,
    )


def _patch_retrieval(monkeypatch, chunk_text: str = "Первоначальный взнос не менее 20 процентов."):
    async def fake_hybrid_search(db, rag_id, query, top_k, mode="hybrid", *, query_vector=None):
        chunk = _make_chunk(chunk_text)
        hit = SimpleNamespace(score=0.91)
        return [(chunk, hit)]

    async def fake_embed_queries(texts, *, rag_models=None):
        return [[0.0] * 8 for _ in texts]

    monkeypatch.setattr(service_mod, "hybrid_search", fake_hybrid_search)
    monkeypatch.setattr(service_mod.embeddings, "embed_queries", fake_embed_queries)


async def test_compare_end_to_end_conflict(monkeypatch):
    _patch_retrieval(monkeypatch)

    async def fake_judge_batch(items, *, rag_models=None):
        return [
            JudgeVerdict(
                relation=ClauseRelation.conflict,
                matched_candidate=0,
                quote="не менее 20 процентов",
                rationale="ставки расходятся",
                recommendation="согласовать",
                confidence=0.85,
            )
            for _ in items
        ]

    monkeypatch.setattr(judge_mod, "judge_clauses_batch", fake_judge_batch)

    pages = [ParsedPage(page_number=1, text="Статья 1. Первоначальный взнос 30 процентов от стоимости жилья.")]
    report = await service_mod.compare_document(_FakeDB(), uuid.uuid4(), pages, "new.pdf")

    assert report.summary.total_clauses == 1
    assert report.summary.conflict == 1
    f = report.findings[0]
    assert f.relation == ClauseRelation.conflict
    assert f.matched_norm is not None
    # Quote is verbatim from the retrieved norm → grounded.
    assert f.matched_norm.grounded is True


async def test_compare_gap_has_no_matched_norm(monkeypatch):
    _patch_retrieval(monkeypatch)

    async def fake_judge_batch(items, *, rag_models=None):
        return [
            JudgeVerdict(
                relation=ClauseRelation.gap,
                matched_candidate=None,
                rationale="новая тема",
                recommendation="рассмотреть",
                confidence=0.5,
            )
            for _ in items
        ]

    monkeypatch.setattr(judge_mod, "judge_clauses_batch", fake_judge_batch)

    pages = [ParsedPage(page_number=1, text="Статья 1. Совершенно новое регулирование по теме без аналогов.")]
    report = await service_mod.compare_document(_FakeDB(), uuid.uuid4(), pages, "new.pdf")
    assert report.summary.gap == 1
    assert report.findings[0].matched_norm is None


async def test_ungrounded_quote_flagged(monkeypatch):
    _patch_retrieval(monkeypatch, chunk_text="Срок рассмотрения заявки составляет 10 рабочих дней.")

    async def fake_judge_batch(items, *, rag_models=None):
        # Quote does NOT appear in the retrieved norm → must be flagged ungrounded.
        return [
            JudgeVerdict(
                relation=ClauseRelation.duplicate,
                matched_candidate=0,
                quote="первоначальный взнос пятьдесят процентов наличными деньгами",
                rationale="...",
                recommendation="...",
                confidence=0.6,
            )
            for _ in items
        ]

    monkeypatch.setattr(judge_mod, "judge_clauses_batch", fake_judge_batch)

    pages = [ParsedPage(page_number=1, text="Статья 1. Некоторое положение длиной достаточной для обработки.")]
    report = await service_mod.compare_document(_FakeDB(), uuid.uuid4(), pages, "new.pdf")
    assert report.findings[0].matched_norm.grounded is False


async def test_findings_sorted_conflicts_first(monkeypatch):
    _patch_retrieval(monkeypatch)

    async def fake_judge_batch(items, *, rag_models=None):
        # Alternate duplicate / conflict so we can assert ordering.
        out = []
        for n, _ in enumerate(items, start=1):
            rel = ClauseRelation.duplicate if n % 2 else ClauseRelation.conflict
            out.append(JudgeVerdict(
                relation=rel,
                matched_candidate=0,
                quote="не менее 20 процентов",
                rationale="x",
                recommendation="y",
                confidence=0.7,
            ))
        return out

    monkeypatch.setattr(judge_mod, "judge_clauses_batch", fake_judge_batch)

    text = "\n".join(
        f"Статья {i}. Положение номер {i} с достаточно длинным текстом для отдельной единицы."
        for i in range(1, 5)
    )
    report = await service_mod.compare_document(
        _FakeDB(), uuid.uuid4(), [ParsedPage(page_number=1, text=text)], "new.pdf"
    )
    assert report.findings[0].relation == ClauseRelation.conflict


# ── Reranking (Phase 1: retrieval precision) ──────────────────────────────────

def _hit(text: str, score: float):
    return (_make_chunk(text), SimpleNamespace(score=score))


async def test_rerank_hits_voyage_reorders_and_trims(monkeypatch):
    # Wide pool of 4; Voyage rerank promotes index 3 then 1, trim to top-2.
    hits = [_hit(f"norm {i}", 0.5) for i in range(4)]
    monkeypatch.setattr(service_mod, "_CANDIDATES_PER_CLAUSE", 2)

    async def fake_voyage_rerank(query, docs, *, top_k=None, model=None):
        assert len(docs) == 4
        return [(3, 0.99), (1, 0.80)][:top_k]

    monkeypatch.setattr(service_mod.voyage_backend, "rerank", fake_voyage_rerank)

    out = await service_mod._rerank_hits("q", hits, None)
    assert [c.text for c, _ in out] == ["norm 3", "norm 1"]


async def test_rerank_hits_falls_back_to_llm_then_raw(monkeypatch):
    hits = [_hit(f"norm {i}", 0.9 - i * 0.1) for i in range(4)]
    monkeypatch.setattr(service_mod, "_CANDIDATES_PER_CLAUSE", 3)

    async def boom_voyage(*_a, **_k):
        raise RuntimeError("voyage down")

    async def boom_llm(*_a, **_k):
        raise RuntimeError("llm down")

    monkeypatch.setattr(service_mod.voyage_backend, "rerank", boom_voyage)
    monkeypatch.setattr(service_mod, "llm_rerank", boom_llm)

    # Both rerankers fail → raw hybrid top-K, original order preserved.
    out = await service_mod._rerank_hits("q", hits, None)
    assert [c.text for c, _ in out] == ["norm 0", "norm 1", "norm 2"]


async def test_rerank_hits_single_hit_skips_rerank(monkeypatch):
    called = {"n": 0}

    async def spy(*_a, **_k):
        called["n"] += 1
        return []

    monkeypatch.setattr(service_mod.voyage_backend, "rerank", spy)
    out = await service_mod._rerank_hits("q", [_hit("only", 0.5)], None)
    assert len(out) == 1 and called["n"] == 0  # short-circuit, no rerank call
