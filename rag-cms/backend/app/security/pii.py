"""Detect and mask personal data before anything leaves for an external model.

The spec allows zero confirmed disclosures of personal, confidential or system
data, and requires masking to run as two sequential mechanisms: detection by
approved fields and patterns, then a contextual pass over the text. This module
is the first mechanism — structural identifiers, which match precisely and carry
no model cost. The contextual pass (names, addresses in prose) belongs to the
second layer and is deliberately out of scope here.

Precision matters more than reach at this layer. A masker that eats ordinary
numbers destroys the evidence the answer is built from, so every pattern is
anchored and the identifiers that have internal structure are validated before
being masked: a 14-digit run is only a PINFL if its embedded birth date is real.

Identifiers covered are the ones Uzbek mortgage records actually carry: PINFL
(ЖШШИР), passport, INN/STIR, bank account and card numbers, phone, email.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

PINFL = "pinfl"
PASSPORT = "passport"
INN = "inn"
ACCOUNT = "account"
CARD = "card"
PHONE = "phone"
EMAIL = "email"

# Order matters: longer, more specific identifiers are matched first so a card
# number is never partly consumed as a phone.
_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    (PINFL, re.compile(r"(?<!\d)\d{14}(?!\d)")),
    (ACCOUNT, re.compile(r"(?<!\d)\d{20}(?!\d)")),
    (CARD, re.compile(r"(?<!\d)(?:\d{4}[ -]?){3}\d{4}(?!\d)")),
    (PHONE, re.compile(r"(?<![\d+])\+998[ -]?\d{2}[ -]?\d{3}[ -]?\d{2}[ -]?\d{2}(?!\d)")),
    (PASSPORT, re.compile(r"(?<![A-Za-z])[A-Z]{2}\s?\d{7}(?!\d)")),
    # A bare 9-digit run is far more often a sum than a tax number — 123456789
    # sum is an ordinary mortgage figure. Require the label, or masking would
    # eat the very amounts the answer reports.
    (INN, re.compile(r"(?:ИНН|СТИР|STIR|INN)[:\s№]*(?<!\d)(\d{9})(?!\d)", re.I)),
    (EMAIL, re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")),
)

# Kinds whose pattern captures the identifier in group 1 rather than group 0,
# so the label stays visible and only the number is replaced.
_GROUPED = frozenset({INN})

_MASK_LABEL = {
    PINFL: "ПИНФЛ",
    PASSPORT: "ПАСПОРТ",
    INN: "ИНН",
    ACCOUNT: "СЧЁТ",
    CARD: "КАРТА",
    PHONE: "ТЕЛЕФОН",
    EMAIL: "EMAIL",
}

_DAYS_IN_MONTH = (31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)


@dataclass(frozen=True)
class PiiMatch:
    kind: str
    value: str
    start: int
    end: int

    @property
    def placeholder(self) -> str:
        return f"[{_MASK_LABEL.get(self.kind, self.kind.upper())}]"


def _valid_pinfl(value: str) -> bool:
    """A PINFL encodes sex+century then DDMMYY; reject runs that cannot be one.

    Without this any 14-digit contract or registry number would be masked, and
    the answer would lose the very figures it is supposed to cite.
    """
    if len(value) != 14 or not value.isdigit():
        return False
    if value[0] not in "123456":
        return False
    day, month, year = int(value[1:3]), int(value[3:5]), int(value[5:7])
    if not 1 <= month <= 12 or not 1 <= day <= _DAYS_IN_MONTH[month - 1]:
        return False
    return 0 <= year <= 99


def _luhn_ok(digits: str) -> bool:
    """Card numbers carry a Luhn check digit; anything else is a plain number."""
    total, parity = 0, len(digits) % 2
    for i, ch in enumerate(digits):
        d = int(ch)
        if i % 2 == parity:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return total % 10 == 0


def _accept(kind: str, value: str) -> bool:
    if kind == PINFL:
        return _valid_pinfl(value)
    if kind == CARD:
        return _luhn_ok(re.sub(r"\D", "", value))
    return True


def detect(text: str) -> tuple[PiiMatch, ...]:
    """Find every structural personal identifier, without overlaps."""
    if not text:
        return ()
    taken: list[tuple[int, int]] = []
    out: list[PiiMatch] = []

    for kind, rx in _PATTERNS:
        for m in rx.finditer(text):
            group = 1 if kind in _GROUPED else 0
            s, e = m.span(group)
            if any(s < te and ts < e for ts, te in taken):
                continue  # already claimed by a more specific pattern
            if not _accept(kind, m.group(group)):
                continue
            taken.append((s, e))
            out.append(PiiMatch(kind=kind, value=m.group(group), start=s, end=e))

    out.sort(key=lambda m: m.start)
    return tuple(out)


def mask(text: str) -> tuple[str, tuple[PiiMatch, ...]]:
    """Replace every detected identifier with a typed placeholder.

    Returns the masked text and what was found, so the caller can log the counts
    without logging the values themselves.
    """
    matches = detect(text)
    if not matches:
        return text, ()

    parts: list[str] = []
    cursor = 0
    for m in matches:
        parts.append(text[cursor:m.start])
        parts.append(m.placeholder)
        cursor = m.end
    parts.append(text[cursor:])
    return "".join(parts), matches


def has_pii(text: str) -> bool:
    return bool(detect(text))


def summarize(matches: tuple[PiiMatch, ...]) -> dict[str, int]:
    """Counts per identifier kind — safe to write to logs and audit records."""
    counts: dict[str, int] = {}
    for m in matches:
        counts[m.kind] = counts.get(m.kind, 0) + 1
    return counts
