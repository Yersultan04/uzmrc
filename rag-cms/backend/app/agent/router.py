from __future__ import annotations

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field

from app.clients.llm import chat

log = logging.getLogger("router")


@dataclass
class RouteDecision:
    kind: str  # "smalltalk" | "lookup" | "multi_entity" | "aggregate" | "definition" | "free_text"
    suggested_tool: str
    suggested_args: dict
    rationale: str
    confidence: float
    via: str  # "regex" | "llm"
    # Whether this query needs document retrieval at all. Greetings / identity /
    # thanks / off-topic chit-chat set this False so the loop answers directly as
    # the assistant persona instead of searching and then escalating with 0%
    # confidence. Mirrors Elza's QueryRouter (needs_retrieval=False for casual).
    needs_retrieval: bool = True
    # Tools to run in parallel with the primary BEFORE the agent's first step,
    # to combine precision (exact_lookup) with recall (hybrid_search). Each is
    # (tool_name, args).
    companions: list[tuple[str, dict]] = field(default_factory=list)
    # Self-contained restatement of the query, folding in the prior topic for
    # contentless follow-ups ("расскажи подробнее" → "<prior topic> — подробнее").
    # None when the router judged the raw query already self-contained. Used for
    # the hybrid_search companion instead of the raw follow-up text, which on its
    # own carries no retrievable signal.
    resolved_query: str | None = None


def _attach_companions(route: RouteDecision, query: str) -> RouteDecision:
    """Pair complementary tools so the first pool always has both precision and recall.

    Currently: any exact_lookup gets hybrid_search as a companion. The user's
    literal regex catches verbatim matches; the embedder catches paraphrases
    and surrounding context. Uses resolved_query (if the router produced one) so
    a follow-up like "расскажи подробнее" searches on the actual topic instead
    of its own contentless text.
    """
    if route.suggested_tool == "exact_lookup":
        route.companions.append((
            "hybrid_search",
            {"query": route.resolved_query or query, "top_k": 10},
        ))
    return route


# The ONLY regex preempt: when the user explicitly quoted a phrase, that's an
# unambiguous "search for this verbatim" intent — no LLM judgement needed.
# Everything else (codes, percentages, dates, named values) is handled by the
# LLM router: it sees the full query and decides whether the right tool is
# exact_lookup (with a tolerant pattern) or a semantic search.
_QUOTED = re.compile(
    r"""
    "([^"]{2,80})"                # "text"
    | «([^»]{2,80})»              # «text»
    | „([^"]{2,80})"              # „text"
    """,
    re.VERBOSE,
)


# Casual / smalltalk fast-path (ru / uz / en): greetings, identity / capability
# questions, thanks, acknowledgements, goodbyes. These never need document
# retrieval — the loop answers them directly as the assistant persona instead of
# searching the corpus and then escalating with 0% confidence. Mirrors Elza's
# _FP_CASUAL_EXACT. Whole-message match only (so "что такое первоначальный взнос"
# is NOT caught — only bare greetings / meta).
_SMALLTALK = re.compile(
    r"""^\s*(
        # — greetings —
        привет\w*|здравствуй\w*|здаров\w*|приветствую|салам\w*|ассал\w+|салом\w*|
        хай|хеллоу|здрасьте|
        добр(ый|ое|ого)\s+(день|вечер|утр\w+)|
        hi|hello|hey|yo|salom|assalom\w*|qalaysiz|
        # — identity / capability —
        кто\s+ты|ты\s+кто|что\s+ты(\s+(такое|за\s+\w+|умеешь|можешь|делаешь))?|
        чем\s+(ты\s+)?(можешь\s+)?(мне\s+)?помо\w+|что\s+(ты\s+)?умеешь|
        расскажи\s+о\s+себе|кто\s+вы|представься|
        who\s+are\s+you|what\s+(are|can|do)\s+you\w*|sen\s+kimsan|nima\s+qila\s+olasan|
        # — thanks / acknowledgement / bye —
        спасибо\w*|благодар\w+|рахмат\w*|rahmat|thanks?|thank\s+you|
        пока|до\s+свидания|до\s+встречи|bye|goodbye|
        ок(ей)?|ok|okay|понятно|ясно|хорошо|good|nice|супер|класс
    )\s*[!?.,…]*(\s+.{0,40})?\s*$""",
    re.IGNORECASE | re.VERBOSE | re.UNICODE,
)


