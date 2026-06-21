// API layer for the UzMRC RAG CMS. Talks directly to our FastAPI backend.
//
// Transport: an axios instance whose baseURL is `${API_BASE}/api`. By default
// API_BASE is empty so requests go to `/api/*` and are proxied to the backend
// by the Next.js rewrite in next.config.ts (BACKEND_URL). Set
// NEXT_PUBLIC_API_BASE to hit the backend directly (e.g. during local dev or
// when not proxying).
//
// Auth: single bearer token (no refresh) read from localStorage. A response
// interceptor turns any 401 (outside the /auth/ paths) into a hard logout +
// redirect to /login.

import axios, { type AxiosProgressEvent } from "axios";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { clearAuth, getAccessToken } from "./auth";
import type {
  AgentEvent,
  AgentRunDetail,
  AgentRunStart,
  AgentRunSummary,
  ChatSessionDetail,
  ChatSessionSummary,
  ChunkFull,
  CompareReport,
  CompareRun,
  FileItem,
  IngestRun,
  Member,
  Preset,
  Rag,
  RagCreate,
  RagStats,
  RegistrationStatus,
  SearchMode,
  SearchResponse,
  TokenResponse,
  User,
  UserRole,
} from "./types";

/** Base origin of the backend, no trailing slash. Empty → same-origin proxy. */
export const API_BASE = (
  process.env.NEXT_PUBLIC_API_BASE ?? ""
).replace(/\/$/, "");

export const api = axios.create({ baseURL: `${API_BASE}/api` });

api.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const status = err.response?.status;
    const url: string = err.config?.url ?? "";
    if (status === 401 && !url.includes("/auth/")) {
      clearAuth();
      if (typeof window !== "undefined") window.location.href = "/login";
    }
    return Promise.reject(err);
  },
);

// ----------------------------------------------------------------------------
// auth
// ----------------------------------------------------------------------------

export const authApi = {
  registrationStatus: () =>
    api.get<RegistrationStatus>("/auth/registration-status").then((r) => r.data),
  register: (email: string, password: string) =>
    api.post<TokenResponse>("/auth/register", { email, password }).then((r) => r.data),
  login: (email: string, password: string) =>
    api.post<TokenResponse>("/auth/login", { email, password }).then((r) => r.data),
  me: () => api.get<User>("/auth/me").then((r) => r.data),

  // admin user management
  listUsers: () => api.get<User[]>("/auth/users").then((r) => r.data),
  createUser: (email: string, password: string, role: UserRole) =>
    api.post<User>("/auth/users", { email, password, role }).then((r) => r.data),
  updateUser: (
    id: string,
    patch: { role?: UserRole; is_active?: boolean; password?: string },
  ) => api.patch<User>(`/auth/users/${id}`, patch).then((r) => r.data),
  deleteUser: (id: string) => api.delete<void>(`/auth/users/${id}`).then((r) => r.data),
};

// ----------------------------------------------------------------------------
// rags
// ----------------------------------------------------------------------------

export const ragsApi = {
  list: () => api.get<Rag[]>("/rags").then((r) => r.data),
  listPresets: () => api.get<Preset[]>("/rags/_presets").then((r) => r.data),
  create: (payload: RagCreate) => api.post<Rag>("/rags", payload).then((r) => r.data),
  get: (id: string) => api.get<Rag>(`/rags/${id}`).then((r) => r.data),
  stats: (id: string) => api.get<RagStats>(`/rags/${id}/stats`).then((r) => r.data),
  remove: (id: string) => api.delete<void>(`/rags/${id}`).then((r) => r.data),
  updateSettings: (id: string, patch: Record<string, unknown>) =>
    api.patch<Rag>(`/rags/${id}/settings`, patch).then((r) => r.data),

  // members
  listMembers: (ragId: string) =>
    api.get<Member[]>(`/rags/${ragId}/members`).then((r) => r.data),
  inviteMember: (ragId: string, email: string) =>
    api.post<Member>(`/rags/${ragId}/members`, { email }).then((r) => r.data),
  revokeMember: (ragId: string, userId: string) =>
    api.delete<void>(`/rags/${ragId}/members/${userId}`).then((r) => r.data),
};

// ----------------------------------------------------------------------------
// files
// ----------------------------------------------------------------------------

