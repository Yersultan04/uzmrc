"""LLM document classification — assigns each file a `doc_type` from a fixed
taxonomy. Used by the admin "Классифицировать" action so the Files tab can show
a type badge and filter by it.
"""
from __future__ import annotations

import json
import logging

from app.clients.llm import chat

log = logging.getLogger("classify")

# Machine key → human (Russian) label. Keys are stored in files.doc_type.
DOC_TYPES: dict[str, str] = {
    "normative": "Нормативные документы",
    "report": "Отчёты",
    "analytics": "Аналитика рынка",
    "press": "Новости и пресс-релизы",
    "issuance": "Эмиссия и инвесторам",
    "certificate": "Сертификаты",
    "business_plan": "Бизнес-планы",
    "about": "О компании",
    "other": "Прочее",
}

_VALID = set(DOC_TYPES)

_SYSTEM = (
    "You classify documents of UzMRC (Uzbekistan Mortgage Refinancing Company) into "
    "ONE category. Reply with a single JSON object: {\"type\": \"<key>\"}.\n\n"
    "Categories (key — meaning):\n"
    "- normative — внутренние нормативные документы: положения, кодексы, политики, "
    "регламенты, уставы, правила (polojenie, kodeks, politika, reglament, nizom).\n"
    "- report — отчёты компании: квартальные/годовые итоги, финансовая отчётность, "
    "аудиторские заключения, KPI.\n"
    "- analytics — аналитика рынка ипотеки, обзоры, исследования рынка.\n"
    "- press — новости, пресс-релизы, объявления, тендеры, анонсы.\n"
    "- issuance — выпуск облигаций/акций, проспекты эмиссии, информация для инвесторов, "
    "рейтинги, пост-эмиссионная отчётность.\n"
    "- certificate — сертификаты (ISO и пр.), лицензии, свидетельства.\n"
    "- business_plan — бизнес-планы, стратегии, бюджеты.\n"
    "- about — общая информация о компании, руководство, структура, наблюдательный совет.\n"
    "- other — всё, что не подходит выше.\n\n"
    "Use BOTH the filename and the text excerpt. Output ONLY the JSON."
)


async def classify_document(
    filename: str,
    sample_text: str,
    *,
    model: str,
    base_url: str | None = None,
    api_key: str | None = None,
    provider_order: list[str] | None = None,
) -> str:
    """Return a doc_type key from DOC_TYPES. Falls back to 'other' on any error."""
    excerpt = (sample_text or "").strip().replace("\n", " ")
    if len(excerpt) > 1500:
        excerpt = excerpt[:1500]
    user = f"FILENAME: {filename}\n\nTEXT EXCERPT:\n{excerpt or '(пусто — классифицируй по имени файла)'}"
    try:
        raw = await chat(
            [{"role": "system", "content": _SYSTEM}, {"role": "user", "content": user}],
            model=model,
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=30,
            base_url=base_url,
            api_key=api_key,
            provider_order=provider_order,
        )
        key = str(json.loads(raw).get("type", "other")).strip().lower()
        return key if key in _VALID else "other"
    except Exception as e:
        log.warning("classify failed for %s: %s", filename, e)
        return "other"
