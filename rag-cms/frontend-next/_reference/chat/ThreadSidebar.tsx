"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Plus,
  Search,
  LogOut,
  Trash2,
  Settings,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ArrowLeft,
  Shield,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { useChatStore, type Thread } from "@/lib/store";
import { chatApi } from "@/lib/api";
import { clearAuth } from "@/lib/auth";
import { toast } from "sonner";

interface ThreadSidebarProps {
  isOpen: boolean;
  onToggle: () => void;
}

interface ThreadRowProps {
  t: Thread;
  isActive: boolean;
  onSelect: () => void;
  onDeleteRequest: (e: React.MouseEvent) => void;
  onDeleteConfirm: (e: React.MouseEvent) => void;
  onDeleteCancel: (e: React.MouseEvent) => void;
  isConfirming: boolean;
  isDeleting: boolean;
  onToggleHitl: (e: React.MouseEvent) => void;
  isHitl: boolean;
}

function ThreadRow({
  t,
  isActive,
  onSelect,
  onDeleteRequest,
  onDeleteConfirm,
  onDeleteCancel,
  isConfirming,
  isDeleting,
  onToggleHitl,
  isHitl,
}: ThreadRowProps) {
  const [hovered, setHovered] = useState(false);
  const [timeAgo, setTimeAgo] = useState("");
  useEffect(() => {
    const dateStr = t.last_message_at || t.created_at;
    if (dateStr) {
      setTimeAgo(formatDistanceToNow(new Date(dateStr), { addSuffix: true }));
    }
  }, [t.last_message_at, t.created_at]);

  return (
    <div
      className="relative mb-0.5"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <button
        onClick={onSelect}
        className="w-full text-left rounded-xl transition-all"
        style={{
          background: isActive
            ? "linear-gradient(135deg, var(--brand-50) 0%, #e8f5e0 100%)"
            : hovered
            ? "rgba(0,0,0,0.035)"
            : "transparent",
          border: isActive ? "1px solid var(--brand-200)" : "1px solid transparent",
          padding: "9px 12px",
          paddingRight: hovered || isConfirming ? 44 : 12,
          boxShadow: isActive ? "0 1px 4px rgba(82,174,48,0.1)" : "none",
          transition: "all 0.15s ease",
        }}
      >
        <div className="flex items-start gap-2">
          {isActive && (
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0 mt-1.5"
              style={{ background: "var(--brand-500)" }}
            />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 min-w-0">
              <p
                className="text-xs font-semibold truncate leading-tight flex-1"
                style={{ color: isActive ? "var(--brand-700)" : "#374151" }}
              >
                {t.title}
              </p>
              {isHitl && (
                <span
                  className="shrink-0 inline-flex items-center gap-0.5 text-[9px] font-bold rounded px-1 py-0.5 leading-none"
                  style={{ background: "#dbeafe", color: "#1d4ed8" }}
                  title="HITL mode active"
                >
                  <Shield size={8} />
                  HITL
                </span>
              )}
            </div>
            {t.last_message && (
              <p
                className="text-xs truncate mt-0.5 leading-tight"
                style={{ color: isActive ? "var(--brand-600)" : "#9ca3af", opacity: isActive ? 0.7 : 1 }}
              >
                {t.last_message}
              </p>
            )}
            <p className="mt-0.5" style={{ fontSize: 10, color: "#b0b8c4" }}>
              {timeAgo || "—"}
            </p>
          </div>
        </div>
      </button>

      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1"
        style={{
          opacity: hovered || isConfirming ? 1 : 0,
          transition: "opacity 0.15s",
          pointerEvents: hovered || isConfirming ? "auto" : "none",
        }}
      >
        {isDeleting ? (
          <div className="w-3.5 h-3.5 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        ) : isConfirming ? (
          <>
            <button
              onClick={onDeleteConfirm}
              className="flex items-center gap-1 text-xs rounded-lg px-1.5 py-1 font-medium transition-colors"
              style={{ background: "rgba(239,68,68,0.1)", color: "#dc2626", border: "1px solid rgba(239,68,68,0.2)" }}
            >
              <AlertTriangle size={10} />
              Delete
            </button>
            <button
              onClick={onDeleteCancel}
              className="text-xs rounded-lg px-1.5 py-1 transition-colors"
              style={{ background: "#f3f4f6", color: "#6b7280" }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button
              onClick={onToggleHitl}
              className="rounded-lg p-1 transition-colors"
              style={{
                color: isHitl ? "#1d4ed8" : "#d1d5db",
                background: isHitl ? "#dbeafe" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (!isHitl) {
                  (e.currentTarget as HTMLButtonElement).style.color = "#3b82f6";
                  (e.currentTarget as HTMLButtonElement).style.background = "#eff6ff";
                }
              }}
              onMouseLeave={(e) => {
                if (!isHitl) {
                  (e.currentTarget as HTMLButtonElement).style.color = "#d1d5db";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }
              }}
              title={isHitl ? "Disable HITL mode" : "Enable HITL mode"}
            >
              <Shield size={12} />
            </button>
            <button
              onClick={onDeleteRequest}
              className="rounded-lg p-1 transition-colors"
              style={{ color: "#d1d5db" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
                (e.currentTarget as HTMLButtonElement).style.background = "#fef2f2";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#d1d5db";
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
              title="Delete conversation"
            >
              <Trash2 size={12} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export function ThreadSidebar({ isOpen, onToggle }: ThreadSidebarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get("agent");

  const threads = useChatStore((s) => s.threads);
  const threadsCursor = useChatStore((s) => s.threadsCursor);
  const hasMoreThreads = useChatStore((s) => s.hasMoreThreads);
  const appendThreads = useChatStore((s) => s.appendThreads);
  const ragAgents = useChatStore((s) => s.ragAgents);
  const activeThreadId = useChatStore((s) => s.activeThreadId);
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const user = useChatStore((s) => s.user);
  const addThread = useChatStore((s) => s.addThread);
  const setUser = useChatStore((s) => s.setUser);
  const deleteThread = useChatStore((s) => s.deleteThread);
  const setThreadAgent = useChatStore((s) => s.setThreadAgent);
  const setThreadMode = useChatStore((s) => s.setThreadMode);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [togglingHitlId, setTogglingHitlId] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMoreThreads = useCallback(async () => {
    if (!hasMoreThreads || loadingMore || !threadsCursor) return;
    setLoadingMore(true);
    try {
      const res = await chatApi.listThreads(threadsCursor);
      appendThreads(res.threads as never[], res.next_cursor);
    } catch {
      // silently ignore
    } finally {
      setLoadingMore(false);
    }
  }, [hasMoreThreads, loadingMore, threadsCursor, appendThreads]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadMoreThreads(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMoreThreads]);

  // If no ?agent= param in URL, fall back to the active thread's assigned agent
  const activeThread = threads.find((t) => t.id === activeThreadId);
  const resolvedAgentFilter = agentFilter ?? activeThread?.active_agent_id ?? null;

  const currentAgent = resolvedAgentFilter ? ragAgents.find((a) => a.id === resolvedAgentFilter) : null;

  const visibleThreads = resolvedAgentFilter
    ? threads.filter((t) => t.active_agent_id === resolvedAgentFilter)
    : threads;

  const filtered = visibleThreads.filter(
    (t) =>
      t.title.toLowerCase().includes(search.toLowerCase()) ||
      (t.last_message && t.last_message.toLowerCase().includes(search.toLowerCase()))
  );

  async function newChat() {
    setCreating(true);
    try {
      const thread: Thread = await chatApi.createThread();
      if (resolvedAgentFilter) {
        await chatApi.setThreadAgent(thread.id, resolvedAgentFilter);
        setThreadAgent(thread.id, resolvedAgentFilter);
        thread.active_agent_id = resolvedAgentFilter;
      }
      addThread(thread);
      setActiveThread(thread.id);
      router.push(resolvedAgentFilter ? `/chat/${thread.id}?agent=${resolvedAgentFilter}` : `/chat/${thread.id}`);
    } catch {
      toast.error("Failed to create conversation");
    } finally {
      setCreating(false);
    }
  }

  function handleDeleteRequest(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    setConfirmDeleteId(threadId);
  }

  async function handleDeleteConfirm(e: React.MouseEvent, threadId: string) {
    e.stopPropagation();
    setDeletingId(threadId);
    setConfirmDeleteId(null);
    try {
      await chatApi.deleteThread(threadId);
      deleteThread(threadId);
      toast.success("Conversation deleted");
      if (activeThreadId === threadId) {
        router.push(resolvedAgentFilter ? `/chat?agent=${resolvedAgentFilter}` : "/chat");
      }
    } catch {
      toast.error("Failed to delete conversation");
    } finally {
      setDeletingId(null);
    }
  }

  function handleDeleteCancel(e: React.MouseEvent) {
    e.stopPropagation();
    setConfirmDeleteId(null);
  }

  async function handleToggleHitl(e: React.MouseEvent, thread: typeof threads[number]) {
    e.stopPropagation();
    if (togglingHitlId === thread.id) return;
    const newMode: "hitl" | "auto" = thread.chat_mode === "hitl" ? "auto" : "hitl";
    // Optimistic update
    setThreadMode(thread.id, newMode);
    setTogglingHitlId(thread.id);
    try {
      await chatApi.setThreadMode(thread.id, newMode);
      toast.success(newMode === "hitl" ? "HITL mode enabled" : "HITL mode disabled");
    } catch {
      // Roll back on failure
      setThreadMode(thread.id, thread.chat_mode === "hitl" ? "hitl" : "auto");
      toast.error("Failed to update thread mode");
    } finally {
      setTogglingHitlId(null);
    }
  }

  function handleLogout() {
    clearAuth();
    setUser(null);
    document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  /* ── COLLAPSED view ── */
  if (!isOpen) {
    return (
      <div
        className="sidebar-transition flex flex-col items-center py-4 h-full relative"
        style={{
          width: 64,
          minWidth: 64,
          background: "#f7faf6",
          borderRight: "1px solid #e8f0e5",
        }}
      >
        {/* Ipoteka icon logo */}
        <div className="mb-4">
          <img src="/ipoteka-icon.png" alt="Ipoteka Bank" style={{ width: 36, height: 36 }} />
        </div>

        {/* Toggle button */}
        <button
          onClick={onToggle}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all mb-4"
          style={{
            background: "rgba(82,174,48,0.08)",
            color: "var(--brand-600)",
            border: "1px solid var(--brand-100)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--brand-200)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLButtonElement).style.background = "rgba(82,174,48,0.08)";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--brand-100)";
          }}
          title="Open sidebar"
        >
          <ChevronRight size={16} />
        </button>

        {/* New chat */}
        <button
          onClick={newChat}
          disabled={creating}
          className="w-9 h-9 rounded-xl flex items-center justify-center transition-all text-white"
          style={{
            background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))",
            boxShadow: "var(--shadow-brand)",
          }}
          title="New conversation"
        >
          {creating ? (
            <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Plus size={16} />
          )}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* User avatar */}
        {user && (
          <button
            onClick={handleLogout}
            className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-white transition-all"
            style={{
              background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
              boxShadow: "0 2px 8px rgba(82,174,48,0.25)",
            }}
            title={`${user.full_name} · Sign out`}
          >
            {user.full_name.charAt(0).toUpperCase()}
          </button>
        )}
      </div>
    );
  }

  /* ── EXPANDED view ── */
  return (
    <div
      className="sidebar-transition flex flex-col h-full select-none"
      style={{
        width: 272,
        minWidth: 272,
        background: "#f7faf6",
        borderRight: "1px solid #e8f0e5",
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-3" style={{ borderBottom: "1px solid #edf3eb" }}>
        {/* Logo + collapse button */}
        <div className="flex items-center justify-between mb-3">
          {resolvedAgentFilter ? (
            <button
              onClick={() => router.push("/home")}
              className="flex items-center gap-1.5 text-xs font-medium transition-all rounded-lg px-2 py-1"
              style={{ color: "#6b7280" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--brand-700)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
            >
              <ArrowLeft size={13} />
              All Agents
            </button>
          ) : (
            <img
              src="/ipoteka-logo.png"
              alt="Ipoteka Bank"
              style={{ height: 32, width: "auto", maxWidth: 150 }}
            />
          )}
          <button
            onClick={onToggle}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all shrink-0"
            style={{ color: "#a0b49a" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)";
              (e.currentTarget as HTMLButtonElement).style.color = "var(--brand-600)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#a0b49a";
            }}
            title="Collapse sidebar"
          >
            <ChevronLeft size={16} />
          </button>
        </div>

        {/* Agent label when filtered */}
        {currentAgent && (
          <div
            className="flex items-center gap-2 px-2.5 py-2 rounded-xl mb-3"
            style={{ background: "rgba(82,174,48,0.08)", border: "1px solid var(--brand-100)" }}
          >
            <div
              className="w-5 h-5 rounded-full shrink-0"
              style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate" style={{ color: "var(--brand-700)" }}>
                {currentAgent.label}
              </p>
            </div>
          </div>
        )}

        {/* New Conversation */}
        <button
          onClick={newChat}
          disabled={creating}
          className="w-full flex items-center justify-center gap-2 text-sm font-semibold rounded-xl py-2.5 transition-all"
          style={{
            background: creating
              ? "var(--brand-100)"
              : "linear-gradient(135deg, var(--brand-500), var(--brand-600))",
            color: creating ? "var(--brand-600)" : "white",
            cursor: creating ? "not-allowed" : "pointer",
            boxShadow: creating ? "none" : "var(--shadow-brand)",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => {
            if (!creating) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "linear-gradient(135deg, #5ec235, var(--brand-500))";
              (e.currentTarget as HTMLButtonElement).style.boxShadow =
                "0 6px 24px rgba(82,174,48,0.35)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
            }
          }}
          onMouseLeave={(e) => {
            if (!creating) {
              (e.currentTarget as HTMLButtonElement).style.background =
                "linear-gradient(135deg, var(--brand-500), var(--brand-600))";
              (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-brand)";
              (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
            }
          }}
        >
          {creating ? (
            <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : (
            <Plus size={15} />
          )}
          {creating ? "Creating…" : "New Conversation"}
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-3">
        <div className="relative">
          <Search
            size={12}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "#a0b49a" }}
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search conversations…"
            className="w-full h-8 text-xs rounded-lg outline-none transition-all"
            style={{
              background: "rgba(255,255,255,0.7)",
              border: "1px solid #d8e8d2",
              color: "#374151",
              paddingLeft: "30px",
              paddingRight: "12px",
            }}
            onFocus={(e) => {
              e.currentTarget.style.border = "1px solid var(--brand-300)";
              e.currentTarget.style.background = "white";
              e.currentTarget.style.boxShadow = "0 0 0 3px rgba(82,174,48,0.1)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.border = "1px solid #d8e8d2";
              e.currentTarget.style.background = "rgba(255,255,255,0.7)";
              e.currentTarget.style.boxShadow = "none";
            }}
          />
        </div>
      </div>

      {/* Section label */}
      <div className="px-4 pb-1.5 flex items-center gap-2">
        <span
          className="text-xs font-semibold uppercase tracking-widest"
          style={{ color: "#a8c0a0", letterSpacing: "0.1em" }}
        >
          Conversations
        </span>
        {visibleThreads.length > 0 && (
          <span
            className="text-xs font-medium rounded-full px-1.5 py-0.5"
            style={{ background: "var(--brand-100)", color: "var(--brand-700)" }}
          >
            {visibleThreads.length}
          </span>
        )}
      </div>

      {/* Thread list */}
      <div className="flex-1 overflow-y-auto px-2.5 pb-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 px-4">
            <p className="text-xs font-medium" style={{ color: "#9ca3af" }}>
              {search
                ? "No results found"
                : resolvedAgentFilter
                ? `No conversations with ${currentAgent?.label ?? "this agent"} yet`
                : "No conversations yet"}
            </p>
            {!search && (
              <p className="text-xs mt-1" style={{ color: "#c4cdc0" }}>
                Start a new chat above
              </p>
            )}
          </div>
        )}

        {filtered.map((t) => (
          <ThreadRow
            key={t.id}
            t={t}
            isActive={activeThreadId === t.id}
            isConfirming={confirmDeleteId === t.id}
            isDeleting={deletingId === t.id}
            isHitl={t.chat_mode === "hitl"}
            onSelect={() => {
              if (confirmDeleteId === t.id) {
                setConfirmDeleteId(null);
                return;
              }
              setActiveThread(t.id);
              const agentParam = resolvedAgentFilter ?? t.active_agent_id;
              router.push(agentParam ? `/chat/${t.id}?agent=${agentParam}` : `/chat/${t.id}`);
            }}
            onDeleteRequest={(e) => handleDeleteRequest(e, t.id)}
            onDeleteConfirm={(e) => handleDeleteConfirm(e, t.id)}
            onDeleteCancel={handleDeleteCancel}
            onToggleHitl={(e) => handleToggleHitl(e, t)}
          />
        ))}

        {/* Lazy-load sentinel */}
        <div ref={sentinelRef} className="py-1">
          {loadingMore && (
            <div className="flex justify-center py-2">
              <div className="w-4 h-4 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-3 py-3" style={{ borderTop: "1px solid #edf3eb" }}>
        {user && (
          <div
            className="flex items-center gap-2.5 mb-2.5 rounded-xl px-2.5 py-2"
            style={{ background: "rgba(255,255,255,0.5)" }}
          >
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 text-white"
              style={{
                background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
                boxShadow: "0 2px 8px rgba(82,174,48,0.25)",
              }}
            >
              {user.full_name.charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold truncate leading-tight" style={{ color: "#1a2e14" }}>
                {user.full_name}
              </p>
              <p className="capitalize" style={{ fontSize: 10, color: "#86a87a" }}>
                {user.role}
              </p>
            </div>
            <button
              onClick={handleLogout}
              className="rounded-lg p-1.5 transition-colors shrink-0"
              style={{ color: "#a0b49a" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#374151";
                (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#a0b49a";
                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              }}
              title="Sign out"
            >
              <LogOut size={13} />
            </button>
          </div>
        )}

        {user?.role === "admin" && (
          <button
            onClick={() => router.push("/admin")}
            className="w-full flex items-center justify-center gap-2 text-xs rounded-xl py-2 transition-all"
            style={{ color: "#6b7280", border: "1px solid #e8f0e5", background: "rgba(255,255,255,0.5)" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "var(--brand-700)";
              (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--brand-200)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
              (e.currentTarget as HTMLButtonElement).style.background = "rgba(255,255,255,0.5)";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#e8f0e5";
            }}
          >
            <Settings size={12} />
            Admin Panel
          </button>
        )}
      </div>
    </div>
  );
}
