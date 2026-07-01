from __future__ import annotations

import asyncio
import json
import logging
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

from pydantic import ValidationError
from sqlalchemy import select

from app.agent.events import EventBroker
from app.agent.grounding import ground_citations
from app.agent.prompts import (
    _resolve_persona,
    build_admin_instructions,
    build_smalltalk_message,
    build_system_message,
    check_restricted_topics,
)
from app.agent.router import RouteDecision, route_query
from app.agent.schemas import (
    Citation,
    Escalation,
    FinalAnswer,
    NextStepEnvelope,
    PoolEntry,
    ToolCall,
)
from app.agent.tools import AgentContext, ToolResult, dispatch
from app.clients.llm import chat, chat_stream
from app.config import get_settings
from app.db import SessionLocal
from app.models import AgentRun, AgentRunStatus, ChatSession, Rag
from app.presets import resolve_models_for_rag

log = logging.getLogger("agent")

DEFAULT_MAX_STEPS = 8   # corpus questions rarely need >4 steps once pre-search seeds the
                        # pool; cap worst-case latency (was 14 — let runs wander to ~60-90s)
HISTORY_KEEP_RECENT = 6
POOL_PROMPT_CAP = 12  # how many pool entries shown in the prompt at once
POOL_TEXT_CAP_CHARS = 700  # truncate each entry's text in the prompt
RECENT_TOOL_CALLS_BUFFER = 6
REPEAT_TOOL_LIMIT = 2  # max identical (tool, args) calls before nudge

# Chat-session memory: keep the last N turns verbatim, summarise the rest.
SESSION_RECENT_TURNS = 5


POOL_PER_FILE_CAP = 4  # in the merged pool the model sees & cites from, keep at
                       # most this many chunks per document so citations span
                       # several files instead of one big doc dominating. The
                       # per-search cap in tools.py limits each retrieval; this
                       # enforces diversity on the ACCUMULATED pool across searches.


def _cap_per_file(pool: list[PoolEntry], cap: int = POOL_PER_FILE_CAP) -> list[PoolEntry]:
    """Drop a document's lowest-scoring chunks once it already has `cap` in the
    (score-sorted) pool. Generous cap → specific single-doc answers keep enough
    evidence, but a vague query can no longer be swept by one document."""
    seen: dict[uuid.UUID, int] = {}
    out: list[PoolEntry] = []
    for p in pool:
        n = seen.get(p.file_id, 0)
        if n < cap:
            out.append(p)
            seen[p.file_id] = n + 1
    return out


def _pool_dedup_merge(pool: list[PoolEntry], new: list[PoolEntry]) -> list[PoolEntry]:
    by_id: dict[uuid.UUID, PoolEntry] = {p.chunk_id: p for p in pool}
    for n in new:
        cur = by_id.get(n.chunk_id)
        if cur is None or n.score > cur.score:
            by_id[n.chunk_id] = n
    merged = sorted(by_id.values(), key=lambda p: p.score, reverse=True)
    return _cap_per_file(merged)


def _format_pool(pool: list[PoolEntry]) -> str:
    if not pool:
        return "(empty)"
    lines = []
    for i, p in enumerate(pool[:POOL_PROMPT_CAP], start=1):
        head = p.heading or "—"
        page = f"p.{p.page_start}" if p.page_start == p.page_end else f"p.{p.page_start}-{p.page_end}"
        snippet = (p.text or "").strip().replace("\n", " ")
        if len(snippet) > POOL_TEXT_CAP_CHARS:
            snippet = snippet[: POOL_TEXT_CAP_CHARS - 1] + "…"
        lines.append(
            f"[{i}] chunk_id={p.chunk_id} file_id={p.file_id} file={p.filename!r} "
            f"{page} score={p.score:.3f} heading={head!r}\n    {snippet}"
        )
    suffix = ""
    if len(pool) > POOL_PROMPT_CAP:
        suffix = f"\n…({len(pool) - POOL_PROMPT_CAP} more chunks in the pool, not shown)"
    return "\n".join(lines) + suffix


def _format_prior_block(prior_turns: list[dict] | None) -> str:
    if not prior_turns:
        return ""
    lines = ["PRIOR CONVERSATION (same chat session — use for context only):"]
    for t in prior_turns:
        kind = t.get("kind", "turn")
        if kind == "summary":
            lines.append("  [Earlier in this conversation — summary]")
            summ = (t.get("summary") or "").strip()
            # indent each line so it sits inside the block
            for ln in summ.splitlines():
                lines.append(f"    {ln}")
        else:
            q = (t.get("query") or "").strip().replace("\n", " ")
            a = (t.get("answer") or "").strip().replace("\n", " ")
            if len(q) > 240:
                q = q[:240] + "…"
            if len(a) > 600:
                a = a[:600] + "…"
            lines.append(f"  Q: {q}")
            if a:
                lines.append(f"  A: {a}")
    return "\n".join(lines) + "\n\n"


def _summarize_history(history: list[dict]) -> str:
    if not history:
        return "(no prior steps)"
    parts: list[str] = []
    for h in history:
        t = h.get("type")
        if t == "tool":
            parts.append(f"#{h['step']} tool={h['tool']} args={h['args']} → {h['summary'][:160]}")
        elif t == "error":
            parts.append(f"#{h['step']} error: {h['summary'][:160]}")
        elif t == "parse_error":
            parts.append(f"#{h['step']} invalid model output: {h['summary'][:160]}")
    return "\n".join(parts)


