"""Minimal in-memory IP rate limiter — brute-force guard for auth endpoints.

Dependency-free sliding window keyed by client IP. Sufficient for a single-worker
demo behind nginx/Cloudflare; for multi-worker prod, swap in Redis-backed limiting.
"""
from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request


class _SlidingWindow:
    def __init__(self, max_hits: int, window_s: float) -> None:
        self.max_hits = max_hits
        self.window_s = window_s
        self._hits: dict[str, list[float]] = defaultdict(list)

    def check(self, key: str, now: float) -> None:
        bucket = self._hits[key]
        cutoff = now - self.window_s
        # Drop timestamps outside the window, then evaluate.
        bucket[:] = [t for t in bucket if t > cutoff]
        if len(bucket) >= self.max_hits:
            retry = int(bucket[0] + self.window_s - now) + 1
            raise HTTPException(
                status_code=429,
                detail="Слишком много попыток входа. Повторите позже.",
                headers={"Retry-After": str(max(retry, 1))},
            )
        bucket.append(now)


# 10 login attempts per IP per minute — generous for humans, hostile to brute force.
_login_limiter = _SlidingWindow(max_hits=10, window_s=60.0)


def _client_ip(request: Request) -> str:
    # Behind nginx/Cloudflare the real IP is in X-Forwarded-For (left-most entry).
    xff = request.headers.get("x-forwarded-for")
    if xff:
        return xff.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def login_rate_limit(request: Request) -> None:
    """FastAPI dependency: throttle login attempts per client IP."""
    _login_limiter.check(_client_ip(request), time.monotonic())
