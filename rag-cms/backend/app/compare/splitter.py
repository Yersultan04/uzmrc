"""Split an uploaded regulation into discrete clauses (положения / пункты).

Legal/normative documents in this domain (UzMRC) are organized as numbered
articles and points, in Russian and Uzbek. We detect clause boundaries from
the numbering markers; tables become atomic clauses; and when a document has no
recognizable structure we fall back to the standard chunker so comparison still
gets sane units.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app.ingestion.chunker import chunk_pages, count_tokens
from app.ingestion.parser import ParsedPage


@dataclass
class Clause:
    index: int
    label: str | None
    text: str
    page_start: int
    page_end: int
    is_table: bool = False


# Markers that start a new clause. Covers RU + UZ normative numbering:
#   "Статья 12." / "Модда 12" / "Глава 3" / "Боб 3" / "Раздел II" / "Бўлим"
#   "§ 5" / "Пункт 4" / "Band 4"
#   "1." "1.1." "2.3.4)" — decimal point/sub-point numbering at line start.
_CLAUSE_START = re.compile(
    r"^\s*(?:"
    r"(?:статья|модда|глава|боб|раздел|бўлим|булим|параграф|пункт|band|§)\s*[№\s]*\d+"
    r"|\d+(?:\.\d+){0,3}\s*[.)]\s+\S"
    r")",
    re.IGNORECASE,
)

# A clause shorter than this (after stripping) is almost always a stray header,
# page number, or table-of-contents line — fold it into the next clause instead
# of emitting a useless finding.
_MIN_CLAUSE_CHARS = 40
# Hard ceiling so a single pathological clause can't blow the judge's context.
_MAX_CLAUSE_TOKENS = 1200


def _label_from(line: str) -> str:
    head = line.strip().splitlines()[0] if line.strip() else ""
    return head[:80].strip()


def _flush_text_clauses(
    pending: list[tuple[int, str]], start_index: int
) -> list[Clause]:
    """Group accumulated (page, line) pairs into clauses on numbering markers."""
    out: list[Clause] = []
    buf: list[str] = []
    buf_pages: list[int] = []
    label: str | None = None
    idx = start_index

    def emit() -> None:
        nonlocal buf, buf_pages, label, idx
        text = "\n".join(buf).strip()
        if text:
            out.append(
                Clause(
                    index=idx,
                    label=label,
                    text=text,
                    page_start=min(buf_pages),
                    page_end=max(buf_pages),
                )
            )
            idx += 1
        buf = []
        buf_pages = []
        label = None

    for page_no, line in pending:
        if _CLAUSE_START.match(line):
            # Only break if what we've accumulated is substantial; otherwise keep
            # folding (handles a bare "Статья 5." header line before its body).
            if buf and len("\n".join(buf).strip()) >= _MIN_CLAUSE_CHARS:
                if label is not None:
                    emit()  # close the previous real clause
                else:
                    # Text before the FIRST numbered marker is the document title /
                    # approval block / table of contents — drop it, don't emit a
                    # bogus clause (otherwise the cover page becomes a finding).
                    buf = []
                    buf_pages = []
            if label is None:
                label = _label_from(line)
        buf.append(line)
        buf_pages.append(page_no)
    if buf:
        emit()
    return out


def _split_oversized(clauses: list[Clause]) -> list[Clause]:
    """Hard-split any clause exceeding the token ceiling, re-indexing as we go."""
    out: list[Clause] = []
    idx = 0
    for c in clauses:
        if count_tokens(c.text) <= _MAX_CLAUSE_TOKENS:
            out.append(Clause(idx, c.label, c.text, c.page_start, c.page_end, c.is_table))
            idx += 1
            continue
        paras = [p for p in re.split(r"\n\s*\n", c.text) if p.strip()]
        cur: list[str] = []
        cur_tokens = 0
        for p in paras:
            t = count_tokens(p)
            if cur and cur_tokens + t > _MAX_CLAUSE_TOKENS:
                out.append(Clause(idx, c.label, "\n\n".join(cur), c.page_start, c.page_end))
                idx += 1
                cur, cur_tokens = [], 0
            cur.append(p)
            cur_tokens += t
        if cur:
            out.append(Clause(idx, c.label, "\n\n".join(cur), c.page_start, c.page_end))
            idx += 1
    return out


def split_clauses(pages: list[ParsedPage]) -> list[Clause]:
    """Top-level: structured split with table-atomicity and a chunker fallback."""
    clauses: list[Clause] = []
    pending: list[tuple[int, str]] = []

    def drain_pending() -> None:
        if pending:
            clauses.extend(_flush_text_clauses(pending, len(clauses)))
            pending.clear()

    for page in pages:
        # Tables are atomic clauses — a table row count mismatch is a classic
        # source of conflicts/dups, so we never sentence-split them.
        for tbl in getattr(page, "tables", []) or []:
            drain_pending()
            clauses.append(
                Clause(
                    index=len(clauses),
                    label=f"Таблица (стр. {tbl.page_number})",
                    text=tbl.markdown,
                    page_start=tbl.page_number,
                    page_end=tbl.page_number,
                    is_table=True,
                )
            )
        for line in (page.text or "").splitlines():
            if line.strip():
                pending.append((page.page_number, line))
    drain_pending()

    # No numbering detected anywhere → fall back to the standard chunker so we
    # still produce reasonable comparison units instead of one giant clause.
    has_structure = any(not c.is_table and c.label for c in clauses)
    if not has_structure:
        chunk_clauses = [
            Clause(
                index=i,
                label=ch.heading,
                text=ch.text,
                page_start=ch.page_start,
                page_end=ch.page_end,
                is_table=ch.is_table,
            )
            for i, ch in enumerate(chunk_pages(pages))
        ]
        if chunk_clauses:
            clauses = chunk_clauses

    return _split_oversized(clauses)
