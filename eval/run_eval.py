#!/usr/bin/env python3
"""UzMRC eval harness — measurable quality for both MVP modules.

Module 1 (retrieval): recall@1/3/5 and MRR over a labelled query→doc gold set.
Module 2 (compare):   per-clause relation accuracy + confusion matrix over the
                      demo draft order (gold relations known by construction).

Stdlib only — runs on the host against the live API. Usage:

    python run_eval.py                      # both suites, compare averaged over 3 runs
    python run_eval.py --runs 5             # more compare runs (model is stochastic)
    python run_eval.py --only retrieval

Config via env (sensible defaults for the local stack):
    UZMRC_API   (http://127.0.0.1:8088)
    UZMRC_RAG_ID(4065a368-96b3-4225-b599-33c41af96a3a)
    UZMRC_EMAIL (admin@uzmrc.io)   UZMRC_PASS (UzmrcAdmin2026!)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from collections import Counter
from pathlib import Path

API = os.environ.get("UZMRC_API", "http://127.0.0.1:8088").rstrip("/")
RAG_ID = os.environ.get("UZMRC_RAG_ID", "4065a368-96b3-4225-b599-33c41af96a3a")
EMAIL = os.environ.get("UZMRC_EMAIL", "admin@uzmrc.io")
PASSWORD = os.environ.get("UZMRC_PASS", "UzmrcAdmin2026!")
HERE = Path(__file__).resolve().parent
DRAFT = HERE.parent / "corpus" / "demo" / "proekt-prikaza-2026.txt"
RELATIONS = ("duplicate", "conflict", "addition", "gap")


def _req(method: str, path: str, *, token: str | None = None, json_body=None,
         multipart: tuple[str, bytes] | None = None, timeout: int = 320):
    url = f"{API}{path}"
    headers = {}
    data = None
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if json_body is not None:
        data = json.dumps(json_body).encode()
        headers["Content-Type"] = "application/json"
    elif multipart is not None:
        filename, content = multipart
        boundary = f"----uzmrc{uuid.uuid4().hex}"
        body = b"".join([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'.encode(),
            b"Content-Type: text/plain\r\n\r\n",
            content, b"\r\n", f"--{boundary}--\r\n".encode(),
        ])
        data = body
        headers["Content-Type"] = f"multipart/form-data; boundary={boundary}"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path} → {e.code}: {e.read().decode()[:200]}") from None


def _req_retry(*args, tries: int = 4, backoff: float = 4.0, **kwargs):
    """Retry transient failures (e.g. the embedder's free-tier RPM → HTTP 500)."""
    last = None
    for i in range(tries):
        try:
            return _req(*args, **kwargs)
        except RuntimeError as e:
            last = e
            time.sleep(backoff * (i + 1))
    raise last


def login() -> str:
    return _req("POST", "/api/auth/login",
                json_body={"email": EMAIL, "password": PASSWORD})["access_token"]


def _norm(name: str) -> str:
    """Strip index suffixes so 'qoidabuzarliklarhaqida.pdf.txt' == gold base name."""
    for suf in (".pdf.txt", ".txt", ".pdf"):
        if name.endswith(suf):
            name = name[: -len(suf)]
    return name.strip().lower()


def _hit_names(hit: dict) -> str:
    for k in ("file_name", "filename", "source", "file"):
        v = hit.get(k)
        if v:
            return _norm(str(v))
    return ""


def eval_retrieval(token: str, delay: float = 4.0) -> None:
    gold = [json.loads(l) for l in (HERE / "retrieval_gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip()]
    r1 = r3 = r5 = 0
    rr_sum = 0.0
    print(f"\n{'='*70}\nMODULE 1 — RETRIEVAL  ({len(gold)} queries, hybrid, top_k=5)\n{'='*70}")
    for i, g in enumerate(gold):
        if i:
            time.sleep(delay)  # respect the embedder's free-tier query RPM
        relevant = {_norm(x) for x in g["relevant"]}
        res = _req_retry("POST", f"/api/rags/{RAG_ID}/search", token=token,
                         json_body={"query": g["query"], "mode": "hybrid", "top_k": 5})
        hits = res if isinstance(res, list) else res.get("results", res.get("hits", []))
        names = [_hit_names(h) for h in hits]
        rank = next((i + 1 for i, n in enumerate(names) if n in relevant), 0)
        r1 += rank == 1
        r3 += 1 <= rank <= 3
        r5 += 1 <= rank <= 5
        rr_sum += (1.0 / rank) if rank else 0.0
        status = f"@{rank}" if rank else "MISS"
        print(f"  [{status:>4}] ({g['lang']}) {g['query'][:52]:52}  → {names[0] if names else '—'}")
    n = len(gold)
    print(f"\n  recall@1={r1/n:.2%}  recall@3={r3/n:.2%}  recall@5={r5/n:.2%}  MRR={rr_sum/n:.3f}")


def eval_compare(token: str, runs: int) -> None:
    gold = {g["clause_index"]: g for g in
            (json.loads(l) for l in (HERE / "compare_gold.jsonl").read_text(encoding="utf-8").splitlines() if l.strip())}
    content = DRAFT.read_bytes()
    print(f"\n{'='*70}\nMODULE 2 — COMPARE  ({len(gold)} clauses × {runs} runs)\n{'='*70}")
    per_run_acc = []
    confusion: Counter = Counter()          # (gold_primary, predicted)
    errors = 0
    for run in range(1, runs + 1):
        rep = _req_retry("POST", f"/api/rags/{RAG_ID}/compare", token=token,
                         multipart=(DRAFT.name, content))
        findings = {f.get("clause_index"): f for f in rep.get("findings", [])}
        correct = 0
        for idx, g in gold.items():
            f = findings.get(idx)
            pred = (f or {}).get("relation", "missing")
            if "ошибка LLM" in ((f or {}).get("rationale") or ""):
                errors += 1
            confusion[(g["primary"], pred)] += 1
            if pred in g["acceptable"]:
                correct += 1
        acc = correct / len(gold)
        per_run_acc.append(acc)
        print(f"  run {run}: accuracy {acc:.0%} ({correct}/{len(gold)})")
    mean = sum(per_run_acc) / len(per_run_acc)
    spread = f"{min(per_run_acc):.0%}–{max(per_run_acc):.0%}"
    print(f"\n  mean accuracy={mean:.1%}  (range {spread})  | LLM-error cells={errors}")
    print("\n  Confusion (gold primary → predicted, summed over runs):")
    golds = sorted({k[0] for k in confusion})
    preds = sorted({k[1] for k in confusion})
    head = "    gold\\pred  " + "  ".join(f"{p[:8]:>8}" for p in preds)
    print(head)
    for gp in golds:
        row = "  ".join(f"{confusion.get((gp, p), 0):>8}" for p in preds)
        print(f"    {gp:>10}  {row}")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=3, help="compare runs (model is stochastic)")
    ap.add_argument("--delay", type=float, default=4.0, help="sec between retrieval queries (embedder RPM)")
    ap.add_argument("--only", choices=["retrieval", "compare"], default=None)
    args = ap.parse_args()
    try:
        token = login()
    except Exception as e:
        print(f"login failed: {e}", file=sys.stderr)
        return 1
    if args.only != "compare":
        eval_retrieval(token, delay=args.delay)
    if args.only != "retrieval":
        eval_compare(token, args.runs)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
