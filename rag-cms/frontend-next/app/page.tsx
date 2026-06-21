"use client";

// Список баз знаний. Грид карточек (ragsApi.list) + диалог создания
// (ragsApi.create + ragsApi.listPresets). Человеческие подписи, без dev-жаргона.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Bot,
  Database,
  FileText,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { ragsApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { Preset, Rag } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { RagStatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";

const LANG_OPTIONS = [
  { value: "simple", label: "Универсальный (по умолчанию)" },
  { value: "russian", label: "Русский" },
  { value: "english", label: "Английский" },
];

export default function KnowledgeBasesPage() {
  return (
    <AppShell>
      <KnowledgeBases />
    </AppShell>
  );
}

function KnowledgeBases() {
  const router = useRouter();
  const user = useAppStore((s) => s.user);
  const rags = useAppStore((s) => s.rags);
  const setRags = useAppStore((s) => s.setRags);
  const removeRag = useAppStore((s) => s.removeRag);

  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRags(await ragsApi.list());
    } catch (e) {
      toast.error((e as Error).message || "Не удалось загрузить базы знаний");
    } finally {
      setLoading(false);
    }
  }, [setRags]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = useMemo(() => {
    return {
      total: rags.length,
      ready: rags.filter((r) => r.status === "ready").length,
      indexing: rags.filter((r) => r.status === "indexing").length,
      failed: rags.filter((r) => r.status === "failed").length,
    };
  }, [rags]);

  const isAdmin = user?.role === "admin";

  async function onDelete(rag: Rag) {
    if (
      !confirm(
        `Удалить базу «${rag.name}» со всеми документами и индексом? Действие необратимо.`,
      )
    )
      return;
    try {
      await ragsApi.remove(rag.id);
      removeRag(rag.id);
      toast.success(`База «${rag.name}» удалена`);
    } catch (e) {
      toast.error((e as Error).message || "Не удалось удалить базу");
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">
            {isAdmin ? "Все базы знаний" : "Базы знаний"}
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            База знаний — это набор документов, по которому можно задавать
            вопросы и проверять новые документы на противоречия.
          </p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          <Plus />
          Новая база
        </Button>
      </div>

      {/* KPI row */}
      {rags.length > 0 && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label="Всего" value={counts.total} icon={Database} />
          <Kpi label="Готовы" value={counts.ready} tone="ok" />
          <Kpi label="Индексируются" value={counts.indexing} tone="info" />
          <Kpi
            label="С ошибками"
            value={counts.failed}
            tone={counts.failed > 0 ? "warn" : undefined}
          />
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="flex items-center gap-2 py-20 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : rags.length === 0 ? (
        <EmptyState onCreate={() => setCreateOpen(true)} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rags.map((rag) => (
            <RagCard
              key={rag.id}
              rag={rag}
              currentUserId={user?.id}
              onOpenChat={() => router.push(`/rags/${rag.id}/chat`)}
              onDelete={() => onDelete(rag)}
            />
          ))}
        </div>
      )}

      <CreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void refresh()}
      />
    </div>
  );
}

