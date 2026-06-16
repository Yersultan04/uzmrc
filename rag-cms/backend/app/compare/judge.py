"""LLM judge: classify the relationship between a new clause and base norms.

Given one clause from the uploaded document plus the top-K most relevant norms
already in the RAG (retrieved via hybrid search), the judge decides whether the
clause is a duplicate, a conflict, an addition, or a gap — and, for the first
three, which base norm it relates to, with a verbatim supporting quote.
"""
from __future__ import annotations

import asyncio
import json
import logging
import re

from pydantic import ValidationError

from app.clients import llm
from app.compare.schemas import ClauseRelation, JudgeVerdict
from app.config import get_settings

log = logging.getLogger("compare.judge")


def _primary_overrides(rag_models: dict | None) -> dict:
    """Per-RAG snapshot overrides for the judge LLM (base/key/model). Empty dict
    means: use the role-based env resolver inside llm.chat."""
    kw: dict = {}
    if rag_models and rag_models.get("llm_base_url"):
        kw["base_url"] = rag_models["llm_base_url"]
        kw["api_key"] = rag_models.get("llm_api_key")
    if rag_models and rag_models.get("llm_model"):
        kw["model"] = rag_models["llm_model"]
    return kw


def _fallback_overrides() -> dict | None:
    """Secondary provider config, active only when all three env vars are set."""
    s = get_settings()
    if s.llm_fallback_api_base_url and s.llm_fallback_api_key and s.llm_fallback_model:
        return {
            "base_url": s.llm_fallback_api_base_url,
            "api_key": s.llm_fallback_api_key,
            "model": s.llm_fallback_model,
        }
    return None


async def _judge_call(messages: list[dict], max_tokens: int, rag_models: dict | None, parse):
    """Run one judge call+parse, trying the primary provider then the fallback.

    `parse(raw)` returns the parsed result or raises. Each provider gets two
    attempts (covers transient 429s and the odd malformed-JSON sample). Raises the
    last error if every attempt across both providers fails.
    """
    base = {
        "messages": messages,
        "temperature": 0.0,
        "response_format": {"type": "json_object"},
        "max_tokens": max_tokens,
    }
    attempts = [{**base, **_primary_overrides(rag_models)}]
    fb = _fallback_overrides()
    if fb:
        attempts.append({**base, **fb})

    last_err: Exception | None = None
    for kw in attempts:
        for _ in range(2):
            try:
                raw = await llm.chat(**kw)
                return parse(raw)
            except Exception as e:
                last_err = e
    raise last_err  # type: ignore[misc]

_PERSONA = (
    "Ты — юрист-аналитик по нормативным документам ипотечной рефинансирующей "
    "компании (UzMRC). "
)

# Shared relation definitions + a 4-step decision procedure. Kept in one place so the
# single- and batch-judge prompts never drift apart. The procedure anchors on the
# "can both be obeyed at once?" test: it catches genuine weakening/bypass/different-
# number conflicts WITHOUT over-flagging mere same-topic additions or duplicates.
_RELATION_RULES = (
    "Типы отношения (relation):\n"
    "- \"duplicate\" — положение устанавливает ТО ЖЕ правило, что и действующая норма "
    "(та же суть, пусть формулировки иные);\n"
    "- \"conflict\" — положение НЕСОВМЕСТИМО с действующей нормой по тому же предмету: "
    "его нельзя исполнить, НЕ НАРУШИВ норму. Признаки:\n"
    "    • другое числовое значение по тому же предмету (срок, ставка, порог, лимит, "
    "доля, кворум, сумма);\n"
    "    • ОСЛАБЛЕНИЕ нормы: разрешает то, что норма ограничивает/запрещает; снимает "
    "контроль, согласование, проверку или уведомление, прямо требуемые нормой;\n"
    "    • передача полномочия иному органу/лицу вопреки норме (обход одобрения);\n"
    "- \"addition\" — положение СОВМЕСТИМО с нормой: добавляет новое требование или "
    "уточнение по теме, НЕ меняя и НЕ ослабляя само правило нормы (обе нормы можно "
    "исполнять одновременно);\n"
    "- \"gap\" — среди кандидатов НЕТ нормы по предмету положения (новая тема), либо "
    "кандидаты не относятся к предмету положения.\n\n"
    "Как выбрать relation (по шагам):\n"
    "1) Есть ли среди кандидатов норма по ТОМУ ЖЕ предмету? Если нет → gap.\n"
    "2) Если есть и правило ИДЕНТИЧНО по сути → duplicate.\n"
    "3) Если правило РАЗНОЕ и положение нельзя исполнить, не нарушив норму (другое "
    "число / другой орган / ослабление / снятие контроля) → conflict.\n"
    "4) Если правило нормы сохраняется, а положение лишь добавляет новое поверх → "
    "addition.\n"
    "Не помечай conflict только из-за общей темы — нужно конкретное НЕСОВМЕСТИМОЕ "
    "расхождение. То, что просто дополняет норму, — это addition, а не conflict.\n\n"
    "Примеры:\n"
    "- Норма: «кворум — не менее 75% членов». Новое: «кворум — не менее 1/3». → "
    "conflict (другое число по тому же предмету).\n"
    "- Норма: «подарки только минимальной стоимости». Новое: «подарки до 10 МРОТ без "
    "уведомления». → conflict (ослабление нормы).\n"
    "- Норма: «выпуск облигаций — по решению Наблюдательного совета». Новое: "
    "«Правление выпускает облигации самостоятельно». → conflict (обход органа).\n"
    "- Норма: «сообщения о нарушениях можно подавать анонимно». Новое: «горячая линия "
    "принимает анонимные сообщения». → duplicate (то же правило).\n"
    "- Норма: «о конфликте интересов сообщать руководителю». Новое: «дополнительно "
    "ежегодно подавать декларацию интересов в комплаенс». → addition (правило нормы "
    "сохраняется, добавлено новое требование).\n\n"
)

