import { authHeaders, clearSession, type AuthUser } from './auth';

export type RagStatus = 'draft' | 'indexing' | 'ready' | 'failed';
export type FileStatus = 'uploaded' | 'parsing' | 'parsed' | 'failed';
export type IngestStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type RagRole = 'owner' | 'admin' | 'member' | 'none';
export type MemberStatus = 'active' | 'revoked';

export interface Rag {
  id: string;
  name: string;
  description: string | null;
  status: RagStatus;
  qdrant_collection: string;
  embed_model: string;
  embed_dim: number;
  owner_id: string;
  settings?: Record<string, unknown>;
  role?: RagRole;
  member_status?: MemberStatus | null;
  created_at: string;
  updated_at: string;
}

export interface Member {
  user_id: string;
  email: string;
  status: MemberStatus;
  created_at: string;
  revoked_at: string | null;
  is_owner: boolean;
}

export interface Preset {
  id: string;
  label: string;
  description: string;
  llm_model: string;
  llm_rerank_model: string;
  llm_vision_model: string;
  embed_model: string;
  embed_dim: number;
}

export interface FileItem {
  id: string;
  rag_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  pages: number | null;
  status: FileStatus;
  error: string | null;
  created_at: string;
}

export interface IngestRun {
  id: string;
  rag_id: string;
  status: IngestStatus;
  files_total: number;
  files_done: number;
  chunks_total: number;
  error: string | null;
  stream_token?: string | null;
  current_file_id?: string | null;
  current_stage?: string | null;
  current_progress?: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface SearchHit {
  chunk_id: string;
  file_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  heading: string | null;
  text: string;
  score: number;
  dense_score: number | null;
  sparse_score: number | null;
}

export interface SearchResponse {
  query: string;
  mode: string;
  hits: SearchHit[];
}

export interface ChunkFull {
  chunk_id: string;
  file_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  heading: string | null;
  text: string;
  token_count: number;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: AuthUser;
}

// --- Module 2: document comparison ---
export type CompareRunStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface CompareRun {
  id: string;
  rag_id: string;
  status: CompareRunStatus;
  filename: string | null;
  stream_token: string | null;
  report: CompareReport | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
}

export type ClauseRelation = 'duplicate' | 'conflict' | 'addition' | 'gap';

export interface MatchedNorm {
  chunk_id: string;
  file_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  quote: string;
  score: number;
  grounded: boolean;
}

export interface ClauseFinding {
  clause_index: number;
  clause_label: string | null;
  clause_text: string;
  page_start: number | null;
  page_end: number | null;
  relation: ClauseRelation;
  rationale: string;
  recommendation: string;
  confidence: number;
  matched_norm: MatchedNorm | null;
}

export interface CompareSummary {
  total_clauses: number;
  duplicate: number;
  conflict: number;
  addition: number;
  gap: number;
}

export interface CompareReport {
  rag_id: string;
  filename: string;
  summary: CompareSummary;
  findings: ClauseFinding[];
  truncated: boolean;
  note: string | null;
}

function notifyError(message: string) {
  try { window.__ragcmsToast?.error(message); } catch { /* ignore */ }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { ...authHeaders() };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    const msg = `Сеть недоступна: ${(e as Error).message}`;
    notifyError(msg);
    throw new Error(msg);
  }
  if (res.status === 401 && !path.startsWith('/auth/')) {
    clearSession();
    notifyError('Сессия истекла. Войдите снова.');
    window.location.assign('/login');
    throw new Error('401: session expired');
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  registrationStatus: () => request<{ open: boolean; reason: string }>('GET', '/auth/registration-status'),
  register: (email: string, password: string) =>
    request<TokenResponse>('POST', '/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<TokenResponse>('POST', '/auth/login', { email, password }),
  me: () => request<AuthUser>('GET', '/auth/me'),

  listUsers: () => request<AuthUser[]>('GET', '/auth/users'),
  createUser: (email: string, password: string, role: 'user' | 'admin') =>
    request<AuthUser>('POST', '/auth/users', { email, password, role }),
  updateUser: (
    id: string,
    patch: { role?: 'user' | 'admin'; is_active?: boolean; password?: string },
  ) => request<AuthUser>('PATCH', `/auth/users/${id}`, patch),
  deleteUser: (id: string) => request<void>('DELETE', `/auth/users/${id}`),

  listRags: () => request<Rag[]>('GET', '/rags'),
  listPresets: () => request<Preset[]>('GET', '/rags/_presets'),
  createRag: (
    name: string,
    description?: string,
    fts_language?: string,
    preset?: string,
  ) =>
    request<Rag>('POST', '/rags', { name, description, fts_language, preset }),
  getRag: (id: string) => request<Rag>('GET', `/rags/${id}`),
  getRagStats: (id: string) => request<RagStats>('GET', `/rags/${id}/stats`),
  deleteRag: (id: string) => request<void>('DELETE', `/rags/${id}`),
  updateRagSettings: (id: string, patch: Record<string, unknown>) =>
    request<Rag>('PATCH', `/rags/${id}/settings`, patch),

  listMembers: (rag_id: string) => request<Member[]>('GET', `/rags/${rag_id}/members`),
  inviteMember: (rag_id: string, email: string) =>
    request<Member>('POST', `/rags/${rag_id}/members`, { email }),
  revokeMember: (rag_id: string, user_id: string) =>
    request<void>('DELETE', `/rags/${rag_id}/members/${user_id}`),

  listFiles: (rag_id: string) => request<FileItem[]>('GET', `/rags/${rag_id}/files`),
  deleteFile: (rag_id: string, file_id: string) =>
    request<void>('DELETE', `/rags/${rag_id}/files/${file_id}`),

  /** Fetch the raw file blob (PDF/XLSX/etc) authenticated, return its mime + a blob URL.
   *  Caller is responsible for URL.revokeObjectURL when done. */
  fetchFileBlob: async (
    rag_id: string,
    file_id: string,
  ): Promise<{ url: string; mime: string }> => {
    const res = await fetch(`/api/rags/${rag_id}/files/${file_id}/blob`, {
      headers: authHeaders(),
    });
    if (res.status === 401) {
      clearSession();
      window.location.assign('/login');
      throw new Error('401: session expired');
    }
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    const blob = await res.blob();
    return { url: URL.createObjectURL(blob), mime: blob.type || 'application/octet-stream' };
  },

  uploadOneFile: (
    rag_id: string,
    file: File,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<FileItem[]> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/rags/${rag_id}/files`);
      const headers = authHeaders();
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          clearSession();
          window.location.assign('/login');
          reject(new Error('401: session expired'));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText));
          } catch (e) {
            reject(e as Error);
          }
        } else {
          reject(new Error(`${xhr.status}: ${xhr.responseText || xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Aborted'));
      const fd = new FormData();
      fd.append('files', file);
      xhr.send(fd);
    }),

  /** Module 2 — upload a regulation file and start an async compare run.
   *  Returns immediately with run_id + stream_token (202). */
  startCompare: (
    rag_id: string,
    file: File,
    onUploadProgress?: (loaded: number, total: number) => void,
  ): Promise<CompareRun> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `/api/rags/${rag_id}/compare`);
      const headers = authHeaders();
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onUploadProgress) onUploadProgress(e.loaded, e.total);
      };
      xhr.onload = () => {
        if (xhr.status === 401) {
          clearSession();
          window.location.assign('/login');
          reject(new Error('401: session expired'));
          return;
        }
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            resolve(JSON.parse(xhr.responseText) as CompareRun);
          } catch (e) {
            reject(e as Error);
          }
        } else {
          reject(new Error(`${xhr.status}: ${xhr.responseText || xhr.statusText}`));
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Aborted'));
      const fd = new FormData();
      fd.append('file', file);
      xhr.send(fd);
    }),

  /** Module 2 — subscribe to SSE events for a running compare.
   *  Calls onProgress({done,total}) for each progress tick,
   *  onReport(report) when the final report arrives, onError on failure.
   *  Returns a cleanup function that closes the EventSource. */
  streamCompare: (
    rag_id: string,
    run_id: string,
    token: string,
    handlers: {
      onProgress?: (done: number, total: number) => void;
      onReport?: (report: CompareReport) => void;
      onError?: (message: string) => void;
    },
    since = 0,
  ): (() => void) => {
    const url = `/api/rags/${rag_id}/compare/runs/${run_id}/stream?token=${encodeURIComponent(token)}&since=${since}`;
    const es = new EventSource(url);

    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data).payload as { done: number; total: number };
        handlers.onProgress?.(payload.done, payload.total);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('report', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data).payload as CompareReport;
        handlers.onReport?.(payload);
      } catch { /* ignore parse errors */ }
    });

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const payload = JSON.parse(e.data).payload as { message: string };
        handlers.onError?.(payload.message ?? 'comparison failed');
      } catch {
        handlers.onError?.('comparison failed');
      }
    });

    es.addEventListener('stream_end', () => {
      es.close();
    });

    es.onerror = () => {
      es.close();
      handlers.onError?.('SSE connection lost');
    };

    return () => es.close();
  },

  startIngest: (rag_id: string, force = false) =>
    request<IngestRun>('POST', `/rags/${rag_id}/index${force ? '?force=true' : ''}`),
  getIngestStatus: (rag_id: string) =>
    request<IngestRun>('GET', `/rags/${rag_id}/index/status`),
  getIngestEvents: (rag_id: string, run_id: string, since = 0) =>
    request<AgentEvent[]>(
      'GET',
      `/rags/${rag_id}/index/runs/${run_id}/events?since=${since}`,
    ),

  search: (rag_id: string, query: string, mode = 'hybrid', top_k = 10) =>
    request<SearchResponse>('POST', `/rags/${rag_id}/search`, { query, mode, top_k }),
  getChunk: (rag_id: string, chunk_id: string) =>
    request<ChunkFull>('GET', `/rags/${rag_id}/chunks/${chunk_id}`),

  startAgentRun: (rag_id: string, query: string, session_id?: string, max_steps?: number) =>
    request<{
      id: string;
      session_id: string;
      status: string;
      max_steps: number;
      stream_token: string;
    }>('POST', `/rags/${rag_id}/agent/runs`, { query, session_id, max_steps }),
  listAgentRuns: (rag_id: string) =>
    request<AgentRunSummary[]>('GET', `/rags/${rag_id}/agent/runs`),
  getAgentRun: (rag_id: string, run_id: string) =>
    request<AgentRunDetail>('GET', `/rags/${rag_id}/agent/runs/${run_id}`),
  getAgentRunEvents: (rag_id: string, run_id: string, since = 0) =>
    request<AgentEvent[]>('GET', `/rags/${rag_id}/agent/runs/${run_id}/events?since=${since}`),

  listChatSessions: (rag_id: string) =>
    request<ChatSessionSummary[]>('GET', `/rags/${rag_id}/chat_sessions`),
  createChatSession: (rag_id: string, title?: string) =>
    request<ChatSessionSummary>('POST', `/rags/${rag_id}/chat_sessions`, { title }),
  getChatSession: (rag_id: string, session_id: string) =>
    request<ChatSessionDetail>('GET', `/rags/${rag_id}/chat_sessions/${session_id}`),
  renameChatSession: (rag_id: string, session_id: string, title: string) =>
    request<ChatSessionSummary>('PATCH', `/rags/${rag_id}/chat_sessions/${session_id}`, { title }),
  deleteChatSession: (rag_id: string, session_id: string) =>
    request<void>('DELETE', `/rags/${rag_id}/chat_sessions/${session_id}`),
};

