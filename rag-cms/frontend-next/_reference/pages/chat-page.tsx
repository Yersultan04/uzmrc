"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { MessageSquare, ArrowLeft, Send, Sparkles, Bot, GraduationCap } from "lucide-react";
import { useChatStore, type Thread } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { chatApi } from "@/lib/api";
import { toast } from "sonner";

/* ── Draft chat — shown when ?agent= param is present ── */
function DraftChat({ agentId }: { agentId: string }) {
  const router = useRouter();
  const t = useT();
  const ragAgents = useChatStore((s) => s.ragAgents);
  const addThread = useChatStore((s) => s.addThread);
  const setActiveThread = useChatStore((s) => s.setActiveThread);
  const setThreadAgent = useChatStore((s) => s.setThreadAgent);
  const setPendingFirstMessage = useChatStore((s) => s.setPendingFirstMessage);
  const setPendingCashierTest = useChatStore((s) => s.setPendingCashierTest);

  const agent = ragAgents.find((a) => a.id === agentId);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [creating, setCreating] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus on mount
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  // Auto-grow textarea
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [input]);

  async function handleSend() {
    const text = input.trim();
    if (!text || creating) return;
    setCreating(true);
    try {
      const thread: Thread = await chatApi.createThread(undefined, agentId);
      thread.active_agent_id = agentId;
      addThread(thread);
      setActiveThread(thread.id);
      setThreadAgent(thread.id, agentId);
      setPendingFirstMessage(text);
      router.push(`/chat/${thread.id}`);
    } catch {
      toast.error("Failed to start conversation");
      setCreating(false);
    }
  }

  async function handleStartTest() {
    if (creating) return;
    setCreating(true);
    try {
      const thread: Thread = await chatApi.createThread("Kassir testi", agentId);
      thread.active_agent_id = agentId;
      addThread(thread);
      setActiveThread(thread.id);
      setThreadAgent(thread.id, agentId);
      setPendingCashierTest(true);
      router.push(`/chat/${thread.id}`);
    } catch {
      toast.error("Failed to start test");
      setCreating(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex flex-col h-full" style={{ background: "#f7faf6" }}>
      {/* Top bar */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-5 py-2"
        style={{
          background: "rgba(247,250,246,0.85)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e8f0e5",
        }}
      >
        {/* Left: back + active badge + test button */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push("/home")}
            className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-2.5 py-1.5 transition-all"
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
            {agent?.label ?? t.backLabel}
          </button>

          {agent && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1"
              style={{
                background: "linear-gradient(135deg, var(--brand-50), #dcfce7)",
                color: "var(--brand-700)",
                border: "1px solid var(--brand-200)",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--brand-500)" }} />
              {t.activeLabel}
            </span>
          )}

          {agentId === "cashier_agent" && (
            <button
              onClick={handleStartTest}
              disabled={creating}
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 transition-all"
              style={{
                background: "var(--brand-100)",
                color: "var(--brand-700)",
                border: "1px solid var(--brand-300)",
                cursor: creating ? "not-allowed" : "pointer",
                opacity: creating ? 0.6 : 1,
              }}
              onMouseEnter={(e) => {
                if (!creating) (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-200)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-100)";
              }}
            >
              {creating ? (
                <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <GraduationCap size={12} />
              )}
              {t.cashierTakeTest}
            </button>
          )}
        </div>
      </div>

      {/* Welcome area */}
      <div className="flex-1 flex flex-col items-center justify-center px-4">
        <div
          className="mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
          style={{
            background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
            boxShadow: "0 8px 32px rgba(82,174,48,0.3)",
          }}
        >
          <Sparkles size={28} color="white" />
        </div>

        {agent ? (
          <>
            <h3
              className="text-lg font-bold mb-2 text-center"
              style={{ color: "#1a2e14", letterSpacing: "-0.02em" }}
            >
              {agent.label}
            </h3>
            <p className="text-sm text-center max-w-xs mb-2" style={{ color: "#86a87a", lineHeight: 1.6 }}>
              {agent.description}
            </p>
            <span
              className="inline-flex items-center gap-2 text-xs font-medium rounded-full px-3 py-1.5 mb-8"
              style={{
                background: "white",
                color: "var(--brand-700)",
                border: "1px solid var(--brand-200)",
                boxShadow: "0 2px 8px rgba(82,174,48,0.1)",
              }}
            >
              <Bot size={12} />
              {t.draftReadyLabel}
            </span>
          </>
        ) : (
          <h3 className="text-lg font-bold mb-8" style={{ color: "#1a2e14" }}>
            Bank AI Assistant
          </h3>
        )}

        {/* Input area — same style as ChatWindow */}
        <div className="w-full max-w-3xl">
          <div
            className="flex gap-2 items-end rounded-2xl px-3 pt-2.5 pb-2 transition-all"
            style={{
              border: focused ? "1.5px solid var(--brand-300)" : "1.5px solid #dde8d8",
              background: "white",
              boxShadow: focused
                ? "0 0 0 3px rgba(82,174,48,0.1), 0 1px 4px rgba(0,0,0,0.06)"
                : "0 1px 4px rgba(0,0,0,0.06)",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder={t.draftPlaceholder}
              className="flex-1 resize-none text-sm bg-transparent border-none outline-none leading-relaxed py-1"
              style={{
                minHeight: 28,
                maxHeight: 128,
                color: "#1a2e14",
                caretColor: "var(--brand-500)",
              }}
              rows={1}
              disabled={creating}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || creating}
              className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all self-end"
              style={{
                background:
                  input.trim() && !creating
                    ? "linear-gradient(135deg, var(--brand-500), var(--brand-600))"
                    : "#f3f4f6",
                color: input.trim() && !creating ? "white" : "#c4cdc0",
                boxShadow: input.trim() && !creating ? "0 2px 8px rgba(82,174,48,0.25)" : "none",
              }}
            >
              {creating ? (
                <div className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
              ) : (
                <Send size={13} />
              )}
            </button>
          </div>
          <p className="text-center mt-3 text-xs" style={{ color: "#b0b8c4" }}>
            All conversations are private and secure
          </p>
        </div>
      </div>
    </div>
  );
}

/* ── Empty state — no agent selected ── */
function ChatIndexContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const agentFilter = searchParams.get("agent");

  if (agentFilter) {
    return <DraftChat agentId={agentFilter} />;
  }

  return (
    <div className="flex-1 flex items-center justify-center bg-white">
      <div className="text-center px-8">
        <div
          className="mb-5 inline-flex rounded-2xl p-4 items-center justify-center"
          style={{ background: "var(--brand-50)", border: "1px solid var(--brand-100)" }}
        >
          <MessageSquare size={32} style={{ color: "var(--brand-500)" }} />
        </div>
        <h3 className="text-lg font-semibold text-gray-900 mb-1.5">Bank AI Assistant</h3>
        <p className="text-sm text-gray-500 mb-1">Select a conversation from the sidebar</p>
        <p className="text-sm text-gray-400 mb-6">or start a new one to begin chatting.</p>
        <button
          onClick={() => router.push("/home")}
          className="inline-flex items-center gap-2 text-sm font-medium rounded-xl px-4 py-2 transition-all"
          style={{ color: "var(--brand-700)", background: "var(--brand-50)", border: "1px solid var(--brand-200)" }}
          onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-100)"; }}
          onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)"; }}
        >
          <ArrowLeft size={14} />
          Back to Home
        </button>
        <div className="mt-5 flex items-center justify-center gap-2 text-gray-400">
          <span className="text-xs">All conversations are private and secure</span>
        </div>
      </div>
    </div>
  );
}

export default function ChatIndexPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 flex items-center justify-center bg-white">
          <div className="w-6 h-6 border-2 border-gray-200 border-t-gray-400 rounded-full animate-spin" />
        </div>
      }
    >
      <ChatIndexContent />
    </Suspense>
  );
}
