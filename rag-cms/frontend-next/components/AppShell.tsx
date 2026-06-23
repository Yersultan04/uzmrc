"use client";

// Protected application shell: left navigation + topbar (theme toggle + user
// menu). Hydrates the session from the persisted token; bounces to /login when
// unauthenticated. Used by the knowledge-base list, base detail, and admin
// screens. Full-screen surfaces (chat / compare) deliberately do NOT use this
// shell — they render their own layout.

import { useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import {
  Database,
  Info,
  LogOut,
  Users,
} from "lucide-react";
import { isAuthenticated } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
  /** Active when pathname starts with this prefix. */
  match: (pathname: string) => boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Базы знаний",
    icon: Database,
    match: (p) => p === "/" || p.startsWith("/rags"),
  },
  {
    href: "/admin/users",
    label: "Пользователи",
    icon: Users,
    adminOnly: true,
    match: (p) => p.startsWith("/admin/users"),
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrate = useAppStore((s) => s.hydrate);
  const user = useAppStore((s) => s.user);
  const authReady = useAppStore((s) => s.authReady);
  const logout = useAppStore((s) => s.logout);

  // hydrate() syncs the Zustand store from a persisted token (external store).
  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login");
      return;
    }
    void hydrate();
  }, [router, hydrate]);

  const isAdmin = user?.role === "admin";
  const visibleNav = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);

  // While we have no token at all, render nothing (redirect is in flight).
  if (!isAuthenticated()) return null;

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* ---- Sidebar (desktop) ---- */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
        <Link
          href="/"
          className="flex h-16 items-center gap-2.5 border-b border-border px-5"
        >
          <Image
            src="/uzmrc-mark.svg"
            alt="UzMRC"
            width={28}
            height={28}
            className="rounded"
          />
          <div className="flex flex-col leading-tight">
            <span className="text-sm font-bold tracking-tight">UzMRC</span>
            <span className="text-[11px] text-muted-foreground">
              Нормативный ассистент
            </span>
          </div>
        </Link>

        <nav className="flex flex-1 flex-col gap-1 p-3">
          {visibleNav.map((item) => {
            const active = item.match(pathname);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-border p-3">
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 text-xs text-muted-foreground">
            <Info className="h-3.5 w-3.5 shrink-0" />
            Внутренняя система · доступ по приглашению
          </div>
        </div>
      </aside>

      {/* ---- Main column ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-border bg-background/80 px-4 backdrop-blur md:px-6">
          {/* Mobile brand + nav (compact) */}
          <Link href="/" className="flex items-center gap-2 md:hidden">
            <Image
              src="/uzmrc-mark.svg"
              alt="UzMRC"
              width={26}
              height={26}
              className="rounded"
            />
            <span className="text-sm font-bold">UzMRC</span>
          </Link>

          {/* Mobile nav pills */}
          <nav className="flex items-center gap-1 md:hidden">
            {visibleNav.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-label={item.label}
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-lg transition-colors",
                    active
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </Link>
              );
            })}
          </nav>

          <div className="flex-1" />

          <ThemeToggle />

          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button variant="ghost" size="sm" className="gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold uppercase">
                    {(user?.email ?? "?").slice(0, 1)}
                  </span>
                  <span className="hidden max-w-[160px] truncate text-sm sm:inline">
                    {user?.email ?? "…"}
                  </span>
                </Button>
              }
            />
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuGroup>
                <DropdownMenuLabel>
                  <div className="flex flex-col">
                    <span className="truncate text-sm font-medium text-foreground">
                      {user?.email ?? "…"}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {isAdmin ? "Администратор" : "Сотрудник"}
                    </span>
                  </div>
                </DropdownMenuLabel>
              </DropdownMenuGroup>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => logout()}>
                <LogOut className="h-4 w-4" />
                Выйти
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="flex-1 px-4 py-6 md:px-8 md:py-8">
          <div className="mx-auto w-full max-w-6xl">
            {authReady || user ? children : null}
          </div>
        </main>
      </div>
    </div>
  );
}
