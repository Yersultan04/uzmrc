"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authApi } from "@/lib/api";
import { saveToken, saveUser } from "@/lib/auth";
import { useAppStore } from "@/lib/store";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const setUser = useAppStore((s) => s.setUser);
  const login = useAppStore((s) => s.login);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  // When no users exist yet, the backend opens a one-shot bootstrap-admin form.
  const [bootstrap, setBootstrap] = useState(false);

  useEffect(() => {
    authApi
      .registrationStatus()
      .then((s) => setBootstrap(s.open))
      .catch(() => setBootstrap(false));
  }, []);

  function destination(role: string): string {
    const redirect = params.get("redirect");
    // Only allow same-site, absolute-path redirects. Reject protocol-relative
    // ("//evil.com") and backslash variants ("/\evil.com") that browsers treat
    // as off-site — otherwise this is an open redirect.
    if (
      redirect &&
      redirect.startsWith("/") &&
      !redirect.startsWith("//") &&
      !redirect.startsWith("/\\")
    ) {
      return redirect;
    }
    return role === "admin" ? "/admin/users" : "/";
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (bootstrap) {
        // One-shot creation of the first admin.
        const tokens = await authApi.register(email, password);
        saveToken(tokens.access_token);
        saveUser(tokens.user);
        setUser(tokens.user);
        toast.success("Учётная запись администратора создана");
        router.replace(destination(tokens.user.role));
      } else {
        const user = await login(email, password);
        toast.success("С возвращением");
        router.replace(destination(user.role));
      }
    } catch {
      toast.error(
        bootstrap ? "Не удалось создать учётную запись" : "Неверный e-mail или пароль",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className="min-h-screen flex"
      style={{
        background: "linear-gradient(135deg, #f0f9eb 0%, #f8fff6 50%, #eef7f2 100%)",
      }}
    >
      {/* Left decorative panel */}
      <div
        className="hidden lg:flex flex-col justify-between w-96 p-10 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(160deg, var(--brand-600) 0%, var(--brand-700) 60%, #1a3a10 100%)",
        }}
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(circle at 20% 20%, white 1px, transparent 1px), radial-gradient(circle at 80% 80%, white 1px, transparent 1px)",
            backgroundSize: "48px 48px",
          }}
        />
        <div
          className="absolute -bottom-20 -left-20 w-64 h-64 rounded-full opacity-10 pointer-events-none"
          style={{ background: "white" }}
        />
        <div
          className="absolute top-1/3 -right-12 w-48 h-48 rounded-full opacity-10 pointer-events-none"
          style={{ background: "white" }}
        />

        <div className="relative z-10 flex items-center gap-3">
          <svg width="40" height="40" viewBox="0 0 32 32" fill="none" aria-label="UzMRC">
            <rect width="32" height="32" rx="8" fill="rgba(255,255,255,0.16)" />
            <path
              d="M11 9v8.2c0 2.7 2.2 4.8 5 4.8s5-2.1 5-4.8V9"
              stroke="#fff"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <circle cx="16" cy="9" r="1.6" fill="#fff" />
          </svg>
          <span
            className="text-2xl font-bold tracking-tight"
            style={{ color: "#fff" }}
          >
            UzMRC
          </span>
        </div>

        <div className="relative z-10">
          <h2
            className="text-2xl font-bold mb-3 leading-snug"
            style={{ color: "rgba(255,255,255,0.95)" }}
          >
            Нормативный AI-ассистент
          </h2>
          <p style={{ color: "rgba(255,255,255,0.6)", fontSize: 14, lineHeight: 1.6 }}>
            Поиск, цитирование и сверка нормативной базы Узбекской ипотечной
            рефинансовой компании.
          </p>
          <div
            className="flex items-center gap-2 mt-6 text-sm font-medium"
            style={{ color: "rgba(255,255,255,0.5)" }}
          >
            <ShieldCheck size={15} />
            Доступ только для авторизованных сотрудников
          </div>
        </div>
      </div>

      {/* Right form area */}
      <div className="flex-1 flex items-center justify-center px-6">
        <div className="w-full max-w-sm animate-fade-up">
          <div className="lg:hidden flex items-center justify-center gap-2.5 mb-8">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/uzmrc-mark.svg" alt="UzMRC" style={{ height: 34, width: 34 }} />
            <span
              className="text-xl font-bold tracking-tight"
              style={{ color: "#127A41" }}
            >
              UzMRC
            </span>
          </div>

          <div className="mb-7">
            <h1
              className="text-2xl font-bold mb-1"
              style={{ color: "#1a2e14", letterSpacing: "-0.02em" }}
            >
              {bootstrap ? "Создание администратора" : "Вход в систему"}
            </h1>
            <p style={{ color: "#86a87a", fontSize: 14 }}>
              {bootstrap
                ? "Создайте первую учётную запись администратора"
                : "Войдите в свою учётную запись"}
            </p>
          </div>

          <div
            className="rounded-2xl p-7"
            style={{
              background: "white",
              boxShadow: "0 8px 40px rgba(0,0,0,0.08), 0 2px 8px rgba(0,0,0,0.04)",
              border: "1px solid rgba(82,174,48,0.1)",
            }}
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-xs font-semibold" style={{ color: "#4a6a40" }}>
                  E-mail
                </Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="user@uzmrc.uz"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  autoFocus
                  className="h-10 text-sm"
                  style={{ border: "1.5px solid #dde8d8", borderRadius: 10, color: "#1a2e14" }}
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password" className="text-xs font-semibold" style={{ color: "#4a6a40" }}>
                  Пароль
                </Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={bootstrap ? 8 : 1}
                  className="h-10 text-sm"
                  style={{ border: "1.5px solid #dde8d8", borderRadius: 10, color: "#1a2e14" }}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full h-11 flex items-center justify-center gap-2.5 rounded-xl font-semibold text-sm text-white transition-all mt-1"
                style={{
                  background: loading
                    ? "var(--brand-300)"
                    : "linear-gradient(135deg, var(--brand-500), var(--brand-600))",
                  boxShadow: loading ? "none" : "0 4px 20px rgba(82,174,48,0.3)",
                  cursor: loading ? "not-allowed" : "pointer",
                }}
              >
                {loading ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <>
                    {bootstrap ? "Создать" : "Войти"}
                    <ArrowRight size={15} />
                  </>
                )}
              </button>
            </form>
          </div>

          <p className="text-center mt-5 text-xs" style={{ color: "#a8c0a0" }}>
            Защищённая внутренняя система · Только для сотрудников
          </p>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