def _build_messages(
    query: str,
    pool: list[PoolEntry],
    history: list[dict],
    step_idx: int,
    max_steps: int,
    nudge: str | None,
    route: RouteDecision | None = None,
    prior_turns: list[dict] | None = None,
    web_search_enabled: bool = False,
    persona_override: str | None = None,
) -> list[dict]:
    recent = history[-HISTORY_KEEP_RECENT:]
    older = history[:-HISTORY_KEEP_RECENT]

    summary_block = ""
    if older:
        summary_block = "EARLIER STEPS (compacted):\n" + _summarize_history(older) + "\n\n"

    recent_block = ""
    if recent:
        recent_lines: list[str] = []
        for h in recent:
            if h["type"] == "tool":
                recent_lines.append(
                    f"#{h['step']} TOOL_CALL tool={h['tool']} args={h['args']}\n"
                    f"OBSERVATION: {h['summary']}"
                )
            elif h["type"] == "error":
                recent_lines.append(f"#{h['step']} ERROR: {h['summary']}")
            elif h["type"] == "parse_error":
                recent_lines.append(f"#{h['step']} INVALID OUTPUT: {h['summary']}")
        recent_block = "RECENT STEPS:\n" + "\n\n".join(recent_lines) + "\n\n"

    nudge_block = f"NUDGE: {nudge}\n\n" if nudge else ""

    route_block = ""
    if route is not None and step_idx <= 2 and not pool:
        route_block = (
            "ROUTER HINT (advisory, use unless clearly wrong):\n"
            f"  kind={route.kind!r}, suggested_tool={route.suggested_tool!r}, "
            f"args={json.dumps(route.suggested_args, ensure_ascii=False)}, "
            f"confidence={route.confidence:.2f}, via={route.via}\n"
            f"  rationale: {route.rationale}\n\n"
        )

    prior_block = _format_prior_block(prior_turns)

    user_content = (
        f"{prior_block}"
        f"USER QUESTION:\n{query}\n\n"
        f"BUDGET: step {step_idx}/{max_steps}\n\n"
        f"{route_block}"
        f"EVIDENCE POOL ({len(pool)} chunks):\n{_format_pool(pool)}\n\n"
        f"{summary_block}{recent_block}{nudge_block}"
        "Decide the next step. Return ONE NextStepEnvelope JSON object."
    )

    return [
        {
            "role": "system",
            "content": build_system_message(
                web_search_enabled=web_search_enabled,
                persona_override=persona_override,
            ),
        },
        {"role": "user", "content": user_content},
    ]


def _extract_first_json_object(s: str) -> str:
    """Find the first balanced JSON object in `s`.

    Some models (e.g. gpt-5.4 on OpenRouter) ignore json-mode and emit either
    reasoning before/after JSON, or multiple JSON fragments. We slice out the
    first { ... } block by brace-counting at the top level (skipping braces
    inside string literals).
    """
    in_str = False
    esc = False
    depth = 0
    start = -1
    for i, ch in enumerate(s):
        if esc:
            esc = False
            continue
        if in_str:
            if ch == "\\":
                esc = True
            elif ch == '"':
                in_str = False
            continue
        if ch == '"':
            in_str = True
        elif ch == "{":
            if depth == 0:
                start = i
            depth += 1
        elif ch == "}":
            if depth > 0:
                depth -= 1
                if depth == 0 and start >= 0:
                    return s[start : i + 1]
    return s  # fall back to whole string — let json.loads raise


def _parse_step(raw: str) -> NextStepEnvelope:
    raw = raw.strip()
    # Strip code fences if present.
    if raw.startswith("```"):
        raw = raw.strip("`")
        if raw.lower().startswith("json"):
            raw = raw[4:].lstrip()
    # Trim any prose around the actual JSON.
    candidate = _extract_first_json_object(raw)
    try:
        data = json.loads(candidate)
    except json.JSONDecodeError as e:
        raise ValueError(f"Output is not valid JSON: {e}") from e
    # Tolerate models that emit the inner object directly.
    if "step" not in data and "kind" in data:
        data = {"step": data}
    return NextStepEnvelope.model_validate(data)


def _norm_text(s: str) -> str:
    return re.sub(r"\s+", " ", (s or "").lower()).strip()


def _match_quote(quote: str, pool: list[PoolEntry]) -> PoolEntry | None:
    """Find the pool entry whose text best contains the quote. Used to recover a
    citation whose chunk_id is wrong/missing but whose quoted text is really in
    the pool (otherwise a real, grounded citation gets dropped)."""
    q = _norm_text(quote)
    if len(q) < 12:
        return None
    probe = q[:80]
    qs = set(q.split())
    best: PoolEntry | None = None
    best_score = 0.0
    for p in pool:
        t = _norm_text(p.text)
        if not t:
            continue
        if probe and probe in t:
            return p  # strong substring hit — accept immediately
        if qs:
            score = len(qs & set(t.split())) / len(qs)
            if score > best_score:
                best_score, best = score, p
    return best if best_score >= 0.6 else None


def _repair_citation(c: Citation, pool: list[PoolEntry]) -> PoolEntry | None:
    return _match_quote(c.quote, pool)


def _validate_citations(
    final: FinalAnswer, pool: list[PoolEntry]
) -> tuple[list[Citation], list[str]]:
    by_id = {p.chunk_id: p for p in pool}
    valid: list[Citation] = []
    warnings: list[str] = []
    for c in final.citations:
        p = by_id.get(c.chunk_id)
        if p is None:
            p = _repair_citation(c, pool)
            if p is None:
                warnings.append(f"citation chunk_id={c.chunk_id} not in pool — dropped")
                continue
            warnings.append(
                f"citation chunk_id={c.chunk_id} remapped to {p.chunk_id} by quote match"
            )
        valid.append(
            Citation(
                chunk_id=p.chunk_id,
                file_id=p.file_id,
                filename=p.filename,
                page_start=p.page_start,
                page_end=p.page_end,
                quote=c.quote[:400],
            )
        )
    return valid, warnings


