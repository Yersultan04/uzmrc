"use client";

// Детали базы знаний во вкладках: Файлы · Индексация · О системе · Участники ·
// Настройки. Вкладки индексации и настроек доступны только владельцу/админу
// базы (участник получит 403 — поэтому скрываем). Живые данные тянутся из
// ragsApi / filesApi / ingestApi.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Bot,
  ExternalLink,
  FileText,
  GitCompare,
  Info,
  Loader2,
  Play,
  Plus,
  RotateCcw,
  Settings,
  ShieldAlert,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { filesApi, ingestApi, ragsApi, sse } from "@/lib/api";
import type {
  FileItem,
  IngestRun,
  Member,
  Rag,
  RagStats,
} from "@/lib/types";
import { DOC_TYPES } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import {
  FileStatusBadge,
  IngestStatusBadge,
  RagStatusBadge,
} from "@/components/StatusBadge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type TabKey = "files" | "index" | "about" | "members" | "settings";

const STAGE_LABELS: Record<string, string> = {
  parsing: "Распознавание текста",
  chunking: "Разбиение на фрагменты",
  enriching: "Обогащение контекстом",
  embedding: "Построение векторов",
  storing: "Сохранение в индекс",
};

export default function RagDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  return (
    <AppShell>
      <RagDetail ragId={id} />
    </AppShell>
  );
}

