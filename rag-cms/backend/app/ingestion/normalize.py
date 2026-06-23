"""Text normalization for ingestion — cleans the scraped/OCR'd corpus so quotes
ground reliably and retrieval isn't polluted by artifacts.

Applied to every parsed page before chunking. Cheap, dependency-free, idempotent.
The win: cleaner text → the model's verbatim quotes match the source → grounding
passes → confidence rises (for content that EXISTS; missing content is unaffected).
"""
from __future__ import annotations

import re
import unicodedata

# Cyrillic letters that look identical to Latin ones (and vice-versa). OCR/scrape
# pipelines mix them, which breaks substring/quote matching. Fold the Latin
# lookalikes to their Cyrillic twins (the corpus is ru/uz-dominant).
_HOMOGLYPH_MAP = {
    "A": "А", "B": "В", "C": "С", "E": "Е", "H": "Н", "K": "К", "M": "М",
    "O": "О", "P": "Р", "T": "Т", "X": "Х", "Y": "У",
    "a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у",
}
_HOMOGLYPH_TABLE = str.maketrans(_HOMOGLYPH_MAP)

_ZERO_WIDTH = re.compile(r"[​‌‍⁠﻿]")
_HYPHEN_BREAK = re.compile(r"(\w)[­-]\s*\n\s*(\w)")  # "сло-\nво" → "слово"
_INLINE_WS = re.compile(r"[ \t  - ]+")       # runs of spaces/nbsp
_MULTI_NL = re.compile(r"\n{3,}")                            # 3+ newlines → 2
_TRAILING_WS = re.compile(r"[ \t]+\n")                       # spaces before newline


def fold_homoglyphs(text: str) -> str:
    """Fold Latin letters that are homoglyphs of Cyrillic ones, but ONLY when the
    surrounding token is otherwise Cyrillic — so genuine Latin words (URLs, codes,
    English terms) are left alone."""
    out: list[str] = []
    for token in re.split(r"(\s+)", text):
        if token.isspace() or not token:
            out.append(token)
            continue
        has_cyr = any("Ѐ" <= ch <= "ӿ" for ch in token)
        has_lat = any(ch in _HOMOGLYPH_MAP for ch in token)
        out.append(token.translate(_HOMOGLYPH_TABLE) if (has_cyr and has_lat) else token)
    return "".join(out)


def normalize_text(text: str) -> str:
    """Idempotent cleanup applied to a parsed page before chunking."""
    if not text:
        return text
    t = unicodedata.normalize("NFC", text)
    t = _ZERO_WIDTH.sub("", t)
    t = t.replace("\r\n", "\n").replace("\r", "\n")
    t = _HYPHEN_BREAK.sub(r"\1\2", t)      # repair hyphenated line breaks
    t = fold_homoglyphs(t)
    t = _INLINE_WS.sub(" ", t)             # collapse intra-line whitespace
    t = _TRAILING_WS.sub("\n", t)
    t = _MULTI_NL.sub("\n\n", t)           # cap blank-line runs
    return t.strip()
