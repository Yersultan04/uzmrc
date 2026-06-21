"use client";

// Compare report view: KPI cards (counts by relation), filter chips by finding
// type, per-finding cards (relation badge + judge rationale + grounded norm
// citation + recommendation), .md export + print (window.print → PDF).
// Ported 1:1 from the proven frontend/src/pages/RagCompare onto our lib types.

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleSlash,
  Copy,
  Download,
  FileText,
  PlusCircle,
  Printer,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import type { ClauseFinding, ClauseRelation, CompareReport as Report } from "@/lib/types";

const RELATION_META: Record<
  ClauseRelation,
  { label: string; color: string; bg: string; icon: typeof AlertTriangle }
> = {
  conflict: { label: "Противоречие", color: "var(--destructive)", bg: "rgba(220,38,38,0.10)", icon: AlertTriangle },
  gap: { label: "Пробел", color: "#d97706", bg: "rgba(245,158,11,0.12)", icon: CircleSlash },
  addition: { label: "Дополнение", color: "var(--brand-600)", bg: "rgba(82,174,48,0.12)", icon: PlusCircle },
  duplicate: { label: "Дубль", color: "var(--muted-foreground)", bg: "rgba(120,120,120,0.10)", icon: Copy },
};

const RELATION_PLAIN: Record<ClauseRelation, string> = {
  conflict: "ПРОТИВОРЕЧИЕ",
  gap: "ПРОБЕЛ",
  addition: "ДОПОЛНЕНИЕ",
  duplicate: "ДУБЛЬ",
};

const FILTERS: { key: ClauseRelation | "all"; label: string }[] = [
  { key: "all", label: "Все" },
  { key: "conflict", label: "Противоречия" },
  { key: "duplicate", label: "Дубли" },
  { key: "addition", label: "Дополнения" },
  { key: "gap", label: "Пробелы" },
];

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + "…" : s;
}

