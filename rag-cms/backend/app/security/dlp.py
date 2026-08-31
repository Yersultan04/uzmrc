"""The gate every outbound model call passes through.

Two rules from the spec drive this module.

*Fail closed.* When DLP, the classifier or the gateway is unavailable, the
external call is blocked — not let through. That inverts the usual default: a
crash in a safety component must stop the request, never quietly skip the check.

*Check twice.* DLP runs once on the user's query and again on the assembled
context immediately before the API call, because the context is built from
retrieval results the query never saw.

Masking itself lives in ``pii.py``. This module decides what happens when
masking cannot be trusted, and validates its output — the spec requires the
masking result to be automatically validated rather than assumed.
"""
from __future__ import annotations

import logging

from app.security.pii import PiiMatch, detect, mask, summarize

log = logging.getLogger(__name__)

# Roles whose content is authored by us, not retrieved. Still scanned: a prompt
# template can interpolate retrieved text.
_SCANNED_ROLES = frozenset({"system", "user", "assistant", "tool"})


class DlpBlocked(RuntimeError):
    """Raised instead of letting an unverified payload leave the perimeter."""

    def __init__(self, where: str, reason: str, found: dict[str, int] | None = None) -> None:
        self.where = where
        self.reason = reason
        self.found = found or {}
        super().__init__(f"внешний вызов заблокирован DLP ({where}): {reason}")


def sanitize(text: str, *, where: str) -> str:
    """Mask ``text`` and verify the result, or block the call.

    A failure inside the masker is not degraded into "send it anyway" — that is
    exactly the case the fail-closed rule exists for.
    """
    if not text:
        return text
    try:
        cleaned, found = mask(text)
    except Exception as e:  # masking unavailable → nothing leaves
        log.error("DLP masking failed at %s: %s", where, e)
        raise DlpBlocked(where, "механизм маскирования недоступен") from e

    residual = detect(cleaned)
    if residual:
        # Masking ran but its output still carries identifiers — a defect in the
        # masker, not in the caller. Block rather than emit a partial mask.
        counts = summarize(residual)
        log.error("DLP validation failed at %s: residual=%s", where, counts)
        raise DlpBlocked(where, "результат маскирования не прошёл валидацию", counts)

    if found:
        log.info("DLP masked %s at %s", summarize(found), where)
    return cleaned


def sanitize_messages(messages: list[dict], *, where: str = "outbound") -> list[dict]:
    """Mask every message before it reaches the provider.

    Returns new message dicts; the caller's list is left untouched so a blocked
    call cannot leave half-masked state behind.
    """
    out: list[dict] = []
    for msg in messages:
        content = msg.get("content")
        if isinstance(content, str) and msg.get("role") in _SCANNED_ROLES:
            out.append({**msg, "content": sanitize(content, where=where)})
        else:
            out.append(dict(msg))
    return out


def scan(text: str) -> tuple[PiiMatch, ...]:
    """Report what personal data ``text`` carries, without altering it."""
    return detect(text)