function Kpi({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number;
  icon?: React.ComponentType<{ className?: string }>;
  tone?: "ok" | "info" | "warn";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "warn"
        ? "text-destructive"
        : tone === "info"
          ? "text-blue-600 dark:text-blue-400"
          : "text-foreground";
  return (
    <Card size="sm" className="gap-1">
      <CardContent className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
        </div>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
      </CardContent>
    </Card>
  );
}

function RagCard({
  rag,
  currentUserId,
  onOpenChat,
  onDelete,
}: {
  rag: Rag;
  currentUserId?: string;
  onOpenChat: () => void;
  onDelete: () => void;
}) {
  const role = rag.role ?? (rag.owner_id === currentUserId ? "owner" : "none");
  const canManage = role === "owner" || role === "admin";
  const isGuest = role === "member";

  return (
    <Card className="group/card relative transition-shadow hover:shadow-md">
      <Link
        href={`/rags/${rag.id}`}
        className="absolute inset-0 z-0"
        aria-label={`Открыть базу ${rag.name}`}
      />
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="line-clamp-2" title={rag.name}>
            {rag.name}
          </CardTitle>
          <RagStatusBadge status={rag.status} />
        </div>
        <CardDescription className="line-clamp-2 min-h-[2.5rem]">
          {rag.description || "Без описания"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {isGuest && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {rag.member_status === "revoked" ? "Доступ отозван" : "Гостевой доступ"}
          </span>
        )}
        {role === "admin" && rag.owner_id !== currentUserId && (
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" /> Просмотр как админ
          </span>
        )}
      </CardContent>
      <CardFooter className="relative z-10 justify-between">
        {rag.status === "ready" ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenChat}
            title="Открыть чат с ассистентом"
          >
            <Bot />
            Чат
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            {rag.status === "failed"
              ? "Ошибка индексации"
              : rag.status === "indexing"
                ? "Индексируется…"
                : "Готовится…"}
          </span>
        )}
        {canManage && (
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onDelete}
            title="Удалить базу"
            aria-label="Удалить базу"
          >
            <Trash2 className="text-muted-foreground" />
          </Button>
        )}
      </CardFooter>
    </Card>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <Card className="items-center py-16 text-center">
      <CardContent className="flex flex-col items-center gap-4">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10">
          <Sparkles className="h-7 w-7 text-primary" />
        </div>
        <div className="space-y-2">
          <h2 className="text-lg font-semibold">Пока ни одной базы знаний</h2>
          <p className="mx-auto max-w-md text-sm text-muted-foreground">
            Создайте первую базу, загрузите документы (PDF, TXT, MD, XLSX) — и
            можно задавать вопросы и проверять документы на противоречия.
          </p>
        </div>
        <Button size="lg" onClick={onCreate}>
          <FileText />
          Создать базу знаний
        </Button>
      </CardContent>
    </Card>
  );
}

function CreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const upsertRag = useAppStore((s) => s.upsertRag);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [ftsLanguage, setFtsLanguage] = useState("simple");
  const [presetId, setPresetId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    void ragsApi
      .listPresets()
      .then((p) => {
        setPresets(p);
        if (p.length > 0) setPresetId((cur) => cur || p[0].id);
      })
      .catch(() => {
        /* presets are optional */
      });
  }, [open]);

  const selectedPreset = presets.find((p) => p.id === presetId) ?? null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      const created = await ragsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        fts_language: ftsLanguage,
        preset: presetId || undefined,
      });
      upsertRag(created);
      toast.success(`База «${created.name}» создана`);
      setName("");
      setDescription("");
      setFtsLanguage("simple");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось создать базу");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Новая база знаний</DialogTitle>
          <DialogDescription>
            Набор документов с поиском и проверкой на противоречия.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="rag-name">Название</Label>
            <Input
              id="rag-name"
              placeholder="Например: Нормативная база 2026"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rag-desc">Описание (необязательно)</Label>
            <Textarea
              id="rag-desc"
              placeholder="Какие документы входят в базу и для чего она нужна"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rag-lang">Язык документов</Label>
            <NativeSelect
              id="rag-lang"
              value={ftsLanguage}
              onChange={(e) => setFtsLanguage(e.target.value)}
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Влияет на текстовый поиск. Задаётся один раз при создании.
            </p>
          </div>
          {presets.length > 0 && (
            <div className="space-y-1.5">
              <Label htmlFor="rag-preset">Профиль обработки</Label>
              <NativeSelect
                id="rag-preset"
                value={presetId}
                onChange={(e) => setPresetId(e.target.value)}
              >
                {presets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
              {selectedPreset && (
                <p className="text-xs text-muted-foreground">
                  {selectedPreset.description}
                </p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={busy || !name.trim()}>
              {busy && <Loader2 className="animate-spin" />}
              {busy ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