async def _call_llm_for_step(
    messages: list[dict],
    step_idx: int,
    broker: EventBroker,
    llm_model: str,
    *,
    base_url: str | None = None,
    api_key: str | None = None,
    provider_order: list[str] | None = None,
) -> NextStepEnvelope:
    last_err: Exception | None = None
    for attempt in range(2):
        try:
            raw = await chat(
                messages,
                model=llm_model,
                temperature=0.1,
                response_format={"type": "json_object"},
                max_tokens=10000,  # with reasoning_effort="low" the model burns far fewer
                                   # reasoning tokens; 10k fits low-reasoning + a long answer
                                   # and cuts TPM pressure (fewer 429s) vs the old 30k reserve.
                base_url=base_url,
                api_key=api_key,
                provider_order=provider_order,
                reasoning_effort="low",  # small corpus → low reasoning is enough and
                                         # much faster per step; grounding pass guards quality
            )
            return _parse_step(raw)
        except (ValueError, ValidationError) as e:
            last_err = e
            await broker.publish(
                "parse_error",
                {"step": step_idx, "attempt": attempt, "error": str(e)[:300]},
            )
            messages = messages + [
                {
                    "role": "user",
                    "content": (
                        "Your previous output was invalid. "
                        f"Reason: {e}. "
                        "Return ONE JSON object that validates against NextStepEnvelope. "
                        "No prose, no code fences."
                    ),
                }
            ]
    assert last_err is not None
    raise last_err


_SYNTH_RULES = (
    "Rewrite the FINAL answer for the user. Rules:\n"
    "- Ground every claim ONLY in the EVIDENCE below — never invent facts or citations.\n"
    "- Be exhaustive but precise; surface every relevant figure, date, name and condition.\n"
    "- Structure with Markdown (## headings, bullet/numbered lists, tables for comparisons,\n"
    "  > blockquotes for verbatim excerpts, **bold** for key terms, `code` for identifiers).\n"
    "- Put an inline [N] marker after each factual claim, where N matches the EVIDENCE\n"
    "  numbering. Use ONLY [N] form; multiple like [1][2] are fine.\n"
    "- Write the ENTIRE answer in the user's language; never mix languages (a verbatim quote\n"
    "  may stay in the source language, but your prose around it must be the user's language).\n"
    "- Do NOT add a 'Sources:'/'Источники:' list — citations render from the [N] markers.\n"
    "- Output ONLY the answer text (Markdown). No JSON, no preamble."
)


async def _synthesize_final_answer(
    query: str,
    pool: list[PoolEntry],
    draft: str,
    citations: list[Citation],
    *,
    persona_override: str | None,
    model: str,
    base_url: str | None,
    api_key: str | None,
    provider_order: list[str] | None,
    on_delta: Callable[[str], Awaitable[None]] | None = None,
) -> str:
    """Polish the final answer with the quality model, reusing the citation set the
    (fast) loop already validated. Returns the rewritten Markdown answer text.
    Falls back to the draft on any error (handled by the caller).
    """
    by_id = {p.chunk_id: p for p in pool}
    ev_lines: list[str] = []
    for i, c in enumerate(citations, 1):
        p = by_id.get(c.chunk_id)
        text = ((p.text if p else c.quote) or "").strip().replace("\n", " ")
        if len(text) > 800:
            text = text[:799] + "…"
        page = f"стр. {c.page_start}" if c.page_start else ""
        ev_lines.append(f"[{i}] (файл: {c.filename}{', ' + page if page else ''}) {text}")
    evidence = "\n".join(ev_lines) if ev_lines else "(нет цитат)"

    system = _resolve_persona(persona_override)
    user = (
        f"USER QUESTION:\n{query}\n\n"
        f"EVIDENCE (numbered — cite with these exact [N] markers):\n{evidence}\n\n"
        f"DRAFT ANSWER (from a faster model — may be rough, improve it):\n{draft}\n\n"
        f"{_SYNTH_RULES}"
    )
    msgs = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    if on_delta is not None:
        # Stream the answer token-by-token so the UI renders it live instead of
        # waiting for the whole (slow quality-model) synthesis to finish.
        parts: list[str] = []
        async for piece in chat_stream(
            msgs,
            model=model,
            temperature=0.2,
            max_tokens=4000,
            base_url=base_url,
            api_key=api_key,
            provider_order=provider_order,
        ):
            parts.append(piece)
            await on_delta(piece)
        return "".join(parts).strip()
    return (await chat(
        msgs,
        model=model,
        temperature=0.2,
        max_tokens=4000,
        base_url=base_url,
        api_key=api_key,
        provider_order=provider_order,
    )).strip()


async def _best_effort_final(
    query: str,
    pool: list[PoolEntry],
    *,
    persona_override: str | None,
    model: str,
    base_url: str | None,
    api_key: str | None,
    provider_order: list[str] | None,
) -> FinalAnswer | None:
    """Last-resort answer when the loop exhausts its budget without producing a
    grounded final. Instead of failing with nothing, synthesise an answer from
    the top evidence we DID retrieve, citing those chunks directly, at low
    confidence. The user always gets a usable response.
    """
    if not pool:
        return None
    top = pool[:8]
    cites = [
        Citation(
            chunk_id=p.chunk_id,
            file_id=p.file_id,
            filename=p.filename,
            page_start=p.page_start,
            page_end=p.page_end,
            quote=(p.text or "")[:300],
        )
        for p in top
    ]
    try:
        answer = await _synthesize_final_answer(
            query,
            pool,
            draft="(no draft — write the answer directly from the EVIDENCE below)",
            citations=cites,
            persona_override=persona_override,
            model=model,
            base_url=base_url,
            api_key=api_key,
            provider_order=provider_order,
        )
    except Exception as e:
        log.warning("best-effort synthesis failed: %s", e)
        return None
    report = ground_citations(cites, pool, 0.35)
    return FinalAnswer(
        thought="Budget exhausted; answering from the retrieved evidence.",
        answer=answer,
        citations=cites,
        confidence=min(report.adjusted_confidence, 0.5),
    )


