"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Users, LayoutDashboard, MessageSquare, LogOut, RefreshCw, FileText, FlaskConical, GraduationCap } from "lucide-react";
import { useChatStore } from "@/lib/store";
import { authApi } from "@/lib/api";
import { clearAuth, isAuthenticated } from "@/lib/auth";

const navItems = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/agents/hr_agent/documents", label: "HR Documents", icon: FileText },
  { href: "/admin/agents/front_office_agent/documents", label: "Front Office Docs", icon: FileText },
  { href: "/admin/agents/cashier_agent/documents", label: "Cashier Docs", icon: FileText },
  { href: "/admin/cashier", label: "Cashier Tests", icon: GraduationCap },
  { href: "/admin/confluence-sync", label: "Confluence Sync", icon: RefreshCw },
  { href: "/admin/eval", label: "Evaluations", icon: FlaskConical },
  { href: "/chat", label: "Chat", icon: MessageSquare },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, setUser } = useChatStore();

  useEffect(() => {
    if (!isAuthenticated()) {
      clearAuth();
      document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      router.replace("/login");
      return;
    }
    authApi.me().then((u) => {
      setUser(u);
      if (u.role !== "admin") router.replace("/chat");
    }).catch(() => {
      clearAuth();
      document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
      router.replace("/login");
    });
  }, []);

  function logout() {
    clearAuth();
    document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  return (
    <div className="admin-light flex h-screen overflow-hidden bg-gray-50">
      {/* Sidebar */}
      <div
        className="flex flex-col w-56 shrink-0 bg-white"
        style={{ borderRight: "1px solid #f3f4f6" }}
      >
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: "1px solid #f3f4f6" }}>
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: "var(--brand-500)" }}
            >
              <LayoutDashboard size={15} color="white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Bank AI</p>
              <p className="text-xs text-gray-400">Admin Panel</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href ||
              (href !== "/admin" && href !== "/chat" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all"
                style={{
                  background: active ? "var(--brand-50)" : "transparent",
                  color: active ? "var(--brand-700)" : "#6b7280",
                  fontWeight: active ? 600 : 400,
                  border: active ? "1px solid var(--brand-100)" : "1px solid transparent",
                }}
                onMouseEnter={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.background = "#f9fafb";
                    (e.currentTarget as HTMLAnchorElement).style.color = "#374151";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!active) {
                    (e.currentTarget as HTMLAnchorElement).style.background = "transparent";
                    (e.currentTarget as HTMLAnchorElement).style.color = "#6b7280";
                  }
                }}
              >
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        <div className="px-4 py-4" style={{ borderTop: "1px solid #f3f4f6" }}>
          {user && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white"
                  style={{ background: "var(--brand-500)" }}
                >
                  {user.full_name.charAt(0)}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-900">{user.full_name}</p>
                  <p className="text-xs text-gray-400">Admin</p>
                </div>
              </div>
              <button
                onClick={logout}
                className="text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg p-1 transition-colors"
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 overflow-y-auto bg-gray-50 p-8">
        {children}
      </main>
    </div>
  );
}
