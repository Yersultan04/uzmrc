import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  CircleSlash,
  Copy,
  FileText,
  Loader2,
  PlusCircle,
  ShieldCheck,
  ShieldAlert,
  UploadCloud,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  api,
  type ClauseFinding,
  type ClauseRelation,
  type CompareReport,
} from '../api';
import { useToast } from '../ToastContext';

const RELATION_META: Record<
  ClauseRelation,
  { label: string; color: string; bg: string; icon: typeof AlertTriangle }
> = {
  conflict: { label: 'Противоречие', color: 'var(--danger)', bg: 'var(--danger-soft)', icon: AlertTriangle },
  gap: { label: 'Пробел', color: 'var(--warning)', bg: 'rgba(245,158,11,0.12)', icon: CircleSlash },
  addition: { label: 'Дополнение', color: 'var(--accent-2)', bg: 'var(--accent-soft)', icon: PlusCircle },
  duplicate: { label: 'Дубль', color: 'var(--text-dim)', bg: 'var(--surface-2)', icon: Copy },
};

export default function RagCompare() {
  const { id } = useParams<{ id: string }>();
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<CompareReport | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function onCompare() {
    if (!id || !file) return;
    setBusy(true);
    setReport(null);
    setProgress(0);
    try {
      const rep = await api.compareDocument(id, file, (loaded, total) => {
        setProgress(total > 0 ? loaded / total : 0);
      });
      setReport(rep);
      const conflicts = rep.summary.conflict;
      toast.success(
        conflicts > 0
          ? `Готово: найдено противоречий — ${conflicts}`
          : 'Готово: критических противоречий не найдено',
      );
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="col" style={{ gap: 20 }}>
      <div className="hero-block">
        <div className="hero-orb" />
        <Link
          to={`/rag/${id}`}
          className="row"
          style={{ color: 'var(--muted)', fontSize: 12.5, marginBottom: 8, position: 'relative' }}
        >
          <ArrowLeft size={14} /> Назад к RAG
        </Link>
        <div className="spread" style={{ position: 'relative' }}>
          <div>
            <h1 style={{ margin: 0 }}>Сравнение документа</h1>
            <p className="muted" style={{ margin: '6px 0 0', maxWidth: 720, lineHeight: 1.55 }}>
              Загрузите новый регламент или приказ — система разобьёт его на положения, сопоставит
              с действующими нормами базы и выдаст отчёт: противоречия, дубли, дополнения и пробелы,
              со ссылками на нормы.
            </p>
          </div>
        </div>
      </div>

      <div className="card col gap-12" style={{ padding: 20 }}>
        <div
          className="row gap-12"
          style={{
            border: '1.5px dashed var(--border)',
            borderRadius: 'var(--r-md)',
            padding: 20,
            alignItems: 'center',
            cursor: busy ? 'default' : 'pointer',
          }}
          onClick={() => !busy && inputRef.current?.click()}
        >
          <UploadCloud size={22} style={{ color: 'var(--accent-2)' }} />
          <div className="grow">
            <div style={{ fontWeight: 500 }}>
              {file ? file.name : 'Выберите файл регламента (.pdf, .txt, .md, .xlsx)'}
            </div>
            <div className="subtle" style={{ fontSize: 12 }}>
              Документ сравнивается с базой и НЕ добавляется в неё.
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,.xlsx"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              setReport(null);
            }}
          />
          <button disabled={!file || busy} onClick={(e) => { e.stopPropagation(); void onCompare(); }}>
            {busy ? <Loader2 size={14} className="spinner" /> : <FileText size={14} />}
            {busy ? 'Анализ…' : 'Сравнить'}
          </button>
        </div>

        {busy && (
          <div className="col gap-4">
            <div className="subtle" style={{ fontSize: 12 }}>
              {progress < 1 ? `Загрузка ${Math.round(progress * 100)}%` : 'Анализ положений (это может занять до минуты)…'}
            </div>
            <div className="upload-bar">
              <div
                className="upload-bar-fill"
                style={{ width: progress < 1 ? `${Math.round(progress * 100)}%` : '100%' }}
              />
            </div>
          </div>
        )}
      </div>

      {report && <Report report={report} />}
    </div>
  );
}