export function CompareReport({ report }: { report: Report }) {
  const s = report.summary;
  const [filter, setFilter] = useState<ClauseRelation | "all">("all");

  const visible = useMemo(
    () =>
      filter === "all"
        ? report.findings
        : report.findings.filter((f) => f.relation === filter),
    [report.findings, filter],
  );

  const countFor = (k: ClauseRelation | "all") =>
    k === "all" ? report.findings.length : report.findings.filter((f) => f.relation === k).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Положений" value={s.total_clauses} />
        <Kpi label="Противоречий" value={s.conflict} color="var(--destructive)" />
        <Kpi label="Пробелов" value={s.gap} color="#d97706" />
        <Kpi label="Дубли / дополнения" value={`${s.duplicate} / ${s.addition}`} />
      </div>

      {report.note && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-600">
          <AlertTriangle size={14} /> {report.note}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <strong className="text-sm">Отчёт по «{report.filename}»</strong>
          <span className="flex-1" />
          <button
            type="button"
            onClick={() => downloadMarkdown(report)}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Download size={13} /> Скачать .md
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          >
            <Printer size={13} /> Печать / PDF
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-3">
          {FILTERS.map((ft) => {
            const n = countFor(ft.key);
            const isActive = filter === ft.key;
            const disabled = n === 0 && ft.key !== "all";
            return (
              <button
                key={ft.key}
                type="button"
                onClick={() => setFilter(ft.key)}
                disabled={disabled}
                className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                  isActive
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-muted"
                } ${disabled ? "opacity-40" : ""}`}
              >
                {ft.label} · {n}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-3 p-4">
          {visible.map((f) => (
            <FindingCard key={f.clause_index} f={f} />
          ))}
          {report.findings.length === 0 && (
            <div className="py-5 text-center text-sm text-muted-foreground">
              Положения не распознаны в документе.
            </div>
          )}
          {report.findings.length > 0 && visible.length === 0 && (
            <div className="py-5 text-center text-sm text-muted-foreground">
              Нет положений этого типа.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FindingCard({ f }: { f: ClauseFinding }) {
  const meta = RELATION_META[f.relation];
  const Icon = meta.icon;
  const [expanded, setExpanded] = useState(false);
  const long = f.clause_text.length > 400;

  return (
    <div
      className="flex flex-col gap-2 rounded-lg border border-border p-3.5"
      style={{ borderLeft: `3px solid ${meta.color}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          style={{ color: meta.color, background: meta.bg }}
        >
          <Icon size={13} /> {meta.label}
        </span>
        {f.clause_label && (
          <span className="font-mono text-xs text-muted-foreground">{f.clause_label}</span>
        )}
        {f.page_start != null && (
          <span className="text-xs text-muted-foreground">
            стр. {f.page_start}
            {f.page_end != null && f.page_end !== f.page_start && `–${f.page_end}`}
          </span>
        )}
        <span className="flex-1" />
        <span className="font-mono text-[11px] text-muted-foreground">
          уверенность {(f.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div className="text-[13.5px] leading-relaxed text-foreground">
        {expanded ? f.clause_text : truncate(f.clause_text, 400)}
        {long && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="ml-1.5 inline-flex items-center gap-0.5 text-xs text-primary"
          >
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            {expanded ? "свернуть" : "показать полностью"}
          </button>
        )}
      </div>

      {f.rationale && (
        <div className="text-xs leading-relaxed text-muted-foreground">
          <strong className="text-foreground">Обоснование:</strong> {f.rationale}
        </div>
      )}

      {f.matched_norm && (
        <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2.5">
          <div className="flex items-center gap-2 text-xs">
            <FileText size={13} className="text-muted-foreground" />
            <span className="text-foreground">{f.matched_norm.filename}</span>
            {f.matched_norm.page_start != null && (
              <span className="text-muted-foreground">стр. {f.matched_norm.page_start}</span>
            )}
            <span className="flex-1" />
            {f.matched_norm.grounded ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-primary">
                <ShieldCheck size={13} /> цитата подтверждена
              </span>
            ) : (
              <span
                className="inline-flex items-center gap-1 text-[11px] text-amber-600"
                title="Цитата не найдена дословно в норме — проверьте вручную"
              >
                <ShieldAlert size={13} /> цитата не подтверждена
              </span>
            )}
          </div>
          <div className="font-mono text-xs leading-relaxed text-muted-foreground">
            «{truncate(f.matched_norm.quote, 300)}»
          </div>
        </div>
      )}

      {f.recommendation && (
        <div className="flex items-start gap-1.5 text-xs text-foreground">
          <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-primary" />
          <span>
            <strong>Рекомендация:</strong> {f.recommendation}
          </span>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

function downloadMarkdown(report: Report) {
  const s = report.summary;
  const lines: string[] = [
    `# Отчёт сравнения — «${report.filename}»`,
    "",
    `Положений: ${s.total_clauses} · Противоречий: ${s.conflict} · Пробелов: ${s.gap} · Дублей: ${s.duplicate} · Дополнений: ${s.addition}`,
    "",
  ];
  for (const f of report.findings) {
    lines.push(`## [${RELATION_PLAIN[f.relation]}] ${f.clause_label || `Положение ${f.clause_index + 1}`}`);
    lines.push("");
    lines.push(f.clause_text.trim());
    lines.push("");
    if (f.rationale) lines.push(`**Обоснование:** ${f.rationale}`);
    if (f.matched_norm) {
      const m = f.matched_norm;
      lines.push(
        `**Норма базы:** ${m.filename}${m.page_start != null ? `, стр. ${m.page_start}` : ""}${
          m.grounded ? " (цитата подтверждена)" : " (цитата не подтверждена)"
        }`,
      );
      lines.push(`> ${m.quote.trim()}`);
    }
    if (f.recommendation) lines.push(`**Рекомендация:** ${f.recommendation}`);
    lines.push("");
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `compare-${report.filename.replace(/\.[^.]+$/, "")}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
