"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Building2,
  LogOut,
  Settings,
  BookOpen,
  Shield,
  Zap,
  CheckCircle2,
  ArrowRight,
  HelpCircle,
  Search,
  FileText,
  AlertCircle,
  MessageCircle,
  ThumbsUp,
  ThumbsDown,
  RotateCcw,
  Copy,
  Pencil,
  Send,
  Square,
  ChevronDown,
  MousePointer2,
  GraduationCap,
} from "lucide-react";
import { useChatStore, type Lang } from "@/lib/store";
import { useT, translations } from "@/lib/i18n";
import { clearAuth } from "@/lib/auth";

type AgentMeta = {
  icon: React.ElementType;
  accentColor: string;
  bgGradient: string;
  borderColor: string;
  iconBg: string;
};

const AGENT_META: Record<string, AgentMeta> = {
  hr_agent: {
    icon: Users,
    accentColor: "#0d9488",
    bgGradient: "linear-gradient(135deg, #f0fdfa 0%, #ccfbf1 100%)",
    borderColor: "#5eead4",
    iconBg: "linear-gradient(135deg, #0d9488, #0f766e)",
  },
  front_office_agent: {
    icon: Building2,
    accentColor: "#3d7a2a",
    bgGradient: "linear-gradient(135deg, #f0f9eb 0%, #dcfce7 100%)",
    borderColor: "#86efac",
    iconBg: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
  },
  cashier_agent: {
    icon: GraduationCap,
    accentColor: "#b45309",
    bgGradient: "linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)",
    borderColor: "#fcd34d",
    iconBg: "linear-gradient(135deg, #f59e0b, #b45309)",
  },
};

const LANG_LABELS: Record<Lang, string> = { uz: "UZ", ru: "RU", en: "EN" };