export interface ChatSessionSummary {
  id: string;
  title: string;
  created_at: string | null;
  last_run_at: string | null;
}

export interface ChatSessionRun extends AgentRunSummary {
  citations: AgentCitation[];
}

export interface ChatSessionDetail extends ChatSessionSummary {
  runs: ChatSessionRun[];
}

export type AgentRunStatus = 'queued' | 'running' | 'succeeded' | 'escalated' | 'failed';

export interface AgentRunSummary {
  id: string;
  status: AgentRunStatus;
  query: string;
  answer: string | null;
  confidence: number | null;
  steps_used: number;
  max_steps: number;
  stream_token: string;
  created_at: string | null;
  finished_at: string | null;
}

export interface AgentCitation {
  chunk_id: string;
  file_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  quote: string;
}

export interface AgentRunDetail extends AgentRunSummary {
  rag_id: string;
  citations: AgentCitation[];
  telemetry: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
}

export interface AgentEvent {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
}

// --- О системе / База знаний ---
export interface RagStats {
  rag_id: string;
  rag_name: string;
  status: RagStatus;
  embed_model: string;
  embed_dim: number;
  documents: number;
  chunks: number;
  pages_total: number;
  avg_chunks_per_doc: number;
  total_tokens: number;
  by_file_status: Record<string, number>;
}
