"use client";

// Renders one assistant answer as Markdown (GFM + KaTeX), turning inline
// citation markers 【n】 / [n] into clickable chips that scroll to (and open a
// preview of) the matching SourceCitations entry. Our model has no streaming
// tokens — the whole answer arrives in one `final_answer` event — so this just
// renders the final string.

import { useMemo, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkBreaks from "remark-breaks";
import rehypeKatex from "rehype-katex";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "katex/dist/katex.min.css";
import type { AgentCitation } from "@/lib/types";

interface Props {
  text: string;
  citations: AgentCitation[];
  onCitationClick: (citation: AgentCitation, index: number) => void;
}

// 【1】, 【1, 2】, [1], [1,2] — capture the inner digit groups.
const CITATION_RE = /[【\[]\s*(\d+(?:\s*[,，]\s*\d+)*)\s*[】\]]/g;

/** Split a text node, replacing citation markers with clickable chips. */
function renderWithCitations(
  text: string,
  citations: AgentCitation[],
  onCitationClick: (citation: AgentCitation, index: number) => void,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let match: RegExpExecArray | null;
  CITATION_RE.lastIndex = 0;
  let key = 0;
  while ((match = CITATION_RE.exec(text)) !== null) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const nums = match[1]
      .split(/[,，]/)
      .map((n) => parseInt(n.trim(), 10))
      .filter((n) => Number.isFinite(n));
    for (const n of nums) {
      const idx = n - 1; // citations are 1-based in the answer text
      const citation = citations[idx];
      out.push(
        <button
          key={`cite-${key++}`}
          type="button"
          className="cite-chip"
          onClick={() => citation && onCitationClick(citation, idx)}
          disabled={!citation}
          title={citation ? `${citation.filename} — открыть фрагмент` : `Источник [${n}]`}
        >
          {n}
        </button>,
      );
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function MessageBubble({ text, citations, onCitationClick }: Props) {
  // Memoise the markdown component map so it isn't recreated each render.
  const components = useMemo(
    () => ({
      // Turn citation markers inside text nodes into chips.
      p({ children }: { children?: ReactNode }) {
        return <p>{mapChildren(children, citations, onCitationClick)}</p>;
      },
      li({ children }: { children?: ReactNode }) {
        return <li>{mapChildren(children, citations, onCitationClick)}</li>;
      },
      pre({ children }: { children?: ReactNode }) {
        return <pre>{children}</pre>;
      },
    }),
    [citations, onCitationClick],
  );

  return (
    <div className="message-content text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath, remarkBreaks]}
        rehypePlugins={[[rehypeSanitize, defaultSchema], rehypeKatex]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

/** Recursively map string children to citation-aware nodes. */
function mapChildren(
  children: ReactNode,
  citations: AgentCitation[],
  onCitationClick: (citation: AgentCitation, index: number) => void,
): ReactNode {
  if (typeof children === "string") {
    return renderWithCitations(children, citations, onCitationClick);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) =>
      typeof child === "string" ? (
        <span key={i}>{renderWithCitations(child, citations, onCitationClick)}</span>
      ) : (
        child
      ),
    );
  }
  return children;
}
