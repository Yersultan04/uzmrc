// Domain types for the UzMRC RAG CMS — mirrored 1:1 from the FastAPI backend
// schemas (backend/app/schemas.py + api/*). Keep field names in sync with the
// backend; do not invent shapes.

// ---------------- enums ----------------

export type UserRole = "user" | "admin";
export type RagStatus = "draft" | "indexing" | "ready" | "failed";
export type FileStatus = "uploaded" | "parsing" | "parsed" | "failed";
export type IngestStatus = "queued" | "running" | "succeeded" | "failed";
export type RagRole = "owner" | "admin" | "member" | "none";
export type MemberStatus = "active" | "revoked";
export type CompareRunStatus = "queued" | "running" | "succeeded" | "failed";
export type AgentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "escalated"
  | "failed";
export type SearchMode = "dense" | "sparse" | "hybrid";

// ---------------- auth ----------------

export interface User {
  id: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  user: User;
}

export interface RegistrationStatus {
  open: boolean;
  reason: string;
}

// ---------------- rags ----------------

export interface Rag {
  id: string;
  name: string;
  description: string | null;
  status: RagStatus;
  qdrant_collection: string | null;
  embed_model: string;
  embed_dim: number;
  owner_id: string;
  settings: Record<string, unknown>;
  role: RagRole | null;
  member_status: MemberStatus | null;
  created_at: string;
  updated_at: string;
}

export interface RagCreate {
  name: string;
  description?: string | null;
  fts_language?: string | null;
  preset?: string | null;
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

// ---------------- members ----------------

export interface Member {
  user_id: string;
  email: string;
  status: MemberStatus;
  created_at: string;
  revoked_at: string | null;
  is_owner: boolean;
}

// ---------------- files ----------------

export interface FileItem {
  id: string;
  rag_id: string;
  filename: string;
  mime_type: string | null;
  size_bytes: number;
  pages: number | null;
  status: FileStatus;
  doc_type: string | null;
  error: string | null;
  created_at: string;
}

// Document type taxonomy (key → Russian label). Mirrors backend
// app/ingestion/classify.py DOC_TYPES.
export const DOC_TYPES: Record<string, string> = {
  normative: "Нормативные документы",
  report: "Отчёты",
  analytics: "Аналитика рынка",
  press: "Новости и пресс-релизы",
  issuance: "Эмиссия и инвесторам",
  certificate: "Сертификаты",
  business_plan: "Бизнес-планы",
  about: "О компании",
  other: "Прочее",
};

// ---------------- ingest ----------------

export interface IngestRun {
  id: string;
  rag_id: string;
  status: IngestStatus;
  files_total: number;
  files_done: number;
  chunks_total: number;
  error: string | null;
  stream_token: string | null;
  current_file_id: string | null;
  current_stage: string | null;
  current_progress: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

// ---------------- search ----------------

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

// ---------------- agent (chat) ----------------

export interface AgentCitation {
  chunk_id: string;
  file_id: string;
  filename: string;
  page_start: number | null;
  page_end: number | null;
  quote: string;
}

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

export interface AgentRunDetail extends AgentRunSummary {
  rag_id: string;
  citations: AgentCitation[];
  telemetry: Record<string, unknown>;
  error: string | null;
  started_at: string | null;
}

/** Response of POST /rags/{id}/agent/runs (202). */
export interface AgentRunStart {
  id: string;
  session_id: string;
  status: string;
  max_steps: number;
  stream_token: string;
}

/** Generic SSE event shape used by agent / compare / ingest streams. */
export interface AgentEvent {
  seq: number;
  ts: string;
  type: string;
  payload: Record<string, unknown>;
}

// ---------------- chat sessions ----------------

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

// ---------------- compare (Module 2) ----------------

export type ClauseRelation = "duplicate" | "conflict" | "addition" | "gap";

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
