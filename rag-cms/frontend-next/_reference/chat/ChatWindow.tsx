"use client";

import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { fetchEventSource } from "@microsoft/fetch-event-source";
import { toast } from "sonner";
import { Send, Square, Plus, Sparkles, Cpu, ChevronDown, Bot, ArrowLeft, GraduationCap } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { MessageBubble } from "./MessageBubble";
import { HumanApprovalModal } from "./HumanApprovalModal";
import { CashierTestModal } from "./CashierTestModal";
import { InstrumentsPanel } from "./InstrumentsPanel";
import { useChatStore, type Message } from "@/lib/store";
import { generateId } from "@/lib/utils";
import { chatApi } from "@/lib/api";

const BASE = "/api";

interface Props {
  threadId: string;
  initialHasMore?: boolean;
  initialLoadedCount?: number;
}

export function ChatWindow({ threadId, initialHasMore = false, initialLoadedCount = 0 }: Props) {
  const router = useRouter();
  // Fix 1: individual selector subscriptions — prevents full re-render on every store update
  const messages = useChatStore((s) => s.messages);
  const threads = useChatStore((s) => s.threads);
  const streaming = useChatStore((s) => s.streaming);
  const pendingInterrupt = useChatStore((s) => s.pendingInterrupt);
  const ragAgents = useChatStore((s) => s.ragAgents);
  const addMessage = useChatStore((s) => s.addMessage);
  const appendToken = useChatStore((s) => s.appendToken);
  const setStreaming = useChatStore((s) => s.setStreaming);
  const setPendingInterrupt = useChatStore((s) => s.setPendingInterrupt);
  const updateThreadLastMessage = useChatStore((s) => s.updateThreadLastMessage);
  const updateThreadTitle = useChatStore((s) => s.updateThreadTitle);
  const removeLastAssistantMessage = useChatStore((s) => s.removeLastAssistantMessage);
  const removeMessagesFrom = useChatStore((s) => s.removeMessagesFrom);
  const addPendingSources = useChatStore((s) => s.addPendingSources);
  const attachSourcesToLastAssistant = useChatStore((s) => s.attachSourcesToLastAssistant);
  const clearPendingSources = useChatStore((s) => s.clearPendingSources);
  const pendingFirstMessage = useChatStore((s) => s.pendingFirstMessage);
  const setPendingFirstMessage = useChatStore((s) => s.setPendingFirstMessage);
  const pendingCashierTest = useChatStore((s) => s.pendingCashierTest);
  const setPendingCashierTest = useChatStore((s) => s.setPendingCashierTest);
  const prependMessages = useChatStore((s) => s.prependMessages);

  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);
  const [showInstruments, setShowInstruments] = useState(false);
  const [showCashierTest, setShowCashierTest] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(initialHasMore);
  const topSentinelRef = useRef<HTMLDivElement>(null);
  const [modelInfo, setModelInfo] = useState<{ model: string; provider: string } | null>(null);
  // Fix 4: track scroll-pinned state
  const [showScrollButton, setShowScrollButton] = useState(false);

  useEffect(() => {
    chatApi.getInfo().then(setModelInfo).catch(() => {});
  }, []);

  // Auto-send the first message when arriving from agent card (lazy thread creation)
  const pendingRef = useRef(pendingFirstMessage);
  useEffect(() => {
    const msg = pendingRef.current;
    if (!msg) return;
    pendingRef.current = null;
    setPendingFirstMessage(null);
    // Small delay to let SSE connection + DOM settle
    const t = setTimeout(() => sendMessage(msg), 150);
    return () => clearTimeout(t);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-open cashier test modal when navigated from the draft screen test button
  useEffect(() => {
    if (!pendingCashierTest) return;
    setPendingCashierTest(false);
    setShowCashierTest(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [isThinking, setIsThinking] = useState(false);
  const [currentAgent, setCurrentAgent] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Fix 4: refs for scroll management
  const isAtBottomRef = useRef(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const msgs = useMemo(() => messages[threadId] || [], [messages, threadId]);
  const isStreaming = streaming;

  // Fix 4: track scroll position to decide whether to auto-scroll
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 50;
    isAtBottomRef.current = atBottom;
    setShowScrollButton(!atBottom);
  }, []);

  // Auto-scroll to bottom when pinned (works with virtualizer)
  useEffect(() => {
    if (isAtBottomRef.current) {
      const el = scrollContainerRef.current;
      if (el) {
        el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
      }
    }
  }, [msgs, isThinking, isStreaming]);

  // Load older messages when scrolling up to top sentinel.
  // offset = msgs already loaded; backend returns the batch before them.
  const loadedCountRef = useRef(initialLoadedCount);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasOlderMessages) return;
    const container = scrollContainerRef.current;
    const prevScrollHeight = container?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const currentOffset = loadedCountRef.current;
      const res = await chatApi.getMessages(threadId, currentOffset, 50);
      const olderRaw = res.messages as Record<string, unknown>[];
      if (olderRaw.length > 0) {
        const { generateId } = await import("@/lib/utils");
        prependMessages(
          threadId,
          olderRaw.map((m): Message => ({
            id: (m.id as string) || generateId(),
            role: (m.role as Message["role"]) || "assistant",
            content: (m.content as string) || "",
            tool_name: m.tool_name as string | undefined,
            server: m.server as string | undefined,
            duration_ms: m.duration_ms as number | undefined,
            output_meta: m.output_meta as Record<string, unknown> | undefined,
            sources: m.sources as Message["sources"],
            timestamp: new Date((m.timestamp as string) || Date.now()),
          }))
        );
        loadedCountRef.current = currentOffset + olderRaw.length;
        setHasOlderMessages(!!res.has_more);
        if (container) {
          container.scrollTop += container.scrollHeight - prevScrollHeight;
        }
      } else {
        setHasOlderMessages(false);
      }
    } catch {
      // ignore
    } finally {
      setLoadingOlder(false);
    }
  }, [loadingOlder, hasOlderMessages, threadId, prependMessages]);

  useEffect(() => {
    const el = topSentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries[0].isIntersecting) loadOlderMessages(); },
      { threshold: 0.1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadOlderMessages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  }, [input]);

  // Close instruments panel when clicking outside
  useEffect(() => {
    if (!showInstruments) return;
    function onDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-instruments]")) setShowInstruments(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showInstruments]);

  async function sendMessage(text: string) {
    if (!text.trim() || isStreaming) return;
    setInput("");

    const userMsg: Message = {
      id: generateId(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    addMessage(threadId, userMsg);
    updateThreadLastMessage(threadId, text);

    const thread = threads.find((t) => t.id === threadId);
    if (thread?.title === "New Conversation") {
      const newTitle = text.length > 50 ? text.slice(0, 50).trimEnd() + "…" : text;
      updateThreadTitle(threadId, newTitle);
      chatApi.updateTitle(threadId, newTitle).catch(() => {});
    }

    setStreaming(true);
    setIsThinking(true);
    setCurrentAgent(null);
    // Pin to bottom when user sends a message
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    abortRef.current = new AbortController();

    const token = localStorage.getItem("access_token");
    const url = `${BASE}/chat/stream?thread_id=${encodeURIComponent(threadId)}&message=${encodeURIComponent(text)}`;

    try {
      await fetchEventSource(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
        signal: abortRef.current.signal,
        onmessage(ev) {
          try {
            const data = JSON.parse(ev.data);
            handleEvent(data);
          } catch {
            // ignore malformed events
          }
        },
        onerror(err) {
          console.error("SSE error", err);
          setStreaming(false);
          throw err;
        },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name !== "AbortError") {
        toast.error("Connection error. Please try again.");
      }
    } finally {
      setStreaming(false);
      setIsThinking(false);
      setCurrentAgent(null);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function handleEvent(data: Record<string, unknown>) {
    switch (data.type) {
      case "token":
        setIsThinking(false);
        setCurrentAgent(null);
        appendToken(threadId, data.content as string);
        break;
      case "tool_call":
        setIsThinking(true);
        setCurrentAgent(data.name as string);
        addMessage(threadId, {
          id: generateId(),
          role: "tool_call",
          content: JSON.stringify(data.input || {}, null, 2),
          tool_name: data.name as string,
          server: data.server as string | undefined,
          timestamp: new Date(),
        });
        break;
      case "tool_result": {
        const meta = data.output_meta as Record<string, unknown> | undefined;
        addMessage(threadId, {
          id: generateId(),
          role: "tool_result",
          content: data.output as string,
          tool_name: data.name as string,
          server: data.server as string | undefined,
          duration_ms: data.duration_ms as number | undefined,
          output_meta: meta,
          timestamp: new Date(),
        });
        if (Array.isArray((meta as Record<string, unknown>)?.sources) && ((meta as Record<string, unknown>)?.sources as unknown[]).length > 0) {
          addPendingSources((meta as Record<string, unknown>).sources as import("@/lib/store").RagSource[]);
        }
        setCurrentAgent(null);
        setIsThinking(true);
        break;
      }
      case "interrupt": {
        setIsThinking(false);
        const interruptMsg: Message = {
          id: generateId(),
          role: "interrupt",
          content: "",
          interrupt_payload: data.payload as Message["interrupt_payload"],
          timestamp: new Date(),
        };
        addMessage(threadId, interruptMsg);
        setPendingInterrupt(interruptMsg);
        setStreaming(false);
        break;
      }
      case "done":
        setIsThinking(false);
        setCurrentAgent(null);
        setStreaming(false);
        attachSourcesToLastAssistant(threadId);
        break;
      case "error":
        setIsThinking(false);
        setCurrentAgent(null);
        clearPendingSources();
        toast.error((data.message as string) || "An error occurred");
        setStreaming(false);
        break;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  }

  function handleRegenerate() {
    // Find the last user message to re-send
    const currentMsgs = messages[threadId] || [];
    let lastUserContent = "";
    for (let i = currentMsgs.length - 1; i >= 0; i--) {
      if (currentMsgs[i].role === "user") {
        lastUserContent = currentMsgs[i].content;
        break;
      }
    }
    if (!lastUserContent) return;
    removeLastAssistantMessage(threadId);
    sendMessage(lastUserContent);
  }

  function handleEditMessage(msgId: string, content: string) {
    removeMessagesFrom(threadId, msgId);
    setInput(content);
    // Focus the textarea after state updates
    setTimeout(() => {
      textareaRef.current?.focus();
    }, 0);
  }

  function scrollToBottom() {
    isAtBottomRef.current = true;
    setShowScrollButton(false);
    const el = scrollContainerRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  const activeAgentId = threads.find((t) => t.id === threadId)?.active_agent_id;
  const activeAgent = activeAgentId ? ragAgents.find((a) => a.id === activeAgentId) : null;

  return (
    <div className="flex flex-col h-full chat-bg">
      {/* Top bar */}
      <div
        className="shrink-0 flex items-center justify-between gap-2 px-5 py-2"
        style={{
          background: "rgba(247,250,246,0.85)",
          backdropFilter: "blur(8px)",
          borderBottom: "1px solid #e8f0e5",
        }}
      >
        {/* Left: back button + active agent badge */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => router.push(activeAgentId ? `/chat?agent=${activeAgentId}` : "/home")}
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
            {activeAgent ? activeAgent.label : "Home"}
          </button>

          {activeAgent && (
            <span
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1"
              style={{
                background: "linear-gradient(135deg, var(--brand-50), #dcfce7)",
                color: "var(--brand-700)",
                border: "1px solid var(--brand-200)",
                boxShadow: "0 1px 4px rgba(82,174,48,0.1)",
              }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ background: "var(--brand-500)" }}
              />
              Active
            </span>
          )}

          {activeAgent?.id === "cashier_agent" && (
            <button
              onClick={() => setShowCashierTest(true)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold rounded-full px-3 py-1 transition-all"
              style={{
                background: "var(--brand-100)",
                color: "var(--brand-700)",
                border: "1px solid var(--brand-300)",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-200)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-100)";
              }}
            >
              <GraduationCap size={12} />
              Test topshirish
            </button>
          )}
        </div>
        <ThemeToggle />
      </div>

      {/* Messages area — Fix 4: attach scroll container refs */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto py-8 relative"
      >
        {msgs.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center px-8">
            <div
              className="mb-5 w-16 h-16 rounded-2xl flex items-center justify-center"
              style={{
                background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
                boxShadow: "0 8px 32px rgba(82,174,48,0.3)",
              }}
            >
              <Sparkles size={28} color="white" />
            </div>
            <h3
              className="text-lg font-bold mb-2"
              style={{ color: "#1a2e14", letterSpacing: "-0.02em" }}
            >
              Xush kelibsiz!
            </h3>
            <p className="text-sm max-w-xs" style={{ color: "#86a87a", lineHeight: 1.6 }}>
              Bank operatsiyalari, HR masalalari yoki mavjud vositalar bo&apos;yicha savol bering.
            </p>

            {activeAgent && (
              <div className="mt-5">
                <span
                  className="inline-flex items-center gap-2 text-xs font-semibold rounded-full px-4 py-2"
                  style={{
                    background: "white",
                    color: "var(--brand-700)",
                    border: "1px solid var(--brand-200)",
                    boxShadow: "0 2px 8px rgba(82,174,48,0.12)",
                  }}
                >
                  <span
                    className="w-2 h-2 rounded-full"
                    style={{ background: "var(--brand-500)" }}
                  />
                  {activeAgent.label} — ready to help
                </span>
              </div>
            )}
          </div>
        )}

        {/* Older messages sentinel — visible when scrolled to top */}
        <div ref={topSentinelRef} className="flex justify-center py-2 min-h-[1px]">
          {loadingOlder && (
            <div className="flex items-center gap-2 text-xs py-1 px-3 rounded-full" style={{ color: "#86a87a", background: "rgba(82,174,48,0.06)" }}>
              <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              Eski xabarlar yuklanmoqda…
            </div>
          )}
        </div>

        {/* Message list */}
        <div className="flex flex-col w-full max-w-3xl mx-auto px-4">
          {msgs.map((msg, i) => {
            const lastAssistantIdx = msgs.reduce(
              (acc, m, idx) => (m.role === "assistant" ? idx : acc),
              -1
            );
            return (
              <MessageBubble
                key={msg.id}
                msg={msg}
                threadId={threadId}
                streaming={isStreaming && i === msgs.length - 1 && (msg.role === "assistant" || msg.role === "tool_call")}
                isLastAssistant={msg.role === "assistant" && i === lastAssistantIdx}
                onRegenerate={msg.role === "assistant" && i === lastAssistantIdx && !isStreaming ? handleRegenerate : undefined}
                onEdit={msg.role === "user" && !isStreaming ? (content) => handleEditMessage(msg.id, content) : undefined}
              />
            );
          })}

          {/* Thinking indicator */}
          {isThinking && (
            <div className="flex items-start gap-3 py-2 animate-fade-up">
              <div
                className="logo-spin-pendulum w-7 h-7 rounded-full overflow-hidden flex items-center justify-center shrink-0 mt-0.5"
                style={{ background: "white", border: "1px solid var(--brand-100)", boxShadow: "0 2px 8px rgba(82,174,48,0.2)" }}
              >
                <img src="/ipoteka-icon.png" alt="AI" style={{ width: 20, height: 20, objectFit: "contain" }} />
              </div>
              <div
                className="flex flex-col gap-1.5 rounded-2xl rounded-tl-sm px-4 py-3"
                style={{ background: "white", border: "1px solid var(--brand-100)", boxShadow: "var(--shadow-sm)" }}
              >
                <div className="flex items-center gap-1.5">
                  <span className="thinking-dot inline-block w-2 h-2 rounded-full" style={{ background: "var(--brand-400)" }} />
                  <span className="thinking-dot inline-block w-2 h-2 rounded-full" style={{ background: "var(--brand-400)" }} />
                  <span className="thinking-dot inline-block w-2 h-2 rounded-full" style={{ background: "var(--brand-400)" }} />
                </div>
                {currentAgent ? (
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-flex items-center gap-1 text-xs font-mono px-2 py-0.5 rounded-full"
                      style={{
                        background: "var(--brand-50)",
                        color: "var(--brand-700)",
                        border: "1px solid var(--brand-100)",
                      }}
                    >
                      <Cpu size={10} />
                      {currentAgent}
                    </span>
                    <span className="text-xs" style={{ color: "#86a87a" }}>ishlamoqda...</span>
                  </div>
                ) : (
                  <span className="text-xs" style={{ color: "#86a87a" }}>Bank AI o&apos;ylayapti...</span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fix 4: scroll-to-bottom button — only visible when not pinned */}
        {showScrollButton && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-4 right-4 w-9 h-9 rounded-full flex items-center justify-center shadow-lg transition-all"
            style={{
              background: "white",
              border: "1px solid var(--brand-200)",
              color: "var(--brand-600)",
              boxShadow: "0 4px 16px rgba(82,174,48,0.2)",
            }}
            title="Scroll to bottom"
          >
            <ChevronDown size={18} />
          </button>
        )}
      </div>

      {/* Input area */}
      <div
        className="px-4 pb-4 pt-3"
        style={{
          background: "rgba(247,250,246,0.9)",
          backdropFilter: "blur(8px)",
          borderTop: "1px solid #e8f0e5",
        }}
      >
        <div className="max-w-3xl mx-auto">
          {/* Active agent badge */}
          {(() => {
            const thread = threads.find((t) => t.id === threadId);
            const agentId = thread?.active_agent_id;
            const agent = agentId ? ragAgents.find((a) => a.id === agentId) : null;
            if (!agent) return null;
            return (
              <div className="flex items-center gap-1.5 mb-2">
                <span
                  className="inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1"
                  style={{
                    background: "var(--brand-50)",
                    color: "var(--brand-700)",
                    border: "1px solid var(--brand-200)",
                    boxShadow: "0 1px 4px rgba(82,174,48,0.1)",
                  }}
                >
                  <Bot size={11} />
                  {agent.label}
                </span>
              </div>
            );
          })()}

          {/* Input box */}
          <div
            className="flex gap-2 items-end rounded-2xl px-3 pt-2.5 pb-2 transition-all"
            style={{
              border: focused ? "1.5px solid var(--brand-300)" : "1.5px solid #dde8d8",
              background: "white",
              boxShadow: focused
                ? "0 0 0 3px rgba(82,174,48,0.1), var(--shadow-sm)"
                : "var(--shadow-sm)",
              transition: "border-color 0.2s, box-shadow 0.2s",
            }}
          >
            {/* "+" button disabled — agent is pre-selected from home page
            {ragAgents.length > 0 && (
              <div className="relative shrink-0 self-end pb-0.5" data-instruments>
                <button
                  onClick={() => setShowInstruments((v) => !v)}
                  className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors"
                  style={{
                    background: showInstruments ? "var(--brand-50)" : "#f3f4f6",
                    color: showInstruments ? "var(--brand-600)" : "#9ca3af",
                  }}
                  title="Tools & instruments"
                >
                  <Plus size={16} />
                </button>

                {showInstruments && (
                  <InstrumentsPanel onClose={() => setShowInstruments(false)} />
                )}
              </div>
            )}
            */}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              placeholder="Message Bank AI… (Enter to send, Shift+Enter for new line)"
              className="flex-1 resize-none text-sm bg-transparent border-none outline-none leading-relaxed py-1"
              style={{
                minHeight: 28,
                maxHeight: 128,
                color: "#1a2e14",
                caretColor: "var(--brand-500)",
              }}
              rows={1}
              disabled={isStreaming}
            />

            {isStreaming ? (
              <button
                onClick={stopStreaming}
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center self-end"
                style={{ background: "#ef4444", color: "white", boxShadow: "0 2px 8px rgba(239,68,68,0.3)" }}
                title="Stop generating"
              >
                <Square size={13} fill="white" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage(input)}
                disabled={!input.trim()}
                className="shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all self-end"
                style={{
                  background: input.trim()
                    ? "linear-gradient(135deg, var(--brand-500), var(--brand-600))"
                    : "#f3f4f6",
                  color: input.trim() ? "white" : "#c4cdc0",
                  cursor: input.trim() ? "pointer" : "not-allowed",
                  boxShadow: input.trim() ? "var(--shadow-brand)" : "none",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  if (input.trim()) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "linear-gradient(135deg, #5ec235, var(--brand-500))";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow =
                      "0 4px 16px rgba(82,174,48,0.4)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(-1px)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (input.trim()) {
                    (e.currentTarget as HTMLButtonElement).style.background =
                      "linear-gradient(135deg, var(--brand-500), var(--brand-600))";
                    (e.currentTarget as HTMLButtonElement).style.boxShadow = "var(--shadow-brand)";
                    (e.currentTarget as HTMLButtonElement).style.transform = "translateY(0)";
                  }
                }}
                title="Send message"
              >
                <Send size={13} />
              </button>
            )}
          </div>

          <p className="text-center text-xs mt-2" style={{ color: "#b0c4a8" }}>
            AI can make mistakes. Verify important information.
          </p>
        </div>
      </div>

      {pendingInterrupt && (
        <HumanApprovalModal
          msg={pendingInterrupt}
          threadId={threadId}
          onDone={() => setPendingInterrupt(null)}
        />
      )}

      {showCashierTest && (
        <CashierTestModal
          threadId={threadId}
          onClose={() => setShowCashierTest(false)}
        />
      )}
    </div>
  );
}
