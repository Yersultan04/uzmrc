"use client";

// Preview of a cited norm. Primary view: the chunk text itself (searchApi.getChunk)
// — fast, no blob download, shows exactly what the citation points at. Secondary:
// "открыть документ" loads the original file blob (PDF in iframe / text inline)
// via filesApi.fetchBlob. Closes on Esc / backdrop click. Cleans up object URLs.

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, X } from "lucide-react";
import { filesApi, searchApi } from "@/lib/api";
import type { AgentCitation, ChunkFull } from "@/lib/types";

interface Props {
  ragId: string;
  citation: AgentCitation;
  onClose: () => void;
}

function pageLabel(start: number | null, end: number | null): string | null {
  if (start == null) return null;
  return end != null && end !== start ? `стр. ${start}–${end}` : `стр. ${start}`;
}

export function DocPreviewModal({ ragId, citation, onClose }: Props) {
  const [chunk, setChunk] = useState<ChunkFull | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFull, setShowFull] = useState(false);

  // Full-file blob state (lazy — only when the user opens the original).
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [blobMime, setBlobMime] = useState("");
  const [blobText, setBlobText] = useState<string | null>(null);
  const [blobLoading, setBlobLoading] = useState(false);
  const urlRef = useRef<string | null>(null);

  // Load the chunk text.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await searchApi.getChunk(ragId, citation.chunk_id);
        if (!cancelled) setChunk(c);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить фрагмент");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ragId, citation.chunk_id]);

  // Esc to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Revoke any object URL on unmount.
  useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function openFull() {
    setShowFull(true);
    if (blobUrl || blobLoading) return;
    setBlobLoading(true);
    try {
      const { url, mime, blob } = await filesApi.fetchBlob(ragId, citation.file_id);
      urlRef.current = url;
      setBlobUrl(url);
      setBlobMime(mime);
      const asText =
        mime.startsWith("text/") ||
        /\.(txt|md|markdown|json|csv|log|html?)$/i.test(citation.filename);
      if (asText) setBlobText(await blob.text());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Не удалось загрузить документ");
    } finally {
      setBlobLoading(false);
    }
  }

  const page = pageLabel(citation.page_start, citation.page_end);
  const isPdf = blobMime === "application/pdf" || citation.filename.toLowerCase().endsWith(".pdf");
  const iframeSrc =
    blobUrl && isPdf && citation.page_start
      ? `${blobUrl}#page=${citation.page_start}&zoom=page-fit`
      : blobUrl ?? "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(3px)" }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-2xl bg-card text-card-foreground overflow-hidden border border-border shadow-2xl"
        style={{ width: "min(92vw, 880px)", height: "min(90vh, 720px)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-border shrink-0">
          <FileText size={16} className="text-primary shrink-0" />
          <div className="min-w-0 truncate text-sm font-semibold" title={citation.filename}>
            {citation.filename}
          </div>
          {page && (
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              {page}
            </span>
          )}
          <span className="flex-1" />
          {!showFull ? (
            <button
              type="button"
              onClick={openFull}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-primary hover:bg-muted"
            >
              <ExternalLink size={12} /> Открыть документ
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setShowFull(false)}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
            >
              ← К фрагменту
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted"
            title="Закрыть (Esc)"
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-hidden bg-muted/30">
          {error ? (
            <div className="p-6 text-sm text-destructive">Ошибка: {error}</div>
          ) : !showFull ? (
            // Chunk view
            !chunk ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" /> Загружаю фрагмент…
              </div>
            ) : (
              <div className="h-full overflow-auto p-6">
                {chunk.heading && (
                  <div className="mb-3 text-sm font-semibold text-foreground">{chunk.heading}</div>
                )}
                <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed text-foreground">
                  {chunk.text}
                </pre>
              </div>
            )
          ) : (
            // Full document view
            blobLoading || (!blobUrl && !error) ? (
              <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" /> Загружаю документ…
              </div>
            ) : isPdf ? (
              <iframe src={iframeSrc} title={citation.filename} className="h-full w-full border-0" />
            ) : blobText !== null ? (
              <pre className="h-full overflow-auto whitespace-pre-wrap break-words p-6 font-sans text-[13.5px] leading-relaxed text-foreground">
                {blobText}
              </pre>
            ) : (
              <div className="p-6 text-sm">
                <p className="mb-3 text-muted-foreground">
                  Превью для этого типа файла не поддерживается в браузере.
                </p>
                {blobUrl && (
                  <a href={blobUrl} download={citation.filename} className="text-primary underline">
                    Скачать {citation.filename}
                  </a>
                )}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}
