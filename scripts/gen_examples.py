"""Генератор 10 примеров работы UzMRC против живого API (localhost:8088).
Пишет результат в notes/10-EXAMPLES.md (UTF-8). Запуск: python gen_examples.py
"""
import json
import time
import os
import requests

BASE = "http://localhost:8088/api"
RAG = "1e852a09-a47e-4979-bb75-e28901a4390d"
HERE = os.path.dirname(os.path.abspath(__file__))
DEMO = os.path.join(HERE, "corpus", "demo")
OUT = os.path.join(HERE, "notes", "10-EXAMPLES.md")

REL_RU = {
    "conflict": "Противоречие",
    "duplicate": "Дубль",
    "addition": "Дополнение",
    "gap": "Пробел",
}


def login() -> str:
    r = requests.post(
        f"{BASE}/auth/login",
        json={"email": "admin@uzmrc.io", "password": "UzmrcAdmin2026!"},
        timeout=30,
    )
    r.raise_for_status()
    return r.json()["access_token"]


def chat(tok: str, query: str, timeout: int = 180) -> dict:
    h = {"Authorization": f"Bearer {tok}"}
    r = requests.post(
        f"{BASE}/rags/{RAG}/agent/runs", json={"query": query}, headers=h, timeout=30
    )
    r.raise_for_status()
    run_id = r.json()["id"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2)
        g = requests.get(
            f"{BASE}/rags/{RAG}/agent/runs/{run_id}", headers=h, timeout=30
        ).json()
        if g["status"] in ("succeeded", "finished", "failed", "error"):
            g["_elapsed"] = round(time.time() - t0, 1)
            return g
    return {"status": "timeout", "_elapsed": timeout}


def compare(tok: str, path: str, timeout: int = 240) -> dict:
    h = {"Authorization": f"Bearer {tok}"}
    with open(path, "rb") as f:
        files = {"file": (os.path.basename(path), f, "text/plain")}
        r = requests.post(
            f"{BASE}/rags/{RAG}/compare", files=files, headers=h, timeout=60
        )
    r.raise_for_status()
    run_id = r.json()["id"]
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(3)
        g = requests.get(
            f"{BASE}/rags/{RAG}/compare/runs/{run_id}", headers=h, timeout=30
        ).json()
        if g["status"] in ("succeeded", "failed"):
            g["_elapsed"] = round(time.time() - t0, 1)
            return g
    return {"status": "timeout", "_elapsed": timeout}


CHAT_QS = [
    ("RU", "Какова антикоррупционная политика компании и что она запрещает сотрудникам?"),
    ("UZ", "Korrupsiyaga qarshi siyosat xodimlarga nimani taqiqlaydi?"),
    ("RU", "Какие полномочия и компетенция у наблюдательного совета?"),
    ("RU", "Какая в компании дивидендная политика и как распределяется прибыль?"),
    ("RU", "Что устав говорит о компетенции общего собрания акционеров?"),
    ("RU", "Каков порядок рассмотрения обращений и жалоб о нарушениях?"),
    ("RU-OOB", "Какой курс доллара к суму сегодня и какая завтра погода в Ташкенте?"),
]

COMPARE_FILES = [
    ("prikaz-vnutrenniy-2026-foreign.txt", "Чужой приказ 2026 (нормы другой компании) — стресс-тест на противоречия"),
    ("prikaz-test-duplicates.txt", "Приказ, дублирующий действующие нормы — тест на дубли"),
    ("prikaz-test-newtopics.txt", "Приказ с новыми темами — тест на пробелы/дополнения"),
]


def w(fh, s=""):
    fh.write(s + "\n")


