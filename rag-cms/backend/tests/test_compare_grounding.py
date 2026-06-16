from __future__ import annotations

from app.compare.grounding import is_quote_grounded

SOURCE = (
    "Первоначальный взнос должен составлять не менее 20 процентов от стоимости "
    "приобретаемого жилья по программе рефинансирования."
)


def test_exact_substring_grounds():
    assert is_quote_grounded("не менее 20 процентов от стоимости", SOURCE)


def test_punctuation_insensitive_grounds():
    assert is_quote_grounded("не менее 20, процентов — от стоимости", SOURCE)


def test_fuzzy_close_grounds():
    # Minor wording drift, still > 0.78 ratio against the whole source.
    assert is_quote_grounded(SOURCE.replace("процентов", "процента"), SOURCE)


def test_hallucinated_quote_not_grounded():
    assert not is_quote_grounded("первоначальный взнос составляет 50 процентов наличными", SOURCE)


def test_empty_inputs_not_grounded():
    assert not is_quote_grounded("", SOURCE)
    assert not is_quote_grounded("что-то", "")


def test_too_short_quote_not_grounded():
    # Below the 16-char minimum and not a fuzzy match → rejected as too weak.
    assert not is_quote_grounded("20%", SOURCE)


# ── best_verbatim_window (Phase 1 A2: salvage paraphrased quotes) ──────────────

from app.compare.grounding import best_verbatim_window


def test_best_window_recovers_paraphrase():
    source = (
        "Работник обязан незамедлительно сообщить руководителю о конфликте интересов. "
        "Кворум заседания составляет не менее семидесяти пяти процентов членов совета."
    )
    # Judge paraphrased the quorum sentence — window should return the verbatim one.
    got = best_verbatim_window("кворум должен быть не менее 75% членов", source)
    assert got is not None and "семидесяти пяти процентов" in got


def test_best_window_none_when_unrelated():
    source = "Работник обязан сообщить о конфликте интересов руководителю."
    assert best_verbatim_window("электромобили заряжаются на парковке офиса", source) is None


def test_grounding_tolerates_ocr_homoglyphs():
    # OCR mixed Latin c/e/o into the quote; should still ground against clean source.
    source = "Все сотрудники обязаны без промедления сообщать о подозрительных случаях."
    ocr_quote = "Вce coтрудники обязаны бeз пpoмeдлeния cooбщать o пoдoзритeльныx cлучаяx"
    assert is_quote_grounded(ocr_quote, source)
