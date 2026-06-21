// Global client state (Zustand). Stage-1 foundation: auth + a light rags cache.
// Chat/agent run state belongs to per-screen state and will be added in Stage 2
// when the chat screen is ported.
//
// Always subscribe with a selector — `useAppStore((s) => s.user)` — to avoid
// re-rendering on unrelated state changes.

import { create } from "zustand";
import { authApi } from "./api";
import { clearAuth, getUser, saveToken, saveUser } from "./auth";
import type { Rag, User } from "./types";

export type Lang = "uz" | "ru" | "en";

function getInitialLang(): Lang {
  if (typeof window === "undefined") return "ru";
  const v = localStorage.getItem("lang");
  return v === "uz" || v === "ru" || v === "en" ? v : "ru";
}

interface AppState {
  // auth
  user: User | null;
  authReady: boolean; // true once we've attempted to hydrate the session

  // rags cache (list screen)
  rags: Rag[];

  // ui
  lang: Lang;

  setUser: (u: User | null) => void;
  setRags: (rags: Rag[]) => void;
  upsertRag: (rag: Rag) => void;
  removeRag: (id: string) => void;
  setLang: (lang: Lang) => void;

  /** Perform login: store token + user, populate state. */
  login: (email: string, password: string) => Promise<User>;
  /** Clear token/user and reset auth state. */
  logout: () => void;
  /** Hydrate session from a persisted token by calling /auth/me. */
  hydrate: () => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  user: null,
  authReady: false,
  rags: [],
  lang: getInitialLang(),

  setUser: (u) => set({ user: u }),
  setRags: (rags) => set({ rags }),
  upsertRag: (rag) =>
    set((s) => {
      const exists = s.rags.some((r) => r.id === rag.id);
      return {
        rags: exists ? s.rags.map((r) => (r.id === rag.id ? rag : r)) : [rag, ...s.rags],
      };
    }),
  removeRag: (id) => set((s) => ({ rags: s.rags.filter((r) => r.id !== id) })),
  setLang: (lang) =>
    set(() => {
      if (typeof window !== "undefined") localStorage.setItem("lang", lang);
      return { lang };
    }),

  login: async (email, password) => {
    const tokens = await authApi.login(email, password);
    saveToken(tokens.access_token);
    saveUser(tokens.user);
    set({ user: tokens.user, authReady: true });
    return tokens.user;
  },

  logout: () => {
    clearAuth();
    set({ user: null, rags: [], authReady: true });
    if (typeof window !== "undefined") window.location.href = "/login";
  },

  hydrate: async () => {
    if (get().authReady) return;
    const cached = getUser();
    if (cached) set({ user: cached });
    try {
      const fresh = await authApi.me();
      saveUser(fresh);
      set({ user: fresh, authReady: true });
    } catch {
      // 401 is handled by the api interceptor (logout + redirect).
      set({ authReady: true });
    }
  },
}));
