"use client";

// Chat with the knowledge base. Ported from the proven frontend/src/pages/RagChat
// onto our Next.js lib layer: agentApi (sessions + runs) + sse.agentRun (stream).
//
// Model (NOT the bank model — no tool-calls / HITL / MCP):
//   POST agentApi.startRun → 202 {id, session_id, stream_token}
//   sse.agentRun(ragId, runId, stream_token, handlers) → live progress events,
//     terminating in `final_answer` (whole answer at once) then `stream_end`.
//   On stream end we re-fetch the session so the persisted answer + citations show.
//
// SSE cleanup: every open stream is an AbortController kept in a ref Map; all are
// aborted on unmount. A 2s fallback poll re-fetches the active session while a run
// is still non-terminal (SSE can drop silently behind a proxy).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Copy, Loader2, Send, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { agentApi, sse } from "@/lib/api";
import type {
  AgentCitation,
  AgentEvent,
  ChatSessionDetail,
  ChatSessionRun,
  ChatSessionSummary,
  Rag,
} from "@/lib/types";
import { ThreadSidebar } from "./ThreadSidebar";
import { MessageBubble } from "./MessageBubble";
import { SourceCitations } from "./SourceCitations";
import { DocPreviewModal } from "./DocPreviewModal";

const TERMINAL = new Set(["succeeded", "escalated", "failed"]);

interface Props {
  rag: Rag;
}