_SINGLE_PASS_RULES = (
    "Answer the USER QUESTION using ONLY the EVIDENCE POOL above. Rules:\n"
    "- Ground every claim in the evidence — never invent facts or citations.\n"
    "- Be exhaustive but precise; surface every relevant figure, date, name, condition.\n"
    "- Structure with Markdown (## headings, bullet/numbered lists, **bold**, > quotes).\n"
    "- Put an inline [N] marker after each factual claim (N = its position in the\n"
    "  citations array). Use ONLY the [N] form.\n"
    "- Write the ENTIRE answer in the user's language; never mix languages (a verbatim\n"
    "  quote may stay in the source language).\n"
    "- If the evidence does NOT answer the question, say so plainly and set a low\n"
    "  confidence — do NOT fabricate.\n"
    "- CITE using the [N] NUMBER shown at the start of each EVIDENCE POOL entry\n"
    "  (e.g. [1], [2]). Cite EVERY factual claim. Prefer multiple distinct sources.\n"
    "Return ONE JSON object EXACTLY:\n"
    '{"answer": "<markdown answer with inline [N] markers>", '
    '"citations": [{"n": <the pool number N>, '
    '"quote": "<short verbatim snippet from that entry>"}], '
    '"confidence": <float 0..1>}'
)


async def _single_pass_answer(
    query: str,
    pool: list[PoolEntry],
    *,
    persona_override: str | None,
    model: str,
    base_url: str | None,
    api_key: str | None,
    provider_order: list[str] | None,
    prior_turns: list[dict] | None = None,
) -> tuple[str, list[Citation], float]:
    """v2 single-pass: produce the final grounded answer in ONE LLM call from the
    pre-searched pool, skipping the multi-step agentic loop. Returns
    (answer_text, validated_citations, raw_confidence). Citations are mapped to
    pool entries by chunk_id, with a quote-match fallback.

    prior_turns is needed here for the same reason the router needs it: a
    contentless follow-up ("расскажи подробнее") has no topic of its own, so
    without the preceding Q/A the model sees only "tell me more" plus an
    evidence pool it has no way to connect to the question, and correctly (by
    its own narrow view) reports the evidence doesn't answer it."""
    system = _resolve_persona(persona_override)
    user = (
        f"{_format_prior_block(prior_turns)}"
        f"USER QUESTION:\n{query}\n\n"
        f"EVIDENCE POOL ({len(pool)} chunks):\n{_format_pool(pool)}\n\n"
        f"{_SINGLE_PASS_RULES}"
    )
    raw = await chat(
        [{"role": "system", "content": system}, {"role": "user", "content": user}],
        model=model,
        temperature=0.1,
        response_format={"type": "json_object"},
        max_tokens=4000,
        base_url=base_url,
        api_key=api_key,
        provider_order=provider_order,
    )
    data = json.loads(_extract_first_json_object(raw.strip()))
    answer = str(data.get("answer") or "").strip()
    try:
        raw_conf = float(data.get("confidence", 0.5))
    except (TypeError, ValueError):
        raw_conf = 0.5
    by_id = {p.chunk_id: p for p in pool}
    cites: list[Citation] = []
    seen: set[uuid.UUID] = set()
    for c in (data.get("citations") or []):
        if not isinstance(c, dict):
            continue
        quote = str(c.get("quote") or "")
        p: PoolEntry | None = None
        # Primary: 1-based pool index N (reliable — the model just copies a number).
        n = c.get("n")
        if isinstance(n, (int, float)) and 1 <= int(n) <= len(pool):
            p = pool[int(n) - 1]
        # Fallbacks: explicit chunk_id, then quote text match.
        if p is None:
            try:
                p = by_id.get(uuid.UUID(str(c.get("chunk_id"))))
            except (ValueError, TypeError, AttributeError):
                p = None
        if p is None:
            p = _match_quote(quote, pool)
        if p is None or p.chunk_id in seen:
            continue
        seen.add(p.chunk_id)
        cites.append(
            Citation(
                chunk_id=p.chunk_id,
                file_id=p.file_id,
                filename=p.filename,
                page_start=p.page_start,
                page_end=p.page_end,
                quote=quote[:400],
            )
        )
    return answer, cites, max(0.0, min(1.0, raw_conf))


async def _summarise_turns(turns: list[tuple[str, str]], previous_summary: str | None) -> str:
    """Roll older Q/A turns into a compact running summary.

    `previous_summary` is the cached summary that already covers some of the
    earliest turns — we extend it rather than re-summarising from scratch.
    """
    if not turns:
        return previous_summary or ""

    s = get_settings()
    parts = []
    if previous_summary:
        parts.append(f"Existing summary so far:\n{previous_summary}\n")
    parts.append("New turns to fold in:")
    for i, (q, a) in enumerate(turns, start=1):
        q = (q or "").strip()
        a = (a or "").strip()
        if len(a) > 1500:
            a = a[:1500] + "…"
        parts.append(f"  T{i} USER: {q}\n  T{i} ASSISTANT: {a}")
    user_msg = "\n".join(parts)

    system_msg = (
        "You are maintaining a compact running summary of a chat session between a user "
        "and an agentic RAG assistant. Update / extend the summary so a future turn of "
        "the agent has the key context.\n\n"
        "Preserve precisely:\n"
        "- Named entities (companies, people, documents, codes, dates, numbers).\n"
        "- Decisions made or facts established by the assistant.\n"
        "- Open questions / loose ends the conversation is following up on.\n"
        "Drop chit-chat and small clarifications. Output 100-300 words, plain prose "
        "or short bullet points, in the SAME language as the conversation."
    )
    try:
        return (await chat(
            [{"role": "system", "content": system_msg},
             {"role": "user", "content": user_msg}],
            model=s.llm_model,
            temperature=0.2,
            max_tokens=800,
        )).strip()
    except Exception as e:
        log.warning("session summarise failed: %s", e)
        return previous_summary or ""