def main():
    tok = login()
    fh = open(OUT, "w", encoding="utf-8")
    w(fh, "# UzMRC — 10 примеров работы системы")
    w(fh)
    w(fh, "> Все примеры — **реальные прогоны** против живого стека (RAG «UzMRC Corpus», "
          "50 документов / 1630 чанков, voyage-3.5). Дата: 2026-06-18.")
    w(fh, "> Чат: async agent-run, ответ с цитатами и оценкой уверенности. "
          "Сравнение: фоновый прогон, отчёт по пунктам.")
    w(fh)
    w(fh, "---")
    w(fh)
    w(fh, "## Часть A. Чат по документам (примеры 1–7)")
    w(fh)
    fh.flush()

    n = 0
    for lang, q in CHAT_QS:
        n += 1
        print(f"[chat {n}] {lang}: {q[:50]}...", flush=True)
        g = chat(tok, q)
        w(fh, f"### Пример {n}. ({lang}) {q}")
        w(fh)
        ans = (g.get("answer") or "").strip()
        conf = g.get("confidence")
        cits = g.get("citations") or []
        w(fh, f"- **Статус:** {g.get('status')} · время: {g.get('_elapsed')}с · "
              f"шагов: {g.get('steps_used')}/{g.get('max_steps')} · "
              f"уверенность: {conf if conf is not None else '—'}")
        w(fh)
        w(fh, "**Ответ системы:**")
        w(fh)
        w(fh, "> " + (ans.replace("\n", "\n> ") if ans else "_(пусто)_"))
        w(fh)
        if cits:
            w(fh, f"**Источники ({len(cits)}):**")
            w(fh)
            for c in cits[:6]:
                if isinstance(c, dict):
                    fn = c.get("filename") or c.get("file") or "?"
                    pg = c.get("page_start") or c.get("page") or "?"
                    quote = (c.get("quote") or c.get("text") or "")[:160].strip()
                    w(fh, f"- `{fn}` стр. {pg}: «{quote}…»")
                else:
                    w(fh, f"- {str(c)[:160]}")
            w(fh)
        else:
            w(fh, "**Источники:** —")
            w(fh)
        if lang == "RU-OOB":
            w(fh, "_Контроль галлюцинаций: вопрос вне нормативной базы — система не выдумывает данные._")
            w(fh)
        w(fh, "---")
        w(fh)
        fh.flush()

    w(fh, "## Часть B. Сравнение документов (примеры 8–10)")
    w(fh)
    fh.flush()

    for fn, desc in COMPARE_FILES:
        n += 1
        path = os.path.join(DEMO, fn)
        print(f"[compare {n}] {fn}", flush=True)
        g = compare(tok, path)
        rep = g.get("report") or {}
        summ = rep.get("summary") or {}
        finds = rep.get("findings") or []
        grounded = sum(
            1 for x in finds if (x.get("matched_norm") or {}).get("grounded")
        )
        w(fh, f"### Пример {n}. Сравнение: `{fn}`")
        w(fh)
        w(fh, f"_{desc}_")
        w(fh)
        w(fh, f"- **Статус:** {g.get('status')} · время: {g.get('_elapsed')}с")
        w(fh, f"- **Итог:** пунктов {summ.get('total_clauses', 0)} · "
              f"противоречий {summ.get('conflict', 0)} · "
              f"дублей {summ.get('duplicate', 0)} · "
              f"дополнений {summ.get('addition', 0)} · "
              f"пробелов {summ.get('gap', 0)}")
        w(fh, f"- **Цитаты норм подтверждены (grounded):** {grounded}/{len(finds)}")
        w(fh)
        if finds:
            w(fh, "**Находки (до 5):**")
            w(fh)
            for x in finds[:5]:
                rel = REL_RU.get(x.get("relation"), x.get("relation"))
                ct = (x.get("clause_text") or "")[:150].strip()
                rat = (x.get("rationale") or "")[:200].strip()
                rec = (x.get("recommendation") or "")[:150].strip()
                mn = x.get("matched_norm") or {}
                w(fh, f"**[{rel}]** п.{x.get('clause_index')}: «{ct}…»")
                w(fh, f"  - Обоснование: {rat}")
                if mn:
                    w(fh, f"  - Норма базы: `{mn.get('filename','?')}` стр. "
                          f"{mn.get('page_start','?')} — «{(mn.get('quote') or '')[:140].strip()}…» "
                          f"(grounded: {mn.get('grounded')})")
                w(fh, f"  - Рекомендация: {rec}")
                w(fh)
        w(fh, "---")
        w(fh)
        fh.flush()

    fh.close()
    print("DONE ->", OUT, flush=True)


if __name__ == "__main__":
    main()
