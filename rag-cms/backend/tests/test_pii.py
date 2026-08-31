"""Personal data detection and masking — the other zero-tolerance metric.

Guards app/security/pii.py. The spec allows zero confirmed disclosures of
personal data in answers, logs or exports, so everything leaving for an external
model passes through here first.

Half of these tests are about what must NOT be masked. An over-eager masker
silently destroys the figures an answer is built from, which fails the accuracy
metrics instead of the privacy ones — a quieter but equally real failure.
"""
from __future__ import annotations

import pytest

from app.security.pii import (
    ACCOUNT,
    CARD,
    EMAIL,
    INN,
    PASSPORT,
    PHONE,
    PINFL,
    detect,
    has_pii,
    mask,
    summarize,
)

# 14 digits, sex+century 3, born 15.04.92 — structurally a real PINFL.
VALID_PINFL = "31504920012345"
# Luhn-valid test card number.
VALID_CARD = "4111111111111111"


def kinds(text: str) -> list[str]:
    return [m.kind for m in detect(text)]


# ── detection ──────────────────────────────────────────────────────────────
def test_detects_pinfl() -> None:
    assert PINFL in kinds(f"Заёмщик, ЖШШИР {VALID_PINFL}, оформил кредит.")


def test_detects_passport() -> None:
    assert PASSPORT in kinds("Паспорт AB 1234567 выдан МВД.")


def test_detects_phone() -> None:
    assert PHONE in kinds("Контакт: +998 90 123 45 67")


def test_detects_email() -> None:
    assert EMAIL in kinds("Написать на ipoteka@uzmrc.uz для уточнения.")


def test_detects_account() -> None:
    assert ACCOUNT in kinds("Счёт 20208000900001234567 в банке.")


def test_detects_card() -> None:
    assert CARD in kinds(f"Карта {VALID_CARD} привязана.")


def test_detects_inn() -> None:
    assert INN in kinds("ИНН 305678901 организации.")


def test_detects_several_kinds_at_once() -> None:
    text = f"ЖШШИР {VALID_PINFL}, паспорт AB 1234567, тел. +998901234567"
    assert set(kinds(text)) == {PINFL, PASSPORT, PHONE}


# ── false positives: what must survive untouched ───────────────────────────
def test_amounts_are_not_masked() -> None:
    """Financial figures are the answer's substance — never mask them."""
    text = "Портфель вырос до 1250000 сум при ставке 16.5% годовых."
    assert detect(text) == ()


def test_nine_digit_amount_is_not_an_inn() -> None:
    """123456789 sum is an ordinary mortgage figure, not a tax number.

    This is why INN needs its label: without it the masker would delete
    amounts from the answer and fail the accuracy metric instead.
    """
    assert detect("Выдано кредитов на 123456789 сум за квартал.") == ()


def test_inn_masks_the_number_but_keeps_its_label() -> None:
    masked, found = mask("ИНН 305678901 организации.")
    assert [m.kind for m in found] == [INN]
    assert "305678901" not in masked
    assert "ИНН" in masked


def test_invalid_pinfl_is_left_alone() -> None:
    """14 digits with an impossible birth date is a registry number, not a PINFL."""
    assert PINFL not in kinds("Регистрационный номер 99999999999999 в реестре.")
    assert PINFL not in kinds("Номер договора 31399920012345 от 2026 года.")


def test_non_luhn_card_is_left_alone() -> None:
    assert CARD not in kinds("Идентификатор 1234567812345678 в системе.")


def test_years_and_dates_survive() -> None:
    assert detect("Постановление № 415 от 29.07.2026 года") == ()


def test_document_numbers_survive() -> None:
    assert detect("Статья 12, пункт 3.4, часть 2 закона") == ()


# ── masking ────────────────────────────────────────────────────────────────
def test_mask_replaces_with_typed_placeholder() -> None:
    masked, found = mask(f"ЖШШИР {VALID_PINFL} заёмщика.")
    assert VALID_PINFL not in masked
    assert "[ПИНФЛ]" in masked
    assert len(found) == 1


def test_mask_preserves_surrounding_text() -> None:
    masked, _ = mask("Телефон +998901234567 указан в анкете.")
    assert masked.startswith("Телефон ")
    assert masked.endswith(" указан в анкете.")


def test_mask_handles_multiple_occurrences() -> None:
    masked, found = mask("тел. +998901234567 и +998901112233")
    assert len(found) == 2
    assert masked.count("[ТЕЛЕФОН]") == 2
    assert "998" not in masked


def test_mask_is_noop_without_pii() -> None:
    text = "Ипотечный портфель вырос на 12% за квартал."
    masked, found = mask(text)
    assert masked == text
    assert found == ()


def test_mask_is_idempotent() -> None:
    once, _ = mask(f"ЖШШИР {VALID_PINFL}")
    twice, _ = mask(once)
    assert once == twice


def test_overlapping_matches_claimed_once() -> None:
    """A card number must not also be reported as a phone or an account."""
    found = detect(f"Карта {VALID_CARD}")
    assert len(found) == 1
    assert found[0].kind == CARD


# ── reporting ──────────────────────────────────────────────────────────────
def test_has_pii() -> None:
    assert has_pii(f"ЖШШИР {VALID_PINFL}")
    assert not has_pii("Ставка 16,5% годовых")


def test_summarize_counts_without_exposing_values() -> None:
    """Audit records need counts; the values themselves must never be logged."""
    _, found = mask(f"{VALID_PINFL} и +998901234567 и +998901112233")
    counts = summarize(found)
    assert counts == {PINFL: 1, PHONE: 2}
    assert VALID_PINFL not in str(counts)


@pytest.mark.parametrize("text", ["", "   ", "\n"])
def test_empty_input(text: str) -> None:
    assert detect(text) == ()
    assert mask(text)[0] == text


# ── the barrier: masking cannot be bypassed by construction ────────────────
def test_pool_entry_masks_on_construction() -> None:
    """The pool is built in several places and flows to the prompt, to
    grounding and to the citations shown to the user. Masking lives on the
    type so no path can assemble one carrying personal data."""
    import uuid as _uuid

    from app.agent.schemas import PoolEntry

    entry = PoolEntry(
        chunk_id=_uuid.uuid4(),
        file_id=_uuid.uuid4(),
        filename="portfel.xlsx",
        heading=f"Заёмщик {VALID_PINFL}",
        text=f"ЖШШИР {VALID_PINFL}, тел. +998901234567, ставка 16,5%.",
    )
    assert VALID_PINFL not in entry.text
    assert VALID_PINFL not in (entry.heading or "")
    assert "998901234567" not in entry.text
    assert "[ПИНФЛ]" in entry.text
    # the substance of the answer must survive
    assert "16,5%" in entry.text
