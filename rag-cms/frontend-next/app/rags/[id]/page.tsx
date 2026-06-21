"use client";

import { StagePlaceholder } from "@/components/StagePlaceholder";

// Детали базы: файлы, индексация, участники, настройки.
// ragsApi.get/stats, filesApi.*, ingestApi.* (+ sse.ingestRun), ragsApi.listMembers.
export default function RagDetailPage() {
  return (
    <StagePlaceholder
      title="База знаний — детали"
      todo="ragsApi.get/stats, filesApi list/upload/remove, ingestApi.start + sse.ingestRun, members"
    />
  );
}
