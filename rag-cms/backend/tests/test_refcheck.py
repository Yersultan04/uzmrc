"""Normative reference verification — the zero-tolerance metric.

The spec scores non-existent or misattributed normative references at zero
allowed cases, so this guards app/agent/refcheck.py: an answer may only assert
"статья 12" when the retrieved pool actually addresses article 12.

Distinct from grounding, which checks that a verbatim quote appears in a chunk.
A quote can be genuine and its stated address invented.
"""
from __future__ import annotations

import uuid

import pytest

from app.agent.refcheck import (
    ARTICLE,
    CLAUSE,
    CONFIRMED,
    DOCUMENT,
    PART,
    UNVERIFIED,
    extract_references,
    verify_references,
)
from app.agent.schemas import PoolEntry


def entry(text: str, *, heading: str | None = None, filename: str = "doc.pdf") -> PoolEntry:
    return PoolEntry(
        chunk_id=uuid.uuid4(),
        file_id=uuid.uuid4(),
        filename=filename,
        heading=heading,
        text=text,
    )


# ── extraction ─────────────────────────────────────────────────────────────
@pytest.mark.parametrize(
    "text,kind,number",
    [
        ("согласно постановлению № 415", DOCUMENT, "415"),
        ("415-сон қарорга мувофиқ", DOCUMENT, "415"),
        ("415-son qarorga muvofiq", DOCUMENT, "415"),
        ("в статье 12 указано", ARTICLE, "12"),
        ("см. ст. 12 закона", ARTICLE, "12"),
        ("12-модда талабларига кўра", ARTICLE, "12"),
        ("12-modda talablariga koʻra", ARTICLE, "12"),
        ("пункт 3.4 регламента", CLAUSE, "3.4"),
        ("п. 5 положения", CLAUSE, "5"),
        ("3-банд бўйича", CLAUSE, "3"),
        ("часть 2 статьи", PART, "2"),
        ("2-қисм", PART, "2"),
    ],
)
def test_extracts_reference(text: str, kind: str, number: str) -> None:
    refs = extract_references(text)
    assert any(r.kind == kind and r.number == number for r in refs), refs


def test_extraction_deduplicates() -> None:
    refs = extract_references("статья 12 ... в статье 12 ... ст. 12")
    assert len([r for r in refs if r.kind == ARTICLE and r.number == "12"]) == 1


def test_extraction_ignores_plain_numbers() -> None:
    """Bare numbers are not addresses — dates and amounts must not be picked up."""
    assert extract_references("выдано 5000 кредитов в 2026 году") == ()


def test_extraction_empty_text() -> None:
    assert extract_references("") == ()


# ── verification ───────────────────────────────────────────────────────────
def test_confirms_article_present_in_pool() -> None:
    pool = [entry("Статья 12. Порядок рефинансирования ипотечных кредитов.")]
    report = verify_references("Согласно статье 12, банк обязан...", pool)
    assert report.total == 1
    assert report.checks[0].verdict == CONFIRMED
    assert report.all_verified


def test_flags_article_absent_from_pool() -> None:
    """The invented-address case the metric exists for."""
    pool = [entry("Статья 12. Порядок рефинансирования.")]
    report = verify_references("Согласно статье 47, банк обязан...", pool)
    assert report.checks[0].verdict == UNVERIFIED
    assert not report.all_verified
    assert report.fraction == 0.0


def test_bare_number_in_pool_is_not_enough() -> None:
    """'47' appearing as an amount must not confirm 'статья 47'."""
    pool = [entry("Выдано 47 кредитов на сумму 47 млрд сум.")]
    report = verify_references("Согласно статье 47...", pool)
    assert report.checks[0].verdict == UNVERIFIED


def test_cyrillic_uzbek_pool_confirms_latin_reference() -> None:
    """Answer in Uzbek Latin, source in Uzbek Cyrillic — must still confirm."""
    pool = [entry("12-модда. Ипотека кредитларини қайта молиялаштириш тартиби.")]
    report = verify_references("12-modda talablariga koʻra...", pool)
    assert report.checks[0].verdict == CONFIRMED


def test_latin_uzbek_pool_confirms_cyrillic_reference() -> None:
    pool = [entry("12-modda. Ipoteka kreditlarini qayta moliyalashtirish tartibi.")]
    report = verify_references("12-модда талабларига кўра...", pool)
    assert report.checks[0].verdict == CONFIRMED


def test_russian_reference_matches_uzbek_source() -> None:
    """Answer says 'статья 12', source writes it as '12-modda'."""
    pool = [entry("12-modda. Ipoteka kreditlari.")]
    report = verify_references("В статье 12 закреплено...", pool)
    assert report.checks[0].verdict == CONFIRMED


def test_document_number_confirmed_from_filename() -> None:
    pool = [entry("Об утверждении перечня.", filename="qaror-415-son.pdf")]
    report = verify_references("постановление № 415 устанавливает...", pool)
    assert report.checks[0].verdict == CONFIRMED


def test_heading_counts_as_source() -> None:
    pool = [entry("Текст без адресов.", heading="Статья 12. Общие положения")]
    report = verify_references("статья 12 гласит", pool)
    assert report.checks[0].verdict == CONFIRMED


def test_mixed_verdicts_are_reported_separately() -> None:
    pool = [entry("Статья 12. Порядок. Пункт 3.4 регламента.")]
    report = verify_references("статья 12 и пункт 3.4, а также статья 99", pool)
    assert report.total == 3
    assert len(report.unverified) == 1
    assert report.unverified[0].ref.number == "99"
    assert report.fraction == pytest.approx(2 / 3)


def test_no_references_is_fully_verified() -> None:
    """An answer that makes no normative claims cannot fail this check."""
    report = verify_references("Ипотечный портфель вырос на 12% за квартал.", [])
    assert report.total == 0
    assert report.all_verified
    assert report.fraction == 1.0


def test_empty_pool_leaves_reference_unverified() -> None:
    report = verify_references("согласно статье 12", [])
    assert report.checks[0].verdict == UNVERIFIED


def test_evidence_records_the_matched_construction() -> None:
    pool = [entry("Статья 12. Порядок рефинансирования.")]
    report = verify_references("статья 12", pool)
    assert "12" in report.checks[0].evidence
