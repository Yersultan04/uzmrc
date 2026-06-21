"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { adminApi } from "@/lib/api";
import { UserPlus, Key, UserX, Pencil } from "lucide-react";

interface User {
  id: string;
  email: string;
  full_name: string;
  role: "admin" | "staff";
  is_active: boolean;
  created_at: string;
}

interface Props {
  users: User[];
  onRefresh: () => void;
}

export function UserTable({ users, onRefresh }: Props) {
  const [showCreate, setShowCreate] = useState(false);
  const [showReset, setShowReset] = useState<User | null>(null);
  const [form, setForm] = useState({ email: "", full_name: "", password: "", role: "staff" });
  const [newPassword, setNewPassword] = useState("");
  const [loading, setLoading] = useState(false);

  async function createUser() {
    setLoading(true);
    try {
      await adminApi.createUser(form);
      toast.success("User created");
      setShowCreate(false);
      setForm({ email: "", full_name: "", password: "", role: "staff" });
      onRefresh();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { detail?: string } } }).response?.data?.detail;
      toast.error(msg || "Failed to create user");
    } finally {
      setLoading(false);
    }
  }

  async function deactivate(user: User) {
    if (!confirm(`Deactivate ${user.full_name}?`)) return;
    try {
      await adminApi.deactivateUser(user.id);
      toast.success("User deactivated");
      onRefresh();
    } catch {
      toast.error("Failed");
    }
  }

  async function resetPw() {
    if (!showReset) return;
    setLoading(true);
    try {
      await adminApi.resetPassword(showReset.id, newPassword);
      toast.success("Password reset");
      setShowReset(null);
      setNewPassword("");
    } catch {
      toast.error("Failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-semibold text-slate-800">Staff Users</h2>
        <Button
          onClick={() => setShowCreate(true)}
          className="gap-2 text-white text-sm"
          style={{ backgroundColor: "#006B54" }}
          size="sm"
        >
          <UserPlus size={14} /> Add User
        </Button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">Name</th>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">Email</th>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">Role</th>
              <th className="text-left px-4 py-3 text-slate-600 font-medium">Status</th>
              <th className="text-right px-4 py-3 text-slate-600 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-xs text-white font-bold shrink-0"
                      style={{ backgroundColor: u.role === "admin" ? "#006B54" : "#64748b" }}
                    >
                      {u.full_name.charAt(0)}
                    </div>
                    <span className="font-medium text-slate-800">{u.full_name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-500">{u.email}</td>
                <td className="px-4 py-3">
                  <Badge variant={u.role === "admin" ? "default" : "secondary"} className="text-xs">
                    {u.role}
                  </Badge>
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full ${
                      u.is_active
                        ? "bg-green-50 text-green-700"
                        : "bg-red-50 text-red-600"
                    }`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${u.is_active ? "bg-green-500" : "bg-red-400"}`} />
                    {u.is_active ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setShowReset(u)}
                      className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                      title="Reset password"
                    >
                      <Key size={13} />
                    </button>
                    {u.is_active && (
                      <button
                        onClick={() => deactivate(u)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        title="Deactivate"
                      >
                        <UserX size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Create user dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Full Name</Label>
              <Input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Role</Label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
              >
                <option value="staff">Staff</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <Button onClick={createUser} disabled={loading} className="w-full text-white" style={{ backgroundColor: "#006B54" }}>
              {loading ? "Creating…" : "Create User"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Reset password dialog */}
      <Dialog open={!!showReset} onOpenChange={() => setShowReset(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password — {showReset?.full_name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
            </div>
            <Button onClick={resetPw} disabled={loading || !newPassword} className="w-full text-white" style={{ backgroundColor: "#006B54" }}>
              {loading ? "Resetting…" : "Reset Password"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
