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

/** Persist the bearer token to localStorage and mirror it into a cookie. */
export function saveToken(token: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(TOKEN_KEY, token);
  document.cookie = `${TOKEN_COOKIE}=${token}; path=/; SameSite=Lax`;
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
  document.cookie = `${TOKEN_COOKIE}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

export function isAuthenticated(): boolean {
  return !!getAccessToken();
}
