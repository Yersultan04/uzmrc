"use client";

import { StagePlaceholder } from "@/components/StagePlaceholder";

// Чат с агентом по базе. agentApi.startRun → sse.agentRun stream; chat sessions;
// citations (AgentCitation). Port logic from _reference/chat/ChatWindow + ThreadSidebar.
export default function RagChatPage() {
  return (
    <StagePlaceholder
      title="Чат с ассистентом"
      todo="agentApi.startRun + sse.agentRun, chat_sessions, citations; port _reference/chat/*"
    />
  );
}