_QUOTE_RULE = (
    "Quote ОБЯЗАН быть дословной (verbatim) выдержкой из текста выбранного кандидата — "
    "скопируй фрагмент буквально, без пересказа, без «...» и без сокращений. Если "
    "уверенной нормы нет — relation=\"gap\"."
)

_SYSTEM = (
    _PERSONA
    + "Тебе дают ОДНО положение нового документа и набор уже действующих норм из базы "
    "(кандидаты). Определи отношение нового положения к базе и верни СТРОГО JSON без "
    "пояснений.\n\n"
    + _RELATION_RULES
    + "Формат ответа (только JSON):\n"
    "{\n"
    '  "relation": "duplicate|conflict|addition|gap",\n'
    '  "matched_candidate": <номер кандидата 0..N-1, или null для gap>,\n'
    '  "quote": "<дословный фрагмент выбранной нормы базы; пусто для gap>",\n'
    '  "rationale": "<краткое обоснование на русском>",\n'
    '  "recommendation": "<что делать: принять / отклонить / согласовать ...>",\n'
    '  "confidence": <число 0..1>\n'
    "}\n"
    + _QUOTE_RULE
)


def _build_user_prompt(clause_text: str, candidates: list[dict]) -> str:
    parts = ["НОВОЕ ПОЛОЖЕНИЕ:", clause_text.strip(), "", "КАНДИДАТЫ ИЗ БАЗЫ:"]
    if not candidates:
        parts.append("(кандидатов нет)")
    for i, c in enumerate(candidates):
        loc = c.get("filename", "?")
        page = c.get("page_start")
        loc = f"{loc}, стр. {page}" if page else loc
        parts.append(f"[{i}] ({loc})\n{c.get('text', '').strip()}")
    return "\n".join(parts)


async def judge_clause(
    clause_text: str,
    candidates: list[dict],
    *,
    rag_models: dict | None = None,
) -> JudgeVerdict:
    """Classify one clause. Falls back to a low-confidence `gap` on any failure.

    `candidates` is an ordered list of dicts with keys: text, filename,
    page_start (the retrieved base norms). `rag_models` carries the per-RAG LLM
    override snapshot, if any.
    """
    if not candidates:
        return JudgeVerdict(
            relation=ClauseRelation.gap,
            rationale="В базе не найдено релевантных норм для этого положения.",
            recommendation="Рассмотреть как новое регулирование.",
            confidence=0.4,
        )

    messages = [
        {"role": "system", "content": _SYSTEM},
        {"role": "user", "content": _build_user_prompt(clause_text, candidates)},
    ]
    # 3000 tokens: leaves room for reasoning models (e.g. gpt-oss) to "think"
    # before the JSON, so the object isn't truncated into an Unterminated string.
    try:
        return await _judge_call(
            messages, 3000, rag_models,
            lambda raw: _parse_verdict(raw, n_candidates=len(candidates)),
        )
    except Exception as e:
        log.warning("judge_clause failed (primary+fallback), defaulting to gap: %s", e)
        return JudgeVerdict(
            relation=ClauseRelation.gap,
            rationale="Не удалось классифицировать положение (ошибка LLM).",
            recommendation="Проверить вручную.",
            confidence=0.0,
        )


