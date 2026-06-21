"""Ингест полного корпуса сайта (PDF-с-текстом + HTML) в новый RAG.

Источники:
- corpus/all/*.pdf — все PDF с реальным текстом (исключая 20 сканов по manifest.json)
- corpus/html/*.txt — текст HTML-страниц

Идемпотентно: стейт в .ingest_full.json, не перезаливает уже загруженное.
Запуск: python scripts/ingest_full_corpus.py
"""
import os, sys, time, json, glob
import requests

BASE = "http://localhost:8088/api"
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STATE = os.path.join(HERE, ".ingest_full.json")


def env(key, default=""):
    path = os.path.join(HERE, "rag-cms", ".env")
    if os.path.exists(path):
        for ln in open(path, encoding="utf-8"):
            if ln.strip().startswith(key + "="):
                return ln.split("=", 1)[1].strip()
    return default


PW = env("BOOTSTRAP_ADMIN_PASSWORD", "UzmrcAdmin2026!")
EMAIL = env("BOOTSTRAP_ADMIN_EMAIL", "admin@uzmrc.io")

tok = requests.post(f"{BASE}/auth/login", json={"email": EMAIL, "password": PW}).json()["access_token"]
H = {"Authorization": f"Bearer {tok}"}
print("logged in as", EMAIL, flush=True)

# --- собрать список файлов ---
# PDF с текстом (исключить сканы chars<100 и ошибки)
man = json.load(open(os.path.join(HERE, "corpus", "manifest.json"), encoding="utf-8"))
good_pdf = {r["file"] for r in man if r.get("file") and "error" not in r and r.get("chars", 0) >= 100}
pdfs = [p for p in sorted(glob.glob(os.path.join(HERE, "corpus", "all", "*.pdf")))
        if os.path.basename(p) in good_pdf]
htmls = sorted(glob.glob(os.path.join(HERE, "corpus", "html", "*.txt")))
all_files = [(p, "application/pdf") for p in pdfs] + [(p, "text/plain") for p in htmls]
print(f"к ингесту: {len(pdfs)} PDF + {len(htmls)} HTML = {len(all_files)}", flush=True)

# --- RAG (создать или переиспользовать) ---
rag_id = json.load(open(STATE)).get("rag_id") if os.path.exists(STATE) else None
if not rag_id:
    r = requests.post(f"{BASE}/rags", headers=H, json={
        "name": "UzMRC — полный корпус сайта",
        "description": "Все документы uzmrc.uz: нормативка, отчёты, аналитика рынка, "
                       "ипотечная грамотность, экспертные статьи, новости (PDF + HTML)",
        "fts_language": "russian",
    })
    r.raise_for_status()
    rag_id = r.json()["id"]
    json.dump({"rag_id": rag_id}, open(STATE, "w"))
print("RAG:", rag_id, flush=True)

# --- что уже залито ---
have = {f["filename"] for f in requests.get(f"{BASE}/rags/{rag_id}/files", headers=H).json()}
todo = [(p, ct) for p, ct in all_files if os.path.basename(p) not in have]
print(f"уже залито: {len(have)} | к заливке: {len(todo)}", flush=True)

# --- заливка батчами по 6 ---
B = 6
for i in range(0, len(todo), B):
    batch = todo[i:i + B]
    files = [("files", (os.path.basename(p), open(p, "rb"), ct)) for p, ct in batch]
    try:
        r = requests.post(f"{BASE}/rags/{rag_id}/files", headers=H, files=files, timeout=180)
        r.raise_for_status()
        print(f"  батч {i//B+1}/{(len(todo)+B-1)//B}: +{len(batch)} ({r.status_code})", flush=True)
    except Exception as e:
        print(f"  ОШИБКА батча {i//B+1}: {str(e)[:120]}", flush=True)
    finally:
        for _, (_, fh, _) in files:
            fh.close()

total = len(requests.get(f"{BASE}/rags/{rag_id}/files", headers=H).json())
print("итого файлов в RAG:", total, flush=True)

# --- индексация ---
ir = requests.post(f"{BASE}/rags/{rag_id}/index", headers=H, timeout=30)
print("index start:", ir.status_code, flush=True)

# --- опрос статуса (до 3 часов) ---
t0 = time.time()
while time.time() - t0 < 10800:
    time.sleep(20)
    try:
        st = requests.get(f"{BASE}/rags/{rag_id}/index/status", headers=H).json()
        rag = requests.get(f"{BASE}/rags/{rag_id}", headers=H).json()
        print(f"  [{int(time.time()-t0)}s] ingest={st.get('status')} rag={rag.get('status')}", flush=True)
        if rag.get("status") in ("ready", "failed") and st.get("status") in ("succeeded", "failed"):
            break
    except Exception as e:
        print(f"  опрос: {str(e)[:80]}", flush=True)

print("DONE. rag_id:", rag_id, flush=True)
