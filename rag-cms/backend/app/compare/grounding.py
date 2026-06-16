"""Quote grounding for comparison findings.

A finding's `matched_norm.quote` is supposed to be a verbatim fragment of the
base norm the judge tied the clause to. We verify it the same way the agent
grounds citations: exact substring → punctuation-insensitive substring → fuzzy
ratio. An ungrounded quote means the judge likely paraphrased or hallucinated,
so we surface `grounded=False` rather than silently trusting it.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[\W_]+", re.UNICODE)

_MIN_LEN = 16
_FUZZY_THRESHOLD = 0.78

# OCR of Cyrillic scans frequently mixes in Latin homoglyphs (е↔e, с↔c, о↔o, …),
# so a verbatim quote and its source chunk can differ only by these confusables and
# fail an exact match. Fold the Latin half of each confusable pair onto its Cyrillic
# twin before comparing, so OCR-corrupted-but-correct citations still ground.
_HOMOGLYPHS = str.maketrans({
    "a": "а", "c": "с", "e": "е", "o": "о", "p": "р", "x": "х", "y": "у",
    "b": "ь", "h": "н", "k": "к", "m": "м", "t": "т",
    "A": "а", "B": "в", "C": "с", "E": "е", "H": "н", "K": "к", "M": "м",
    "O": "о", "P": "р", "T": "т", "X": "х", "Y": "у",
})


def _fold(s: str) -> str:
    return s.translate(_HOMOGLYPHS)


def _norm(s: str) -> str:
    return _fold(_WS.sub(" ", s).strip().lower())


def _norm_loose(s: str) -> str:
    return _fold(_PUNCT.sub(" ", s).lower())


def is_quote_grounded(quote: str, source_text: str) -> bool:
    """True if `quote` is supported by `source_text` (exact, loose, or fuzzy)."""
    q = (quote or "").strip()
    if not q or not source_text:
        return False

    q_norm = _norm(q)
    t_norm = _norm(source_text)
    if len(q_norm) >= _MIN_LEN and q_norm in t_norm:
        return True

    q_loose = _norm_loose(q)
    t_loose = _norm_loose(source_text)
    if len(q_loose) >= _MIN_LEN and q_loose in t_loose:
        return True

    if not q_norm or not t_norm:
        return False
    ratio = SequenceMatcher(None, q_norm, t_norm, autojunk=False).ratio()
    return ratio >= _FUZZY_THRESHOLD


# Sentence-ish splitter for salvaging a verbatim excerpt: break on . ! ? ; or
# newline, keeping fragments long enough to be a meaningful citation.
_SENT_SPLIT = re.compile(r"(?<=[.!?;])\s+|\n+")


# Salvage uses token-overlap (fraction of the quote's content words present in a
# sentence), not full-sentence fuzzy ratio: a paraphrase like "75%" vs the verbatim
# "семидесяти пяти процентов" tanks SequenceMatcher but still shares most words. The
# reranker already chose the right norm — we only need its most relevant sentence.
_OVERLAP_THRESHOLD = 0.5
_TOK = re.compile(r"\w+", re.UNICODE)


def _tokens(s: str) -> set[str]:
    return {t for t in _TOK.findall(_fold(s.lower())) if len(t) >= 3}


def best_verbatim_window(quote: str, source_text: str) -> str | None:
    """Return the verbatim sentence of `source_text` closest to `quote`.

    Used to salvage display when the judge paraphrased: instead of showing the
    judge's non-verbatim quote, we substitute the actual norm sentence sharing the
    most content words, so the user always sees a real excerpt. Returns None when
    no sentence shares enough of the quote's words.
    """
    q = (quote or "").strip()
    if not q or not source_text:
        return None
    q_tokens = _tokens(q)
    if not q_tokens:
        return None
    best: tuple[float, str] | None = None
    for raw in _SENT_SPLIT.split(source_text):
        sent = raw.strip()
        if len(sent) < _MIN_LEN:
            continue
        overlap = len(q_tokens & _tokens(sent)) / len(q_tokens)
        if best is None or overlap > best[0]:
            best = (overlap, sent)
    if best is not None and best[0] >= _OVERLAP_THRESHOLD:
        return best[1]
    return None
