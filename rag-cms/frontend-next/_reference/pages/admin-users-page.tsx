"use client";

import { useEffect, useState } from "react";
import { adminApi } from "@/lib/api";
import { UserTable } from "@/components/admin/UserTable";

export default function UsersPage() {
  const [users, setUsers] = useState([]);

  async function load() {
    const data = await adminApi.listUsers();
    setUsers(data);
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Users</h1>
        <p className="text-slate-500 text-sm mt-1">Manage platform staff access</p>
      </div>
      <UserTable users={users} onRefresh={load} />
    </div>
  );
}