export function ChatWindow({ rag }: Props) {
  const ragId = rag.id;
  const [sessions, setSessions] = useState<ChatSessionSummary[]>([]);
  const [active, setActive] = useState<ChatSessionDetail | null>(null);
  const [runEvents, setRunEvents] = useState<Record<string, AgentEvent[]>>({});
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<AgentCitation | null>(null);

  const streamsRef = useRef<Map<string, AbortController>>(new Map());
  const bottomRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  // Keep `active` accessible to async callbacks without re-subscribing effects.
  const activeRef = useRef<ChatSessionDetail | null>(null);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await agentApi.listSessions(ragId));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось загрузить чаты");
    }
  }, [ragId]);

  const refreshActiveSession = useCallback(async () => {
    const cur = activeRef.current;
    if (!cur) return;
    try {
      const detail = await agentApi.getSession(ragId, cur.id);
      setActive(detail);
      await loadSessions();
    } catch {
      /* ignore — fallback poll will retry */
    }
  }, [ragId, loadSessions]);

  const subscribeRun = useCallback(
    (runId: string, token: string) => {
      if (streamsRef.current.has(runId)) return;
      const ctrl = sse.agentRun(ragId, runId, token, {
        onEvent: (ev) => {
          setRunEvents((prev) => ({ ...prev, [runId]: [...(prev[runId] ?? []), ev] }));
        },
        onEnd: () => {
          streamsRef.current.delete(runId);
          void refreshActiveSession();
        },
        onError: () => {
          streamsRef.current.delete(runId);
          void refreshActiveSession();
        },
      });
      streamsRef.current.set(runId, ctrl);
    },
    [ragId, refreshActiveSession],
  );

  const openSession = useCallback(
    async (sid: string) => {
      try {
        const detail = await agentApi.getSession(ragId, sid);
        setActive(detail);
        setRunEvents({});
        for (const r of detail.runs) {
          if (!TERMINAL.has(r.status) && r.stream_token) subscribeRun(r.id, r.stream_token);
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Не удалось открыть чат");
      }
    },
    [ragId, subscribeRun],
  );

  // Initial load + abort all streams on unmount.
  useEffect(() => {
    const streams = streamsRef.current;
    void (async () => {
      await loadSessions();
    })();
    return () => {
      for (const ctrl of streams.values()) ctrl.abort();
      streams.clear();
    };
  }, [loadSessions]);

  // Auto-scroll to the latest turn / event.
  const eventCounts = Object.values(runEvents)
    .map((e) => e.length)
    .join(",");
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [active?.runs.length, eventCounts]);

  // Fallback poll: while a run in the open session is still non-terminal.
  const statusKey = active?.runs.map((r) => r.status).join(",");
  useEffect(() => {
    if (!active) return;
    const hasActive = active.runs.some((r) => !TERMINAL.has(r.status));
    if (!hasActive) return;
    const t = setInterval(() => {
      void (async () => {
        try {
          const detail = await agentApi.getSession(ragId, active.id);
          setActive(detail);
        } catch {
          /* retry next tick */
        }
      })();
    }, 2000);
    return () => clearInterval(t);
  }, [ragId, active, statusKey]);

  function newChat() {
    setActive(null);
    setRunEvents({});
    setQuery("");
    composerRef.current?.focus();
  }

  async function onAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q) return;
    if (rag.status !== "ready") {
      toast.warning("Дождитесь окончания индексации (статус «готов»).");
      return;
    }
    setBusy(true);
    try {
      const started = await agentApi.startRun(ragId, q, active?.id);
      setQuery("");
      const detail = await agentApi.getSession(ragId, started.session_id);
      setActive(detail);
      await loadSessions();
      subscribeRun(started.id, started.stream_token);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось отправить вопрос");
    } finally {
      setBusy(false);
    }
  }

  function onComposerKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void onAsk(e as unknown as React.FormEvent);
    }
  }

  async function onRename(s: ChatSessionSummary) {
    const title = window.prompt("Новое название чата:", s.title);
    if (!title || title.trim() === s.title) return;
    try {
      await agentApi.renameSession(ragId, s.id, title.trim());
      await loadSessions();
      if (active?.id === s.id) await refreshActiveSession();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось переименовать");
    }
  }

  async function onDelete(s: ChatSessionSummary) {
    if (!window.confirm(`Удалить чат «${s.title}» со всеми сообщениями?`)) return;
    try {
      await agentApi.deleteSession(ragId, s.id);
      if (active?.id === s.id) setActive(null);
      await loadSessions();
      toast.success("Чат удалён");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось удалить");
    }
  }

  const revoked = rag.role === "member" && rag.member_status === "revoked";

  return (
    <div className="flex h-full min-h-0 flex-1">
      <ThreadSidebar
        sessions={sessions}
        activeId={active?.id ?? null}
        onNewChat={newChat}
        onSelect={(sid) => void openSession(sid)}
        onRename={onRename}
        onDelete={onDelete}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-8">
          {!active ? (
            <EmptyState
              onSeed={(q) => {
                setQuery(q);
                composerRef.current?.focus();
              }}
            />
          ) : active.runs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Чат пустой — задайте первый вопрос.
            </div>
          ) : (
            <div className="mx-auto flex max-w-3xl flex-col gap-6">
              {active.runs.map((r) => (
                <RunTurn
                  key={r.id}
                  run={r}
                  events={runEvents[r.id] ?? []}
                  onPreview={setPreview}
                />
              ))}
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {revoked ? (
          <div className="border-t border-border bg-destructive/10 px-6 py-4 text-center text-sm text-destructive">
            Ваш доступ к этой базе отозван. Новые вопросы недоступны, история открыта.
          </div>
        ) : (
          <form
            onSubmit={onAsk}
            className="flex items-end gap-2 border-t border-border bg-background px-4 py-3 sm:px-8"
          >
            <textarea
              ref={composerRef}
              rows={1}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onComposerKey}
              disabled={busy}
              placeholder={
                active
                  ? "Продолжите этот чат… (Ctrl/⌘+Enter — отправить)"
                  : "Начните новый чат… (Ctrl/⌘+Enter — отправить)"
              }
              className="max-h-40 min-h-[40px] flex-1 resize-y rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <button
              type="submit"
              disabled={busy || !query.trim()}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-primary px-3 text-primary-foreground transition-opacity disabled:opacity-50"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        )}
      </section>

      {preview && (
        <DocPreviewModal ragId={ragId} citation={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One Q/A turn                                                          */
/* ------------------------------------------------------------------ */

function RunTurn({
  run,
  events,
  onPreview,
}: {
  run: ChatSessionRun;
  events: AgentEvent[];
  onPreview: (c: AgentCitation) => void;
}) {
  const running = !TERMINAL.has(run.status);

  // Live answer text streamed token-by-token (ephemeral `answer_token` events).
  // Shown while the run is still in flight and the persisted answer hasn't loaded
  // yet, so the user sees the answer build up instead of waiting for the whole
  // synthesis to finish.
  const streamingText = useMemo(() => {
    let s = "";
    for (const ev of events) {
      if (ev.type === "answer_token") {
        const d = (ev.payload as { delta?: string }).delta;
        if (typeof d === "string") s += d;
      }
    }
    return s;
  }, [events]);

  function copyAnswer() {
    if (!run.answer) return;
    void navigator.clipboard.writeText(run.answer);
    toast.success("Ответ скопирован");
  }

  return (
    <div className="flex flex-col gap-3">
      {/* User question */}
      <div className="flex justify-end">
        <div className="max-w-[80%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm text-primary-foreground">
          {run.query}
        </div>
      </div>

      {/* Assistant answer */}
      <div className="flex gap-2.5">
        <div className="mt-1 flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-card">
          <Bot size={15} className="text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Ассистент</span>
            <StatusBadge status={run.status} />
            <span className="flex-1" />
            {run.answer && (
              <button
                type="button"
                onClick={copyAnswer}
                title="Скопировать ответ"
                className="rounded p-1 hover:bg-muted"
              >
                <Copy size={12} />
              </button>
            )}
          </div>

          {run.answer ? (
            <MessageBubble
              text={run.answer}
              citations={run.citations}
              onCitationClick={(c) => onPreview(c)}
            />
          ) : running && streamingText ? (
            <div>
              <MessageBubble text={streamingText} citations={[]} onCitationClick={() => {}} />
              <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-primary/60 align-middle" />
            </div>
          ) : running ? (
            <AgentProgress run={run} events={events} />
          ) : run.status === "escalated" ? (
            <div className="text-sm text-muted-foreground">
              В доступных документах UzMRC нет точного ответа на этот вопрос.
              Попробуйте переформулировать или уточнить — я помогу по нормативной базе
              (ипотечное рефинансирование: правила, ставки, требования, процедуры).
            </div>
          ) : (
            <div className="text-sm text-destructive">Ответ не получен.</div>
          )}

          {run.citations.length > 0 && (
            <SourceCitations citations={run.citations} onSelect={(c) => onPreview(c)} />
          )}
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    succeeded: "bg-primary/10 text-primary",
    escalated: "bg-amber-500/15 text-amber-600",
    failed: "bg-destructive/15 text-destructive",
    running: "bg-blue-500/15 text-blue-600",
    queued: "bg-muted text-muted-foreground",
  };
  const label: Record<string, string> = {
    succeeded: "готово",
    escalated: "нет в документах",
    failed: "ошибка",
    running: "идёт",
    queued: "в очереди",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${map[status] ?? "bg-muted"}`}>
      {label[status] ?? status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Live progress                                                         */
/* ------------------------------------------------------------------ */

function truncate(s: string, n: number): string {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

/** Human label for the agent's current activity, from the latest event. */
function describeCurrent(events: AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i];
    const p = ev.payload as Record<string, unknown>;
    switch (ev.type) {
      case "thought":
        return `Думаю: ${truncate(String(p.thought ?? ""), 110)}`;
      case "tool_call": {
        const args = p.args as Record<string, unknown> | undefined;
        const q = args && typeof args.query === "string" ? `"${truncate(args.query, 50)}"` : "";
        return `Поиск ${String(p.tool)}${q ? " " + q : "…"}`;
      }
      case "pre_search":
        return `Предпоиск: ${String(p.tool)} (найдено ${String(p.pool_size ?? "?")})`;
      case "observation":
        return `Получен результат от ${String(p.tool)}`;
      case "grounding_report":
        return `Проверяю цитаты: ${String(p.grounded)}/${String(p.total)} подтверждены`;
      case "router_decision":
        return `Маршрут: ${String(p.kind)} → ${String(p.tool)}`;
      case "run_started":
        return `Запуск (бюджет: ${String(p.max_steps)} шагов)`;
    }
  }
  return "Подключаюсь к агенту…";
}

function AgentProgress({ run, events }: { run: ChatSessionRun; events: AgentEvent[] }) {
  let step = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const p = events[i].payload as { step?: number };
    if (typeof p.step === "number") {
      step = p.step;
      break;
    }
  }
  const max = run.max_steps || 14;
  const current = describeCurrent(events);

  if (step === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="flex items-center gap-2 text-[13px] font-medium">
          <Loader2 size={14} className="animate-spin text-primary" /> Запускаю агента…
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div className="h-full w-1/3 animate-pulse rounded-full bg-primary/50" />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{current}</p>
      </div>
    );
  }

  const pct = Math.min(100, Math.round((step / Math.max(1, max)) * 100));
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <div className="flex items-center gap-2 text-[13px] font-medium">
        <Loader2 size={14} className="animate-spin text-primary" />
        Шаг {step} <span className="text-muted-foreground">из {max}</span>
        <span className="flex-1" />
        <span className="font-mono text-xs text-muted-foreground">{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{current}</p>
    </div>
  );
}

function EmptyState({ onSeed }: { onSeed: (q: string) => void }) {
  const seeds = [
    "О чём эти документы? Опиши основные темы.",
    "Перечисли ключевые требования и положения.",
    "Какие нормы регулируют рефинансирование ипотеки?",
  ];
  return (
    <div className="mx-auto max-w-xl py-10 text-center text-muted-foreground">
      <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10">
        <Sparkles size={24} className="text-primary" />
      </div>
      <h2 className="mt-4 text-lg font-semibold text-foreground">С чего начнём?</h2>
      <p className="mt-1 text-sm">
        Задайте вопрос по нормативной базе. Каждый ответ сопровождается ссылками на нормы.
      </p>
      <div className="mx-auto mt-6 flex flex-col gap-2">
        {seeds.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onSeed(s)}
            className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
          >
            <Sparkles size={13} className="text-primary" /> {s}
          </button>
        ))}
      </div>
    </div>
  );
}