async def _build_session_context(
    db, session_id: uuid.UUID, current_run_id: uuid.UUID,
) -> list[dict]:
    """Return prior_turns blocks for the agent prompt:
       optional [summary] entry + the most recent SESSION_RECENT_TURNS verbatim turns.

    Also lazily updates / extends the cached summary on the ChatSession row so
    we don't re-summarise every request.
    """
    from app.models import ChatSession  # local to avoid cycles

    sess = (await db.execute(select(ChatSession).where(ChatSession.id == session_id))).scalar_one_or_none()
    if sess is None:
        return []

    past = (await db.execute(
        select(AgentRun)
        .where(
            AgentRun.session_id == session_id,
            AgentRun.id != current_run_id,
            AgentRun.status == AgentRunStatus.succeeded,
        )
        .order_by(AgentRun.created_at.asc())
    )).scalars().all()
    past = [r for r in past if r.answer]

    if len(past) <= SESSION_RECENT_TURNS:
        return [{"kind": "turn", "query": r.query, "answer": r.answer} for r in past]

    # We have older turns to compress.
    older = past[:-SESSION_RECENT_TURNS]
    recent = past[-SESSION_RECENT_TURNS:]

    # Find which older turns aren't yet covered by sess.summary.
    already_covered_idx = -1
    if sess.summary_through_run_id is not None:
        for i, r in enumerate(older):
            if r.id == sess.summary_through_run_id:
                already_covered_idx = i
                break
    new_turns = [(r.query, r.answer or "") for r in older[already_covered_idx + 1 :]]

    if new_turns or sess.summary is None:
        sess.summary = await _summarise_turns(new_turns, sess.summary)
        if older:
            sess.summary_through_run_id = older[-1].id
        await db.commit()

    out: list[dict] = []
    if sess.summary:
        out.append({"kind": "summary", "summary": sess.summary})
    out.extend({"kind": "turn", "query": r.query, "answer": r.answer} for r in recent)
    return out


