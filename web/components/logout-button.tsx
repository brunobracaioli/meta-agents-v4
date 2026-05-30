"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <button
      onClick={logout}
      disabled={loading}
      className="rounded-md border border-transparent px-3 py-2 text-white/70 transition hover:border-orange-200/25 hover:bg-orange-400/10 hover:text-orange-100 disabled:opacity-50"
    >
      Sair
    </button>
  );
}
