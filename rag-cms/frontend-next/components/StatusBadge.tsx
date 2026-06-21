import { Badge } from "@/components/ui/badge";
import type {
  FileStatus,
  IngestStatus,
  RagStatus,
} from "@/lib/types";

type Variant = "default" | "secondary" | "destructive" | "outline" | "ghost";

const RAG_LABEL: Record<RagStatus, { label: string; variant: Variant }> = {
  draft: { label: "Черновик", variant: "outline" },
  indexing: { label: "Индексируется", variant: "secondary" },
  ready: { label: "Готова", variant: "default" },
  failed: { label: "Ошибка", variant: "destructive" },
};

const FILE_LABEL: Record<FileStatus, { label: string; variant: Variant }> = {
  uploaded: { label: "Загружен", variant: "outline" },
  parsing: { label: "Обработка", variant: "secondary" },
  parsed: { label: "Готов", variant: "default" },
  failed: { label: "Ошибка", variant: "destructive" },
};

const INGEST_LABEL: Record<IngestStatus, { label: string; variant: Variant }> = {
  queued: { label: "В очереди", variant: "outline" },
  running: { label: "Выполняется", variant: "secondary" },
  succeeded: { label: "Завершено", variant: "default" },
  failed: { label: "Ошибка", variant: "destructive" },
};

export function RagStatusBadge({ status }: { status: RagStatus }) {
  const cfg = RAG_LABEL[status] ?? { label: status, variant: "outline" as Variant };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function FileStatusBadge({ status }: { status: FileStatus }) {
  const cfg = FILE_LABEL[status] ?? { label: status, variant: "outline" as Variant };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

export function IngestStatusBadge({ status }: { status: IngestStatus }) {
  const cfg = INGEST_LABEL[status] ?? { label: status, variant: "outline" as Variant };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}
