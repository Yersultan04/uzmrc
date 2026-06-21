"use client";

// Chat session list. Maps over chat_sessions (agentApi), supports new chat,
// select, rename (inline prompt), delete. Active session highlighted. The parent
// owns the data + mutations — this is presentational + thin callbacks.

import { MessageSquarePlus, Pencil, Trash2 } from "lucide-react";
import type { ChatSessionSummary } from "@/lib/types";

interface Props {
  sessions: ChatSessionSummary[];
  activeId: string | null;
  onNewChat: () => void;
  onSelect: (sessionId: string) => void;
  onRename: (session: ChatSessionSummary) => void;
  onDelete: (session: ChatSessionSummary) => void;
}

export function ThreadSidebar({
  sessions,
  activeId,
  onNewChat,
  onSelect,
  onRename,
  onDelete,
}: Props) {
  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-card/40">
      <div className="flex items-center justify-between px-3 py-3">
        <span className="text-sm font-semibold">Чаты</span>
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted"
        >
          <MessageSquarePlus size={13} /> Новый
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {sessions.length === 0 ? (
          <div className="px-2 py-3 text-xs text-muted-foreground">Чатов ещё нет.</div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`group mb-1 cursor-pointer rounded-lg px-3 py-2 transition-colors ${
                activeId === s.id ? "bg-muted" : "hover:bg-muted/60"
              }`}
            >
              <div className="truncate text-[13px] font-medium text-foreground" title={s.title}>
                {s.title}
              </div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
                <span>{s.last_run_at ? new Date(s.last_run_at).toLocaleString("ru-RU") : "—"}</span>
                <span className="flex-1" />
                <button
                  type="button"
                  title="Переименовать"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRename(s);
                  }}
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-background group-hover:opacity-100"
                >
                  <Pencil size={11} />
                </button>
                <button
                  type="button"
                  title="Удалить чат"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(s);
                  }}
                  className="rounded p-1 opacity-0 transition-opacity hover:bg-background hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