_ROUTE_SYSTEM = (
    "You are a query router for a RAG system over a private document collection. "
    "Classify the user query and pick the best first tool to retrieve evidence.\n\n"
    "OUTPUT JSON exactly:\n"
    '{"kind": "smalltalk|lookup|multi_entity|aggregate|definition|free_text",\n'
    ' "tool":  "none|hybrid_search|dense_search|sparse_search|decompose_and_search|hyde_search|exact_lookup|list_files",\n'
    ' "args":  { … tool-specific arguments … },\n'
    ' "resolved_query": "<self-contained restatement of what the user needs — see FOLLOW-UPS; '
    'omit or repeat the question verbatim when it is already self-contained>",\n'
    ' "rationale": "<one short sentence>",\n'
    ' "confidence": <0.0..1.0>}\n\n'
    "0. smalltalk — use this (tool=\"none\") ONLY for messages that plainly need no "
    "document at all: greetings (\"привет\", \"salom\"), identity/capability questions "
    "(\"кто ты\", \"что ты умеешь\"), thanks, acknowledgements, goodbyes, and requests no "
    "internal company document could ever answer — general knowledge, arithmetic/math "
    "(\"2+2\"), writing code, translation, jokes, today's weather/exchange rate, or "
    "questions about unrelated third-party organisations. These need NO retrieval — the "
    "assistant replies directly as its persona (greeting or a polite refusal for off-topic).\n"
    "The document collection is NOT limited to mortgage-refinancing rules — it also covers "
    "the Company's OWN internal/corporate material: governance (Наблюдательный совет, "
    "устав), policies (anti-corruption, ethics, information policy, HR/remuneration), IT "
    "strategy, financial reports, market analytics, and news. A question about the "
    "Company's own policies, structure, or internal documents is ALWAYS a document "
    "question, even if it isn't literally about mortgage rates.\n"
    "When unsure whether something might be covered by an internal UzMRC document, PREFER "
    "SEARCHING over smalltalk: a search that returns nothing costs a little latency and the "
    "answering model is instructed not to fabricate when evidence is missing — that's a "
    "safe failure. Routing a real document question to smalltalk skips retrieval entirely, "
    "so the model has nothing to ground its reply in and may confidently invent an answer "
    "that sounds plausible but isn't backed by any document — that's an unsafe failure. "
    "Reserve smalltalk for cases where NO document could possibly be relevant.\n\n"
    "TOOL SELECTION for document questions (read CAREFULLY):\n\n"
    "1. exact_lookup — ALWAYS use this when the query references something the user "
    "would EXPECT to find verbatim in the documents. Examples that should route here:\n"
    "  • specific identifier code: \"RM-2\", \"OSON-3\", \"SC-7\", \"ARB/2025\"\n"
    "  • specific number with unit: \"13%\", \"25 000 сум\", \"$1200\", \"5 лет\"\n"
    "  • specific date: \"12.05.2024\", \"в 2025 году\"\n"
    "  • specific field/term from a known domain: \"первоначальный взнос\", \"процентная ставка\", \"срок кредита\"\n"
    "  • a quoted phrase: \"найди упоминания X\"\n"
    "  Build args.pattern as a TOLERANT POSIX regex (case-insensitive). Allow flex:\n"
    "    - whitespace: \\s+\n"
    "    - decimal separator: [.,]\n"
    "    - punctuation between chars of a code: [-/_ ]?\n"
    "    - inflection of Russian words: use stem + \\w*, e.g. ставк\\w+, первоначальн\\w+\\s+взнос\n"
    "  GOOD patterns:\n"
    '    "ставк\\\\w*\\\\s+13[.,]?5?\\\\s*%"   ← rate ~13%\n'
    '    "первоначальн\\\\w+\\\\s+взнос"      ← \"первоначальный взнос\"\n'
    '    "(RM|SC|OSON)[-/_ ]?\\\\d+"           ← any of those codes\n\n'
    "2. decompose_and_search — multi-entity / comparative / aggregate questions "
    "(\"compare X and Y\", \"сколько всего\", \"each of the products\").\n\n"
    "3. hyde_search — abstract / paraphrased questions where the user's vocabulary "
    "is unlikely to appear in the corpus verbatim.\n\n"
    "4. hybrid_search — default for free-text questions that don't fit above.\n\n"
    "Be opportunistic about exact_lookup: if there is ANY literal token the user "
    "names, prefer it over hybrid_search. Even if uncertain, set confidence 0.7+ "
    "and let downstream tools also run.\n\n"
    "FOLLOW-UPS: if RECENT CONVERSATION is given below the question, the current "
    "message may be a short continuation (\"расскажи подробнее\", \"а почему?\", "
    "\"and what about the fee\", \"и что дальше\") that only makes sense in light "
    "of the prior turn. Judge it AS a continuation of that topic, NOT in "
    "isolation — do not classify a contentless follow-up as smalltalk just "
    "because it has no topic words of its own; the topic is the prior turn's. "
    "Put a SELF-CONTAINED restatement in \"resolved_query\" — the prior topic "
    "folded into the current request (e.g. prior topic + \"— подробнее, детали\") "
    "— because the bare follow-up text alone (\"расскажи подробнее\") carries no "
    "retrievable signal for a search tool. This applies whether the primary tool "
    "is a search tool directly or exact_lookup (its hybrid_search companion uses "
    "resolved_query, not the raw follow-up)."
)


