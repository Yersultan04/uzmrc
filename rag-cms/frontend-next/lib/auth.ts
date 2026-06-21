// Auth helpers — token + current user persistence in localStorage, plus a
// mirror of the token into a non-httpOnly cookie so middleware.ts can do a
// best-effort server-side redirect guard.
//
// Our FastAPI backend issues a single bearer token (no refresh token), so there
// is only `access_token` here — unlike the banking base this was forked from.

import type { User } from "./types";

export type { User } from "./types";

export const TOKEN_KEY = "access_token";
export const USER_KEY = "current_user";
export const TOKEN_COOKIE = "access_token";

/**
 * Persist the bearer token to localStorage and mirror it into a cookie.
 *
 * Security note: the cookie is a *navigation-guard mirror only* — middleware.ts
 * reads it to decide redirects. The actual Authorization header is always built
 * from the localStorage copy (see lib/api.ts), so the cookie is never required
 * to be JS-readable for requests to work. We therefore harden it as much as a
 * client-set cookie allows:
 *   - SameSite=Strict — the token cookie is never sent on cross-site navigations,
 *     killing CSRF / cross-site leakage of the mirror.
 *   - Secure — only sent over HTTPS (skipped on localhost so http dev still works).
 * httpOnly is intentionally NOT set here: a client-set cookie cannot be httpOnly,
 * and our axios interceptor reads the token from localStorage, not the cookie.
 * Moving to a backend-set httpOnly cookie is the proper hardening (see auth
 * trade-off note) but requires a backend change and is out of scope for the FE.
 */
export function saveToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=${encodeURIComponent(
    token,
  )}; path=/; SameSite=Strict${secure}`;
}

export function getAccessToken(): string | null {
  return typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
}

export function saveUser(user: User): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function getUser(): User | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as User) : null;
  } catch {
    return null;
  }
}

export function clearAuth(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  // Match the path/SameSite of saveToken so the deletion reliably overwrites it.
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${TOKEN_COOKIE}=; path=/; SameSite=Strict${secure}; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