export const filesApi = {
  list: (ragId: string) => api.get<FileItem[]>(`/rags/${ragId}/files`).then((r) => r.data),
  remove: (ragId: string, fileId: string) =>
    api.delete<void>(`/rags/${ragId}/files/${fileId}`).then((r) => r.data),

  /** Upload one file (multipart, field name `files`). Reports progress. */
  upload: (
    ragId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<FileItem[]> => {
    const form = new FormData();
    form.append("files", file);
    return api
      .post<FileItem[]>(`/rags/${ragId}/files`, form, {
        onUploadProgress: onProgress
          ? (e: AxiosProgressEvent) => {
              if (e.total) onProgress(e.loaded, e.total);
            }
          : undefined,
      })
      .then((r) => r.data);
  },

  /** Fetch the raw authenticated file blob (PDF/XLSX/…). Caller revokes URL. */
  fetchBlob: async (
    ragId: string,
    fileId: string,
  ): Promise<{ url: string; mime: string; blob: Blob }> => {
    const res = await api.get<Blob>(`/rags/${ragId}/files/${fileId}/blob`, {
      responseType: "blob",
    });
    const blob = res.data;
    return {
      url: URL.createObjectURL(blob),
      mime: blob.type || "application/octet-stream",
      blob,
    };
  },
};

// ----------------------------------------------------------------------------
// ingest / indexing
// ----------------------------------------------------------------------------

export const ingestApi = {
  start: (ragId: string, force = false) =>
    api
      .post<IngestRun>(`/rags/${ragId}/index`, undefined, { params: force ? { force: true } : {} })
      .then((r) => r.data),
  status: (ragId: string) =>
    api.get<IngestRun>(`/rags/${ragId}/index/status`).then((r) => r.data),
  listRuns: (ragId: string) =>
    api.get<IngestRun[]>(`/rags/${ragId}/index/runs`).then((r) => r.data),
  events: (ragId: string, runId: string, since = 0) =>
    api
      .get<AgentEvent[]>(`/rags/${ragId}/index/runs/${runId}/events`, { params: { since } })
      .then((r) => r.data),
};

// ----------------------------------------------------------------------------
// search
// ----------------------------------------------------------------------------

export const searchApi = {
  search: (ragId: string, query: string, mode: SearchMode = "hybrid", top_k = 10) =>
    api
      .post<SearchResponse>(`/rags/${ragId}/search`, { query, mode, top_k })
      .then((r) => r.data),
  getChunk: (ragId: string, chunkId: string) =>
    api.get<ChunkFull>(`/rags/${ragId}/chunks/${chunkId}`).then((r) => r.data),
};

// ----------------------------------------------------------------------------
// agent (chat)
// ----------------------------------------------------------------------------

export const agentApi = {
  startRun: (ragId: string, query: string, session_id?: string, max_steps?: number) =>
    api
      .post<AgentRunStart>(`/rags/${ragId}/agent/runs`, { query, session_id, max_steps })
      .then((r) => r.data),
  listRuns: (ragId: string) =>
    api.get<AgentRunSummary[]>(`/rags/${ragId}/agent/runs`).then((r) => r.data),
  getRun: (ragId: string, runId: string) =>
    api.get<AgentRunDetail>(`/rags/${ragId}/agent/runs/${runId}`).then((r) => r.data),
  getRunEvents: (ragId: string, runId: string, since = 0) =>
    api
      .get<AgentEvent[]>(`/rags/${ragId}/agent/runs/${runId}/events`, { params: { since } })
      .then((r) => r.data),

  // chat sessions
  listSessions: (ragId: string) =>
    api.get<ChatSessionSummary[]>(`/rags/${ragId}/chat_sessions`).then((r) => r.data),
  createSession: (ragId: string, title?: string) =>
    api
      .post<ChatSessionSummary>(`/rags/${ragId}/chat_sessions`, { title })
      .then((r) => r.data),
  getSession: (ragId: string, sessionId: string) =>
    api
      .get<ChatSessionDetail>(`/rags/${ragId}/chat_sessions/${sessionId}`)
      .then((r) => r.data),
  renameSession: (ragId: string, sessionId: string, title: string) =>
    api
      .patch<ChatSessionSummary>(`/rags/${ragId}/chat_sessions/${sessionId}`, { title })
      .then((r) => r.data),
  deleteSession: (ragId: string, sessionId: string) =>
    api.delete<void>(`/rags/${ragId}/chat_sessions/${sessionId}`).then((r) => r.data),
};

// ----------------------------------------------------------------------------
// compare (Module 2)
// ----------------------------------------------------------------------------

export const compareApi = {
  /** Upload a regulation file, start an async compare run (202 → run_id + stream_token). */
  start: (
    ragId: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<CompareRun> => {
    const form = new FormData();
    form.append("file", file);
    return api
      .post<CompareRun>(`/rags/${ragId}/compare`, form, {
        onUploadProgress: onProgress
          ? (e: AxiosProgressEvent) => {
              if (e.total) onProgress(e.loaded, e.total);
            }
          : undefined,
      })
      .then((r) => r.data);
  },
  getRun: (ragId: string, runId: string) =>
    api.get<CompareRun>(`/rags/${ragId}/compare/runs/${runId}`).then((r) => r.data),
};

// ----------------------------------------------------------------------------
// SSE helpers
// ----------------------------------------------------------------------------
//
// All three streams (agent / compare / ingest) speak the same wire format
// produced by the backend `_sse()` helper:
//
//   event: <type>
//   id: <seq>
//   data: {"seq":N,"ts":"…","type":"<type>","payload":{…}}
//
// They terminate with a `stream_end` event. Agent and ingest streams are
// authenticated by a `token` query param (the run's stream_token); compare uses
// the same. We use @microsoft/fetch-event-source so we can attach the bearer
// header too and resume via `since`.

export interface SSEHandlers {
  /** Fired for every event with a recognised `type`. */
  onEvent?: (event: AgentEvent) => void;
  /** Convenience hooks keyed by event type. */
  on?: Record<string, (event: AgentEvent) => void>;
  onError?: (message: string) => void;
  onEnd?: () => void;
}

function buildStreamUrl(
  path: string,
  params: Record<string, string | number | undefined>,
): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v));
  }
  const query = qs.toString();
  return `${API_BASE}/api${path}${query ? `?${query}` : ""}`;
}