def _regex_route(query: str) -> RouteDecision | None:
    """Fast paths that don't need an LLM call:

    1. Bare greeting / identity / thanks / bye → smalltalk (no retrieval).
    2. An explicitly quoted phrase → exact_lookup verbatim.

    All other "looks like a literal" decisions (codes, percentages, dates,
    precise field names) are delegated to the LLM router below, which has the
    full query context and won't miss things our regex would never anticipate
    ("в районе 13 процентов", "ID начинается с RM").
    """
    if _SMALLTALK.match(query):
        return RouteDecision(
            kind="smalltalk",
            suggested_tool="none",
            suggested_args={},
            rationale="greeting / identity / smalltalk — answer as persona, no retrieval",
            confidence=0.97,
            via="regex",
            needs_retrieval=False,
        )

    qm = _QUOTED.search(query)
    if qm is not None:
        phrase = next(g for g in qm.groups() if g)
        pattern = re.escape(phrase.strip()).replace(r"\ ", r"\s+")
        return RouteDecision(
            kind="lookup",
            suggested_tool="exact_lookup",
            suggested_args={"pattern": pattern, "top_k": 20},
            rationale=f"user quoted phrase: {phrase!r}",
            confidence=0.95,
            via="regex",
        )
    return None


def _format_history(prior_turns: list[dict] | None) -> str:
    """Last couple of Q/A turns, for the router only — just enough to resolve a
    short follow-up against its topic. Mirrors the (larger) block _build_messages
    gives the answering model."""
    if not prior_turns:
        return ""
    lines: list[str] = []
    for t in prior_turns[-2:]:
        if t.get("kind") != "turn":
            continue
        q = (t.get("query") or "").strip().replace("\n", " ")[:200]
        a = (t.get("answer") or "").strip().replace("\n", " ")[:300]
        if q:
            lines.append(f"  Q: {q}")
        if a:
            lines.append(f"  A: {a}")
    if not lines:
        return ""
    return "RECENT CONVERSATION:\n" + "\n".join(lines) + "\n\n"


async def _llm_route(query: str, history_block: str = "") -> RouteDecision | None:
    # One retry: a failure here doesn't just mean a worse tool pick, it means
    # smalltalk/off-topic detection is skipped entirely (the regex fast-path
    # can't catch free-form off-topic like "какая погода?"), so the query falls
    # through to a full hybrid_search + LLM-answer pass instead of the cheap
    # short-circuit — still safe (the answering model won't fabricate), just
    # needlessly expensive. A transient 429/timeout shouldn't cost that.
    data = None
    for attempt in range(2):
        try:
            raw = await chat(
                [
                    {"role": "system", "content": _ROUTE_SYSTEM},
                    {"role": "user", "content": f"{history_block}CURRENT QUESTION:\n{query}"
                                                if history_block else query},
                ],
                temperature=0.0,
                response_format={"type": "json_object"},
                max_tokens=800,  # 300 truncated the JSON ("Unterminated string") and
                                 # dropped the route to a low-confidence fallback, which
                                 # skipped pre-search; 800 lets the router JSON complete.
            )
            data = json.loads(raw)
            break
        except Exception as e:
            log.warning("llm_route failed (attempt %d/2): %s", attempt + 1, e)
            if attempt == 0:
                await asyncio.sleep(1.0)
    if data is None:
        return None

    kind = data.get("kind") or "free_text"
    tool = data.get("tool") or "hybrid_search"
    args = data.get("args") or {}

    # smalltalk / off-topic → no retrieval, answer as persona.
    if str(kind) == "smalltalk" or str(tool) == "none":
        return RouteDecision(
            kind="smalltalk",
            suggested_tool="none",
            suggested_args={},
            rationale=str(data.get("rationale", "smalltalk / off-topic")),
            confidence=float(data.get("confidence", 0.8)),
            via="llm",
            needs_retrieval=False,
        )

    resolved_query = str(data.get("resolved_query") or "").strip() or None
    effective_query = resolved_query or query
    if tool in {"hybrid_search", "dense_search", "sparse_search", "hyde_search"} and "query" not in args:
        args["query"] = effective_query
    if tool == "decompose_and_search" and "query" not in args:
        args["query"] = effective_query
    return RouteDecision(
        kind=str(kind),
        suggested_tool=str(tool),
        suggested_args=args if isinstance(args, dict) else {},
        rationale=str(data.get("rationale", "")),
        confidence=float(data.get("confidence", 0.5)),
        via="llm",
        resolved_query=resolved_query,
    )


async def route_query(query: str, prior_turns: list[dict] | None = None) -> RouteDecision:
    fast = _regex_route(query)
    # A confident regex hit (smalltalk or quoted phrase) short-circuits the LLM call.
    if fast is not None and fast.confidence >= 0.8:
        if fast.kind == "smalltalk":
            return fast  # no companions, no retrieval
        return _attach_companions(fast, query)
    llm = await _llm_route(query, _format_history(prior_turns))
    if llm is not None:
        return _attach_companions(llm, query)
    if fast is not None:
        return _attach_companions(fast, query)
    return RouteDecision(
        kind="free_text",
        suggested_tool="hybrid_search",
        suggested_args={"query": query, "top_k": 10},
        rationale="fallback default",
        confidence=0.3,
        via="regex",
    )
