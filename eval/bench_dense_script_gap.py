"""Does the dense leg already bridge the two Uzbek scripts?

Script expansion is in place for the sparse leg, but sparse carries only 20% of
the hybrid weight. Before spending the other 80% on a second embedding call per
query, measure whether the embedder already treats "ipoteka" and "ипотека" as
the same thing.

Method: embed each domain term in both scripts and compare
  * same-term cross-script cosine  -- ipoteka  vs  ипотека
  * different-term baseline cosine -- ipoteka  vs  шартнома
A model blind to script would put both near the same value; a model that
bridges scripts puts same-term far above baseline.

Reads credentials from rag-cms/.env. Costs ~30 query embeddings.

Usage: python bench_dense_script_gap.py
"""
from __future__ import annotations

import asyncio
import itertools
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "rag-cms"
sys.path.insert(0, str(ROOT / "backend"))

# Load rag-cms/.env before app settings are constructed.
for line in (ROOT / ".env").read_text(encoding="utf-8", errors="ignore").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from app.clients import voyage  # noqa: E402

PAIRS = [
    ("ipoteka", "ипотека"),
    ("kredit", "кредит"),
    ("bank", "банк"),
    ("qaror", "қарор"),
    ("shartnoma", "шартнома"),
    ("hisobot", "ҳисобот"),
    ("foiz stavkasi", "фоиз ставкаси"),
    ("nazorat kengashi", "назорат кенгаши"),
    ("qayta moliyalashtirish", "қайта молиялаштириш"),
    ("majburiyat", "мажбурият"),
]


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    return dot / (na * nb) if na and nb else 0.0


async def main() -> None:
    lat = [p[0] for p in PAIRS]
    cyr = [p[1] for p in PAIRS]

    print(f"Модель эмбеддингов: {voyage._effective_model(None)}")
    print(f"Терминов: {len(PAIRS)} пар\n")

    vecs = await voyage._embed(lat + cyr, "query")
    vlat, vcyr = vecs[: len(lat)], vecs[len(lat):]

    print(f"{'термин':<26}{'кросс-графика':>15}")
    print("-" * 41)
    same = []
    for i, (l, c) in enumerate(PAIRS):
        s = cosine(vlat[i], vcyr[i])
        same.append(s)
        print(f"{l + ' / ' + c:<26}{s:>15.3f}")

    # Baseline: different terms, across scripts (what "unrelated" looks like).
    base = [
        cosine(vlat[i], vcyr[j])
        for i, j in itertools.permutations(range(len(PAIRS)), 2)
    ]
    # Same-script different-term, for reference.
    base_same_script = [
        cosine(vlat[i], vlat[j])
        for i, j in itertools.permutations(range(len(PAIRS)), 2)
    ]

    avg_same = sum(same) / len(same)
    avg_base = sum(base) / len(base)
    avg_base_ss = sum(base_same_script) / len(base_same_script)

    print("-" * 41)
    print(f"{'один термин, разная графика':<26}{avg_same:>15.3f}")
    print(f"{'разные термины, разн. граф.':<26}{avg_base:>15.3f}")
    print(f"{'разные термины, одна граф.':<26}{avg_base_ss:>15.3f}")

    margin = avg_same - avg_base
    print("\n--- вывод ---")
    print(f"Отрыв от шума: {margin:+.3f}")
    print(f"Минимум по парам: {min(same):.3f}  ({PAIRS[same.index(min(same))][0]})")
    if avg_same > 0.80 and margin > 0.25:
        print("\nDense-нога СПРАВЛЯЕТСЯ с графикой сама.")
        print("Расширять dense вторым эмбеддингом не нужно — только удвоит стоимость.")
    elif margin < 0.15:
        print("\nDense-нога СЛЕПА к графике так же, как sparse.")
        print("Нужно расширение dense: эмбеддить обе формы и брать максимум.")
    else:
        print("\nDense-нога справляется ЧАСТИЧНО.")
        print("Расширение даст выигрыш на слабых парах; решать по стоимости.")


if __name__ == "__main__":
    asyncio.run(main())
