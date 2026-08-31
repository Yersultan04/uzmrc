"""Uzbek Latin <-> Cyrillic transliteration and query expansion.

Guards the fix for the measured script split in the UzMRC corpus: 252 Latin vs
198 Cyrillic documents with a 3.6% term overlap, costing a Latin-only query
44.3% of its relevant documents. See app/lang/uz_translit.py.
"""
from __future__ import annotations

import pytest

from app.lang.uz_translit import (
    detect_script,
    fold,
    query_variants,
    to_cyrillic,
    to_latin,
)

# Domain vocabulary actually present in the corpus, in both scripts.
DOMAIN_PAIRS = [
    ("ipoteka", "ипотека"),
    ("kredit", "кредит"),
    ("bank", "банк"),
    ("qaror", "қарор"),
    ("nazorat", "назорат"),
    ("mablagʻ", "маблағ"),
    ("hisobot", "ҳисобот"),
    ("foiz", "фоиз"),
    ("shartnoma", "шартнома"),
    ("majburiyat", "мажбурият"),
    ("toʻgʻrisida", "тўғрисида"),
    ("qayta moliyalashtirish", "қайта молиялаштириш"),
    ("respublikasi", "республикаси"),
]


@pytest.mark.parametrize("lat,cyr", DOMAIN_PAIRS)
def test_latin_to_cyrillic(lat: str, cyr: str) -> None:
    assert to_cyrillic(lat) == cyr


@pytest.mark.parametrize("lat,cyr", DOMAIN_PAIRS)
def test_fold_collapses_both_scripts(lat: str, cyr: str) -> None:
    """The whole point: two spellings of one word compare equal."""
    assert fold(lat) == fold(cyr)


@pytest.mark.parametrize(
    "cyr,lat",
    [("ипотека", "ipoteka"), ("шартнома", "shartnoma"), ("қарор", "qaror")],
)
def test_cyrillic_to_latin(cyr: str, lat: str) -> None:
    assert to_latin(cyr) == lat


def test_apostrophe_variants_all_fold_together() -> None:
    """Real corpora spell oʻ with whatever apostrophe the keyboard produced."""
    spellings = ["toʻgʻrisida", "to'g'risida", "to‘g‘risida", "to`g`risida", "toʼgʼrisida"]
    folded = {fold(s) for s in spellings}
    assert len(folded) == 1
    assert folded.pop() == fold("тўғрисида")


def test_digraphs_beat_single_letters() -> None:
    """sh/ch/yo must not decompose into their component letters."""
    assert to_cyrillic("shahar") == "шаҳар"
    assert to_cyrillic("choy") == "чой"
    assert to_cyrillic("yozuv") == "ёзув"


def test_case_is_preserved() -> None:
    assert to_cyrillic("Ipoteka") == "Ипотека"
    assert to_cyrillic("BANK") == "БАНК"
    assert to_latin("Шартнома") == "Shartnoma"


def test_punctuation_and_digits_survive() -> None:
    assert to_cyrillic("qaror 415-son, 29.07.2026") == "қарор 415-сон, 29.07.2026"


@pytest.mark.parametrize(
    "text,expected",
    [
        ("ipoteka krediti", "latin"),
        ("ипотека кредити", "cyrillic"),
        ("bank банк", "mixed"),
        ("2026 — 415", "none"),
    ],
)
def test_detect_script(text: str, expected: str) -> None:
    assert detect_script(text) == expected


def test_query_variants_covers_both_scripts() -> None:
    lat = query_variants("ipoteka shartnomasi")
    assert lat[0] == "ipoteka shartnomasi"
    assert "ипотека шартномаси" in lat

    cyr = query_variants("ипотека шартномаси")
    assert cyr[0] == "ипотека шартномаси"
    assert "ipoteka shartnomasi" in cyr


def test_query_variants_are_deduplicated() -> None:
    """A script-neutral query (digits, punctuation) must not fan out."""
    assert len(query_variants("415")) == 1


def test_query_variants_empty_input() -> None:
    assert query_variants("") == []
    assert query_variants("   ") == []


def test_transliteration_is_idempotent_under_fold() -> None:
    """Folding a round-trip must not drift — guards against rule-order bugs."""
    for lat, _ in DOMAIN_PAIRS:
        assert fold(to_latin(to_cyrillic(lat))) == fold(lat)


def test_russian_text_is_not_mangled_by_fold() -> None:
    """Russian shares the Cyrillic block; folding must stay reversible enough
    that distinct Russian words do not collide."""
    words = ["ипотека", "кредит", "договор", "процент", "отчёт", "надзор"]
    assert len({fold(w) for w in words}) == len(words)
