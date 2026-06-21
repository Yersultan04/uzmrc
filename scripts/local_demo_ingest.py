"""Локальный демо-ингест для E2E нового фронта.

Создаёт RAG в локальном бэке (:8088), заливает курированный срез корпуса
(нормативка ru/uz + ипотечная грамотность + green bonds) и запускает индексацию.
Креды читаются из rag-cms/.env в процессе — на диск не пишутся.
Запуск: python scripts/local_demo_ingest.py
"""
from __future__ import annotations

import json
import sys
import time
import urllib.request
from pathlib import Path

BASE = "http://localhost:8088"
ROOT = Path(__file__).resolve().parent.parent
CORPUS = ROOT / "corpus" / "all_txt"
ENV = ROOT / "rag-cms" / ".env"

# Курированный набор — гарантирует цитаты в чате по разным пластам.
DOCS = [
    "antokorrup-politika.pdf.txt",
    "divident-politika.pdf.txt",
    "kknizomuz.pdf.txt",
    "kknizomrus.pdf.txt",
    "strategy2025-2030UZ.pdf.txt",
    "report-on-green-bonds-RU.pdf.txt",
    "report-on-green-bonds-UZ.pdf.txt",
    "obligatsiya.dasturi.pdf.txt",
]


def env(key: str, default: str = "") -> str:
    for line in ENV.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if line.startswith(key + "=") and not line.startswith("#"):
            return line.split("=", 1)[1]
    return default


def req(path: str, method: str = "GET", token: str | None = None,
        data: dict | None = None, raw: bytes | None = None,
        headers: dict | None = None) -> tuple[int, str]:
    h = dict(headers or {})
    body: bytes | None = None
    if data is not None:
        h["Content-Type"] = "application/json"
        body = json.dumps(data).encode()
    elif raw is not None:
        body = raw
    if token:
        h["Authorization"] = "Bearer " + token
    r = urllib.request.urlopen(
        urllib.request.Request(BASE + path, data=body, headers=h, method=method),
        timeout=120)
    return r.status, r.read().decode()


def multipart(files: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    boundary = "----uzmrcdemo7068961b"
    parts: list[bytes] = []
    for name, content in files:
        parts.append(("--" + boundary + "\r\n").encode())
        parts.append(
            (f'Content-Disposition: form-data; name="files"; filename="{name}"\r\n'
             "Content-Type: text/plain\r\n\r\n").encode())
        parts.append(content)
        parts.append(b"\r\n")
    parts.append(("--" + boundary + "--\r\n").encode())
    return b"".join(parts), boundary


def main() -> int:
    email = env("BOOTSTRAP_ADMIN_EMAIL", "admin@uzmrc.io")
    password = env("BOOTSTRAP_ADMIN_PASSWORD")
    if not password:
        print("НЕТ пароля админа в .env", file=sys.stderr)
        return 1

    token = json.loads(req("/api/auth/login", "POST",
                           data={"email": email, "password": password})[1])["access_token"]
    print("login OK")

    rag = json.loads(req("/api/rags", "POST", token=token, data={
        "name": "Демо — локальный E2E (полный корпус, срез)",
        "description": "Срез корпуса УзКРИ для живой проверки нового фронта",
        "fts_language": "russian",
    })[1])
    rid = rag["id"]
    print("RAG:", rid)

    # Загрузка файлов одним multipart-запросом.
    payload = []
    for fn in DOCS:
        fp = CORPUS / fn
        if fp.exists():
            payload.append((fn, fp.read_bytes()))
        else:
            print("пропуск (нет файла):", fn)
    body, boundary = multipart(payload)
    st, _ = req(f"/api/rags/{rid}/files", "POST", token=token, raw=body,
                headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    print(f"upload {len(payload)} файлов: HTTP {st}")

    st, _ = req(f"/api/rags/{rid}/index", "POST", token=token, data={})
    print("index start: HTTP", st)

    # Поллинг статуса.
    deadline = time.time() + 900
    while time.time() < deadline:
        s = json.loads(req(f"/api/rags/{rid}/index/status", token=token)[1])
        status = s.get("status") or s.get("rag_status") or s
        print("  status:", json.dumps(status, ensure_ascii=False)[:160])
        if isinstance(status, str) and status in ("ready", "error"):
            break
        if isinstance(s, dict) and s.get("rag_status") in ("ready", "error"):
            break
        time.sleep(15)

    rag_final = json.loads(req(f"/api/rags/{rid}", token=token)[1])
    print("FINAL RAG status:", rag_final.get("status"))
    print("RAG_ID=" + rid)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
