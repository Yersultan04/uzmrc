"use client";

// Админ: управление пользователями. authApi.listUsers/createUser/updateUser/
// deleteUser. Доступ только для роли admin (иначе мягкая заглушка).

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  KeyRound,
  Loader2,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
  UserCog,
  UserMinus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { authApi } from "@/lib/api";
import { useAppStore } from "@/lib/store";
import type { User, UserRole } from "@/lib/types";
import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { NativeSelect } from "@/components/ui/native-select";

export default function AdminUsersPage() {
  return (
    <AppShell>
      <AdminUsers />
    </AppShell>
  );
}

function AdminUsers() {
  const currentUser = useAppStore((s) => s.user);
  const authReady = useAppStore((s) => s.authReady);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const isAdmin = currentUser?.role === "admin";

  const refresh = useCallback(async () => {
    try {
      setUsers(await authApi.listUsers());
    } catch (e) {
      toast.error((e as Error).message || "Не удалось загрузить пользователей");
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch-on-mount: refresh() only updates state after an await (asynchronous),
  // so the cascading-render rule is a false positive here.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (isAdmin) void refresh();
  }, [isAdmin, refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.is_active).length,
      admins: users.filter((u) => u.role === "admin").length,
    }),
    [users],
  );

  if (authReady && !isAdmin) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 py-8 text-sm text-destructive">
          <ShieldAlert className="h-4 w-4" /> Раздел доступен только
          администраторам.
        </CardContent>
      </Card>
    );
  }

  async function onToggleActive(u: User) {
    try {
      await authApi.updateUser(u.id, { is_active: !u.is_active });
      toast.success(u.is_active ? `${u.email} заблокирован` : `${u.email} разблокирован`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Ошибка");
    }
  }

  async function onToggleRole(u: User) {
    const next: UserRole = u.role === "admin" ? "user" : "admin";
    if (!confirm(`Изменить роль ${u.email} на «${roleLabel(next)}»?`)) return;
    try {
      await authApi.updateUser(u.id, { role: next });
      toast.success(`Роль ${u.email} → ${roleLabel(next)}`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Ошибка");
    }
  }

  async function onResetPassword(u: User) {
    const pwd = prompt(`Новый пароль для ${u.email} (минимум 8 символов):`);
    if (!pwd || pwd.length < 8) {
      if (pwd !== null) toast.error("Пароль слишком короткий");
      return;
    }
    try {
      await authApi.updateUser(u.id, { password: pwd });
      toast.success("Пароль обновлён");
    } catch (e) {
      toast.error((e as Error).message || "Ошибка");
    }
  }

  async function onDelete(u: User) {
    if (
      !confirm(
        `Удалить ${u.email}? Все базы знаний пользователя будут удалены.`,
      )
    )
      return;
    try {
      await authApi.deleteUser(u.id);
      toast.success(`${u.email} удалён`);
      await refresh();
    } catch (e) {
      toast.error((e as Error).message || "Ошибка");
    }
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-up">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">Пользователи</h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Учётные записи создают только администраторы. Публичная регистрация
            закрыта.
          </p>
        </div>
        <Button size="lg" onClick={() => setCreateOpen(true)}>
          <Plus />
          Добавить пользователя
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <KpiCell label="Всего" value={counts.total} />
        <KpiCell label="Активны" value={counts.active} tone="ok" />
        <KpiCell label="Администраторов" value={counts.admins} tone="info" />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-10 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
        </div>
      ) : (
        <Card className="overflow-x-auto py-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">E-mail</th>
                <th className="px-4 py-2.5 font-medium">Роль</th>
                <th className="px-4 py-2.5 font-medium">Статус</th>
                <th className="px-4 py-2.5 font-medium">Создан</th>
                <th className="px-4 py-2.5 text-right font-medium">Действия</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isMe = u.id === currentUser?.id;
                return (
                  <tr
                    key={u.id}
                    className="border-b border-border/60 last:border-0"
                  >
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{u.email}</span>
                        {isMe && <Badge variant="secondary">вы</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      {u.role === "admin" ? (
                        <Badge>
                          <ShieldCheck /> Администратор
                        </Badge>
                      ) : (
                        <Badge variant="outline">Сотрудник</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      {u.is_active ? (
                        <Badge variant="secondary">Активен</Badge>
                      ) : (
                        <Badge variant="destructive">Заблокирован</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-muted-foreground">
                      {fmtDateTime(u.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Сменить пароль"
                          onClick={() => onResetPassword(u)}
                        >
                          <KeyRound className="text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={
                            u.role === "admin"
                              ? "Снять права администратора"
                              : "Сделать администратором"
                          }
                          onClick={() => onToggleRole(u)}
                        >
                          <UserCog className="text-muted-foreground" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={u.is_active ? "Заблокировать" : "Разблокировать"}
                          onClick={() => onToggleActive(u)}
                        >
                          <UserMinus className="text-muted-foreground" />
                        </Button>
                        {!isMe && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title="Удалить"
                            onClick={() => onDelete(u)}
                          >
                            <Trash2 className="text-muted-foreground" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={() => void refresh()}
      />
    </div>
  );
}

function KpiCell({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "ok" | "info";
}) {
  const toneClass =
    tone === "ok"
      ? "text-emerald-600 dark:text-emerald-400"
      : tone === "info"
        ? "text-blue-600 dark:text-blue-400"
        : "text-foreground";
  return (
    <Card size="sm">
      <CardContent>
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className={`text-2xl font-bold ${toneClass}`}>{value}</div>
      </CardContent>
    </Card>
  );
}

function CreateUserDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<UserRole>("user");
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return;
    setBusy(true);
    try {
      const u = await authApi.createUser(email.trim(), password, role);
      toast.success(`Пользователь ${u.email} создан (${roleLabel(u.role)})`);
      setEmail("");
      setPassword("");
      setRole("user");
      onOpenChange(false);
      onCreated();
    } catch (e) {
      toast.error((e as Error).message || "Не удалось создать пользователя");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-4 w-4" /> Новый пользователь
          </DialogTitle>
          <DialogDescription>
            Выдайте временный пароль — пользователь сможет сменить его позже.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="u-email">E-mail</Label>
            <Input
              id="u-email"
              type="email"
              placeholder="user@uzmrc.uz"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-pwd">Временный пароль</Label>
            <Input
              id="u-pwd"
              type="text"
              placeholder="минимум 8 символов"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="u-role">Роль</Label>
            <NativeSelect
              id="u-role"
              value={role}
              onChange={(e) => setRole(e.target.value as UserRole)}
            >
              <option value="user">Сотрудник</option>
              <option value="admin">Администратор</option>
            </NativeSelect>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Отмена
            </Button>
            <Button
              type="submit"
              disabled={busy || !email.trim() || password.length < 8}
            >
              {busy && <Loader2 className="animate-spin" />}
              {busy ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function roleLabel(role: UserRole): string {
  return role === "admin" ? "Администратор" : "Сотрудник";
}

function fmtDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString("ru-RU");
  } catch {
    return iso;
  }
}
