"use client";

// Чат с базой знаний (RAG). Загружает RAG, рендерит ChatWindow (agentApi + sse.agentRun).
// Логика портирована с проверенного на проде frontend/src/pages/RagChat на наш lib-слой.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ragsApi } from "@/lib/api";
import { isAuthenticated } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import type { Rag } from "@/lib/types";
import { ChatWindow } from "@/components/chat/ChatWindow";

export default function RagChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const hydrate = useAppStore((s) => s.hydrate);
  const [rag, setRag] = useState<Rag | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Не удалось загрузить базу");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, router, hydrate]);

  return (
    <main className="flex h-screen flex-col">
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-3 sm:px-8">
        <Link
          href={`/rags/${id}`}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft size={14} /> {rag?.name ?? "…"}
        </Link>
        <h1 className="text-base font-semibold">Чат с ассистентом</h1>
      </header>

      {error ? (
        <div className="p-8 text-sm text-destructive">Ошибка: {error}</div>
      ) : !rag ? (
        <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 size={16} className="animate-spin" /> Загрузка…
        </div>
      ) : (
        <ChatWindow rag={rag} />
      )}
    </main>
  );
}