function Report({ report }: { report: CompareReport }) {
  const s = report.summary;
  return (
    <>
      <div className="grid cols-4">
        <Kpi label="Положений" value={s.total_clauses} />
        <Kpi label="Противоречий" value={s.conflict} color="var(--danger)" />
        <Kpi label="Пробелов" value={s.gap} color="var(--warning)" />
        <Kpi label="Дублей / дополнений" value={`${s.duplicate} / ${s.addition}`} />
      </div>

      {report.note && (
        <div
          className="row gap-8"
          style={{
            padding: '10px 14px', background: 'rgba(245,158,11,0.12)', color: 'var(--warning)',
            border: '1px solid rgba(245,158,11,0.2)', borderRadius: 'var(--r-md)', fontSize: 13,
          }}
        >
          <AlertTriangle size={14} /> {report.note}
        </div>
      )}

      <div className="card flush">
        <div className="row" style={{ padding: '14px 16px', borderBottom: '1px solid var(--border)' }}>
          <strong>Отчёт по «{report.filename}»</strong>
          <span className="spacer" style={{ flex: 1 }} />
          <span className="subtle">{report.findings.length} положений · противоречия сверху</span>
        </div>
        <div className="col" style={{ padding: 16, gap: 12 }}>
          {report.findings.map((f) => (
            <FindingCard key={f.clause_index} f={f} />
          ))}
          {report.findings.length === 0 && (
            <div className="subtle" style={{ textAlign: 'center', padding: 20 }}>
              Положения не распознаны в документе.
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function FindingCard({ f }: { f: ClauseFinding }) {
  const meta = RELATION_META[f.relation];
  const Icon = meta.icon;
  return (
    <div
      className="col gap-8"
      style={{
        border: '1px solid var(--border)',
        borderLeft: `3px solid ${meta.color}`,
        borderRadius: 'var(--r-md)',
        padding: 14,
      }}
    >
      <div className="row gap-8" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <span
          className="row gap-4"
          style={{
            color: meta.color, background: meta.bg, padding: '3px 10px',
            borderRadius: 999, fontSize: 12, fontWeight: 600,
          }}
        >
          <Icon size={13} /> {meta.label}
        </span>
        {f.clause_label && <span className="mono subtle" style={{ fontSize: 12 }}>{f.clause_label}</span>}
        {f.page_start && (
          <span className="subtle" style={{ fontSize: 12 }}>
            стр. {f.page_start}{f.page_end !== f.page_start && `–${f.page_end}`}
          </span>
        )}
        <span className="spacer" style={{ flex: 1 }} />
        <span className="subtle mono" style={{ fontSize: 11.5 }}>
          уверенность {(f.confidence * 100).toFixed(0)}%
        </span>
      </div>

      <div style={{ fontSize: 13.5, lineHeight: 1.5 }}>
        {truncate(f.clause_text, 400)}
      </div>

      {f.rationale && (
        <div className="subtle" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          <strong style={{ color: 'var(--text-dim)' }}>Обоснование:</strong> {f.rationale}
        </div>
      )}

      {f.matched_norm && (
        <div
          className="col gap-4"
          style={{ background: 'var(--surface-2)', borderRadius: 'var(--r-sm)', padding: 10 }}
        >
          <div className="row gap-8" style={{ fontSize: 12, alignItems: 'center' }}>
            <FileText size={13} style={{ color: 'var(--muted)' }} />
            <span style={{ color: 'var(--text)' }}>{f.matched_norm.filename}</span>
            {f.matched_norm.page_start && <span className="subtle">стр. {f.matched_norm.page_start}</span>}
            <span className="spacer" style={{ flex: 1 }} />
            {f.matched_norm.grounded ? (
              <span className="row gap-4" style={{ color: 'var(--success)', fontSize: 11.5 }}>
                <ShieldCheck size={13} /> цитата подтверждена
              </span>
            ) : (
              <span className="row gap-4" style={{ color: 'var(--warning)', fontSize: 11.5 }} title="Цитата не найдена дословно в норме — проверьте вручную">
                <ShieldAlert size={13} /> цитата не подтверждена
              </span>
            )}
          </div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--text-dim)', lineHeight: 1.5 }}>
            «{truncate(f.matched_norm.quote, 300)}»
          </div>
        </div>
      )}

      {f.recommendation && (
        <div className="row gap-4" style={{ fontSize: 12.5, color: 'var(--text)', alignItems: 'flex-start' }}>
          <CheckCircle2 size={14} style={{ color: 'var(--accent-2)', marginTop: 1, flexShrink: 0 }} />
          <span><strong>Рекомендация:</strong> {f.recommendation}</span>
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="kpi">
      <div className="label">{label}</div>
      <div className="value" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
}