/**
 * Subscribe to a backend SSE stream. Returns an AbortController — call
 * `.abort()` to close the connection. `since` resumes after a given seq.
 */
function openStream(
  url: string,
  handlers: SSEHandlers,
): AbortController {
  const ctrl = new AbortController();
  const token = getAccessToken();

  void fetchEventSource(url, {
    signal: ctrl.signal,
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    openWhenHidden: true,
    onmessage(msg) {
      if (!msg.data) return;
      let parsed: AgentEvent;
      try {
        parsed = JSON.parse(msg.data) as AgentEvent;
      } catch {
        return;
      }
      const type = parsed.type ?? msg.event ?? "message";
      if (type === "stream_end") {
        handlers.onEnd?.();
        ctrl.abort();
        return;
      }
      handlers.onEvent?.(parsed);
      handlers.on?.[type]?.(parsed);
    },
    onerror(err) {
      handlers.onError?.(err instanceof Error ? err.message : "SSE connection error");
      // Throw to stop fetch-event-source's automatic retry loop.
      throw err;
    },
  }).catch(() => {
    /* aborted or errored — already surfaced via onerror */
  });

  return ctrl;
}

export const sse = {
  /** Stream an agent run. Requires the run's stream_token. */
  agentRun: (
    ragId: string,
    runId: string,
    token: string,
    handlers: SSEHandlers,
    since = 0,
  ): AbortController =>
    openStream(
      buildStreamUrl(`/rags/${ragId}/agent/runs/${runId}/stream`, { token, since }),
      handlers,
    ),

  /** Stream a compare run. Requires the run's stream_token. */
  compareRun: (
    ragId: string,
    runId: string,
    token: string,
    handlers: SSEHandlers,
    since = 0,
  ): AbortController =>
    openStream(
      buildStreamUrl(`/rags/${ragId}/compare/runs/${runId}/stream`, { token, since }),
      handlers,
    ),

  /** Stream an indexing run. Requires the run's stream_token. */
  ingestRun: (
    ragId: string,
    runId: string,
    token: string,
    handlers: SSEHandlers,
    since = 0,
  ): AbortController =>
    openStream(
      buildStreamUrl(`/rags/${ragId}/index/runs/${runId}/stream`, { token, since }),
      handlers,
    ),
};

// Re-export types so consumers can `import { ... } from "@/lib/api"`.
export type {
  CompareReport,
} from "./types";
