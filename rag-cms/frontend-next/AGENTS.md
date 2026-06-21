<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

---

# Frontend Architecture Guide

**Stack:** Next.js 16.2 · React 19.2 · Zustand 5 · Axios · Tailwind v4 · shadcn/ui

**Ports:** dev `3001` (via `next dev`) · Docker `3300`

---

## Project Layout

```
frontend/
├── app/                   # Next.js App Router (all pages)
│   ├── api/               # Edge API routes (SSE proxy to backend)
│   ├── login/
│   ├── home/
│   ├── chat/
│   │   └── [threadId]/
│   └── admin/
│       ├── users/
│       ├── agents/[agentId]/documents/
│       ├── approvals/
│       ├── confluence-sync/
│       └── eval/
├── components/
│   ├── chat/              # ChatWindow, MessageBubble, ThreadSidebar, ToolCallCard,
│   │                      # HumanApprovalModal, SourceCitations, DocPreviewModal,
│   │                      # InstrumentsPanel
│   ├── admin/             # UserTable, McpServerCard
│   ├── ui/                # shadcn primitives (Button, Card, Dialog, etc.)
│   └── ThemeProvider.tsx  # next-themes (light/dark)
├── lib/
│   ├── api.ts             # Axios client + all API call functions
│   ├── store.ts           # Zustand global store
│   ├── auth.ts            # Login/logout, localStorage token helpers
│   ├── types.ts           # Shared TS interfaces (ToolConfig, etc.)
│   ├── i18n.ts            # Translations: uz / ru / en
│   └── utils.ts           # generateId() and misc helpers
└── middleware.ts          # Auth guard — redirects unauthenticated users
```

---

## Next.js Config

`next.config.ts` sets three things that affect how you write code:

```ts
output: "standalone"              // Docker build — don't add static export
images: { unoptimized: true }     // MinIO previews bypass Image Optimization
experimental.proxyClientMaxBodySize: "1gb"  // needed for document uploads

rewrites: /api/* → BACKEND_URL/*  // ALL /api/ calls proxy to the FastAPI backend
```

**Consequence:** There are no "real" Next.js API routes in this project — `app/api/chat/stream/route.ts` and `app/api/chat/resume/route.ts` are thin SSE proxies that add `force-dynamic` and forward the stream. Do not add business logic there.

---

## Routing & Middleware

`middleware.ts` protects routes based on the presence of `access_token` in `localStorage` — **but middleware runs on the server** and cannot read localStorage. The workaround: the middleware reads a custom request header that the Axios client injects, or it redirects to `/login?redirect=<path>` and the login page handles the bounce.

| Route | Access |
|---|---|
| `/login` | Public; authenticated users redirected to `/home` |
| `/home`, `/chat/*` | Requires `access_token` |
| `/admin/*` | Requires `access_token` + admin role |

> **P1 TODO in middleware.ts:** Move tokens from `localStorage` to `httpOnly` cookies so server-side auth enforcement works on direct URL navigation.

---

## State Management — Zustand (`lib/store.ts`)

Single store: `useChatStore`. **Always use selective subscriptions** to prevent cascading re-renders:

```ts
// Good — only re-renders when streaming changes
const streaming = useChatStore((s) => s.streaming);

// Bad — re-renders on every store change
const store = useChatStore();
```

### Key state fields

| Field | Type | Purpose |
|---|---|---|
| `user` | `User \| null` | Logged-in user |
| `threads` | `Thread[]` | Thread list (cursor-paginated) |
| `threadsCursor` | `string \| null` | Opaque cursor for next page |
| `hasMoreThreads` | `boolean` | Whether more threads exist |
| `messages` | `Record<string, Message[]>` | Messages per thread (LRU-evicted) |
| `messageOffsets` | `Record<string, number>` | How many older messages were prepended (for pagination) |
| `streaming` | `boolean` | SSE stream active |
| `pendingInterrupt` | `Message \| null` | Set when backend sends an `interrupt` SSE event → triggers `HumanApprovalModal` |
| `pendingSources` | `RagSource[]` | RAG sources waiting to be attached to the next assistant message |
| `ragAgents` | `RagAgent[]` | All available RAG agents (loaded on app init) |
| `mcpServers` | `McpServer[]` | Available MCP servers |
| `disabledMcpServerIds` | `string[]` | User-toggled off servers |
| `lang` | `'uz' \| 'ru' \| 'en'` | UI language; persisted to `localStorage` per user |
| `_threadAccessOrder` | `string[]` | LRU order for message eviction |

