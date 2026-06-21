"use client";

import { StagePlaceholder } from "@/components/StagePlaceholder";

// Список баз знаний (RAGs). GET /api/rags via ragsApi.list().
export default function RagListPage() {
  return (
    <StagePlaceholder
      title="Базы знаний"
      todo="ragsApi.list() → grid of RagCard; create-RAG dialog (ragsApi.create + listPresets)"
    />
  );
}
