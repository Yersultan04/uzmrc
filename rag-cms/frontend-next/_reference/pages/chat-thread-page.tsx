"use client";

import { use, useEffect, useState } from "react";
import { useChatStore, type Message, type Thread } from "@/lib/store";
import { generateId } from "@/lib/utils";
import { chatApi } from "@/lib/api";
import { ChatWindow } from "@/components/chat/ChatWindow";

export default function ThreadPage({ params }: { params: Promise<{ threadId: string }> }) {
  const { threadId } = use(params);
  const { setActiveThread, setMessages, messages, upsertThread } = useChatStore();
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadedCount, setLoadedCount] = useState(0);

  useEffect(() => {
    setActiveThread(threadId);

    // Always fetch fresh thread metadata so the cashier test button / agent badge
    // is visible even when navigating directly to an old thread outside the first page.
    chatApi.getThread(threadId).then((t) => upsertThread(t as Thread)).catch(() => {});

    if (messages[threadId]) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    chatApi
      .getMessages(threadId, 0, 50)
      .then((res) => {
        const msgs = res.messages as Record<string, unknown>[];
        setMessages(
          threadId,
          msgs.map((m): Message => ({
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
        setHasMore(!!(res as Record<string, unknown>).has_more);
        setLoadedCount(msgs.length);
      })
      .catch(() => {
        setMessages(threadId, []);
      })
      .finally(() => setLoading(false));
  }, [threadId]);

  if (loading) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center chat-bg gap-4">
        <div className="logo-spin-pendulum">
          <img src="/ipoteka-icon.png" alt="Loading" style={{ width: 52, height: 52, display: "block" }} />
        </div>
        <p className="text-sm font-medium" style={{ color: "var(--brand-600)" }}>
          Loading conversation…
        </p>
      </div>
    );
  }

  return <ChatWindow threadId={threadId} initialHasMore={hasMore} initialLoadedCount={loadedCount} />;
}