### LRU message eviction

Only `MAX_WARM_THREADS = 5` threads keep messages in memory. When `setActiveThread` or `setMessages` is called, `_evictIfNeeded` promotes the thread to front and drops the oldest if over cap. Don't store large objects in messages — they will be evicted.

### RAG source attachment flow

SSE `tool_result` events push sources into `pendingSources`. The first token of the next assistant message (via `appendToken`) atomically attaches them and clears the buffer. If streaming ends before a token arrives, `attachSourcesToLastAssistant` is called as a fallback.

---

## API Client (`lib/api.ts`)

Axios instance with two interceptors:

1. **Request interceptor** — reads `access_token` from `localStorage`, injects `Authorization: Bearer <token>`
2. **Response interceptor** — on 401, fires `POST /auth/refresh` once (singleton promise deduplicates concurrent 401s), stores new tokens, retries the original request. On refresh failure, clears tokens and redirects to `/login`.

### API namespaces

```ts
authApi.login(email, password)
authApi.me()

chatApi.getThreads(cursor?, search?)
chatApi.createThread(agentId?)
chatApi.getMessages(threadId, offset?)
chatApi.sendMessage(threadId, content, disabledMcpIds)
chatApi.resumeInterrupt(threadId, approved, content?)
chatApi.deleteThread(threadId)
chatApi.getRagAgents()
chatApi.getMcpServers()
chatApi.switchAgent(threadId, agentId)
chatApi.switchMode(threadId, mode)

documentsApi.getPreviewMeta(bucket, object)
documentsApi.streamBlob(bucket, object)          // returns raw blob for preview
documentsApi.convertDocx(bucket, object)         // returns HTML string

adminApi.getUsers() / createUser() / updateUser() / deleteUser()
adminApi.getMcpServers() / createMcpServer() / updateMcpServer() / deleteMcpServer()
adminApi.getAgents()
adminApi.getDocuments(agentId, search?)
adminApi.uploadDocument(agentId, file, onProgress)
adminApi.deleteDocument(agentId, docId)
adminApi.triggerConfluenceSync()
adminApi.getConfluenceSyncStatus()
adminApi.getEvalMetrics()

evalApi.downloadCsv()
```

---

## SSE Streaming (`components/chat/ChatWindow.tsx`)

Uses `@microsoft/fetch-event-source` (not `EventSource`) because it supports POST and custom headers.

### Event types

| Event | Payload | Action |
|---|---|---|
| `token` | `string` | `appendToken(threadId, data)` |
| `tool_call` | `{tool_name, tool_input, server}` | `addMessage(…, role:"tool_call")` |
| `tool_result` | `{tool_name, output_meta, sources, duration_ms}` | `addMessage(…, role:"tool_result")` + `addPendingSources` |
| `interrupt` | `{question, tool_name, tool_args, …}` | `setPendingInterrupt(msg)` → renders `HumanApprovalModal` |
| `done` | `{title?}` | `setStreaming(false)`, `attachSourcesToLastAssistant`, update thread title |
| `error` | `string` | Show toast, `setStreaming(false)` |

### Stream lifecycle

```
sendMessage()
  → POST /api/chat/stream (proxied to backend /chat/stream)
  → AbortController attached to stop button
  → on:token  → appendToken (mutates last assistant msg in place)
  → on:done   → setStreaming(false)
  → on:interrupt → setPendingInterrupt → HumanApprovalModal shown
```

Resuming HITL: `POST /api/chat/resume` with `{ approved, content }` → new SSE stream opens on the same thread.

### Scroll management

- `scrollContainerRef` — the scrollable message list div
- `isAtBottomRef` — boolean ref, updated on scroll events
- Auto-scroll fires on every `appendToken` only when `isAtBottomRef` is true (user pinned to bottom)
- Older message loading uses `IntersectionObserver` on a sentinel div at the top

---

## Message Types

`Message.role` controls rendering in `MessageBubble`:

