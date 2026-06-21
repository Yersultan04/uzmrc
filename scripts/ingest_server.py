"""Серверный ингест полного корпуса (txt) в НОВЫЙ RAG — не трогает существующий.
Запуск на сервере: python3 /opt/uzmrc/ingest_server.py
Источники на сервере: /opt/uzmrc/corpus/all_txt/*.txt (PDF-тексты) + /opt/uzmrc/corpus/html/*.txt
"""
import json, os, glob, time, urllib.request

ROOT = "/opt/uzmrc"
BASE = "http://localhost:8088"
STATE = os.path.join(ROOT, ".ingest_server.json")


def env(key, default=""):
    for ln in open(os.path.join(ROOT, "rag-cms", ".env")):
        ln = ln.strip()
        if ln.startswith(key + "=") and not ln.startswith("#"):
            return ln.split("=", 1)[1]
    return default


def req(path, method="GET", tok=None, data=None, files=None):
    url = BASE + path
    headers = {}
    if tok:
        headers["Authorization"] = "Bearer " + tok
    if files is not None:
        import uuid
        boundary = "----b" + uuid.uuid4().hex
        body = b""
        for name, (fn, content) in files:
            body += f"--{boundary}\r\n".encode()
            body += f'Content-Disposition: form-data; name="{name}"; filename="{fn}"\r\n'.encode()
            body += b"Content-Type: text/plain\r\n\r\n" + content + b"\r\n"
        body += f"--{boundary}--\r\n".encode()
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
        r = urllib.request.Request(url, data=body, headers=headers, method="POST")
    else:
        if data is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(data).encode()
        r = urllib.request.Request(url, data=data, headers=headers, method=method)
    return urllib.request.urlopen(r, timeout=300).read().decode()


em, pw = env("BOOTSTRAP_ADMIN_EMAIL", "admin@uzmrc.io"), env("BOOTSTRAP_ADMIN_PASSWORD")
tok = json.loads(req("/api/auth/login", method="POST", data={"email": em, "password": pw}))["access_token"]
print("login OK", flush=True)

# список файлов: txt с текстом (по manifest) + html
man = json.load(open(os.path.join(ROOT, "corpus", "manifest.json")))
good = {r["file"] + ".txt" for r in man if r.get("file") and "error" not in r and r.get("chars", 0) >= 100}
txts = [p for p in sorted(glob.glob(os.path.join(ROOT, "corpus", "all_txt", "*.txt")))
        if os.path.basename(p) in good]
htmls = sorted(glob.glob(os.path.join(ROOT, "corpus", "html", "*.txt")))
allf = txts + htmls
print(f"к ингесту: {len(txts)} PDF-txt + {len(htmls)} HTML = {len(allf)}", flush=True)

rid = json.load(open(STATE))["rag_id"] if os.path.exists(STATE) else None
if not rid:
    rid = json.loads(req("/api/rags", method="POST", tok=tok, data={
        "name": "UzMRC — полный корпус сайта",
        "description": "Все документы uzmrc.uz: нормативка, отчёты, аналитика рынка, "
                       "ипотечная грамотность, экспертные статьи, новости (PDF+HTML, 504 док)",
        "fts_language": "russian",
    }))["id"]
    json.dump({"rag_id": rid}, open(STATE, "w"))
print("RAG:", rid, flush=True)

have = {f["filename"] for f in json.loads(req(f"/api/rags/{rid}/files", tok=tok))}
todo = [p for p in allf if os.path.basename(p) not in have]
print(f"уже залито {len(have)} | к заливке {len(todo)}", flush=True)

B = 6
for i in range(0, len(todo), B):
    batch = todo[i:i + B]
    files = [("files", (os.path.basename(p), open(p, "rb").read())) for p in batch]
    try:
        req(f"/api/rags/{rid}/files", tok=tok, files=files)
        print(f"  батч {i//B+1}/{(len(todo)+B-1)//B} +{len(batch)}", flush=True)
    except Exception as e:
        print(f"  ОШИБКА батч {i//B+1}: {str(e)[:100]}", flush=True)

total = len(json.loads(req(f"/api/rags/{rid}/files", tok=tok)))
print("итого файлов:", total, flush=True)
print("index:", req(f"/api/rags/{rid}/index", method="POST", tok=tok)[:60], flush=True)

t0 = time.time()
while time.time() - t0 < 10800:
    time.sleep(20)
    try:
        st = json.loads(req(f"/api/rags/{rid}/index/status", tok=tok)).get("status")
        rs = json.loads(req(f"/api/rags/{rid}", tok=tok)).get("status")
        print(f"  [{int(time.time()-t0)}s] ingest={st} rag={rs}", flush=True)
        if rs in ("ready", "failed") and st in ("succeeded", "failed"):
            break
    except Exception as e:
        print("  poll:", str(e)[:80], flush=True)
print("DONE", rid, flush=True)
