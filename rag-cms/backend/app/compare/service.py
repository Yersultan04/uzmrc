"""Comparison orchestrator (Module 2).

parse → split into clauses → per-clause hybrid retrieval → LLM judge →
ground the cited quote → aggregate into a CompareReport.

The heavy external dependency is `hybrid_search` (needs the embedder) and the
LLM judge. Both are injected/patched in tests so the pipeline can be exercised
without a live embedder or model.
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from collections.abc import Awaitable, Callable

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.clients import embeddings
from app.clients import voyage as voyage_backend
from app.compare import judge as judge_mod
from app.compare.grounding import best_verbatim_window, is_quote_grounded
from app.compare.schemas import (
    ClauseFinding,
    ClauseRelation,
    CompareReport,
    CompareSummary,
    MatchedNorm,
)
from app.compare.splitter import Clause, split_clauses
from app.ingestion.parser import ParsedPage
from app.models import Rag
from app.presets import resolve_models_for_rag
from app.retrieval.hybrid import hybrid_search
from app.retrieval.rerank import RerankItem, llm_rerank

log = logging.getLogger("compare.service")

# Retrieval (Qdrant + sparse) is local/cheap — run it wide.
_RETRIEVE_CONCURRENCY = 8
# Judge calls go to a rate-limited LLM. Clauses are grouped into batches (one LLM
# call per batch) so the *request count* — not just tokens — stays under free-tier
# RPM (e.g. Gemini Flash-Lite = 15 RPM). Few batches → a couple of LLM calls total.
_JUDGE_BATCH_SIZE = 8
# Larger batches → fewer requests → friendlier to low daily request caps (Gemini
# Flash-Lite free RPD is small). Concurrency 2 stays well under its 15 RPM.
_JUDGE_CONCURRENCY = 2
# Wide retrieval pool per clause. We pull this many hybrid hits, then LLM-rerank
# them down to the top _CANDIDATES_PER_CLAUSE the judge actually sees. Widening the
# pool is what lets the *right* norm surface for a clause when pure hybrid score
# buries it just outside the top-3 (the infosec / board-exclusivity misses in demo).
_RETRIEVE_POOL = 10
# Candidate norms shown to the judge per clause (post-rerank). On the paid stack
# token budget is no longer the binding constraint, so 5 > the old 3 — more context
# for the judge without flooding it.
_CANDIDATES_PER_CLAUSE = 5
# LLM-rerank the wide pool before judging. Promotes the topically-correct norm over
# a lexically-similar but wrong one. Disable to fall back to raw hybrid top-K.
_RERANK_ENABLED = True
_RERANK_CONCURRENCY = 6
# Blend: mostly trust the reranker's semantic judgement, keep a little retrieval prior.
_RERANK_BLEND = 0.3
# Safety ceiling on clauses processed in one synchronous request.
_MAX_CLAUSES = 120

ProgressCb = Callable[[int, int], Awaitable[None] | None]


async def _retrieve_candidates(
    db: AsyncSession,
    rag_id: uuid.UUID,
    clause_text: str,
    query_vector: list[float] | None = None,
) -> list[tuple]:
    """Top-K base norms for a clause. Returns hybrid_search tuples (chunk, hit).

    `query_vector` (when given) is the pre-computed dense embedding for this clause,
    so hybrid_search skips the per-clause embedder call.
    """
    try:
        return await hybrid_search(
            db, rag_id, clause_text, top_k=_RETRIEVE_POOL, mode="hybrid",
            query_vector=query_vector,
        )
    except Exception as e:
        log.warning("retrieval failed for clause, treating as no candidates: %s", e)
        return []


async def _rerank_hits(
    clause_text: str, hits: list[tuple], rag_models: dict | None
) -> list[tuple]:
    """Rerank a clause's wide hit pool, return the top _CANDIDATES_PER_CLAUSE hits
    (chunk, hit) in reranked order.

    Prefers Voyage's dedicated reranker (fast, multilingual, no RPM storm). Falls
    back to the LLM reranker, then to raw hybrid top-K — so a rerank failure never
    breaks the comparison, only softens ranking.
    """
    if not hits:
        return []
    if not _RERANK_ENABLED or len(hits) <= 1:
        return hits[:_CANDIDATES_PER_CLAUSE]

    # 1) Voyage reranker (preferred).
    try:
        ranked = await voyage_backend.rerank(
            clause_text,
            [chunk.text for chunk, _ in hits],
            top_k=_CANDIDATES_PER_CLAUSE,
        )
        reordered = [hits[i] for i, _ in ranked if 0 <= i < len(hits)]
        if reordered:
            return reordered[:_CANDIDATES_PER_CLAUSE]
    except Exception as e:
        log.warning("voyage rerank failed, trying LLM reranker: %s", e)

    # 2) LLM reranker fallback.
    rm = rag_models or {}
    by_id = {chunk.id: (chunk, hit) for chunk, hit in hits}
    items = [
        RerankItem(chunk_id=chunk.id, text=chunk.text, score=getattr(hit, "score", 0.0))
        for chunk, hit in hits
    ]
    try:
        res = await llm_rerank(
            clause_text,
            items,
            top_n=_CANDIDATES_PER_CLAUSE,
            blend_with_retrieval=_RERANK_BLEND,
            model=rm.get("llm_rerank_model"),
            base_url=rm.get("llm_base_url"),
            api_key=rm.get("llm_api_key"),
            provider_order=rm.get("llm_provider_order"),
        )
        reordered = [by_id[it.chunk_id] for it in res.items if it.chunk_id in by_id]
        if reordered:
            return reordered[:_CANDIDATES_PER_CLAUSE]
    except Exception as e:
        log.warning("clause rerank failed, using raw top-K: %s", e)

    # 3) Raw hybrid top-K.
    return hits[:_CANDIDATES_PER_CLAUSE]


def _candidate_views(hits: list[tuple]) -> list[dict]:
    views: list[dict] = []
    for chunk, hit in hits:
        views.append(
            {
                "chunk_id": chunk.id,
                "file_id": chunk.file_id,
                "filename": getattr(chunk.file, "filename", "?"),
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "text": chunk.text,
                "score": getattr(hit, "score", 0.0),
            }
        )
    return views


def _finding_from_verdict(
    clause: Clause, candidate_views: list[dict], verdict
) -> ClauseFinding:
    """Build a ClauseFinding from an already-computed judge verdict."""
    matched: MatchedNorm | None = None
    if verdict.matched_candidate is not None and verdict.relation != ClauseRelation.gap:
        cv = candidate_views[verdict.matched_candidate]
        quote = verdict.quote or cv["text"][:300]
        grounded = is_quote_grounded(quote, cv["text"])
        # Salvage: if the judge paraphrased (not grounded), swap in the closest
        # verbatim sentence from the norm so the citation shown is always real.
        if not grounded:
            salvaged = best_verbatim_window(quote, cv["text"])
            if salvaged is not None:
                quote = salvaged
                grounded = True
        matched = MatchedNorm(
            chunk_id=cv["chunk_id"],
            file_id=cv["file_id"],
            filename=cv["filename"],
            page_start=cv["page_start"],
            page_end=cv["page_end"],
            quote=quote,
            score=cv["score"],
            grounded=grounded,
        )

    return ClauseFinding(
        clause_index=clause.index,
        clause_label=clause.label,
        clause_text=clause.text,
        page_start=clause.page_start,
        page_end=clause.page_end,
        relation=verdict.relation,
        rationale=verdict.rationale,
        recommendation=verdict.recommendation,
        confidence=verdict.confidence,
        matched_norm=matched,
    )


def _summarize(findings: list[ClauseFinding]) -> CompareSummary:
    s = CompareSummary(total_clauses=len(findings))
    for f in findings:
        setattr(s, f.relation.value, getattr(s, f.relation.value) + 1)
    return s


# Conflicts first (most actionable), then gaps, additions, duplicates.
_RELATION_ORDER = {
    ClauseRelation.conflict: 0,
    ClauseRelation.gap: 1,
    ClauseRelation.addition: 2,
    ClauseRelation.duplicate: 3,
}


async def compare_document(
    db: AsyncSession,
    rag_id: uuid.UUID,
    pages: list[ParsedPage],
    filename: str,
    *,
    on_progress: ProgressCb | None = None,
) -> CompareReport:
    rag_row = (await db.execute(select(Rag).where(Rag.id == rag_id))).scalar_one_or_none()
    rag_models = resolve_models_for_rag(rag_row) if rag_row is not None else None

    clauses = split_clauses(pages)
    truncated = len(clauses) > _MAX_CLAUSES
    note: str | None = None
    if truncated:
        note = (
            f"Документ содержит {len(clauses)} положений; обработаны первые "
            f"{_MAX_CLAUSES}. Разбейте документ или используйте пакетную обработку."
        )
        log.warning(note)
        clauses = clauses[:_MAX_CLAUSES]

    total = len(clauses)

    # Pre-embed every clause query in one batched call (instead of one embedder
    # request per clause). Keeps us under embedder rate limits and is far faster.
    # On failure, fall back to per-clause embedding inside hybrid_search.
    clause_vectors: list[list[float] | None] = [None] * total
    try:
        vecs = await embeddings.embed_queries(
            [c.text for c in clauses], rag_models=rag_models
        )
        if len(vecs) == total:
            clause_vectors = list(vecs)
    except Exception as e:
        log.warning("batch clause embedding failed, falling back per-clause: %s", e)

    # Stage 1 — retrieve a wide candidate pool per clause (Qdrant + sparse, local &
    # cheap), then LLM-rerank it down to the top norms the judge will see. Rerank is
    # what corrects topically-wrong-but-lexically-close matches.
    retr_sem = asyncio.Semaphore(_RETRIEVE_CONCURRENCY)
    rerank_sem = asyncio.Semaphore(_RERANK_CONCURRENCY)

    async def _retrieve(clause: Clause, qv: list[float] | None) -> list[dict]:
        async with retr_sem:
            hits = await _retrieve_candidates(db, rag_id, clause.text, qv)
        async with rerank_sem:
            hits = await _rerank_hits(clause.text, hits, rag_models)
        return _candidate_views(hits)

    views_per_clause = await asyncio.gather(
        *(_retrieve(c, v) for c, v in zip(clauses, clause_vectors, strict=True))
    )

    # Stage 2 — judge in batches: one LLM call per group of clauses keeps the request
    # count (not just tokens) under free-tier RPM. Verdicts map back by position.
    groups = [
        list(range(i, min(i + _JUDGE_BATCH_SIZE, total)))
        for i in range(0, total, _JUDGE_BATCH_SIZE)
    ]
    judge_sem = asyncio.Semaphore(_JUDGE_CONCURRENCY)
    findings: list[ClauseFinding | None] = [None] * total
    done = 0
    done_lock = asyncio.Lock()

    async def _judge_group(idxs: list[int]) -> None:
        nonlocal done
        items = [(clauses[i].text, views_per_clause[i]) for i in idxs]
        async with judge_sem:
            verdicts = await judge_mod.judge_clauses_batch(items, rag_models=rag_models)
        for i, verdict in zip(idxs, verdicts, strict=True):
            findings[i] = _finding_from_verdict(clauses[i], views_per_clause[i], verdict)
        async with done_lock:
            done += len(idxs)
            if on_progress is not None:
                res = on_progress(done, total)
                if res is not None and hasattr(res, "__await__"):
                    await res

    await asyncio.gather(*(_judge_group(g) for g in groups))
    findings = [f for f in findings if f is not None]
    findings.sort(key=lambda f: (_RELATION_ORDER.get(f.relation, 9), f.clause_index))

    return CompareReport(
        rag_id=rag_id,
        filename=filename,
        summary=_summarize(findings),
        findings=findings,
        truncated=truncated,
        note=note,
    )
