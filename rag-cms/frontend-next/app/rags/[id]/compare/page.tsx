"use client";

import { StagePlaceholder } from "@/components/StagePlaceholder";

// Сверка документа с нормативной базой (Module 2).
// compareApi.start (202 → run_id + stream_token) → sse.compareRun; CompareReport findings.
export default function RagComparePage() {
  return (
    <StagePlaceholder
      title="Сверка документа"
      todo="compareApi.start + sse.compareRun, render CompareReport (findings by relation)"
    />
  );
}
