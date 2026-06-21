"use client";

import { useEffect, useRef, useState } from "react";
import { X, FileText, Loader2, AlertCircle, ChevronLeft, ChevronRight, Download } from "lucide-react";
import type { RagSource } from "@/lib/store";
import { documentsApi } from "@/lib/api";

interface Props {
  source: RagSource;
  onClose: () => void;
}

type FileKind = "pdf" | "docx" | "image" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const DOCX_EXTS = new Set(["docx", "doc"]);

function getFileKind(filename: string): FileKind {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (DOCX_EXTS.has(ext)) return "docx";
  if (IMAGE_EXTS.has(ext)) return "image";
  return "other";
}

export function DocPreviewModal({ source, onClose }: Props) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [docxHtml, setDocxHtml] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [page, setPage] = useState<number>(source.page_number ?? 1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const filename = source.source_file?.split("/").pop() || "Document";
  const kind = getFileKind(filename);

  useEffect(() => {
    if (!source.minio_object || !source.bucket) {
      setError("Document location unavailable.");
      setLoading(false);
      return;
    }

    const bucket = source.bucket;
    const key = source.minio_object;

    (async () => {
      try {
        if (kind === "docx") {
          const html = await documentsApi.convertDocx(bucket, key);
          setDocxHtml(html);
        } else if (kind === "pdf" || kind === "image") {
          const blob = await documentsApi.streamBlob(bucket, key);
          const url = URL.createObjectURL(blob);
          setBlobUrl(url);
        } else {
          // unsupported: get presigned URL for download link only
          const meta = await documentsApi.getPreviewMeta(bucket, key);
          setDownloadUrl(meta.url);
        }
      } catch {
        setError("Could not load document.");
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const iframeSrc = blobUrl && kind === "pdf" ? `${blobUrl}#page=${page}` : blobUrl;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-2xl overflow-hidden"
        style={{
          width: "min(92vw, 960px)",
          height: "min(92vh, 780px)",
          background: "white",
          boxShadow: "0 32px 80px rgba(0,0,0,0.35), 0 0 0 1px rgba(0,0,0,0.05)",
          animation: "modalIn 0.18s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center gap-3 px-5 py-3.5 shrink-0"
          style={{
            background: "linear-gradient(to right, #f0fdf4, #f8fef6)",
            borderBottom: "1px solid #d1fae5",
          }}
        >
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "#52ae30", boxShadow: "0 2px 8px rgba(82,174,48,0.3)" }}
          >
            <FileText size={15} color="white" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate" style={{ color: "#1a1a1a" }}>
              {filename}
            </p>
            {source.page_number != null && kind === "pdf" && (
              <p className="text-xs" style={{ color: "#6b7280" }}>
                page {page}
              </p>
            )}
          </div>

          {/* PDF page navigation */}
          {source.page_number != null && kind === "pdf" && (
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: "#6b7280", border: "1px solid #e5e7eb" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                title="Previous page"
              >
                <ChevronLeft size={14} />
              </button>
              <span className="text-xs px-2 py-1 rounded-lg font-mono" style={{ background: "#f3f4f6", color: "#374151", minWidth: 44, textAlign: "center" }}>
                {page}
              </span>
              <button
                onClick={() => setPage((p) => p + 1)}
                className="w-7 h-7 rounded-lg flex items-center justify-center transition-colors"
                style={{ color: "#6b7280", border: "1px solid #e5e7eb" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.background = "transparent")}
                title="Next page"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl flex items-center justify-center transition-colors shrink-0"
            style={{ color: "#6b7280", border: "1px solid #e5e7eb" }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "#fee2e2";
              (e.currentTarget as HTMLButtonElement).style.color = "#ef4444";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#fca5a5";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLButtonElement).style.background = "transparent";
              (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
              (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb";
            }}
            title="Close (Esc)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 relative overflow-hidden" style={{ background: "#f3f4f6" }}>
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: "white" }}>
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
              >
                <Loader2 size={22} className="animate-spin" style={{ color: "#52ae30" }} />
              </div>
              <p className="text-sm" style={{ color: "#9ca3af" }}>Loading document…</p>
            </div>
          )}

          {error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3" style={{ background: "white" }}>
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center"
                style={{ background: "#fef2f2", border: "1px solid #fca5a5" }}
              >
                <AlertCircle size={22} style={{ color: "#ef4444" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "#374151" }}>Could not load document</p>
              <p className="text-xs" style={{ color: "#9ca3af" }}>{error}</p>
            </div>
          )}

          {/* PDF or image via blob URL in iframe / img */}
          {!loading && !error && iframeSrc && kind === "pdf" && (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              className="w-full h-full border-0"
              title={filename}
              style={{ display: "block" }}
            />
          )}

          {!loading && !error && blobUrl && kind === "image" && (
            <div className="w-full h-full flex items-center justify-center p-4" style={{ background: "white" }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={blobUrl}
                alt={filename}
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain", borderRadius: 8 }}
              />
            </div>
          )}

          {/* DOCX rendered as HTML */}
          {!loading && !error && docxHtml && (
            <div
              className="w-full h-full overflow-y-auto"
              style={{ background: "white" }}
              dangerouslySetInnerHTML={{ __html: docxHtml }}
            />
          )}

          {/* Unsupported file type */}
          {!loading && !error && downloadUrl && kind === "other" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4" style={{ background: "white" }}>
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center"
                style={{ background: "#f0fdf4", border: "1px solid #bbf7d0" }}
              >
                <FileText size={26} style={{ color: "#52ae30" }} />
              </div>
              <p className="text-sm font-medium" style={{ color: "#374151" }}>Preview not available for this file type</p>
              <a
                href={downloadUrl}
                download={filename}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors"
                style={{ background: "#52ae30", color: "white", textDecoration: "none" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.background = "#3d8a22")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.background = "#52ae30")}
              >
                <Download size={15} />
                Download {filename}
              </a>
            </div>
          )}
        </div>
      </div>

      <style>{`
        @keyframes modalIn {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);   }
        }
      `}</style>
    </div>
  );
}
