"""Регресс-тесты grounding: цитата из нескольких НЕсоседних фрагментов (через «…»)
в длинном чанке должна заземляться, а не рушить confidence в 0 (баг примера 6).
А также — покрытие не должно зависеть от длины чанка.
"""
import uuid

from app.agent.grounding import _coverage_ratio, check_citation
from app.agent.schemas import Citation, PoolEntry

_CHUNK = (
    "Upon receipt of a relevant report, the anti-corruption inspector shall conduct a "
    "preliminary investigation and analyse its relevance. The preliminary audit shall be "
    "conducted within 5 (five) working days from the date of receipt of the relevant notice. "
    "Padding sentence one. Padding sentence two. Padding three to make the chunk far longer "
    "than the quote. Consideration of the content of the relevant reports within one month "
    "from the date of receipt."
)


def _pool(text: str):
    cid = uuid.uuid4()
    entry = PoolEntry(
        chunk_id=cid,
        file_id=uuid.uuid4(),
        filename="politika.pdf.txt",
        page_start=1,
        page_end=1,
        heading=None,
        text=text,
        score=0.9,
    )
    return cid, {cid: entry}


def test_coverage_ratio_independent_of_haystack_length():
    needle = "the preliminary audit shall be conducted within 5 (five) working days"
    assert _coverage_ratio(needle, _CHUNK.lower()) > 0.95


def test_stitched_quote_grounds():
    cid, pool = _pool(_CHUNK)
    quote = (
        "The preliminary audit shall be conducted within 5 (five) working days from the date "
        "of receipt… Consideration of the content of the relevant reports within one month"
    )
    check = check_citation(
        Citation(chunk_id=cid, file_id=uuid.uuid4(), filename="politika.pdf.txt", quote=quote),
        pool,
    )
    assert check.grounded, check.note
    assert check.score >= 0.78


def test_unrelated_quote_does_not_ground():
    cid, pool = _pool(_CHUNK)
    quote = "The dividend policy distributes profit to shareholders twice a year by board vote."
    check = check_citation(
        Citation(chunk_id=cid, file_id=uuid.uuid4(), filename="politika.pdf.txt", quote=quote),
        pool,
    )
    assert not check.grounded


def test_chunk_not_in_pool():
    _, pool = _pool(_CHUNK)
    check = check_citation(
        Citation(
            chunk_id=uuid.uuid4(),
            file_id=uuid.uuid4(),
            filename="politika.pdf.txt",
            quote="anything at all here",
        ),
        pool,
    )
    assert not check.grounded
    assert check.method == "none"
