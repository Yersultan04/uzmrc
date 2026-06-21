"use client";

// Source list rendered under an assistant answer. Each entry is numbered [n]
// (matching the inline 【n】 chips), shows filename + page, and opens the chunk
// preview when clicked. Pure presentational — the modal lives in ChatWindow.

import { Quote } from "lucide-react";
import type { AgentCitation } from "@/lib/types";

interface Props {
  citations: AgentCitation[];
  onSelect: (citation: AgentCitation, index: number) => void;
}

function pageLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end !== start ? `стр. ${start}–${end}` : `стр. ${start}`;
}

export function SourceCitations({ citations, onSelect }: Props) {
  if (citations.length === 0) return null;
  return (
    <div className="mt-3 flex flex-col gap-1.5 border-t border-border pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Источники
      </p>
      {citations.map((c, i) => {
        const page = pageLabel(c.page_start, c.page_end);
        return (
          <button
            key={`${c.chunk_id}-${i}`}
            type="button"
            onClick={() => onSelect(c, i)}
            className="group inline-flex w-fit items-center gap-2 text-left text-xs"
            title="Открыть фрагмент"
          >
            <span className="flex size-4 shrink-0 items-center justify-center rounded bg-primary/10 text-[10px] font-bold text-primary">
              {i + 1}
            </span>
            <Quote size={11} className="shrink-0 text-muted-foreground" />
            <span className="truncate text-primary underline decoration-dotted underline-offset-2 group-hover:opacity-80" style={{ maxWidth: 360 }}>
              {c.filename}
            </span>
            {page && <span className="shrink-0 text-muted-foreground">· {page}</span>}
          </button>
        );
      })}
    </div>
  );
}
