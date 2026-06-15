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
