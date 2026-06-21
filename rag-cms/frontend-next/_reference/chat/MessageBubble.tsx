"use client";

import { useState, useCallback, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "katex/dist/katex.min.css";
import { formatDistanceToNow } from "date-fns";
import { Copy, Check, Pencil, RotateCcw, ThumbsUp, ThumbsDown } from "lucide-react";
import type { Message } from "@/lib/store";
import { ToolCallCard } from "./ToolCallCard";
import { SourceCitations } from "./SourceCitations";
import { useChatStore } from "@/lib/store";
import { chatApi } from "@/lib/api";

/* ------------------------------------------------------------------ */
/* Reusable copy button                                                  */
/* ------------------------------------------------------------------ */
function CopyButton({ text, className = "" }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className={`action-icon-btn ${copied ? "action-icon-btn--active" : ""} ${className}`}
      aria-label={copied ? "Copied!" : "Copy"}
      title={copied ? "Copied!" : "Copy"}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Fenced code block with header + copy button                          */
/* ------------------------------------------------------------------ */
function CodeBlock({ children, className }: { children: string; className?: string }) {
  const lang = className ? className.replace("language-", "") : "code";
  return (
    <div className="code-block-wrapper">
      <div className="code-block-header">
        <span className="code-block-lang">{lang}</span>
        <CopyButton text={children} className="code-copy-btn" />
      </div>
      <pre>
        <code className={className}>{children}</code>
      </pre>
    </div>
  );
}

interface Props {
  msg: Message;
  threadId?: string;
  streaming?: boolean;
  isLastAssistant?: boolean;
  onRegenerate?: () => void;
  onEdit?: (content: string) => void;
}

export function MessageBubble({ msg, threadId, streaming, isLastAssistant, onRegenerate, onEdit }: Props) {
  const { user } = useChatStore();
  const [showTime, setShowTime] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [feedback, setFeedback] = useState<1 | -1 | null>(null);

  const handleFeedback = useCallback(async (value: 1 | -1) => {
    if (feedback !== null || !threadId) return;
    setFeedback(value);
    try {
      await chatApi.submitFeedback(threadId, msg.id, value);
    } catch {
      setFeedback(null);
    }
  }, [feedback, threadId, msg.id]);

  if (msg.role === "tool_call" || msg.role === "tool_result") {
    return <ToolCallCard msg={msg} streaming={streaming} />;
  }

  if (msg.role === "interrupt") {
    return null;
  }

  const isUser = msg.role === "user";
  const [time, setTime] = useState("");
  useEffect(() => {
    if (msg.timestamp) {
      setTime(formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true }));
    }
  }, [msg.timestamp]);
  const userInitial = user?.full_name ? user.full_name.charAt(0).toUpperCase() : "U";

  return (
    <div
      className={`flex w-full ${isUser ? "justify-end" : "justify-start"} py-1.5`}
      onMouseEnter={() => { setShowTime(true); setHovered(true); }}
      onMouseLeave={() => { setShowTime(false); setHovered(false); }}
    >
      {/* AI Avatar */}
      {!isUser && (
        <div className="shrink-0 mr-2.5 mt-1">
          <div
            className="w-7 h-7 rounded-full overflow-hidden flex items-center justify-center"
            style={{ boxShadow: "0 2px 8px rgba(82,174,48,0.2)", background: "white", border: "1px solid var(--brand-100)" }}
          >
            <img src="/ipoteka-icon.png" alt="AI" style={{ width: 20, height: 20, objectFit: "contain" }} />
          </div>
        </div>
      )}

      <div
        className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}
        style={{ maxWidth: "76%" }}
      >
        <span
          className="text-xs font-medium mb-1 px-1"
          style={{ color: isUser ? "var(--brand-600)" : "#9ca3af", letterSpacing: "0.01em" }}
        >
          {isUser ? (user?.full_name || "You") : "Bank AI"}
        </span>

        {/* Message bubble with optional inline edit button for user messages */}
        <div className="relative group/bubble">
          <div
            className="rounded-2xl px-4 py-3 text-sm leading-relaxed"
            style={
              isUser
                ? {
                    background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
                    color: "white",
                    borderBottomRightRadius: 6,
                    boxShadow: "0 4px 16px rgba(82,174,48,0.25), 0 1px 4px rgba(0,0,0,0.08)",
                  }
                : {
                    background: "white",
                    color: "#1a1a1a",
                    borderTopLeftRadius: 6,
                    border: "1px solid #e8f0e5",
                    boxShadow: "0 2px 12px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)",
                    borderLeft: "3px solid var(--brand-200)",
                  }
            }
          >
            {isUser ? (
              <p className="whitespace-pre-wrap">{msg.content}</p>
            ) : (
              <div className={`message-content ${streaming ? "streaming-cursor" : ""}`}>
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
                  rehypePlugins={[[rehypeSanitize, defaultSchema], rehypeKatex]}
                  components={{
                    // Intercept <code>: if it has a language-* class it is a fenced block
                    code({ className, children }) {
                      const isBlock = Boolean(className?.startsWith("language-"));
                      if (isBlock) {
                        return (
                          <CodeBlock className={className}>
                            {String(children).replace(/\n$/, "")}
                          </CodeBlock>
                        );
                      }
                      // inline code — keep globals.css styling
                      return <code className={className}>{children}</code>;
                    },
                    // Suppress ReactMarkdown's default <pre> wrapper; CodeBlock renders its own
                    pre({ children }) {
                      return <>{children}</>;
                    },
                  }}
                >
                  {msg.content}
                </ReactMarkdown>
              </div>
            )}
          </div>

          {/* Source citations — assistant messages from RAG agents */}
          {!isUser && msg.sources && msg.sources.length > 0 && (
            <SourceCitations sources={msg.sources} />
          )}

          {/* Edit button — user messages, visible on hover */}
          {isUser && onEdit && (
            <button
              onClick={() => onEdit(msg.content)}
              className="absolute -left-8 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg flex items-center justify-center transition-all duration-150"
              style={{
                opacity: hovered ? 1 : 0,
                pointerEvents: hovered ? "auto" : "none",
                background: "white",
                border: "1px solid #e2e8e0",
                color: "#86a87a",
                boxShadow: "0 1px 4px rgba(0,0,0,0.08)",
              }}
              title="Edit message"
            >
              <Pencil size={12} />
            </button>
          )}
        </div>

        {/* Action buttons: feedback + regenerate + copy — icon-only, visible on hover */}
        {!isUser && !streaming && (
          <div
            className="flex items-center gap-0.5 mt-1 px-1 transition-opacity duration-150"
            style={{ opacity: hovered ? 1 : 0, pointerEvents: hovered ? "auto" : "none" }}
          >
            <button
              onClick={() => handleFeedback(1)}
              disabled={feedback !== null}
              className={`action-icon-btn ${feedback === 1 ? "action-icon-btn--active-green" : ""}`}
              title="Good response"
            >
              <ThumbsUp size={13} fill={feedback === 1 ? "currentColor" : "none"} />
            </button>
            <button
              onClick={() => handleFeedback(-1)}
              disabled={feedback !== null}
              className={`action-icon-btn ${feedback === -1 ? "action-icon-btn--active-red" : ""}`}
              title="Bad response"
            >
              <ThumbsDown size={13} fill={feedback === -1 ? "currentColor" : "none"} />
            </button>
            {isLastAssistant && onRegenerate && (
              <button
                onClick={onRegenerate}
                className="action-icon-btn"
                title="Regenerate response"
              >
                <RotateCcw size={13} />
              </button>
            )}
            <CopyButton text={msg.content} />
          </div>
        )}

        <span
          className="text-xs px-1 mt-1 transition-opacity duration-150"
          style={{ opacity: showTime ? 1 : 0, fontSize: 10, color: "#b0b8c4" }}
        >
          {time}
        </span>
      </div>

      {/* User Avatar */}
      {isUser && (
        <div className="shrink-0 ml-2.5 mt-1">
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
            style={{
              background: "linear-gradient(135deg, #52ae30, #2e6e18)",
              boxShadow: "0 2px 8px rgba(82,174,48,0.25)",
            }}
          >
            {userInitial}
          </div>
        </div>
      )}
    </div>
  );
}
