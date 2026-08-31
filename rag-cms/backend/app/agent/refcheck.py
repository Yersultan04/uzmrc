"""Verify that normative references in an answer actually exist in the sources.

``grounding.py`` answers a different question: is this verbatim quote really in
the chunk? A model can pass that check and still attach the quote to a made-up
address — cite "статья 47" of a document that has 30 articles, or a resolution
number nobody uploaded. Those are exactly the failures the spec scores at zero
tolerance: no non-existent or misattributed normative references.

So every reference the answer makes is extracted and looked for in the retrieved
pool. A reference the pool cannot support is reported as unverified, letting the
caller downgrade confidence or refuse rather than assert it.

Uzbek writes these addresses as suffixed ordinals — ``12-modda`` for article 12,
``3-band`` for clause 3, ``415-son`` for №415 — in both scripts. Every reference
is therefore searched for in Russian, Uzbek Latin and Uzbek Cyrillic forms.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.agent.schemas import PoolEntry
from app.lang.uz_translit import fold

# ── reference kinds ────────────────────────────────────────────────────────
DOCUMENT = "document"
ARTICLE = "article"
CLAUSE = "clause"
PART = "part"

CONFIRMED = "confirmed"
UNVERIFIED = "unverified"

# A bare number is far too noisy to search for, so each kind is matched through
# the constructions that actually address it. Russian abbreviations, Uzbek Latin
# and Uzbek Cyrillic suffixed ordinals all point at the same element.
_LOOKUP_FORMS: dict[str, tuple[str, ...]] = {
    DOCUMENT: (r"№\s*{n}\b", r"n\s*{n}\b", r"{n}-son\b", r"{n}-сон\b"),
    ARTICLE: (r"стат[а-я]*\s*{n}\b", r"ст\.?\s*{n}\b", r"{n}-modda\b", r"{n}-модда\b"),
    CLAUSE: (r"пункт[а-я]*\s*{n}\b", r"п\.?\s*{n}\b", r"{n}-band\b", r"{n}-банд\b"),
    PART: (r"част[а-я]*\s*{n}\b", r"ч\.?\s*{n}\b", r"{n}-qism\b", r"{n}-қисм\b"),
}

# Extraction patterns, applied to the answer text. Number groups are named `n`.
_EXTRACT: tuple[tuple[str, str], ...] = (
    (DOCUMENT, r"№\s*(?P<n>\d+(?:[-/]\d+)?)"),
    (DOCUMENT, r"\b(?P<n>\d+(?:[-/]\d+)?)\s*-\s*(?:son|сон)\b"),
    (ARTICLE, r"\bстать[а-яё]*\s*(?P<n>\d+(?:\.\d+)*)"),
    (ARTICLE, r"\bст\.\s*(?P<n>\d+(?:\.\d+)*)"),
    (ARTICLE, r"\b(?P<n>\d+(?:\.\d+)*)\s*-\s*(?:modda|модда)\b"),
    (CLAUSE, r"\bпункт[а-яё]*\s*(?P<n>\d+(?:\.\d+)*)"),
    (CLAUSE, r"\bп\.\s*(?P<n>\d+(?:\.\d+)*)"),
    (CLAUSE, r"\b(?P<n>\d+(?:\.\d+)*)\s*-\s*(?:band|банд)\b"),
    (PART, r"\bчаст[а-яё]*\s*(?P<n>\d+)"),
    (PART, r"\b(?P<n>\d+)\s*-\s*(?:qism|қисм)\b"),
)

_COMPILED = tuple((kind, re.compile(pat, re.I | re.U)) for kind, pat in _EXTRACT)


@dataclass(frozen=True)
class NormativeRef:
    """One address the answer claims: a document number or a structural element."""

    kind: str
    number: str
    raw: str


@dataclass(frozen=True)
class RefCheck:
    ref: NormativeRef
    verdict: str
    evidence: str


@dataclass(frozen=True)
class RefReport:
    checks: tuple[RefCheck, ...]

    @property
    def total(self) -> int:
        return len(self.checks)

    @property
    def unverified(self) -> tuple[RefCheck, ...]:
        return tuple(c for c in self.checks if c.verdict == UNVERIFIED)

    @property
    def all_verified(self) -> bool:
        return not self.unverified

    @property
    def fraction(self) -> float:
        """Share of references the sources support; 1.0 when none were made."""
        if not self.checks:
            return 1.0
        return (self.total - len(self.unverified)) / self.total


def extract_references(text: str) -> tuple[NormativeRef, ...]:
    """Pull every normative address out of an answer, deduplicated."""
    if not text:
        return ()
    found: dict[tuple[str, str], NormativeRef] = {}
    for kind, rx in _COMPILED:
        for m in rx.finditer(text):
            number = m.group("n")
            key = (kind, number)
            if key not in found:
                found[key] = NormativeRef(kind=kind, number=number, raw=m.group(0).strip())
    return tuple(found.values())


def _haystacks(pool: list[PoolEntry]) -> tuple[str, str]:
    """Searchable text of the pool, as written and script-folded to Latin.

    Two views rather than one: the raw text carries Russian and Uzbek Cyrillic
    constructions verbatim, while the folded view turns Uzbek Cyrillic
    ``12-модда`` into ``12-modda`` so the Latin patterns reach it too. Patterns
    themselves are never folded — that would corrupt their character classes.
    """
    parts: list[str] = []
    for entry in pool:
        if entry.heading:
            parts.append(entry.heading)
        parts.append(entry.text)
        parts.append(entry.filename)
    raw = " \n ".join(parts)
    return raw.lower(), fold(raw)


def _find_form(ref: NormativeRef, raw: str, folded: str) -> str | None:
    """Return the matched construction, or None when the pool never addresses it."""
    n = re.escape(ref.number)
    for form in _LOOKUP_FORMS.get(ref.kind, ()):
        pattern = form.replace("{n}", n)
        for haystack in (raw, folded):
            m = re.search(pattern, haystack, re.I | re.U)
            if m:
                return m.group(0)
    return None


def verify_references(text: str, pool: list[PoolEntry]) -> RefReport:
    """Check every reference in ``text`` against the retrieved ``pool``.

    A reference is confirmed only when the pool addresses that exact element —
    finding the bare number somewhere is not enough.
    """
    refs = extract_references(text)
    if not refs:
        return RefReport(checks=())

    raw, folded = _haystacks(pool)
    checks: list[RefCheck] = []
    for ref in refs:
        hit = _find_form(ref, raw, folded)
        checks.append(
            RefCheck(
                ref=ref,
                verdict=CONFIRMED if hit else UNVERIFIED,
                evidence=hit or "",
            )
        )
    return RefReport(checks=tuple(checks))
