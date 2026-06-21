"""Проверка retrieval нового полного RAG: кросс-язык ru/uz + покрытие новых тем.
Запуск на сервере: python3 /opt/uzmrc/verify_retrieval.py
Гоняет набор запросов и печатает топ-хиты (источник + score) — глазами видно, что
матчится по нормативке, аналитике рынка, ипотечной грамотности, новостям.
"""
import json, urllib.request

BASE = "http://localhost:8088"

# (язык, запрос, что ожидаем найти)
QUERIES = [
    ("ru", "антикоррупционная политика компании", "нормативка"),
    ("uz", "ipoteka krediti nima va qanday olinadi", "ипотечная грамотность (HTML)"),
    ("ru", "обзор рынка ипотеки Узбекистана", "аналитика рынка (HTML)"),
    ("uz", "yashil obligatsiyalar emissiyasi", "green bonds / эмиссия"),
    ("ru", "дивидендная политика и выплаты", "нормативка"),
    ("uz", "kuzatuv kengashi vakolatlari", "положение о набсовете"),
    ("ru", "требования к банкам-партнёрам рефинансирования", "программа рефинансирования"),
    ("uz", "biznes reja va strategiya 2026", "стратегия/бизнес-план"),
]


def env(k, d=""):
    for ln in open("/opt/uzmrc/rag-cms/.env"):
        ln = ln.strip()
        if ln.startswith(k + "=") and not ln.startswith("#"):
            return ln.split("=", 1)[1]
    return d


def post(p, d, t=None):
    h = {"Content-Type": "application/json"}
    if t:
        h["Authorization"] = "Bearer " + t
    return urllib.request.urlopen(
        urllib.request.Request(BASE + p, data=json.dumps(d).encode(), headers=h, method="POST"),
        timeout=30).read().decode()


tok = json.loads(post("/api/auth/login",
                      {"email": env("BOOTSTRAP_ADMIN_EMAIL", "admin@uzmrc.io"),
                       "password": env("BOOTSTRAP_ADMIN_PASSWORD")}))["access_token"]
rid = json.load(open("/opt/uzmrc/.ingest_server.json"))["rag_id"]
print("RAG:", rid)

for lang, q, expect in QUERIES:
    try:
        r = json.loads(post(f"/api/rags/{rid}/search",
                            {"query": q, "mode": "hybrid", "top_k": 3}, tok))
        hits = r.get("hits", r if isinstance(r, list) else [])
        print(f"\n[{lang}] {q}  (ожидали: {expect})")
        for h in hits[:3]:
            src = h.get("filename") or h.get("source") or h.get("document") or "?"
            sc = h.get("score", h.get("rerank_score", "?"))
            print(f"   {sc}  {src}")
    except Exception as e:
        print(f"\n[{lang}] {q} → ОШИБКА: {str(e)[:100]}")