export default function HomePage() {
  const router = useRouter();
  const t = useT();
  const user = useChatStore((s) => s.user);
  const threads = useChatStore((s) => s.threads);
  const ragAgents = useChatStore((s) => s.ragAgents);
  const lang = useChatStore((s) => s.lang);
  const setLang = useChatStore((s) => s.setLang);
  const setUser = useChatStore((s) => s.setUser);
  const [activeTab, setActiveTab] = useState<"agents" | "docs">("agents");

  function handleLogout() {
    clearAuth();
    setUser(null);
    document.cookie = "access_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    router.push("/login");
  }

  const displayAgents =
    ragAgents.length > 0
      ? ragAgents
      : [
          { id: "hr_agent", label: "HR Agent", description: "HR policies, contracts, employee data" },
          { id: "front_office_agent", label: "Front Office Agent", description: "Customer products, loan rates, account info" },
          { id: "cashier_agent", label: "Kassir / Кассир / Cashier", description: "Currency exchange, AML/KYC, cash procedures, staff testing" },
        ];

  function getCapabilities(agentId: string): string[] {
    if (agentId === "hr_agent") return translations[lang].hrCapabilities as unknown as string[];
    if (agentId === "front_office_agent") return translations[lang].foCapabilities as unknown as string[];
    if (agentId === "cashier_agent") return (translations[lang] as Record<string, unknown>).cashierCapabilities as string[] ?? [];
    return [];
  }

  return (
    <div
      className="min-h-screen flex flex-col relative overflow-hidden"
      style={{ background: "linear-gradient(135deg, #f0f9eb 0%, #f8fff6 50%, #eef7f2 100%)" }}
    >
      {/* Animated background orbs */}
      <div
        className="absolute pointer-events-none"
        style={{
          top: "-80px", left: "-100px",
          width: "420px", height: "420px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(82,174,48,0.18) 0%, transparent 70%)",
          filter: "blur(60px)",
          animation: "orb-drift 18s ease-in-out infinite",
          zIndex: 0,
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          top: "30%", right: "-80px",
          width: "340px", height: "340px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(13,148,136,0.13) 0%, transparent 70%)",
          filter: "blur(50px)",
          animation: "orb-drift 22s ease-in-out infinite reverse",
          animationDelay: "-7s",
          zIndex: 0,
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          bottom: "-60px", left: "40%",
          width: "300px", height: "300px",
          borderRadius: "50%",
          background: "radial-gradient(circle, rgba(245,158,11,0.10) 0%, transparent 70%)",
          filter: "blur(55px)",
          animation: "orb-drift 26s ease-in-out infinite",
          animationDelay: "-14s",
          zIndex: 0,
        }}
      />
      {/* Navbar */}
      <header
        className="flex items-center justify-between px-6 py-3 sticky top-0 z-20"
        style={{
          background: "rgba(255,255,255,0.85)",
          backdropFilter: "blur(12px)",
          borderBottom: "1px solid rgba(82,174,48,0.12)",
          boxShadow: "0 1px 12px rgba(0,0,0,0.06)",
        }}
      >
        <img src="/ipoteka-logo.png" alt="Ipoteka Bank" style={{ height: 36, width: "auto" }} />

        <div className="flex items-center gap-2">
          {/* Language switcher */}
          <div
            className="flex rounded-lg p-0.5 gap-0.5"
            style={{ background: "#f3f4f6", border: "1px solid #e5e7eb" }}
          >
            {(["uz", "ru", "en"] as Lang[]).map((l) => (
              <button
                key={l}
                onClick={() => setLang(l)}
                className="px-2.5 py-1 rounded-md text-xs font-semibold transition-all"
                style={
                  lang === l
                    ? {
                        background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))",
                        color: "white",
                        boxShadow: "0 1px 4px rgba(82,174,48,0.25)",
                      }
                    : { color: "#6b7280", background: "transparent" }
                }
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>

          {user?.role === "admin" && (
            <button
              onClick={() => router.push("/admin")}
              className="flex items-center gap-1.5 text-xs font-medium rounded-lg px-3 py-1.5 transition-all"
              style={{ color: "#6b7280", border: "1px solid #e5e7eb", background: "white" }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "var(--brand-700)";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--brand-300)";
                (e.currentTarget as HTMLButtonElement).style.background = "var(--brand-50)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLButtonElement).style.color = "#6b7280";
                (e.currentTarget as HTMLButtonElement).style.borderColor = "#e5e7eb";
                (e.currentTarget as HTMLButtonElement).style.background = "white";
              }}
            >
              <Settings size={13} />
              {t.admin}
            </button>
          )}

          {user && (
            <div className="flex items-center gap-2.5">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))" }}
              >
                {user.full_name.charAt(0).toUpperCase()}
              </div>
              <div className="hidden sm:block text-right">
                <p className="text-xs font-semibold leading-tight" style={{ color: "#1a2e14" }}>
                  {user.full_name}
                </p>
                <p className="capitalize" style={{ fontSize: 10, color: "#86a87a" }}>
                  {user.role}
                </p>
              </div>
              <button
                onClick={handleLogout}
                className="rounded-lg p-1.5 transition-colors"
                style={{ color: "#a0b49a" }}
                onMouseEnter={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#374151";
                  (e.currentTarget as HTMLButtonElement).style.background = "#f3f4f6";
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLButtonElement).style.color = "#a0b49a";
                  (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                }}
                title={t.signOut}
              >
                <LogOut size={14} />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Hero */}
      <div className="text-center pt-14 pb-10 px-4 relative">
        <div className="inline-flex items-center gap-1.5 mb-5">
          <span
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold"
            style={{
              background: "rgba(82,174,48,0.10)",
              color: "var(--brand-700)",
              border: "1px solid rgba(82,174,48,0.20)",
              letterSpacing: "0.01em",
            }}
          >
            ✦ {displayAgents.length} {t.tabAgents}
          </span>
        </div>
        {user && (
          <p className="text-sm font-medium mb-2" style={{ color: "#7aaa6a" }}>
            {t.heroGreeting},{" "}
            <span style={{ color: "#2d6a1f", fontWeight: 700 }}>{user.full_name}</span>!
          </p>
        )}
        <h1
          className="text-4xl font-bold mb-3 leading-tight"
          style={{
            background: "linear-gradient(135deg, #1a2e14 0%, var(--brand-600) 50%, #0d9488 100%)",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent",
            backgroundClip: "text",
            color: "transparent",
            letterSpacing: "-0.025em",
          }}
        >
          {t.heroTitle}
        </h1>
        <p style={{ color: "#7aaa6a", fontSize: 15 }}>{t.heroSubtitle}</p>
      </div>

      {/* Tabs */}
      <div className="flex justify-center mb-8 px-4">
        <div
          className="flex rounded-xl p-1 gap-1"
          style={{ background: "rgba(255,255,255,0.7)", border: "1px solid rgba(82,174,48,0.15)", boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}
        >
          {[
            { id: "agents", label: t.tabAgents, icon: Zap },
            { id: "docs", label: t.tabDocs, icon: BookOpen },
          ].map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id as "agents" | "docs")}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-semibold transition-all"
              style={
                activeTab === id
                  ? { background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))", color: "white", boxShadow: "0 2px 12px rgba(82,174,48,0.3)" }
                  : { color: "#6b7280", background: "transparent" }
              }
            >
              <Icon size={14} />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-6xl w-full mx-auto px-4 pb-16">
        {activeTab === "agents" && (
          <div>
            <p className="text-center text-sm mb-8" style={{ color: "#9ca3af" }}>
              {t.agentsSubtitle}
            </p>

            {/* Uniform 4-column grid — all agents */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {displayAgents.map((agent) => {
                const meta = AGENT_META[agent.id] ?? {
                  icon: MessageCircle,
                  accentColor: "var(--brand-600)",
                  bgGradient: "linear-gradient(135deg, var(--brand-50), #dcfce7)",
                  borderColor: "var(--brand-200)",
                  iconBg: "linear-gradient(135deg, var(--brand-500), var(--brand-700))",
                };
                const Icon = meta.icon;
                const agentThreadCount = threads.filter((th) => th.active_agent_id === agent.id).length;
                const caps = getCapabilities(agent.id);
                return (
                  <button
                    key={agent.id}
                    onClick={() => router.push(`/chat?agent=${agent.id}`)}
                    className="text-left rounded-2xl overflow-hidden transition-all flex flex-col"
                    style={{
                      background: "rgba(255,255,255,0.65)",
                      backdropFilter: "blur(20px)",
                      WebkitBackdropFilter: "blur(20px)",
                      border: "1px solid rgba(255,255,255,0.85)",
                      boxShadow: "0 4px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)",
                      transitionProperty: "transform, box-shadow, border-color",
                      transitionDuration: "220ms",
                      transitionTimingFunction: "ease-out",
                    }}
                    onMouseEnter={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.transform = "translateY(-4px)";
                      el.style.boxShadow = `0 16px 48px rgba(0,0,0,0.11), 0 3px 10px ${meta.accentColor}20, inset 0 1px 0 rgba(255,255,255,0.95)`;
                      el.style.borderColor = "rgba(255,255,255,0.95)";
                    }}
                    onMouseLeave={(e) => {
                      const el = e.currentTarget as HTMLButtonElement;
                      el.style.transform = "translateY(0)";
                      el.style.boxShadow = "0 4px 24px rgba(0,0,0,0.07), inset 0 1px 0 rgba(255,255,255,0.9)";
                      el.style.borderColor = "rgba(255,255,255,0.85)";
                    }}
                  >
                    {/* Accent strip */}
                    <div style={{ height: "3px", background: `linear-gradient(90deg, ${meta.accentColor}, ${meta.borderColor})` }} />

                    <div className="p-5 flex flex-col flex-1">
                      <div className="flex justify-between items-start mb-4">
                        <div className="relative">
                          <div
                            className="absolute inset-0 rounded-xl"
                            style={{ background: meta.accentColor, opacity: 0.15, filter: "blur(10px)", transform: "scale(1.25)" }}
                          />
                          <div
                            className="relative w-12 h-12 rounded-xl flex items-center justify-center"
                            style={{ background: meta.iconBg, boxShadow: "0 4px 16px rgba(0,0,0,0.15)" }}
                          >
                            <Icon size={20} color="white" />
                          </div>
                        </div>
                        {agentThreadCount > 0 && (
                          <span
                            className="text-xs font-semibold px-2 py-0.5 rounded-full"
                            style={{
                              background: `${meta.accentColor}18`,
                              color: meta.accentColor,
                              border: `1px solid ${meta.accentColor}35`,
                            }}
                          >
                            {agentThreadCount} {agentThreadCount === 1 ? t.chatSingle : t.chats}
                          </span>
                        )}
                      </div>

                      <h2 className="text-base font-bold mb-1.5" style={{ color: "#1a2e14" }}>{agent.label}</h2>
                      <p className="text-xs mb-4 leading-relaxed" style={{ color: "#6b7280" }}>{agent.description}</p>

                      {caps.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mb-4">
                          {caps.slice(0, 3).map((cap) => (
                            <span
                              key={cap}
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{
                                background: `${meta.accentColor}12`,
                                color: meta.accentColor,
                                border: `1px solid ${meta.accentColor}28`,
                              }}
                            >
                              {cap}
                            </span>
                          ))}
                          {caps.length > 3 && (
                            <span
                              className="text-xs px-2 py-0.5 rounded-full font-medium"
                              style={{ background: "#f3f4f6", color: "#9ca3af", border: "1px solid #e5e7eb" }}
                            >
                              +{caps.length - 3}
                            </span>
                          )}
                        </div>
                      )}

                      <div className="mt-auto flex items-center gap-1.5 text-xs font-bold" style={{ color: meta.accentColor }}>
                        {agentThreadCount > 0 ? t.ctaContinue : t.ctaStart}
                        <ArrowRight size={12} />
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === "docs" && (
          <div className="max-w-3xl mx-auto space-y-8">
            {/* Overview */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #e8f0e5", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))" }}>
                  <HelpCircle size={18} color="white" />
                </div>
                <h2 className="text-base font-bold" style={{ color: "#1a2e14" }}>{t.docsWhat}</h2>
              </div>
              <p className="text-sm leading-relaxed" style={{ color: "#4b5563" }}>{t.docsWhatBody}</p>
            </div>

            {/* Getting started */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #e8f0e5", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}>
                  <Zap size={18} color="white" />
                </div>
                <h2 className="text-base font-bold" style={{ color: "#1a2e14" }}>{t.docsStart}</h2>
              </div>
              <ol className="space-y-4">
                {t.docsSteps.map((step, i) => (
                  <li key={i} className="flex gap-4">
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5 text-white"
                      style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))" }}
                    >
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-semibold mb-0.5" style={{ color: "#1a2e14" }}>{step.title}</p>
                      <p className="text-sm" style={{ color: "#6b7280", lineHeight: 1.5 }}>{step.desc}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            {/* Agent capabilities */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #f0fdfa, #ccfbf1)", border: "1px solid #5eead4", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0d9488, #0f766e)" }}>
                    <Users size={15} color="white" />
                  </div>
                  <h3 className="text-sm font-bold" style={{ color: "#0f766e" }}>HR Agent</h3>
                </div>
                <ul className="space-y-1.5">
                  {translations[lang].hrCapabilities.map((cap: string) => (
                    <li key={cap} className="flex items-center gap-2 text-xs" style={{ color: "#374151" }}>
                      <CheckCircle2 size={11} style={{ color: "#0d9488", flexShrink: 0 }} />
                      {cap}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-2xl p-5" style={{ background: "linear-gradient(135deg, #f0f9eb, #dcfce7)", border: "1px solid #86efac", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-700))" }}>
                    <Building2 size={15} color="white" />
                  </div>
                  <h3 className="text-sm font-bold" style={{ color: "var(--brand-700)" }}>Front Office Agent</h3>
                </div>
                <ul className="space-y-1.5">
                  {translations[lang].foCapabilities.map((cap: string) => (
                    <li key={cap} className="flex items-center gap-2 text-xs" style={{ color: "#374151" }}>
                      <CheckCircle2 size={11} style={{ color: "var(--brand-500)", flexShrink: 0 }} />
                      {cap}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Tips */}
            <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #e8f0e5", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
                  <FileText size={18} color="white" />
                </div>
                <h2 className="text-base font-bold" style={{ color: "#1a2e14" }}>{t.docsTips}</h2>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {t.docsTipsList.map((tip, i) => {
                  const icons = [Search, MessageCircle, FileText, Zap];
                  const Icon = icons[i % icons.length];
                  return (
                    <div key={i} className="flex gap-2.5 p-3 rounded-xl" style={{ background: "#fafafa", border: "1px solid #f0f0f0" }}>
                      <Icon size={14} style={{ color: "var(--brand-500)", flexShrink: 0, marginTop: 2 }} />
                      <p className="text-xs leading-relaxed" style={{ color: "#4b5563" }}>{tip}</p>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Icons guide */}
            {(() => {
              const ICON_MAP: Record<string, React.ElementType> = {
                ThumbsUp, ThumbsDown, RotateCcw, Copy, Pencil, Send, Square, ChevronDown,
              };
              const ICON_COLOR: Record<string, { bg: string; color: string }> = {
                ThumbsUp:    { bg: "#dcfce7", color: "#16a34a" },
                ThumbsDown:  { bg: "#fee2e2", color: "#dc2626" },
                RotateCcw:   { bg: "#dbeafe", color: "#2563eb" },
                Copy:        { bg: "#f3f4f6", color: "#6b7280" },
                Pencil:      { bg: "#fef3c7", color: "#d97706" },
                Send:        { bg: "var(--brand-50)", color: "var(--brand-600)" },
                Square:      { bg: "#fee2e2", color: "#dc2626" },
                ChevronDown: { bg: "#f3f4f6", color: "#6b7280" },
              };
              const groups = [
                { key: "ai",    label: t.docsIconsAiLabel },
                { key: "user",  label: t.docsIconsUserLabel },
                { key: "input", label: t.docsIconsInputLabel },
                { key: "other", label: t.docsIconsOtherLabel },
              ];
              return (
                <div className="rounded-2xl p-6" style={{ background: "white", border: "1px solid #e8f0e5", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: "linear-gradient(135deg, #7c3aed, #5b21b6)" }}>
                      <MousePointer2 size={18} color="white" />
                    </div>
                    <h2 className="text-base font-bold" style={{ color: "#1a2e14" }}>{t.docsIconsTitle}</h2>
                  </div>

                  <div className="space-y-6">
                    {groups.map(({ key, label }) => {
                      const items = t.docsIcons.filter((ic) => ic.group === key);
                      if (items.length === 0) return null;
                      return (
                        <div key={key}>
                          <p
                            className="text-xs font-semibold uppercase tracking-widest mb-3"
                            style={{ color: "#a8c0a0", letterSpacing: "0.08em" }}
                          >
                            {label}
                          </p>
                          <div className="space-y-2">
                            {items.map((ic) => {
                              const LIcon = ICON_MAP[ic.icon] ?? MessageCircle;
                              const style = ICON_COLOR[ic.icon] ?? { bg: "#f3f4f6", color: "#6b7280" };
                              return (
                                <div
                                  key={ic.icon}
                                  className="flex items-start gap-3 p-3 rounded-xl"
                                  style={{ background: "#fafafa", border: "1px solid #f0f0f0" }}
                                >
                                  <div
                                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
                                    style={{ background: style.bg }}
                                  >
                                    <LIcon size={15} style={{ color: style.color }} />
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-semibold mb-0.5" style={{ color: "#1a2e14" }}>
                                      {ic.name}
                                    </p>
                                    <p className="text-xs leading-relaxed" style={{ color: "#6b7280" }}>
                                      {ic.desc}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Security */}
            <div className="rounded-2xl p-5 flex items-start gap-4" style={{ background: "linear-gradient(135deg, #eff6ff, #dbeafe)", border: "1px solid #93c5fd", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #3b82f6, #1d4ed8)" }}>
                <Shield size={16} color="white" />
              </div>
              <div>
                <h3 className="text-sm font-bold mb-1" style={{ color: "#1e3a8a" }}>{t.docsSecurity}</h3>
                <p className="text-xs leading-relaxed" style={{ color: "#1e40af" }}>{t.docsSecurityBody}</p>
              </div>
            </div>

            {/* Limitations */}
            <div className="rounded-2xl p-5 flex items-start gap-4" style={{ background: "linear-gradient(135deg, #fffbeb, #fef3c7)", border: "1px solid #fcd34d", boxShadow: "0 2px 12px rgba(0,0,0,0.05)" }}>
              <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: "linear-gradient(135deg, #f59e0b, #d97706)" }}>
                <AlertCircle size={16} color="white" />
              </div>
              <div>
                <h3 className="text-sm font-bold mb-1" style={{ color: "#92400e" }}>{t.docsLimits}</h3>
                <p className="text-xs leading-relaxed" style={{ color: "#78350f" }}>{t.docsLimitsBody}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