_BATCH_SYSTEM = (
    _PERSONA
    + "Тебе дают НЕСКОЛЬКО положений нового документа; у каждого положения свой набор "
    "уже действующих норм из базы (кандидаты). Для КАЖДОГО положения определи "
    "отношение к базе и верни СТРОГО JSON без пояснений.\n\n"
    + _RELATION_RULES
    + "Формат ответа (только JSON):\n"
    "{\n"
    '  "verdicts": [\n'
    "    {\n"
    '      "clause": <номер положения, как в запросе>,\n'
    '      "relation": "duplicate|conflict|addition|gap",\n'
    '      "matched_candidate": <номер кандидата 0..N-1 ЭТОГО положения, или null для gap>,\n'
    '      "quote": "<дословный фрагмент выбранной нормы; пусто для gap>",\n'
    '      "rationale": "<краткое обоснование на русском>",\n'
    '      "recommendation": "<что делать: принять / отклонить / согласовать ...>",\n'
    '      "confidence": <число 0..1>\n'
    "    }\n"
    "  ]\n"
    "}\n"
    "Верни РОВНО по одному объекту на каждое положение, поле clause равно его "
    "номеру из запроса. Quote — того же кандидата, что и matched_candidate этого "
    "положения. "
    + _QUOTE_RULE
)


def _build_batch_prompt(items: list[tuple[str, list[dict]]]) -> str:
    parts: list[str] = []
    for idx, (clause_text, candidates) in enumerate(items):
        parts.append(f"=== ПОЛОЖЕНИЕ [{idx}] ===")
        parts.append(clause_text.strip())
        parts.append("КАНДИДАТЫ ИЗ БАЗЫ:")
        if not candidates:
            parts.append("(кандидатов нет)")
        for i, c in enumerate(candidates):
            loc = c.get("filename", "?")
            page = c.get("page_start")
            loc = f"{loc}, стр. {page}" if page else loc
            parts.append(f"[{i}] ({loc})\n{c.get('text', '').strip()}")
        parts.append("")
    return "\n".join(parts)


def _gap_verdict(reason: str = "Не удалось классифицировать (ошибка LLM).") -> JudgeVerdict:
    return JudgeVerdict(
        relation=ClauseRelation.gap,
        rationale=reason,
        recommendation="Проверить вручную.",
        confidence=0.0,
    )


async def judge_clauses_batch(
    items: list[tuple[str, list[dict]]],
    *,
    rag_models: dict | None = None,
) -> list[JudgeVerdict]:
    """Judge several clauses in ONE LLM call to minimise request count.

    `items` is an ordered list of (clause_text, candidates). Returns a verdict per
    item, in the same order. Clauses without candidates resolve to `gap` without an
    LLM call. On any LLM/parse failure the whole batch degrades to per-clause `gap`
    (caller may retry smaller batches if desired).
    """
    results: list[JudgeVerdict | None] = [None] * len(items)
    judgeable: list[int] = []
    for i, (_, cands) in enumerate(items):
        if cands:
            judgeable.append(i)
        else:
            results[i] = JudgeVerdict(
                relation=ClauseRelation.gap,
                rationale="В базе не найдено релевантных норм для этого положения.",
                recommendation="Рассмотреть как новое регулирование.",
                confidence=0.4,
            )
    if not judgeable:
        return [r or _gap_verdict() for r in results]

    sub = [items[i] for i in judgeable]
    messages = [
        {"role": "system", "content": _BATCH_SYSTEM},
        {"role": "user", "content": _build_batch_prompt(sub)},
    ]
    # Budget output tokens generously: verdicts carry verbatim quotes, and reasoning
    # models (e.g. gpt-oss) spend tokens before the JSON. Too low → truncated JSON.
    max_tokens = min(8192, 900 * len(sub) + 2048)

    try:
        by_local = await _judge_call(
            messages, max_tokens, rag_models, lambda raw: _parse_batch(raw, sub)
        )
    except Exception as e:  # primary + fallback both failed — recover per-clause below
        log.warning("judge_clauses_batch call/parse failed, falling back per-clause: %s", e)
        by_local = {}

    # Any clause the batch didn't cover (call failed, JSON truncated, or model
    # dropped it) is retried individually via the single-clause path. Smaller
    # payloads don't truncate and survive transient provider hiccups, so a flaky
    # batch degrades to per-clause accuracy — never to a bogus "LLM error" gap.
    missing = [li for li in range(len(sub)) if li not in by_local]
    if missing:
        log.info("batch judge missed %d/%d clauses → per-clause fallback", len(missing), len(sub))
        fb = await asyncio.gather(
            *(judge_clause(sub[li][0], sub[li][1], rag_models=rag_models) for li in missing)
        )
        for li, verdict in zip(missing, fb, strict=True):
            by_local[li] = verdict

    for local_idx, orig_idx in enumerate(judgeable):
        results[orig_idx] = by_local.get(local_idx) or _gap_verdict()
    return [r or _gap_verdict() for r in results]


