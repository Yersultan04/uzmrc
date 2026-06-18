from __future__ import annotations

import re
import uuid
from dataclasses import dataclass
from difflib import SequenceMatcher

from app.agent.schemas import Citation, PoolEntry

_WS = re.compile(r"\s+")
_PUNCT = re.compile(r"[\W_]+", re.UNICODE)

# OCR of Cyrillic scans frequently mixes in Latin homoglyphs (е↔e, с↔c, о↔o, …),
# so a verbatim quote and its source chunk can differ only by these confusables and
# fail grounding (→ confidence collapses to 0 on a correct answer). Fold the Latin
# half of each confusable pair onto its Cyrillic twin before comparing. Applied to
# BOTH sides, so legitimate all-Latin (Uzbek) matches are preserved.
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
    """Aggressive normalization for fuzzy match — strip all non-alphanumerics."""
    return _fold(_PUNCT.sub(" ", s).lower())


@dataclass
class CitationCheck:
    citation: Citation
    grounded: bool
    method: str  # "substring" | "fuzzy" | "none"
    score: float  # 0..1
    note: str


@dataclass
class GroundingReport:
    checks: list[CitationCheck]
    grounded_count: int
    total: int
    adjusted_confidence: float

    @property
    def fraction(self) -> float:
        return self.grounded_count / self.total if self.total else 1.0


_SUBSTRING_MIN_LEN = 16  # treat very short quotes as too weak to be authoritative
_FRAGMENT_MIN_LEN = 10   # ignore tiny stitched fragments (connectives, page nums)
_FUZZY_THRESHOLD = 0.78
# Models often stitch several non-contiguous spans of a norm into one quote with
# ellipses ("…" / "...") or newlines. Ground each span independently, otherwise a
# perfectly valid multi-span quote never matches as one contiguous substring and
# collapses confidence to 0. Split on ellipses and line breaks.
_FRAGMENT_SPLIT = re.compile(r"\s*(?:\.{3,}|…|…|\n)\s*")


def _coverage_ratio(needle: str, haystack: str) -> float:
    """How much of `needle` appears contiguously inside `haystack`, in [0, 1].

    Uses the longest matching block rather than SequenceMatcher.ratio() — the latter
    divides by the COMBINED length, so a fully-contained short quote scores low when
    the chunk is much longer than the quote. Coverage is independent of chunk length.
    """
    n = len(needle)
    if n == 0 or len(haystack) == 0:
        return 0.0
    match = SequenceMatcher(None, needle, haystack, autojunk=False).find_longest_match(
        0, n, 0, len(haystack)
    )
    return match.size / n


def _score_span(span_norm: str, span_loose: str, t_norm: str, t_loose: str) -> tuple[float, str]:
    """Best grounding score for a single span against a chunk. Returns (score, method)."""
    if len(span_norm) >= _SUBSTRING_MIN_LEN and span_norm in t_norm:
        return 1.0, "substring"
    if len(span_loose) >= _SUBSTRING_MIN_LEN and span_loose in t_loose:
        return 0.95, "substring"
    return _coverage_ratio(span_norm, t_norm), "fuzzy"


def check_citation(citation: Citation, pool_by_id: dict[uuid.UUID, PoolEntry]) -> CitationCheck:
    chunk = pool_by_id.get(citation.chunk_id)
    if chunk is None:
        return CitationCheck(citation, False, "none", 0.0, "chunk not in pool")
    quote = citation.quote or ""
    if not quote.strip():
        return CitationCheck(citation, False, "none", 0.0, "empty quote")

    q_norm = _norm(quote)
    t_norm = _norm(chunk.text)
    # Fast path: the whole quote is one contiguous span of the chunk.
    if len(q_norm) >= _SUBSTRING_MIN_LEN and q_norm in t_norm:
        return CitationCheck(citation, True, "substring", 1.0, "exact substring match")
    t_loose = _norm_loose(chunk.text)
    q_loose = _norm_loose(quote)
    if len(q_loose) >= _SUBSTRING_MIN_LEN and q_loose in t_loose:
        return CitationCheck(citation, True, "substring", 0.95, "match after punctuation strip")

    # Split stitched quotes ("span A … span B") and ground each span independently,
    # then take a length-weighted mean so one valid multi-span quote still grounds.
    spans = [s for s in _FRAGMENT_SPLIT.split(quote) if len(_norm(s)) >= _FRAGMENT_MIN_LEN]
    if not spans:
        spans = [quote]
    total_w = 0.0
    weighted = 0.0
    best_method = "fuzzy"
    for sp in spans:
        sn = _norm(sp)
        sl = _norm_loose(sp)
        score, method = _score_span(sn, sl, t_norm, t_loose)
        w = max(1, len(sn))
        weighted += score * w
        total_w += w
        if method == "substring":
            best_method = "substring"
    agg = weighted / total_w if total_w else 0.0
    if agg >= _FUZZY_THRESHOLD:
        method = best_method if len(spans) == 1 else "fuzzy"
        return CitationCheck(citation, True, method, agg,
                             f"grounded across {len(spans)} span(s), score={agg:.2f}")
    return CitationCheck(citation, False, "none", agg,
                         f"no support ({len(spans)} span(s), best score={agg:.2f})")


def ground_citations(
    citations: list[Citation],
    pool: list[PoolEntry],
    original_confidence: float,
) -> GroundingReport:
    pool_by_id = {p.chunk_id: p for p in pool}
    checks = [check_citation(c, pool_by_id) for c in citations]
    grounded = sum(1 for c in checks if c.grounded)
    total = len(checks)
    fraction = grounded / total if total else 1.0
    # Confidence is bounded by grounded fraction — you cannot claim 0.9 confidence
    # while half your citations don't ground.
    adjusted = min(original_confidence, max(0.0, fraction))
    return GroundingReport(
        checks=checks,
        grounded_count=grounded,
        total=total,
        adjusted_confidence=adjusted,
    )
