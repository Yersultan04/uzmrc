"use client";

// Сверка документа с нормативной базой (Module 2). compareApi.start (202 →
// run_id + stream_token) → sse.compareRun → CompareReport. Логика портирована
// с проверенного на проде frontend/src/pages/RagCompare на наш lib-слой.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { ragsApi } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import type { Rag } from "@/lib/types";
import { CompareUploader } from "@/components/compare/CompareUploader";

export default function RagComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const hydrate = useAppStore((s) => s.hydrate);
  const [rag, setRag] = useState<Rag | null>(null);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    void hydrate();
    let cancelled = false;
    void (async () => {
      try {
        const r = await ragsApi.get(id);
        if (!cancelled) setRag(r);
      } catch {
        /* header just shows … — uploader works regardless */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router, hydrate]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-6 sm:px-8">
      <div>
        <Link
          href={`/rags/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> {rag?.name ?? "Назад к базе"}
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Сверка документа</h1>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Загрузите новый регламент или приказ — система разобьёт его на положения, сопоставит с
          действующими нормами базы и выдаст отчёт: противоречия, дубли, дополнения и пробелы — со
          ссылками на нормы.
        </p>
      </div>

      <CompareUploader ragId={id} />
    </main>
  );
}