function RagDetail({ ragId }: { ragId: string }) {
  const router = useRouter();
  const [rag, setRag] = useState<Rag | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<TabKey>("files");

  const role = rag?.role ?? "owner";
  const canManage = role === "owner" || role === "admin";

  const loadRag = useCallback(async () => {
    try {
      setRag(await ragsApi.get(ragId));
    } catch (e) {
      toast.error((e as Error).message || "Не удалось загрузить базу");
    } finally {
      setLoading(false);
    }
  }, [ragId]);

  // Fetch-on-mount: state updates happen after an await (asynchronous).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadRag();
  }, [loadRag]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Hide owner-only tabs for guests.
  const tabs = useMemo(() => {
    const base: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
      { key: "files", label: "Файлы", icon: FileText },
    ];
    if (canManage) base.push({ key: "index", label: "Индексация", icon: Play });
    base.push({ key: "about", label: "О системе", icon: Info });
    if (canManage) {
      base.push({ key: "members", label: "Участники", icon: Users });
      base.push({ key: "settings", label: "Настройки", icon: Settings });
    }
    return base;
  }, [canManage]);

  // If the active tab becomes unavailable (e.g. guest loses an owner-only tab),
  // fall back to "files" during render instead of in an effect.
  const activeTab: TabKey = tabs.some((t) => t.key === tab) ? tab : "files";

  async function onDeleteRag() {
    if (!rag) return;
    if (!confirm(`Удалить базу «${rag.name}» безвозвратно?`)) return;
    try {
      await ragsApi.remove(rag.id);
      toast.success(`База «${rag.name}» удалена`);
      router.push("/");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось удалить базу");
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-20 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
      </div>
    );
  }

  if (!rag) {
    return (
      <div className="py-20 text-center text-muted-foreground">
        База не найдена.{" "}
        <Link href="/" className="underline">
          К списку баз
        </Link>
      </div>
    );
  }

  const ready = rag.status === "ready";
  const blockedReason = !ready
    ? rag.status === "indexing"
      ? "База индексируется — чат и сравнение станут доступны после завершения."
      : rag.status === "failed"
        ? "Индексация не удалась — обратитесь к администратору."
        : "База ещё не проиндексирована — загрузите документы и запустите индексацию."
    : null;

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      <div>
        <Link
          href="/"
          className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Все базы знаний
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <h1 className="text-2xl font-bold tracking-tight">{rag.name}</h1>
              <RagStatusBadge status={rag.status} />
            </div>
            {rag.description && (
              <p className="max-w-2xl text-sm text-muted-foreground">
                {rag.description}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={ready ? `/rags/${rag.id}/compare` : "#"}
              aria-disabled={!ready}
              tabIndex={ready ? 0 : -1}
              className={cn(!ready && "pointer-events-none")}
            >
              <Button
                variant="outline"
                disabled={!ready}
                title={blockedReason ?? "Сравнить документ с базой"}
              >
                <GitCompare />
                Сравнить документ
              </Button>
            </Link>
            <Link
              href={ready ? `/rags/${rag.id}/chat` : "#"}
              aria-disabled={!ready}
              tabIndex={ready ? 0 : -1}
              className={cn(!ready && "pointer-events-none")}
            >
              <Button disabled={!ready} title={blockedReason ?? "Открыть чат"}>
                <Bot />
                Чат с ассистентом
              </Button>
            </Link>
            {canManage && (
              <Button variant="destructive" size="icon" onClick={onDeleteRag} title="Удалить базу">
                <Trash2 />
              </Button>
            )}
          </div>
        </div>
        {blockedReason && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-4 py-2.5 text-sm text-muted-foreground">
            {rag.status === "indexing" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Info className="h-4 w-4" />
            )}
            {blockedReason}
          </div>
        )}
        {role === "member" && rag.member_status === "revoked" && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm text-destructive">
            <X className="h-4 w-4" /> Ваш доступ к базе отозван — новые вопросы
            заблокированы.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-border">
        <div className="flex flex-wrap gap-1">
          {tabs.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={cn(
                  "flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors",
                  active
                    ? "border-primary text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "files" && (
        <FilesTab ragId={ragId} canManage={canManage} />
      )}
      {activeTab === "index" && canManage && (
        <IndexTab ragId={ragId} onIndexed={() => void loadRag()} />
      )}
      {activeTab === "about" && <AboutTab ragId={ragId} />}
      {activeTab === "members" && canManage && <MembersTab ragId={ragId} />}
      {activeTab === "settings" && canManage && (
        <SettingsTab rag={rag} onUpdated={setRag} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Files tab                                                           */
/* ------------------------------------------------------------------ */

function FilesTab({ ragId, canManage }: { ragId: string; canManage: boolean }) {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [classifying, setClassifying] = useState(false);
  const [uploads, setUploads] = useState<
    { name: string; progress: number; error?: string }[]
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setFiles(await filesApi.list(ragId));
    } catch (e) {
      toast.error((e as Error).message || "Не удалось загрузить файлы");
    } finally {
      setLoading(false);
    }
  }, [ragId]);

  // Fetch-on-mount: state updates happen after an await (asynchronous).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Which doc types actually occur, for the filter dropdown.
  const presentTypes = useMemo(() => {
    const s = new Set<string>();
    for (const f of files) if (f.doc_type) s.add(f.doc_type);
    return Object.keys(DOC_TYPES).filter((k) => s.has(k));
  }, [files]);

  const classified = useMemo(() => files.some((f) => f.doc_type), [files]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return files.filter(
      (f) =>
        (!q || f.filename.toLowerCase().includes(q)) &&
        (!typeFilter || f.doc_type === typeFilter),
    );
  }, [files, filter, typeFilter]);

  async function onClassify() {
    setClassifying(true);
    try {
      const res = await filesApi.classify(ragId);
      toast.success(`Классифицировано: ${res.classified} файлов`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось классифицировать");
    } finally {
      setClassifying(false);
    }
  }

  async function handleFiles(picked: File[]) {
    if (picked.length === 0) return;
    setUploads(picked.map((f) => ({ name: f.name, progress: 0 })));
    for (const file of picked) {
      try {
        await filesApi.upload(ragId, file, (loaded, total) => {
          const p = total > 0 ? loaded / total : 0;
          setUploads((prev) =>
            prev.map((u) => (u.name === file.name ? { ...u, progress: p } : u)),
          );
        });
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, progress: 1 } : u)),
        );
      } catch (e) {
        const msg = (e as Error).message;
        setUploads((prev) =>
          prev.map((u) => (u.name === file.name ? { ...u, error: msg } : u)),
        );
        toast.error(`${file.name}: ${msg}`);
      }
    }
    toast.success("Загрузка завершена");
    setTimeout(() => setUploads([]), 2000);
    await refresh();
  }

  async function onDelete(file: FileItem) {
    if (!confirm(`Удалить файл «${file.filename}»?`)) return;
    try {
      await filesApi.remove(ragId, file.id);
      toast.success("Файл удалён");
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось удалить файл");
    }
  }

  // Open the original file blob in a new tab (PDF inline / text inline).
  async function onOpen(file: FileItem) {
    setOpeningId(file.id);
    try {
      const { url } = await filesApi.fetchBlob(ragId, file.id);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (!w) toast.error("Разрешите всплывающие окна, чтобы открыть файл");
      // Revoke once the new tab has had time to load the blob.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      toast.error((e as Error).message || "Не удалось открыть файл");
    } finally {
      setOpeningId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {canManage && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void handleFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => inputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-6 py-10 text-center transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/40",
          )}
        >
          <Upload className="h-7 w-7 text-muted-foreground" />
          <div className="text-sm font-medium">
            Перетащите файлы сюда или нажмите для выбора
          </div>
          <div className="text-xs text-muted-foreground">
            Поддерживаются PDF, TXT, MD, XLSX
          </div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.txt,.md,.xlsx"
            className="hidden"
            onChange={(e) => {
              void handleFiles(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      )}

      {uploads.length > 0 && (
        <div className="flex flex-col gap-2">
          {uploads.map((u) => (
            <div key={u.name} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="truncate">{u.name}</span>
                <span className={u.error ? "text-destructive" : "text-muted-foreground"}>
                  {u.error ? "Ошибка" : `${Math.round(u.progress * 100)}%`}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    u.error ? "bg-destructive" : "bg-primary",
                  )}
                  style={{ width: `${Math.round(u.progress * 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Поиск по имени файла…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="max-w-xs"
          />
          {presentTypes.length > 0 && (
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring"
            >
              <option value="">Все типы</option>
              {presentTypes.map((k) => (
                <option key={k} value={k}>
                  {DOC_TYPES[k]}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            {filter || typeFilter
              ? `${visible.length} из ${files.length}`
              : `${files.length} файл(ов)`}
          </span>
          {canManage && files.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClassify} disabled={classifying}>
              {classifying ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {classified ? "Переклассифицировать" : "Классифицировать"}
            </Button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {files.length === 0
              ? "Файлы пока не загружены."
              : "Ничего не найдено."}
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-x-auto py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">Файл</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
                <th className="px-4 py-2.5 font-medium">Размер</th>
                <th className="px-4 py-2.5 font-medium">Страниц</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {visible.map((f) => (
                <tr
                  key={f.id}
                  className="border-b border-border/60 last:border-0"
                >
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium">{f.filename}</span>
                          {f.doc_type && (
                            <Badge variant="secondary" className="shrink-0 font-normal">
                              {DOC_TYPES[f.doc_type] ?? f.doc_type}
                            </Badge>
                          )}
                        </div>
                        {f.error && (
                          <div className="truncate text-xs text-destructive">
                            {f.error}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5">
                    <FileStatusBadge status={f.status} />
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {(f.size_bytes / 1024).toFixed(1)} КБ
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground">
                    {f.pages ?? "—"}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => onOpen(f)}
                        disabled={openingId === f.id}
                        title="Открыть файл"
                        aria-label={`Открыть ${f.filename}`}
                      >
                        {openingId === f.id ? (
                          <Loader2 className="animate-spin text-muted-foreground" />
                        ) : (
                          <ExternalLink className="text-muted-foreground" />
                        )}
                      </Button>
                      {canManage && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => onDelete(f)}
                          title="Удалить файл"
                          aria-label={`Удалить ${f.filename}`}
                        >
                          <Trash2 className="text-muted-foreground" />
                        </Button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Index tab                                                           */
/* ------------------------------------------------------------------ */

function IndexTab({
  ragId,
  onIndexed,
}: {
  ragId: string;
  onIndexed: () => void;
}) {
  const [run, setRun] = useState<IngestRun | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<FileItem[]>([]);
  const streamRef = useRef<AbortController | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      setRun(await ingestApi.status(ragId));
    } catch {
      setRun(null);
    }
  }, [ragId]);

  // Fetch-on-mount: state updates happen after an await (asynchronous).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void loadStatus();
    void filesApi.list(ragId).then(setFiles).catch(() => {});
    return () => streamRef.current?.abort();
  }, [ragId, loadStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Poll while a run is queued/running (covers reload mid-run).
  useEffect(() => {
    if (run?.status === "queued" || run?.status === "running") {
      const t = setInterval(() => void loadStatus(), 1500);
      return () => clearInterval(t);
    }
    if (run?.status === "succeeded" || run?.status === "failed") {
      onIndexed();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run?.status]);

  function startStream(r: IngestRun) {
    if (!r.stream_token) return;
    streamRef.current?.abort();
    setLog([]);
    streamRef.current = sse.ingestRun(ragId, r.id, r.stream_token, {
      onEvent: (ev) => {
        setLog((prev) => [...prev, formatEvent(ev.type, ev.payload)]);
      },
      onEnd: () => {
        void loadStatus();
      },
      onError: () => void loadStatus(),
    });
  }

  async function start(force: boolean) {
    if (force && !confirm("Полная переиндексация обработает все файлы заново. Продолжить?"))
      return;
    setBusy(true);
    try {
      const r = await ingestApi.start(ragId, force);
      setRun(r);
      startStream(r);
      toast.info(force ? "Переиндексация запущена" : "Индексация запущена");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось запустить индексацию");
    } finally {
      setBusy(false);
    }
  }

  const isActive = run?.status === "queued" || run?.status === "running";
  const filesPct =
    run && run.files_total > 0
      ? Math.round((run.files_done / run.files_total) * 100)
      : 0;
  const currentFile = run?.current_file_id
    ? files.find((f) => f.id === run.current_file_id)
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              onClick={() => void start(false)}
              disabled={busy || isActive || files.length === 0}
            >
              {isActive ? <Loader2 className="animate-spin" /> : <Play />}
              {isActive ? "Индексация…" : "Запустить индексацию"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void start(true)}
              disabled={busy || isActive || files.length === 0}
              title="Сбросить кеш и проиндексировать все файлы заново"
            >
              <RotateCcw />
              Переиндексировать всё
            </Button>
            {files.length === 0 && (
              <span className="text-xs text-muted-foreground">
                Сначала загрузите файлы во вкладке «Файлы».
              </span>
            )}
          </div>

          {run && (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2">
                  <IngestStatusBadge status={run.status} />
                  <span className="text-muted-foreground">
                    файлы {run.files_done}/{run.files_total} · фрагментов{" "}
                    {run.chunks_total}
                  </span>
                </div>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${filesPct}%` }}
                />
              </div>
              {isActive && currentFile && (
                <div className="text-xs text-muted-foreground">
                  Сейчас: <span className="font-medium">{currentFile.filename}</span>
                  {run.current_stage && (
                    <>
                      {" · "}
                      {STAGE_LABELS[run.current_stage] ?? run.current_stage}
                    </>
                  )}
                  {run.current_progress != null &&
                    ` · ${Math.round(run.current_progress * 100)}%`}
                </div>
              )}
              {run.error && (
                <div className="text-xs text-destructive">{run.error}</div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {log.length > 0 && (
        <Card>
          <CardContent>
            <div className="mb-2 text-xs font-medium text-muted-foreground">
              Журнал · {log.length} событий
            </div>
            <div className="max-h-64 overflow-y-auto rounded-lg bg-muted/50 p-3 font-mono text-xs leading-relaxed">
              {log.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function formatEvent(type: string, payload: Record<string, unknown>): string {
  switch (type) {
    case "run_started":
      return `Старт · всего файлов ${payload.files_total ?? "?"}`;
    case "file_started":
      return `► Файл ${payload.file_id ?? ""}`;
    case "chunked":
      return `   ${payload.pages ?? "?"} стр. → ${payload.chunks ?? "?"} фрагментов`;
    case "enriching":
      return `   обогащение контекстом (${payload.chunks ?? "?"})`;
    case "embedding":
      return `   построение векторов (${payload.chunks_total ?? "?"})`;
    case "embedding_batch":
      return `   векторы ${payload.done ?? "?"}/${payload.total ?? "?"}`;
    case "storing":
      return `   сохранение (${payload.chunks ?? "?"})`;
    case "file_done":
      return `✓ Файл готов · ${payload.chunks ?? "?"} фрагментов`;
    case "file_failed":
      return `✗ Ошибка: ${payload.error ?? ""}`;
    case "run_finished":
      return `Готово · ${payload.files_done ?? "?"} файлов, ${payload.chunks_total ?? "?"} фрагментов`;
    case "run_failed":
      return `Прогон упал: ${payload.error ?? ""}`;
    default:
      return type;
  }
}

/* ------------------------------------------------------------------ */
/* About tab — live KPIs                                               */
/* ------------------------------------------------------------------ */

function AboutTab({ ragId }: { ragId: string }) {
  const [stats, setStats] = useState<RagStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    ragsApi
      .stats(ragId)
      .then((s) => alive && setStats(s))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [ragId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Загрузка статистики…
      </div>
    );
  }
  if (error || !stats) {
    return (
      <Card>
        <CardContent className="py-8 text-sm text-destructive">
          {error || "Статистика недоступна"}
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label="Документов" value={stats.documents} hint="уникальных файлов" />
        <Stat
          label="Фрагментов"
          value={stats.chunks.toLocaleString("ru-RU")}
          hint="в индексе"
        />
        <Stat label="Страниц" value={stats.pages_total.toLocaleString("ru-RU")} hint="всего" />
        <Stat
          label="Фрагментов на документ"
          value={stats.avg_chunks_per_doc}
          hint="в среднем"
        />
        <Stat
          label="Токенов в индексе"
          value={stats.total_tokens.toLocaleString("ru-RU")}
          hint="суммарно"
        />
        <Stat
          label="Статус базы"
          value={
            stats.status === "ready"
              ? "Готова"
              : stats.status === "indexing"
                ? "Индексируется"
                : stats.status === "failed"
                  ? "Ошибка"
                  : "Черновик"
          }
          hint={stats.rag_name}
        />
      </div>
      <Card>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Система отвечает на вопросы по документам базы со ссылкой на источник
            (файл, страницу и точную цитату) и сравнивает новые приказы с
            действующими нормами.
          </p>
          <p className="text-xs">
            Модель построения векторов: {stats.embed_model} ({stats.embed_dim}-мерные).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: number | string;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="mt-0.5 text-xl font-bold">{value}</div>
        {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Members tab                                                         */
/* ------------------------------------------------------------------ */

function MembersTab({ ragId }: { ragId: string }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setMembers(await ragsApi.listMembers(ragId));
    } catch (e) {
      toast.error((e as Error).message || "Не удалось загрузить участников");
    } finally {
      setLoading(false);
    }
  }, [ragId]);

  // Fetch-on-mount: state updates happen after an await (asynchronous).
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    void refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setBusy(true);
    try {
      await ragsApi.inviteMember(ragId, email.trim());
      setEmail("");
      await refresh();
      toast.success("Участник приглашён");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось пригласить");
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(m: Member) {
    if (m.is_owner) return;
    if (!confirm(`Отозвать доступ ${m.email}?`)) return;
    try {
      await ragsApi.revokeMember(ragId, m.user_id);
      await refresh();
      toast.success("Доступ отозван");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось отозвать доступ");
    }
  }

  async function onReactivate(m: Member) {
    if (m.is_owner) return;
    try {
      await ragsApi.inviteMember(ragId, m.email); // POST reactivates
      await refresh();
      toast.success("Доступ восстановлен");
    } catch (e) {
      toast.error((e as Error).message || "Не удалось восстановить доступ");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Приглашённые участники могут задавать вопросы ассистенту. Управление
            файлами и настройками остаётся за владельцем базы.
          </p>
          <form onSubmit={onInvite} className="flex gap-2">
            <Input
              type="email"
              placeholder="email@uzmrc.uz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={busy}
            />
            <Button type="submit" disabled={busy || !email.trim()}>
              {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
              Пригласить
            </Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Пользователь должен уже существовать в системе. Если его нет —
            попросите администратора создать учётную запись.
          </p>
        </CardContent>
      </Card>

      {loading ? (
        <div className="flex items-center gap-2 py-6 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : (
        <Card className="py-0">
          <ul className="divide-y divide-border">
            {members.map((m) => (
              <li
                key={m.user_id}
                className="flex items-center justify-between gap-3 px-4 py-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{m.email}</span>
                    {m.is_owner ? (
                      <Badge variant="secondary">Владелец</Badge>
                    ) : m.status === "active" ? (
                      <Badge>Активен</Badge>
                    ) : (
                      <Badge variant="destructive">Отозван</Badge>
                    )}
                  </div>
                  {!m.is_owner && (
                    <div className="text-xs text-muted-foreground">
                      Приглашён {fmtDate(m.created_at)}
                      {m.revoked_at && ` · отозван ${fmtDate(m.revoked_at)}`}
                    </div>
                  )}
                </div>
                {!m.is_owner && m.status === "active" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => onRevoke(m)}
                  >
                    <X /> Отозвать
                  </Button>
                )}
                {!m.is_owner && m.status === "revoked" && (
                  <Button variant="outline" size="sm" onClick={() => onReactivate(m)}>
                    <UserPlus /> Восстановить
                  </Button>
                )}
              </li>
            ))}
            {members.filter((m) => !m.is_owner).length === 0 && (
              <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                Пока никого не приглашали.
              </li>
            )}
          </ul>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Settings tab                                                        */
/* ------------------------------------------------------------------ */

function SettingsTab({
  rag,
  onUpdated,
}: {
  rag: Rag;
  onUpdated: (r: Rag) => void;
}) {
  const [busy, setBusy] = useState(false);
  const webSearch = Boolean(
    (rag.settings as { web_search_enabled?: boolean })?.web_search_enabled,
  );

  async function toggleWebSearch() {
    setBusy(true);
    try {
      const updated = await ragsApi.updateSettings(rag.id, {
        web_search_enabled: !webSearch,
      });
      onUpdated(updated);
      toast.success(
        `Поиск в интернете ${!webSearch ? "включён" : "выключен"}`,
      );
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <AIConfigCard rag={rag} onUpdated={onUpdated} />
      <Card>
        <CardContent className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Поиск в интернете</div>
            <p className="text-xs text-muted-foreground">
              Когда документов в базе не хватает, ассистент может искать ответ в
              открытых источниках.
            </p>
          </div>
          <Button
            variant={webSearch ? "default" : "outline"}
            onClick={toggleWebSearch}
            disabled={busy}
          >
            {busy && <Loader2 className="animate-spin" />}
            {webSearch ? "Включён" : "Выключен"}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

/* Structured assistant configuration (Tone / Do / Don't / Ethics / Languages /
   Restricted topics). The base identity (UzMRC normative assistant) is fixed in
   the backend; everything here is appended as "ADMIN-CONFIGURED BEHAVIOR".
   Stored in rag.settings.ai_config — applied live, no redeploy. */

interface AIConfig {
  tone: string;
  dos: string[];
  donts: string[];
  ethics: string;
  languages: string[];
  restricted_topics: string[];
  restriction_message: string;
}

const EMPTY_AICONFIG: AIConfig = {
  tone: "",
  dos: [],
  donts: [],
  ethics: "",
  languages: [],
  restricted_topics: [],
  restriction_message: "",
};

function normalizeAIConfig(settings: Record<string, unknown>): AIConfig {
  const raw = (settings?.ai_config ?? null) as Partial<AIConfig> | null;
  if (raw && typeof raw === "object") {
    return {
      tone: String(raw.tone ?? ""),
      dos: Array.isArray(raw.dos) ? raw.dos.map(String) : [],
      donts: Array.isArray(raw.donts) ? raw.donts.map(String) : [],
      ethics: String(raw.ethics ?? ""),
      languages: Array.isArray(raw.languages) ? raw.languages.map(String) : [],
      restricted_topics: Array.isArray(raw.restricted_topics)
        ? raw.restricted_topics.map(String)
        : [],
      restriction_message: String(raw.restriction_message ?? ""),
    };
  }
  // Migrate the legacy free-text persona into the Tone field on first open.
  const legacy = String((settings as { persona?: string })?.persona ?? "");
  return { ...EMPTY_AICONFIG, tone: legacy };
}

function aiConfigIsEmpty(c: AIConfig): boolean {
  return (
    !c.tone.trim() &&
    !c.ethics.trim() &&
    !c.restriction_message.trim() &&
    c.dos.length === 0 &&
    c.donts.length === 0 &&
    c.languages.length === 0 &&
    c.restricted_topics.length === 0
  );
}

function AIConfigCard({
  rag,
  onUpdated,
}: {
  rag: Rag;
  onUpdated: (r: Rag) => void;
}) {
  const saved = useMemo(() => normalizeAIConfig(rag.settings), [rag.settings]);
  const [cfg, setCfg] = useState<AIConfig>(saved);
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(cfg) !== JSON.stringify(saved);

  function patch(p: Partial<AIConfig>) {
    setCfg((c) => ({ ...c, ...p }));
  }

  async function save() {
    setBusy(true);
    try {
      const empty = aiConfigIsEmpty(cfg);
      // Clear the legacy persona key too, so behaviour comes only from ai_config.
      const updated = await ragsApi.updateSettings(rag.id, {
        ai_config: empty ? null : cfg,
        persona: "",
      });
      onUpdated(updated);
      toast.success(
        empty ? "Настройки сброшены к стандартным" : "Настройки ассистента сохранены",
      );
    } catch (e) {
      toast.error((e as Error).message || "Не удалось сохранить настройки");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardContent className="space-y-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Bot className="h-4 w-4 text-primary" />
            Поведение ассистента
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Базовая роль (нормативный помощник UzMRC) зашита в системе. Здесь
            настраиваются <span className="font-medium">дополнительные правила</span> —
            применяются сразу, без переразвёртывания. Оставьте всё пустым, чтобы
            вернуть стандартное поведение.
          </p>
        </div>

        {/* Tone & Personality */}
        <Field
          label="Тон и характер"
          hint="Как ассистент общается: тон, манера, акценты."
        >
          <Textarea
            value={cfg.tone}
            onChange={(e) => patch({ tone: e.target.value })}
            rows={3}
            placeholder="Напр.: Официально-деловой тон, вежливо, на «вы», без эмодзи и разговорных выражений."
            className="resize-y"
          />
        </Field>

        {/* Behaviour rules */}
        <div className="grid gap-5 sm:grid-cols-2">
          <RuleListEditor
            label="Что ассистент ДОЛЖЕН делать"
            items={cfg.dos}
            onChange={(dos) => patch({ dos })}
            placeholder="Добавить правило…"
            tone="do"
          />
          <RuleListEditor
            label="Что ассистент НЕ должен делать"
            items={cfg.donts}
            onChange={(donts) => patch({ donts })}
            placeholder="Добавить ограничение…"
            tone="dont"
          />
        </div>

        {/* Ethics */}
        <Field
          label="Этика и безопасность"
          hint="Принципы: правдивость, ссылки на источник, отказ при отсутствии данных."
        >
          <Textarea
            value={cfg.ethics}
            onChange={(e) => patch({ ethics: e.target.value })}
            rows={3}
            placeholder="Напр.: Давать только достоверную информацию из базы. Не выдумывать. При отсутствии данных — честно сообщать."
            className="resize-y"
          />
        </Field>

        {/* Languages */}
        <Field
          label="Предпочитаемые языки ответа"
          hint="ISO-коды по приоритету (ru, uz, en). Язык вопроса пользователя всегда важнее."
        >
          <ChipEditor
            items={cfg.languages}
            onChange={(languages) => patch({ languages })}
            placeholder="ru, uz, en…"
            transform={(s) => s.toLowerCase().slice(0, 8)}
          />
        </Field>

        {/* Restricted topics */}
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <ShieldAlert className="h-4 w-4 text-amber-600" />
            Запрещённые темы
          </div>
          <p className="mt-1 mb-2 text-xs text-muted-foreground">
            Ключевые слова: если вопрос их содержит, ассистент вежливо откажется
            (поиск по подстроке — вводите основу слова, напр. «политик» поймает
            «политика/политику/политики»).
          </p>
          <ChipEditor
            items={cfg.restricted_topics}
            onChange={(restricted_topics) => patch({ restricted_topics })}
            placeholder="Добавить ключевое слово…"
            transform={(s) => s.slice(0, 80)}
          />
          <div className="mt-3">
            <Field label="Сообщение при отказе" hint="">
              <Textarea
                value={cfg.restriction_message}
                onChange={(e) => patch({ restriction_message: e.target.value })}
                rows={2}
                placeholder="Извините, я не могу обсуждать эту тему. Задайте вопрос по нормативной базе UzMRC."
                className="resize-y"
              />
            </Field>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
          {dirty && (
            <Button variant="ghost" size="sm" onClick={() => setCfg(saved)} disabled={busy}>
              Отменить
            </Button>
          )}
          <Button onClick={save} disabled={busy || !dirty} size="sm">
            {busy && <Loader2 className="animate-spin" />}
            Сохранить
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium">{label}</div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  );
}

/* Editable list of free-text rules (dos / donts). */
function RuleListEditor({
  label,
  items,
  onChange,
  placeholder,
  tone,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  tone: "do" | "dont";
}) {
  const [draft, setDraft] = useState("");
  const dot = tone === "do" ? "bg-primary" : "bg-amber-600";

  function add() {
    const v = draft.trim();
    if (!v) return;
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{label}</div>
      <ul className="space-y-1.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", dot)} />
            <span className="min-w-0 flex-1 break-words">{item}</span>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              title="Удалить"
              aria-label="Удалить правило"
            >
              <X className="text-muted-foreground" />
            </Button>
          </li>
        ))}
        {items.length === 0 && (
          <li className="text-xs text-muted-foreground">Пока нет правил.</li>
        )}
      </ul>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
        <Button variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

/* Editable chip list (languages / restricted keywords). */
function ChipEditor({
  items,
  onChange,
  placeholder,
  transform = (s) => s,
}: {
  items: string[];
  onChange: (items: string[]) => void;
  placeholder: string;
  transform?: (s: string) => string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const v = transform(draft.trim());
    if (!v || items.includes(v)) {
      setDraft("");
      return;
    }
    onChange([...items, v]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-xs"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="rounded-full hover:bg-foreground/10"
                aria-label={`Удалить ${item}`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
        <Button variant="outline" size="sm" onClick={add} disabled={!draft.trim()}>
          <Plus />
        </Button>
      </div>
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("ru-RU");
  } catch {
    return iso;
  }
}
