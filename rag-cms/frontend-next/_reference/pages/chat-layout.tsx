"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ThreadSidebar } from "@/components/chat/ThreadSidebar";
import { useChatStore } from "@/lib/store";
import { chatApi, authApi } from "@/lib/api";
import { getUser, isAuthenticated } from "@/lib/auth";

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { setThreads, setUser, setRagAgents, loadUserLang } = useChatStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);

  useEffect(() => {
    if (!isAuthenticated()) {
      document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      router.replace("/login");
      return;
    }

    const storedUser = getUser();
    if (storedUser) setUser(storedUser);

    async function load() {
      try {
        const [threadsRes, me] = await Promise.all([chatApi.listThreads(), authApi.me()]);
        setThreads(threadsRes.threads as never[], threadsRes.next_cursor);
        setUser(me);
        loadUserLang(me.id);

        try {
          // const [serversRes, agentsRes] = await Promise.allSettled([
          //   chatApi.getMcpServers(),
          //   chatApi.getRagAgents(),
          // ]);
          // if (serversRes.status === "fulfilled" && Array.isArray(serversRes.value)) {
          //   setMcpServers(serversRes.value);
          //   const disabledIds = serversRes.value
          //     .filter((s: { user_enabled: boolean }) => !s.user_enabled)
          //     .map((s: { id: string }) => s.id);
          //   setDisabledMcpServerIds(disabledIds);
          // }
          const agentsRes = await Promise.allSettled([chatApi.getRagAgents()]);
          const [agentsSettled] = agentsRes;
          if (agentsSettled.status === "fulfilled" && Array.isArray(agentsSettled.value)) {
            setRagAgents(agentsSettled.value);
          }
        } catch {
          // optional endpoints; silently ignore errors
        }
      } catch {
        document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
        router.replace("/login");
      }
    }
    load();
  }, []);

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: "#f7faf6" }}>
      <Suspense fallback={<div style={{ width: 272, minWidth: 272, background: "#f7faf6", borderRight: "1px solid #e8f0e5" }} />}>
        <ThreadSidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((o) => !o)}
        />
      </Suspense>
      <main className="flex-1 overflow-hidden flex flex-col">
        {children}
      </main>
    </div>
  );
}
