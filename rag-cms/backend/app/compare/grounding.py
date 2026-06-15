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


def _norm(s: str) -> str:
    return _WS.sub(" ", s).strip().lower()


def _norm_loose(s: str) -> str:
    return _PUNCT.sub(" ", s).lower()


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