async def run_agent(rag_id: uuid.UUID, run_id: uuid.UUID, query: str, max_steps: int) -> None:
    """Background entrypoint. Owns its own DB session and event broker."""
    t0 = time.monotonic()
    broker = await EventBroker.get_or_create(rag_id, run_id)

    async with SessionLocal() as db:
        run = (await db.execute(select(AgentRun).where(AgentRun.id == run_id))).scalar_one()
        rag = (await db.execute(select(Rag).where(Rag.id == rag_id))).scalar_one()
        run.status = AgentRunStatus.running
        run.started_at = datetime.now(timezone.utc)
        await db.commit()

        await broker.publish(
            "run_started",
            {"run_id": str(run_id), "rag_id": str(rag_id), "query": query, "max_steps": max_steps},
        )

        pool: list[PoolEntry] = []
        rag_settings = dict(rag.settings or {})
        rag_models = resolve_models_for_rag(rag)

        # Hybrid speed: drive the iterative agent loop (tool selection / search) with a
        # FAST model (the env default — e.g. Cerebras gpt-oss-120b, ~5-10x faster), and
        # synthesize ONLY the final user-visible answer with the RAG's quality model
        # (e.g. gpt-5.4). Steps dominate latency, so this cuts wall-clock a lot while
        # keeping the visible answer high-quality. When the two models are the same,
        # we skip the extra synthesis call (no-op hybrid).
        s = get_settings()
        # Fast loop model runs on OpenRouter (paid — no Cerebras free-tier 429/backoff).
        step_model = s.agent_step_model
        step_base = s.openrouter_base_url
        step_key = s.openrouter_api_key
        final_model = rag_models["llm_model"]
        final_base = rag_models.get("llm_base_url")
        final_key = rag_models.get("llm_api_key")
        final_porder = rag_models.get("llm_provider_order")
        # Hybrid only when a fast step model is set, it differs from the final model,
        # and we actually have an OpenRouter key to run it.
        hybrid = bool(step_model and step_key) and final_model != step_model
        if not hybrid:
            # Fall back to the RAG's own model for the loop too.
            step_model = final_model
            step_base = final_base
            step_key = final_key

        ctx = AgentContext(
            rag_id=rag.id, db=db, user_query=query, pool_ref=pool,
            rag_settings=rag_settings,
            rag_models=rag_models,
        )
        history: list[dict] = []

        # Pull previous turns of the same chat session, if any.
        prior_turns: list[dict] = []
        if run.session_id is not None:
            prior_turns = await _build_session_context(db, run.session_id, run.id)

        # Pre-loop: route the query. Prior turns are threaded in so a short
        # follow-up ("расскажи подробнее") resolves against the previous topic
        # instead of being misread as smalltalk/off-topic in isolation.
        try:
            route = await route_query(query, prior_turns)
            await broker.publish(
                "router_decision",
                {
                    "kind": route.kind,
                    "tool": route.suggested_tool,
                    "args": route.suggested_args,
                    "rationale": route.rationale,
                    "confidence": route.confidence,
                    "via": route.via,
                    "companions": [t for t, _ in route.companions],
                },
            )
        except Exception as e:
            log.warning("router failed: %s", e)
            route = None
            await broker.publish("router_failed", {"error": str(e)[:200]})

        # Admin-configured persona: structured ai_config takes precedence, with
        # the legacy free-text `persona` key as a fallback. Flattened into the
        # instruction block appended after the base persona.
        ai_config = rag_settings.get("ai_config") if isinstance(rag_settings.get("ai_config"), dict) else None
        persona_override = build_admin_instructions(ai_config, rag_settings.get("persona")) or None

        # Restricted-topics guard: if the query mentions an admin-banned keyword,
        # refuse politely and stop — no retrieval, no escalation. Mirrors Elza's
        # ContentFilter guardrail.
        is_restricted, restriction_msg = check_restricted_topics(ai_config, query)
        if is_restricted:
            run.status = AgentRunStatus.succeeded
            run.answer = restriction_msg
            run.citations = []
            run.confidence = 1.0
            run.steps_used = 0
            run.telemetry = {
                "elapsed_sec": round(time.monotonic() - t0, 3),
                "pool_size": 0,
                "scratchpad_keys": [],
                "terminated_reason": "restricted_topic",
                "prior_turns_used": len(prior_turns),
                "router": {"kind": route.kind, "via": route.via, "confidence": route.confidence}
                if route is not None else None,
            }
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
            await broker.publish(
                "final_answer",
                {"step": 0, "answer": restriction_msg, "confidence": 1.0,
                 "raw_confidence": 1.0, "citations": [], "warnings": []},
            )
            await broker.publish(
                "run_finished",
                {"status": run.status.value, "steps_used": 0,
                 "elapsed_sec": run.telemetry["elapsed_sec"]},
            )
            await broker.close()
            await EventBroker.pop(run_id)
            return

        # Short-circuit: smalltalk / greeting / identity / off-topic. Answer
        # directly as the assistant persona — no retrieval, no escalation. This
        # is what fixes "привет"/"кто ты" landing on an alarming 0%-confidence
        # escalation. Mirrors Elza's casual-conversation path.
        if route is not None and not route.needs_retrieval:
            try:
                # Greetings don't need the heavy model — use the fast step model.
                answer = (await chat(
                    [
                        {"role": "system", "content": build_smalltalk_message(persona_override)},
                        {"role": "user", "content": query},
                    ],
                    model=step_model,
                    base_url=step_base,
                    api_key=step_key,
                    provider_order=None,
                    temperature=0.4,
                    max_tokens=500,
                )).strip()
            except Exception as e:
                log.warning("smalltalk answer failed: %s", e)
                answer = (
                    "Здравствуйте! Я — ассистент UzMRC по нормативным документам. "
                    "Помогаю с вопросами об ипотечном рефинансировании: правила, ставки, "
                    "требования и процедуры. Чем могу помочь?"
                )

            run.status = AgentRunStatus.succeeded
            run.answer = answer
            run.citations = []
            run.confidence = 1.0
            run.steps_used = 0
            run.telemetry = {
                "elapsed_sec": round(time.monotonic() - t0, 3),
                "pool_size": 0,
                "scratchpad_keys": [],
                "terminated_reason": "smalltalk",
                "prior_turns_used": len(prior_turns),
                "router": {"kind": route.kind, "via": route.via, "confidence": route.confidence},
            }
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()

            await broker.publish(
                "final_answer",
                {
                    "step": 0, "answer": answer, "confidence": 1.0,
                    "raw_confidence": 1.0, "citations": [], "warnings": [],
                },
            )
            await broker.publish(
                "run_finished",
                {
                    "status": run.status.value, "steps_used": 0,
                    "elapsed_sec": run.telemetry["elapsed_sec"],
                },
            )
            await broker.close()
            await EventBroker.pop(run_id)
            return

        recent_tool_calls: list[tuple[str, str]] = []

        # Pre-search: run the primary suggested tool + its companions in parallel
        # BEFORE the agent's first reasoning step. This combines precision
        # (exact_lookup with a regex) with recall (hybrid_search). The agent
        # sees a populated pool on step 1 and can often finalize immediately.
        if route is not None and route.confidence >= 0.6:
            pre_calls: list[tuple[str, dict]] = [
                (route.suggested_tool, route.suggested_args)
            ]
            pre_calls.extend(route.companions)

            async def _pre_run(tool: str, args: dict) -> tuple[str, dict, ToolResult | None]:
                try:
                    res = await dispatch(ctx, tool, args)
                    return tool, args, res
                except Exception as exc:
                    log.warning("pre-search %s failed: %s", tool, exc)
                    return tool, args, None

            results = await asyncio.gather(*[_pre_run(t, a) for t, a in pre_calls])
            for tool, args, res in results:
                if res is None:
                    continue
                if res.pool:
                    pool[:] = _pool_dedup_merge(pool, res.pool)
                sig = (tool, json.dumps(args, sort_keys=True, default=str))
                recent_tool_calls.append(sig)
                history.append({
                    "step": 0, "type": "tool", "tool": tool, "args": args,
                    "summary": res.summary,
                })
                await broker.publish(
                    "pre_search",
                    {
                        "tool": tool, "args": args, "summary": res.summary,
                        "pool_size": len(pool),
                    },
                )
        nudge: str | None = None
        final_obj: FinalAnswer | None = None
        escalated: Escalation | None = None
        terminated_reason: str | None = None
        steps_used = 0

        try:
            # v2: ensure the pool is seeded for retrieval queries even if pre-search
            # was skipped (e.g. the router returned low confidence / failed). Smalltalk
            # already short-circuited above, so any query here needs evidence. This makes
            # single-pass self-sufficient instead of depending on the flaky pre-search.
            if not pool:
                try:
                    seed = await dispatch(ctx, "hybrid_search", {"query": query, "top_k": 12})
                    if seed.pool:
                        pool[:] = _pool_dedup_merge(pool, seed.pool)
                    history.append({
                        "step": 0, "type": "tool", "tool": "hybrid_search",
                        "args": {"query": query, "top_k": 12}, "summary": seed.summary,
                    })
                    await broker.publish(
                        "pre_search",
                        {"tool": "hybrid_search", "args": {"query": query},
                         "summary": seed.summary, "pool_size": len(pool)},
                    )
                except Exception as e:
                    log.warning("seed search failed: %s", e)

            # v2 single-pass: with the pool seeded, answer in ONE LLM call (quality
            # model) instead of the multi-step loop. Falls back to the loop only for
            # complex (multi-entity / aggregate) queries. Cuts ~4 LLM calls → ~2.
            if pool and (route is None or route.kind not in ("multi_entity", "aggregate")):
                try:
                    sp_answer, sp_cites, sp_conf = await _single_pass_answer(
                        query, pool,
                        persona_override=persona_override,
                        model=final_model, base_url=final_base,
                        api_key=final_key, provider_order=final_porder,
                        prior_turns=prior_turns,
                    )
                    # Accept the single-pass answer whenever it produced prose.
                    # With citations → grounded confidence. Without (typically a
                    # genuine "not in the documents" answer) → keep the model's
                    # low confidence and DON'T fall into the full loop, which would
                    # only wander to budget exhaustion on the same empty evidence.
                    if sp_answer:
                        report = ground_citations(sp_cites, pool, sp_conf)
                        await broker.publish(
                            "grounding_report",
                            {"step": 1, "grounded": report.grounded_count,
                             "total": report.total, "fraction": round(report.fraction, 3),
                             "adjusted_confidence": round(report.adjusted_confidence, 3)},
                        )
                        conf = report.adjusted_confidence if sp_cites else min(sp_conf, 0.3)
                        final_obj = FinalAnswer(
                            thought="single-pass answer from pre-searched evidence",
                            answer=sp_answer, citations=sp_cites,
                            confidence=conf,
                        )
                        steps_used = 1
                        terminated_reason = "single_pass"
                        await broker.publish(
                            "final_answer",
                            {"step": 1, "answer": final_obj.answer,
                             "confidence": final_obj.confidence, "raw_confidence": sp_conf,
                             "citations": [c.model_dump(mode="json") for c in final_obj.citations],
                             "warnings": []},
                        )
                except Exception as e:
                    log.warning("single-pass failed, falling back to loop: %s", e)

            for step in range(1, max_steps + 1):
                if final_obj is not None or escalated is not None:
                    break
                steps_used = step
                messages = _build_messages(
                    query, pool, history, step, max_steps, nudge,
                    route=route, prior_turns=prior_turns,
                    web_search_enabled=bool(rag_settings.get("web_search_enabled")),
                    persona_override=persona_override,
                )
                nudge = None
                try:
                    envelope = await _call_llm_for_step(
                        messages, step, broker,
                        llm_model=step_model,
                        base_url=step_base,
                        api_key=step_key,
                        provider_order=None,
                    )
                except Exception as e:
                    history.append(
                        {"step": step, "type": "parse_error", "summary": f"LLM/parse failed: {e}"}
                    )
                    await broker.publish("step_failed", {"step": step, "error": str(e)[:300]})
                    nudge = "Previous step couldn't be parsed twice. Try a simpler tool call or finalize."
                    continue

                next_step = envelope.step
                await broker.publish(
                    "thought",
                    {"step": step, "thought": next_step.thought, "kind": next_step.kind},
                )

                if isinstance(next_step, FinalAnswer):
                    valid_cites, warns = _validate_citations(next_step, pool)
                    if not valid_cites and pool:
                        # Refuse to finalize without grounding when we have evidence available.
                        nudge = (
                            "You must include at least one citation from the EVIDENCE POOL "
                            "(chunk_id must match). Cite or escalate."
                        )
                        await broker.publish(
                            "final_rejected",
                            {"step": step, "reason": "no_valid_citations", "warnings": warns},
                        )
                        history.append(
                            {
                                "step": step,
                                "type": "error",
                                "summary": "final_answer had no valid citations; retrying",
                            }
                        )
                        continue
                    report = ground_citations(valid_cites, pool, next_step.confidence)
                    await broker.publish(
                        "grounding_report",
                        {
                            "step": step,
                            "grounded": report.grounded_count,
                            "total": report.total,
                            "fraction": round(report.fraction, 3),
                            "adjusted_confidence": round(report.adjusted_confidence, 3),
                            "checks": [
                                {
                                    "chunk_id": str(c.citation.chunk_id),
                                    "grounded": c.grounded,
                                    "method": c.method,
                                    "score": round(c.score, 3),
                                    "note": c.note,
                                }
                                for c in report.checks
                            ],
                        },
                    )
                    # Hybrid: re-synthesise the user-visible prose once with the
                    # quality model, keeping the validated citation set. The fast
                    # model already did the retrieval work; this only polishes the
                    # final answer's wording/structure.
                    answer_text = next_step.answer
                    if hybrid:
                        try:
                            # Stream the synthesized answer to the UI live. Token
                            # deltas are batched (~24 chars) and sent as ephemeral
                            # (non-persisted) events so they don't bloat the log.
                            await broker.publish("answer_start", {"step": step})
                            _buf = {"s": ""}

                            async def _emit(piece: str, _buf=_buf) -> None:
                                _buf["s"] += piece
                                if len(_buf["s"]) >= 24 or piece.endswith("\n"):
                                    await broker.publish(
                                        "answer_token",
                                        {"step": step, "delta": _buf["s"]},
                                        persist=False,
                                    )
                                    _buf["s"] = ""

                            answer_text = await _synthesize_final_answer(
                                query, pool, next_step.answer, valid_cites,
                                persona_override=persona_override,
                                model=final_model, base_url=final_base,
                                api_key=final_key, provider_order=final_porder,
                                on_delta=_emit,
                            )
                            if _buf["s"]:
                                await broker.publish(
                                    "answer_token",
                                    {"step": step, "delta": _buf["s"]},
                                    persist=False,
                                )
                            await broker.publish(
                                "final_synthesized", {"step": step, "model": final_model},
                            )
                        except Exception as e:
                            log.warning("final synthesis failed, using draft: %s", e)

                    final_obj = FinalAnswer(
                        thought=next_step.thought,
                        answer=answer_text,
                        citations=valid_cites,
                        confidence=report.adjusted_confidence,
                    )
                    await broker.publish(
                        "final_answer",
                        {
                            "step": step,
                            "answer": final_obj.answer,
                            "confidence": final_obj.confidence,
                            "raw_confidence": next_step.confidence,
                            "citations": [c.model_dump(mode="json") for c in final_obj.citations],
                            "warnings": warns,
                        },
                    )
                    terminated_reason = "final"
                    break

                if isinstance(next_step, Escalation):
                    escalated = next_step
                    await broker.publish(
                        "escalated",
                        {
                            "step": step,
                            "reason": next_step.reason,
                            "confidence": next_step.confidence,
                        },
                    )
                    terminated_reason = "escalated"
                    break

                assert isinstance(next_step, ToolCall)
                sig = (next_step.tool, json.dumps(next_step.args, sort_keys=True, default=str))
                if recent_tool_calls.count(sig) >= REPEAT_TOOL_LIMIT:
                    nudge = (
                        f"You called {next_step.tool} with the same args {REPEAT_TOOL_LIMIT}+ times. "
                        "Try a different tool or argument. If the pool is empty for this question, "
                        "consider hyde_search, decompose_and_search, or escalate."
                    )
                    history.append(
                        {
                            "step": step,
                            "type": "error",
                            "summary": f"repeated tool call blocked: {next_step.tool}",
                        }
                    )
                    await broker.publish(
                        "tool_blocked",
                        {"step": step, "tool": next_step.tool, "reason": "repeat"},
                    )
                    continue
                recent_tool_calls.append(sig)
                recent_tool_calls = recent_tool_calls[-RECENT_TOOL_CALLS_BUFFER:]

                await broker.publish(
                    "tool_call",
                    {"step": step, "tool": next_step.tool, "args": next_step.args},
                )
                result: ToolResult = await dispatch(ctx, next_step.tool, next_step.args)
                if result.pool:
                    merged = _pool_dedup_merge(pool, result.pool)
                    pool.clear()
                    pool.extend(merged)

                history.append(
                    {
                        "step": step,
                        "type": "tool",
                        "tool": next_step.tool,
                        "args": next_step.args,
                        "summary": result.summary,
                    }
                )
                await broker.publish(
                    "observation",
                    {
                        "step": step,
                        "tool": next_step.tool,
                        "summary": result.summary,
                        "pool_size": len(pool),
                        "data": result.data,
                    },
                )
            else:
                # max_steps exhausted without break
                terminated_reason = "max_steps"
                await broker.publish(
                    "budget_exhausted",
                    {"step": steps_used, "pool_size": len(pool)},
                )

            # Graceful degradation: ended (budget exhausted, or fell through)
            # without a grounded final answer or an escalation. Rather than
            # failing with nothing, synthesise a best-effort answer from the
            # evidence we DID gather. Only a truly empty pool still fails.
            if final_obj is None and escalated is None and pool:
                be = await _best_effort_final(
                    query, pool,
                    persona_override=persona_override,
                    model=final_model, base_url=final_base,
                    api_key=final_key, provider_order=final_porder,
                )
                if be is not None:
                    final_obj = be
                    terminated_reason = f"{terminated_reason or 'ended'}+best_effort"
                    await broker.publish(
                        "final_answer",
                        {
                            "step": steps_used,
                            "answer": be.answer,
                            "confidence": be.confidence,
                            "raw_confidence": be.confidence,
                            "citations": [c.model_dump(mode="json") for c in be.citations],
                            "warnings": [
                                "best-effort answer: synthesised from retrieved "
                                "evidence after the step budget ran out"
                            ],
                        },
                    )

            # Persist run result
            if final_obj is not None:
                run.status = AgentRunStatus.succeeded
                run.answer = final_obj.answer
                run.citations = [c.model_dump(mode="json") for c in final_obj.citations]
                run.confidence = final_obj.confidence
            elif escalated is not None:
                run.status = AgentRunStatus.escalated
                run.error = escalated.reason
                run.confidence = escalated.confidence
            else:
                run.status = AgentRunStatus.failed
                run.error = (
                    "Step budget exhausted without producing a final answer or escalation."
                )

            run.steps_used = steps_used
            run.telemetry = {
                "elapsed_sec": round(time.monotonic() - t0, 3),
                "pool_size": len(pool),
                "scratchpad_keys": sorted(ctx.scratchpad.keys()),
                "terminated_reason": terminated_reason,
                "prior_turns_used": len(prior_turns),
                "router": (
                    {
                        "kind": route.kind,
                        "tool": route.suggested_tool,
                        "via": route.via,
                        "confidence": route.confidence,
                    }
                    if route is not None
                    else None
                ),
            }
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()

            await broker.publish(
                "run_finished",
                {
                    "status": run.status.value,
                    "steps_used": steps_used,
                    "elapsed_sec": run.telemetry["elapsed_sec"],
                },
            )
        except Exception as e:
            log.exception("agent run %s crashed", run_id)
            run.status = AgentRunStatus.failed
            run.error = f"{type(e).__name__}: {e}"
            run.finished_at = datetime.now(timezone.utc)
            run.steps_used = steps_used
            await db.commit()
            await broker.publish("run_failed", {"error": run.error})
        finally:
            await broker.close()
            await EventBroker.pop(run_id)
