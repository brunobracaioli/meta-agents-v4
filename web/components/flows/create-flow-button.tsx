"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ClientOption = { id: string; name: string };

export function CreateFlowButton({ clients }: { clients: ClientOption[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [clientId, setClientId] = useState(clients[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function create() {
    if (!name.trim() || !clientId || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/flows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, name: name.trim() }),
      });
      if (!res.ok) {
        setError("Não foi possível criar o flow. Tente novamente.");
        return;
      }
      const flow = (await res.json()) as { id: string };
      router.push(`/dashboard/flows/${flow.id}`);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={clients.length === 0}
        title={clients.length === 0 ? "Cadastre um cliente primeiro" : undefined}
        className="rounded-md border border-cyan-300/30 bg-cyan-400/[0.08] px-4 py-2 text-sm text-cyan-100 transition hover:border-cyan-200/50 hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
      >
        Novo flow
      </button>
    );
  }

  return (
    <div className="tech-panel w-full max-w-md rounded-xl border border-cyan-300/20 p-4 sm:w-auto">
      <div className="space-y-3">
        <label className="block text-xs text-white/60">
          Nome
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            maxLength={120}
            placeholder="Ex.: Lançamento — tráfego frio"
            className="mt-1 w-full rounded-md border border-white/15 bg-white/[0.04] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/40"
          />
        </label>
        <label className="block text-xs text-white/60">
          Cliente
          <select
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            className="mt-1 w-full rounded-md border border-white/15 bg-[#0a0f1e] px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/40"
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {error ? <p className="text-xs text-rose-300">{error}</p> : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim()}
            className="rounded-md border border-cyan-300/30 bg-cyan-400/[0.08] px-4 py-2 text-sm text-cyan-100 transition hover:bg-cyan-400/15 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Criando…" : "Criar"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-md px-3 py-2 text-sm text-white/50 transition hover:text-white"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  );
}
