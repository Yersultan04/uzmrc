from __future__ import annotations

from app.compare.splitter import split_clauses
from app.ingestion.parser import ParsedPage, ParsedTable


def _page(n: int, text: str, tables: list[ParsedTable] | None = None) -> ParsedPage:
    return ParsedPage(page_number=n, text=text, tables=tables or [])


def test_structured_numbered_clauses_split():
    text = (
        "Статья 1. Общие положения\n"
        "Настоящий регламент определяет порядок рефинансирования ипотечных кредитов.\n"
        "Статья 2. Требования к заёмщику\n"
        "Первоначальный взнос должен составлять не менее 20 процентов.\n"
        "Статья 3. Сроки\n"
        "Срок рассмотрения заявки не превышает 10 рабочих дней.\n"
    )
    clauses = split_clauses([_page(1, text)])
    assert len(clauses) == 3
    assert clauses[0].label.startswith("Статья 1")
    assert "20 процентов" in clauses[1].text
    assert all(c.page_start == 1 for c in clauses)


def test_decimal_numbering_split():
    text = (
        "1. Первое положение с достаточно длинным текстом для прохождения порога.\n"
        "2. Второе положение, тоже длинное, чтобы не схлопнулось с предыдущим.\n"
        "3. Третье положение, снова достаточно длинное для отдельной единицы.\n"
    )
    clauses = split_clauses([_page(1, text)])
    assert len(clauses) == 3


def test_table_becomes_atomic_clause():
    tbl = ParsedTable(
        page_number=1,
        markdown="| Параметр | Значение |\n| --- | --- |\n| Ставка | 12% |",
        rows=2,
        cols=2,
    )
    text = "Статья 1. Условия кредитования определяются следующей таблицей значений."
    clauses = split_clauses([_page(1, text, tables=[tbl])])
    table_clauses = [c for c in clauses if c.is_table]
    assert len(table_clauses) == 1
    assert "Ставка" in table_clauses[0].text


def test_unstructured_falls_back_to_chunker():
    # No clause markers at all → must still yield at least one unit.
    text = "Просто сплошной текст без какой-либо нумерации и заголовков. " * 50
    clauses = split_clauses([_page(1, text)])
    assert len(clauses) >= 1
    assert all(c.text for c in clauses)


def test_page_range_tracked_across_pages():
    p1 = _page(1, "Статья 1. Начало положения на первой странице документа.")
    p2 = _page(2, "продолжение того же положения на второй странице документа.")
    clauses = split_clauses([p1, p2])
    # First (only) clause spans pages 1..2.
    assert clauses[0].page_start == 1
    assert clauses[0].page_end == 2
