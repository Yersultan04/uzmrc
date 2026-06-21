"use client";

// Temporary placeholder shown by Stage-1 route stubs. Real screens are built in
// Stage 2. Hydrates the session so an unauthenticated direct hit bounces to
// /login (middleware is best-effort because the token lives in localStorage).

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Construction } from "lucide-react";

export function StagePlaceholder({
  title,
  todo,
}: {
  title: string;
  todo: string;
}) {
  const router = useRouter();
  const hydrate = useAppStore((s) => s.hydrate);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    void hydrate();
  }, [router, hydrate]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
      <div className="absolute top-4 right-4">
        <ThemeToggle />
      </div>
      <Construction className="h-10 w-10 text-muted-foreground" />
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Каркас готов (этап 1). Экран будет реализован на этапе 2.
      </p>
      <code className="rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
        TODO: {todo}
      </code>
    </main>
  );
}