| role | Rendered as |
|---|---|
| `user` | Right-aligned bubble, plain text |
| `assistant` | Left-aligned bubble, Markdown + KaTeX |
| `tool_call` | `ToolCallCard` (collapsible JSON input) |
| `tool_result` | `ToolCallCard` (duration + output) |
| `interrupt` | `HumanApprovalModal` trigger (not a bubble) |

Assistant messages support: GFM tables, code blocks with syntax highlight, LaTeX math (`$…$` inline, `$$…$$` block), copy button, thumbs up/down feedback.

---

## HITL — Human Approval Flow

1. Backend sends `interrupt` SSE event with `interrupt_payload`
2. `setPendingInterrupt(msg)` → `pendingInterrupt` set in store
3. `HumanApprovalModal` renders (blocks chat input)
4. User approves/rejects → `chatApi.resumeInterrupt(threadId, approved, content?)`
5. New SSE stream opens; modal clears (`setPendingInterrupt(null)`)

`interrupt_payload.type === "response_review"` means the interrupt is asking an admin to review the LLM's draft response before sending it to the user (not a tool approval).

---

## Internationalisation (`lib/i18n.ts`)

Languages: `uz` (Uzbek), `ru` (Russian — default), `en` (English).

```ts
import { useI18n } from "@/lib/i18n";
const t = useI18n();
t("chat.placeholder")   // returns translated string for current lang
```

Language preference is stored in `localStorage` keyed by `lang_<userId>` (falls back to `lang`). `loadUserLang(userId)` is called after login to restore the per-user preference.

Do not hardcode UI strings — always use `t()`.

---

## Auth (`lib/auth.ts`)

Tokens stored in `localStorage`:
- `access_token` — short-lived JWT
- `refresh_token` — 7-day JWT

`logout()` clears both keys and redirects to `/login`.

The Axios interceptor handles silent refresh automatically — components never need to catch 401s.

---

## Adding a New Page

1. Create `app/<route>/page.tsx` — must be a **Client Component** (`"use client"`) if it uses hooks or store.
2. Add it to `middleware.ts` protected/admin lists if needed.
3. For admin pages, import from `components/admin/` — keep admin layout consistent.
4. Use `useChatStore` selectively; don't subscribe to the whole store.

---

## Adding a New Component

- **Chat UI** → `components/chat/`
- **Admin UI** → `components/admin/`
- **Primitives** → `components/ui/` (shadcn — run `npx shadcn add <component>` to extend)
- Prefer Tailwind v4 utility classes. Do not add custom CSS unless unavoidable.
- Use `Sonner` (`import { toast } from "sonner"`) for all toast notifications — do not use `alert()`.
- Icons: `lucide-react` only.

---

## Key Dependencies

| Package | Version | Used for |
|---|---|---|
| `next` | 16.2.4 | Framework |
| `react` | 19.2.4 | UI |
| `zustand` | 5.0.12 | Global state |
| `axios` | — | HTTP client |
| `@microsoft/fetch-event-source` | — | SSE streaming |
| `react-markdown` | — | Markdown in assistant messages |
| `remark-gfm` | — | GFM tables/strikethrough |
| `rehype-katex` + `katex` | — | LaTeX math rendering |
| `tailwindcss` | v4 | Styling |
| `sonner` | — | Toast notifications |
| `date-fns` | — | Date formatting |
| `lucide-react` | — | Icons |
| `next-themes` | — | Dark/light mode |

---

## Common Pitfalls

- **`"use client"` is required** on any component that uses hooks (`useState`, `useEffect`, `useChatStore`, etc.). App Router defaults to Server Components.
- **Don't call `useChatStore()` without a selector** — it subscribes to the entire store and causes excessive re-renders.
- **`appendToken` is the hot path** — it runs on every streamed token. Keep any logic inside it minimal.
- **`pendingSources` is a buffer** — it is cleared automatically when the first assistant token arrives. If you add a new SSE event type that carries sources, call `addPendingSources()` from the event handler.
- **Next.js `rewrites` proxy `/api/*`** — do not create real API routes at those paths or they will shadow the proxy.
- **`output: standalone`** — don't use `next export` or static generation for pages that need runtime data.