def _parse_batch(
    raw: str, sub: list[tuple[str, list[dict]]]
) -> dict[int, JudgeVerdict]:
    data = _loads_lenient(raw)
    rows = data.get("verdicts") if isinstance(data, dict) else data
    if not isinstance(rows, list):
        raise ValueError("batch response has no verdicts array")
    out: dict[int, JudgeVerdict] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        try:
            local_idx = int(row.get("clause"))
        except (TypeError, ValueError):
            continue
        if not (0 <= local_idx < len(sub)):
            continue
        n_cands = len(sub[local_idx][1])
        try:
            out[local_idx] = _coerce_verdict(row, n_candidates=n_cands)
        except (ValidationError, ValueError):
            continue
    return out


def _coerce_verdict(data: dict, *, n_candidates: int) -> JudgeVerdict:
    payload = {k: data.get(k) for k in (
        "relation", "matched_candidate", "quote", "rationale",
        "recommendation", "confidence",
    )}
    try:
        verdict = JudgeVerdict.model_validate(payload)
    except ValidationError:
        rel = str(payload.get("relation", "")).lower()
        if rel not in {r.value for r in ClauseRelation}:
            payload["relation"] = ClauseRelation.gap.value
        verdict = JudgeVerdict.model_validate(payload)
    if verdict.relation == ClauseRelation.gap:
        verdict.matched_candidate = None
    elif verdict.matched_candidate is None or not (
        0 <= verdict.matched_candidate < n_candidates
    ):
        verdict.relation = ClauseRelation.gap
        verdict.matched_candidate = None
    return verdict


def _parse_verdict(raw: str, *, n_candidates: int) -> JudgeVerdict:
    data = _loads_lenient(raw)
    try:
        verdict = JudgeVerdict.model_validate(data)
    except ValidationError:
        # Be lenient: coerce an unknown relation to gap rather than 500.
        rel = str(data.get("relation", "")).lower()
        if rel not in {r.value for r in ClauseRelation}:
            data["relation"] = ClauseRelation.gap.value
        verdict = JudgeVerdict.model_validate(data)

    # Guard the candidate index: out-of-range or set on a gap → drop it.
    if verdict.relation == ClauseRelation.gap:
        verdict.matched_candidate = None
    elif verdict.matched_candidate is None or not (
        0 <= verdict.matched_candidate < n_candidates
    ):
        # Judge claimed a relation but gave no valid match → treat as gap.
        verdict.relation = ClauseRelation.gap
        verdict.matched_candidate = None
    return verdict


def _strip_fences(s: str) -> str:
    s = s.strip()
    if s.startswith("```"):
        s = s.split("\n", 1)[-1] if "\n" in s else s
        if s.endswith("```"):
            s = s[: -3]
        s = s.removeprefix("json").strip()
    return s


_TRAILING_COMMA = re.compile(r",(\s*[}\]])")


def _loads_lenient(raw: str) -> dict | list:
    """Parse model JSON tolerantly — LLMs (esp. reasoning models like gpt-oss) emit
    minor malformations: prose around the object, raw newlines inside strings,
    trailing commas. We extract the outermost JSON value and parse with
    strict=False (allows control chars in strings → fixes 'Unterminated string')."""
    s = _strip_fences(raw)
    # Narrow to the outermost {...} or [...] so leading/trailing prose is ignored.
    starts = [p for p in (s.find("{"), s.find("[")) if p != -1]
    ends = [p for p in (s.rfind("}"), s.rfind("]")) if p != -1]
    if starts and ends:
        s = s[min(starts): max(ends) + 1]
    candidates = (s, _TRAILING_COMMA.sub(r"\1", s))
    last_err: Exception | None = None
    for cand in candidates:
        try:
            return json.loads(cand, strict=False)
        except json.JSONDecodeError as e:
            last_err = e
    raise last_err  # type: ignore[misc]
