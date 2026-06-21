"use client";

// File → compare flow. compareApi.start (202 + run_id + stream_token) →
// sse.compareRun (progress {done,total} + report + error) → renders CompareReport.
//
// SSE contract (verified against backend/app/compare/{events,worker,service}.py +
// api/compare.py): events `progress` payload {done,total}, `report` payload = full
// CompareReport dict, `error` payload {message}, terminated by `stream_end`.
// The stream_token comes from the POST response (compareApi.start → CompareRun).
//
// Cleanup: the active stream's AbortController is aborted on a new run and on unmount.

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, UploadCloud } from "lucide-react";
import { toast } from "sonner";
import { compareApi, sse } from "@/lib/api";
import type { AgentEvent, CompareReport as Report } from "@/lib/types";
import { CompareReport } from "./CompareReport";

const ACCEPT = ".pdf,.txt,.md,.xlsx";

export function CompareUploader({ ragId }: { ragId: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [analyzeDone, setAnalyzeDone] = useState(0);
  const [analyzeTotal, setAnalyzeTotal] = useState(0);
  const [report, setReport] = useState<Report | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      streamRef.current?.abort();
      streamRef.current = null;
    };
  }, []);

  async function onCompare() {
    if (!file) return;
    setBusy(true);
    setReport(null);
    setUploadPct(0);
    setAnalyzeDone(0);
    setAnalyzeTotal(0);
    streamRef.current?.abort();
    streamRef.current = null;

    try {
      const run = await compareApi.start(ragId, file, (loaded, total) => {
        setUploadPct(total > 0 ? loaded / total : 0);
      });
      if (!run.stream_token) throw new Error("в ответе нет stream_token");
      setUploadPct(1);

      await new Promise<void>((resolve, reject) => {
        const ctrl = sse.compareRun(ragId, run.id, run.stream_token!, {
          on: {
            progress: (ev: AgentEvent) => {
              const p = ev.payload as { done?: number; total?: number };
              if (typeof p.done === "number") setAnalyzeDone(p.done);
              if (typeof p.total === "number") setAnalyzeTotal(p.total);
            },
            report: (ev: AgentEvent) => {
              const rep = ev.payload as unknown as Report;
              setReport(rep);
              const conflicts = rep.summary.conflict;
              toast.success(
                conflicts > 0
                  ? `Готово: найдено противоречий — ${conflicts}`
                  : "Готово: критических противоречий не найдено",
              );
              resolve();
            },
            error: (ev: AgentEvent) => {
              const p = ev.payload as { message?: string };
              reject(new Error(p.message || "ошибка сравнения"));
            },
          },
          onEnd: () => resolve(),
          onError: (msg) => reject(new Error(msg)),
        });
        streamRef.current = ctrl;
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Не удалось выполнить сравнение");
    } finally {
      setBusy(false);
      streamRef.current = null;
    }
  }

  const analyzeLabel = (() => {
    if (uploadPct < 1) return `Загрузка ${Math.round(uploadPct * 100)}%`;
    if (analyzeTotal === 0) return "Подготовка анализа…";
    return `Анализ положений: ${analyzeDone} / ${analyzeTotal}`;
  })();

  // Upload = first 10%, analysis = remaining 90%.
  const progressPct = (() => {
    if (uploadPct < 1) return uploadPct * 0.1;
    if (analyzeTotal === 0) return 0.1;
    return 0.1 + (analyzeDone / analyzeTotal) * 0.9;
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-xl border border-border bg-card p-5">
        <div
          className="flex items-center gap-3 rounded-lg border border-dashed border-border p-5"
          style={{ cursor: busy ? "default" : "pointer" }}
          onClick={() => !busy && inputRef.current?.click()}
        >
          <UploadCloud size={22} className="shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">
              {file ? file.name : "Выберите файл регламента (.pdf, .txt, .md, .xlsx)"}
            </div>
            <div className="text-xs text-muted-foreground">
              Документ сравнивается с базой и НЕ добавляется в неё.
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setReport(null);
            }}
          />
          <button
            type="button"
            disabled={!file || busy}
            onClick={(e) => {
              e.stopPropagation();
              void onCompare();
            }}
            className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm text-primary-foreground disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
            {busy ? "Анализ…" : "Сравнить"}
          </button>
        </div>

        {busy && (
          <div className="mt-3 flex flex-col gap-1.5">
            <div className="text-xs text-muted-foreground">{analyzeLabel}</div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.round(progressPct * 100)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {report && <CompareReport report={report} />}
    </div>
  );
}
