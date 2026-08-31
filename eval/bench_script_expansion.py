"""Measure what Uzbek script expansion buys the sparse leg.

The sparse leg runs ``to_tsvector('simple', ...)`` + ``plainto_tsquery``, which
with the ``simple`` config does no stemming: a lexeme matches only if the exact
token is present. This script reproduces those semantics over the on-disk corpus
so the effect can be measured without a database or an index rebuild:

  * a query matches a document when **all** its tokens appear in it (AND), which
    is what ``plainto_tsquery`` builds;
  * expansion ORs the Latin and Cyrillic renderings, which is what
    ``plainto_tsquery(q0) || plainto_tsquery(q1)`` does in sparse.py.

Reported numbers are document hit counts, i.e. sparse-leg recall over the whole
corpus, not end-to-end answer quality.

Usage: python bench_script_expansion.py [corpus_dir]
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "rag-cms" / "backend"))

from app.lang.uz_translit import detect_script, query_variants  # noqa: E402

CORPUS = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    Path(__file__).resolve().parents[1] / "corpus"
)

_TOKEN = re.compile(r"\w+", re.UNICODE)

# Realistic user queries over the UzMRC corpus, in both scripts.
QUERIES: list[str] = [
    # Latin
    "ipoteka krediti",
    "qayta moliyalashtirish",
    "bank shartnomasi",
    "foiz stavkasi",
    "hisobot",
    "aksiyadorlar yigʻilishi",
    "nazorat kengashi",
    "majburiyat",
    "mablagʻ",
    "qaror",
    "ipoteka bozori",
    "kredit tartibi",
    # Cyrillic
    "ипотека кредити",
    "қайта молиялаштириш",
    "банк шартномаси",
    "фоиз ставкаси",
    "ҳисобот",
    "акциядорлар йиғилиши",
    "назорат кенгаши",
    "мажбурият",
    "маблағ",
    "қарор",
    "ипотека бозори",
    "кредит тартиби",
]


def load_corpus() -> dict[str, set[str]]:
    """Document name -> set of lowercase tokens, deduplicated by filename."""
    docs: dict[str, set[str]] = {}
    for p in CORPUS.rglob("*"):
        if not p.is_file() or p.suffix.lower() not in (".txt", ".html", ".htm", ".md"):
            continue
        key = p.name.lower()
        if key in docs:
            continue
        try:
            t = p.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if p.suffix.lower() in (".html", ".htm"):
            t = re.sub(r"<[^>]+>", " ", t)
        docs[key] = {m.group(0).lower() for m in _TOKEN.finditer(t)}
    return docs


def matches(doc_tokens: set[str], query: str) -> bool:
    """plainto_tsquery semantics under 'simple': every query token must appear."""
    toks = [m.group(0).lower() for m in _TOKEN.finditer(query)]
    return bool(toks) and all(t in doc_tokens for t in toks)


def hits(docs: dict[str, set[str]], queries: list[str]) -> set[str]:
    """Documents matching any of the query renderings (the OR of tsqueries)."""
    return {name for name, toks in docs.items() if any(matches(toks, q) for q in queries)}


def main() -> None:
    if not CORPUS.exists():
        raise SystemExit(f"corpus not found: {CORPUS}")

    docs = load_corpus()
    print(f"Корпус: {CORPUS}")
    print(f"Уникальных документов: {len(docs)}\n")

    hdr = f"{'запрос':<30}{'граф.':<10}{'без расш.':>11}{'с расш.':>10}{'прирост':>10}"
    print(hdr)
    print("-" * len(hdr))

    base_total = exp_total = 0
    gained_any = 0
    for q in QUERIES:
        base = hits(docs, [q])
        exp = hits(docs, query_variants(q))
        base_total += len(base)
        exp_total += len(exp)
        gained_any += 1 if len(exp) > len(base) else 0
        delta = len(exp) - len(base)
        pct = f"+{delta/len(base)*100:.0f}%" if base else ("+∞" if delta else "—")
        print(f"{q:<30}{detect_script(q):<10}{len(base):>11}{len(exp):>10}{pct:>10}")

    print("-" * len(hdr))
    print(f"{'СУММАРНО':<30}{'':<10}{base_total:>11}{exp_total:>10}"
          f"{f'+{(exp_total/base_total-1)*100:.0f}%' if base_total else '—':>10}")

    print("\n--- итог ---")
    print(f"Запросов, где расширение дало новые документы: {gained_any} из {len(QUERIES)}")
    if base_total:
        print(f"Суммарное покрытие sparse-ноги: {base_total} → {exp_total} документов "
              f"(x{exp_total/base_total:.2f})")
    print("\nЗамер лексический, воспроизводит семантику to_tsvector('simple').")
    print("Влияние на dense-ногу и на итоговое качество ответа здесь НЕ измеряется —")
    print("для этого нужен прогон на живом индексе.")


if __name__ == "__main__":
    main()
