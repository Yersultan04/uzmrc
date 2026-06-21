"use client";

import { useState } from "react";
import { FileText, ExternalLink } from "lucide-react";
import type { RagSource } from "@/lib/store";
import { DocPreviewModal } from "./DocPreviewModal";

interface Props {
  sources: RagSource[];
}

function basename(path: string) {
  return path.split("/").pop()?.replace(/\.[^.]+$/, "") || path;
}

export function SourceCitations({ sources }: Props) {
  const [preview, setPreview] = useState<RagSource | null>(null);

  if (sources.length === 0) return null;

  const unique = sources.filter(
    (s, i, arr) =>
      arr.findIndex(
        (x) => x.source_file === s.source_file && x.page_number === s.page_number
      ) === i
  );

  return (
    <>
      <div
        className="mt-3 pt-3"
        style={{ borderTop: "1px solid #e8f0e5" }}
      >
        <p className="text-xs mb-2" style={{ color: "#9ca3af", letterSpacing: "0.04em", textTransform: "uppercase", fontWeight: 600 }}>
          Sources
        </p>
        <div className="flex flex-col gap-1">
          {unique.map((src, i) => (
            <div key={i} className="inline-flex items-center gap-1 w-fit">
              <button
                onClick={() => src.minio_object && setPreview(src)}
                disabled={!src.minio_object}
                className="group inline-flex items-center gap-2 text-left"
                style={{ cursor: src.minio_object ? "pointer" : "default" }}
              >
                <span
                  className="shrink-0 w-4 h-4 rounded flex items-center justify-center text-xs font-bold"
                  style={{ background: "#f0fdf4", color: "#52ae30", border: "1px solid #bbf7d0" }}
                >
                  {i + 1}
                </span>
                <FileText
                  size={12}
                  className="shrink-0 transition-colors"
                  style={{ color: "#9ca3af" }}
                />
                <span
                  className="text-xs transition-colors"
                  style={{
                    color: src.minio_object ? "#52ae30" : "#6b7280",
                    textDecoration: src.minio_object ? "underline" : "none",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: 3,
                    maxWidth: 340,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    display: "inline-block",
                  }}
                  onMouseEnter={(e) => {
                    if (src.minio_object) (e.currentTarget as HTMLElement).style.color = "#15803d";
                  }}
                  onMouseLeave={(e) => {
                    if (src.minio_object) (e.currentTarget as HTMLElement).style.color = "#52ae30";
                  }}
                  title={src.source_file}
                >
                  {basename(src.source_file) || "Document"}
                </span>
                {src.page_number != null && (
                  <span
                    className="text-xs shrink-0"
                    style={{ color: "#9ca3af" }}
                  >
                    p. {src.page_number}
                  </span>
                )}
                {src.quality != null && (
                  <span
                    className="shrink-0 text-xs rounded px-1"
                    title={`Relevance score: ${src.score}`}
                    style={{
                      background:
                        src.quality >= 0.75 ? "#f0fdf4" :
                        src.quality >= 0.5  ? "#fffbeb" : "#f1f5f9",
                      color:
                        src.quality >= 0.75 ? "#16a34a" :
                        src.quality >= 0.5  ? "#d97706" : "#64748b",
                      border: `1px solid ${
                        src.quality >= 0.75 ? "#bbf7d0" :
                        src.quality >= 0.5  ? "#fde68a" : "#e2e8f0"
                      }`,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {Math.round(src.quality * 100)}%
                  </span>
                )}
              </button>
              {src.confluence_url && (
                <a
                  href={src.confluence_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open in Confluence"
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded transition-colors"
                  style={{ color: "#0052cc", background: "#e8f0ff", border: "1px solid #c2d4ff" }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = "#cfe0ff")}
                  onMouseLeave={(e) => (e.currentTarget.style.background = "#e8f0ff")}
                >
                  <ExternalLink size={10} />
                  Confluence
                </a>
              )}
            </div>
          ))}
        </div>
      </div>

      {preview && <DocPreviewModal source={preview} onClose={() => setPreview(null)} />}
    </>
  );
}
