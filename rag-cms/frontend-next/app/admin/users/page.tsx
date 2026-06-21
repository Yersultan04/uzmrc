"use client";

import { StagePlaceholder } from "@/components/StagePlaceholder";

// Админ: управление пользователями. authApi.listUsers/createUser/updateUser/deleteUser.
// Port table from _reference/pages/UserTable.tsx (adapt to our User shape).
export default function AdminUsersPage() {
  return (
    <StagePlaceholder
      title="Пользователи"
      todo="authApi.listUsers/createUser/updateUser/deleteUser; role + is_active toggles"
    />
  );
}
