"""The outbound DLP gate — fail-closed behaviour.

Guards app/security/dlp.py. Two spec rules are under test:

* when masking is unavailable the external call is blocked, not let through;
* the masking result is validated rather than assumed correct.

The second one matters most. A masker that silently half-works is worse than
one that crashes, because nothing downstream notices — so a residual identifier
in masked output has to stop the call.
"""
from __future__ import annotations

import pytest

from app.security import dlp
from app.security.dlp import DlpBlocked, sanitize, sanitize_messages, scan

VALID_PINFL = "31504920012345"


# ── sanitize ───────────────────────────────────────────────────────────────
def test_sanitize_masks_identifiers() -> None:
    out = sanitize(f"ЖШШИР {VALID_PINFL} заёмщика", where="test")
    assert VALID_PINFL not in out
    assert "[ПИНФЛ]" in out


def test_sanitize_preserves_clean_text() -> None:
    text = "Ставка 16,5% годовых, портфель вырос на 12%."
    assert sanitize(text, where="test") == text


def test_sanitize_passes_empty_through() -> None:
    assert sanitize("", where="test") == ""


# ── fail closed ────────────────────────────────────────────────────────────
def test_masker_crash_blocks_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """A crash in a safety component must stop the request, not skip the check."""

    def boom(_: str):
        raise OSError("masking backend down")

    monkeypatch.setattr(dlp, "mask", boom)
    with pytest.raises(DlpBlocked) as e:
        sanitize("любой текст", where="test")
    assert "маскирования недоступен" in str(e.value)
    assert e.value.where == "test"


def test_residual_pii_after_masking_blocks_the_call(monkeypatch: pytest.MonkeyPatch) -> None:
    """Masking ran but its output still leaks — block, don't emit a partial mask."""

    def half_broken(text: str):
        return text, ()  # pretends to mask, changes nothing

    monkeypatch.setattr(dlp, "mask", half_broken)
    with pytest.raises(DlpBlocked) as e:
        sanitize(f"ЖШШИР {VALID_PINFL}", where="test")
    assert "не прошёл валидацию" in str(e.value)
    assert e.value.found  # what leaked is reported as counts, not values


def test_block_reports_counts_not_values(monkeypatch: pytest.MonkeyPatch) -> None:
    """An audit record must never carry the identifier it is reporting."""
    monkeypatch.setattr(dlp, "mask", lambda t: (t, ()))
    with pytest.raises(DlpBlocked) as e:
        sanitize(f"ЖШШИР {VALID_PINFL}", where="test")
    assert VALID_PINFL not in str(e.value)
    assert VALID_PINFL not in str(e.value.found)


# ── message payloads ───────────────────────────────────────────────────────
def test_sanitize_messages_masks_every_role() -> None:
    msgs = [
        {"role": "system", "content": "Ты ассистент."},
        {"role": "user", "content": f"Кто такой {VALID_PINFL}?"},
        {"role": "assistant", "content": "тел. +998901234567"},
    ]
    out = sanitize_messages(msgs)
    joined = " ".join(m["content"] for m in out)
    assert VALID_PINFL not in joined
    assert "998901234567" not in joined


def test_sanitize_messages_does_not_mutate_input() -> None:
    """A blocked call must not leave half-masked state in the caller's list."""
    msgs = [{"role": "user", "content": f"ЖШШИР {VALID_PINFL}"}]
    sanitize_messages(msgs)
    assert msgs[0]["content"] == f"ЖШШИР {VALID_PINFL}"


def test_sanitize_messages_keeps_non_string_content() -> None:
    msgs = [{"role": "user", "content": [{"type": "text", "text": "hi"}]}]
    out = sanitize_messages(msgs)
    assert out[0]["content"] == [{"type": "text", "text": "hi"}]


def test_sanitize_messages_preserves_other_fields() -> None:
    msgs = [{"role": "tool", "content": "ok", "tool_call_id": "abc123"}]
    out = sanitize_messages(msgs)
    assert out[0]["tool_call_id"] == "abc123"


def test_scan_reports_without_altering() -> None:
    found = scan(f"ЖШШИР {VALID_PINFL}")
    assert len(found) == 1
    assert found[0].value == VALID_PINFL
