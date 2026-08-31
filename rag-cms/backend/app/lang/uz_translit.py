"""Uzbek Latin <-> Cyrillic transliteration for retrieval.

The UzMRC corpus is split almost evenly between the two scripts a Uzbek reader
uses interchangeably: a language audit of 529 documents found 252 in Latin and
198 in Cyrillic, with only a 3.6% term overlap between them. A query typed in
one script therefore misses roughly half of the relevant corpus -- measured at
44.3% loss for Latin-only queries and 52.1% for Cyrillic-only ones.

That hits the sparse leg hardest. It runs ``to_tsvector('simple', ...)`` with no
stemming, so ``plainto_tsquery('simple', 'ipoteka')`` can never match ``ипотека``
no matter how the ranking is tuned.

This module gives retrieval two tools:

``to_cyrillic`` / ``to_latin``
    Faithful transliteration, used to expand a query into both scripts so the
    existing index is searched twice without being rebuilt.

``fold``
    A lossy ASCII canonical form that collapses both scripts onto one string.
    Used for equality and dedup checks where recall matters more than fidelity;
    the dense leg and the reranker restore precision downstream.

Dependency-free and idempotent, matching the rest of the ingestion helpers.
"""
from __future__ import annotations

import re
import unicodedata

# Uzbek Latin uses a modifier letter turned comma (U+02BB) for oʻ/gʻ and a
# modifier apostrophe (U+02BC) for tutuq belgisi, but real corpora carry ASCII
# quotes, typographic quotes and backticks in those slots interchangeably.
_APOSTROPHES = "'‘’ʻʼʽ`´"
_APOSTROPHE_CLASS = f"[{re.escape(_APOSTROPHES)}]"

# Longest-match-first: digraphs must win over the single letters inside them,
# otherwise "sh" degrades to "с"+"ҳ" and "oʻ" to "о"+apostrophe.
_LAT_TO_CYR: dict[str, str] = {
    "yo": "ё", "yu": "ю", "ya": "я", "ye": "е",
    "sh": "ш", "ch": "ч", "ts": "ц",
    "a": "а", "b": "б", "d": "д", "e": "е", "f": "ф", "g": "г", "h": "ҳ",
    "i": "и", "j": "ж", "k": "к", "l": "л", "m": "м", "n": "н", "o": "о",
    "p": "п", "q": "қ", "r": "р", "s": "с", "t": "т", "u": "у", "v": "в",
    "x": "х", "y": "й", "z": "з", "c": "к",
}

_CYR_TO_LAT: dict[str, str] = {
    "ё": "yo", "ю": "yu", "я": "ya", "ш": "sh", "ч": "ch", "щ": "sh",
    "ц": "ts", "ў": "oʻ", "ғ": "gʻ", "қ": "q", "ҳ": "h",
    "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ж": "j",
    "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m", "н": "n",
    "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f",
    "х": "x", "ъ": "ʼ", "ь": "", "ы": "i", "э": "e",
}

_LAT_KEYS = sorted(_LAT_TO_CYR, key=len, reverse=True)
_CYR_KEYS = sorted(_CYR_TO_LAT, key=len, reverse=True)

# oʻ / gʻ carry any of the apostrophe variants above; normalise them first so
# the table only has to know the canonical U+02BB form.
_OQ = re.compile(f"([oOgG]){_APOSTROPHE_CLASS}")
_TUTUQ = re.compile(_APOSTROPHE_CLASS)

_CYR_RE = re.compile(r"[Ѐ-ӿ]")
_LAT_RE = re.compile(r"[A-Za-z]")
_WORD_SPLIT = re.compile(r"(\W+)", re.UNICODE)


def _restore_case(src: str, out: str) -> str:
    """Carry the source token's casing onto the transliterated token."""
    if src.isupper() and len(src) > 1:
        return out.upper()
    if src[:1].isupper():
        return out[:1].upper() + out[1:]
    return out


def _map_word(word: str, table: dict[str, str], keys: list[str]) -> str:
    """Greedy longest-match replacement over one word."""
    low = word.lower()
    out: list[str] = []
    i = 0
    while i < len(low):
        for k in keys:
            if low.startswith(k, i):
                out.append(table[k])
                i += len(k)
                break
        else:
            out.append(low[i])
            i += 1
    return "".join(out)


def to_cyrillic(text: str) -> str:
    """Transliterate Uzbek Latin to Uzbek Cyrillic. Cyrillic input passes through."""
    if not text:
        return text
    # oʻ -> ў and gʻ -> ғ before the letter table sees a bare o/g
    t = _OQ.sub(lambda m: "ў" if m.group(1) in "oO" else "ғ", text)
    t = _TUTUQ.sub("ъ", t)

    parts = _WORD_SPLIT.split(t)
    for idx, part in enumerate(parts):
        if not part or not _LAT_RE.search(part):
            continue
        low = part.lower()
        # Word-initial e is /e/ (э); elsewhere it is /je/ written е.
        lead = "э" if low.startswith("e") else ""
        body = low[1:] if lead else low
        parts[idx] = _restore_case(part, lead + _map_word(body, _LAT_TO_CYR, _LAT_KEYS))
    return "".join(parts)


def to_latin(text: str) -> str:
    """Transliterate Uzbek Cyrillic to Uzbek Latin. Latin input passes through."""
    if not text:
        return text
    parts = _WORD_SPLIT.split(text)
    for idx, part in enumerate(parts):
        if not part or not _CYR_RE.search(part):
            continue
        parts[idx] = _restore_case(part, _map_word(part, _CYR_TO_LAT, _CYR_KEYS))
    return "".join(parts)


def detect_script(text: str) -> str:
    """Return ``"cyrillic"``, ``"latin"`` or ``"mixed"``/``"none"``."""
    cyr = len(_CYR_RE.findall(text or ""))
    lat = len(_LAT_RE.findall(text or ""))
    if not cyr and not lat:
        return "none"
    if not cyr:
        return "latin"
    if not lat:
        return "cyrillic"
    ratio = cyr / (cyr + lat)
    if ratio > 0.85:
        return "cyrillic"
    if ratio < 0.15:
        return "latin"
    return "mixed"


def fold(text: str) -> str:
    """Collapse either script onto one lossy ASCII form.

    ``fold("ипотека") == fold("ipoteka")`` and ``fold("тўғрисида") ==
    fold("toʻgʻrisida")``. Distinctions that do not survive: oʻ/o, gʻ/g and the
    tutuq belgisi. That is deliberate -- this form exists to make two spellings
    of the same word compare equal, not to round-trip.
    """
    if not text:
        return text
    t = to_latin(text) if _CYR_RE.search(text) else text
    t = unicodedata.normalize("NFKD", t)
    t = _TUTUQ.sub("", t)
    t = "".join(ch for ch in t if not unicodedata.combining(ch))
    return t.lower()


def query_variants(query: str) -> list[str]:
    """Both script renderings of a query, most specific first, deduplicated.

    Feeds the sparse leg so a Latin query still matches Cyrillic chunks and vice
    versa, without touching the index.
    """
    if not query or not query.strip():
        return []
    script = detect_script(query)
    if script == "latin":
        out = [query, to_cyrillic(query)]
    elif script == "cyrillic":
        out = [query, to_latin(query)]
    else:
        out = [query, to_cyrillic(query), to_latin(query)]

    seen: set[str] = set()
    uniq: list[str] = []
    for v in out:
        key = v.strip().lower()
        if v.strip() and key not in seen:
            seen.add(key)
            uniq.append(v)
    return uniq
