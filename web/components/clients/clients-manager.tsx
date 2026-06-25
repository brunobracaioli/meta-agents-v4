"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminClient } from "@/lib/services/clients-admin";

// SPEC-018 — client-management UI. Talks to /api/clients (auth + ownership guard + Zod live there;
// this is presentation only). After a successful write we router.refresh() so the server component
// re-reads through RLS — the list stays the source of truth.

type FormState = {
  slug: string;
  name: string;
  ad_account_id: string;
  business_manager_id: string;
  facebook_page_id: string;
  default_landing_url: string;
  daily_budget_cap: string; // in currency units (UI); converted to cents on submit
  currency: string;
  materials_path: string;
};

const EMPTY: FormState = {
  slug: "",
  name: "",
  ad_account_id: "",
  business_manager_id: "",
  facebook_page_id: "",
  default_landing_url: "",
  daily_budget_cap: "",
  currency: "BRL",
  materials_path: "",
};

const inputClass =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-orange,#fb923c)]";
const labelClass = "block text-xs font-medium uppercase tracking-wide text-white/45";

function toForm(c: AdminClient): FormState {
  return {
    slug: c.slug,
    name: c.name,
    ad_account_id: c.ad_account_id,
    business_manager_id: c.business_manager_id ?? "",
    facebook_page_id: c.facebook_page_id ?? "",
    default_landing_url: c.default_landing_url ?? "",
    daily_budget_cap: (c.daily_budget_cap_cents / 100).toString(),
    currency: c.currency,
    materials_path: c.materials_path ?? "",
  };
}

export function ClientsManager({ initialClients }: { initialClients: AdminClient[] }) {
  const router = useRouter();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function startCreate() {
    setForm(EMPTY);
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(c: AdminClient) {
    setForm(toForm(c));
    setEditingId(c.id);
    setCreating(false);
    setError(null);
  }

  function cancel() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }

  function field(key: keyof FormState) {
    return {
      value: form[key],
      onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })),
    };
  }

  function buildBody(includeSlug: boolean): Record<string, unknown> {
    const cents = Math.round(Number(form.daily_budget_cap) * 100);
    const body: Record<string, unknown> = {
      name: form.name.trim(),
      ad_account_id: form.ad_account_id.trim(),
      business_manager_id: form.business_manager_id.trim() || null,
      facebook_page_id: form.facebook_page_id.trim() || null,
      default_landing_url: form.default_landing_url.trim() || null,
      daily_budget_cap_cents: Number.isFinite(cents) ? cents : 0,
      currency: form.currency.trim().toUpperCase(),
      materials_path: form.materials_path.trim() || null,
    };
    if (includeSlug) body.slug = form.slug.trim();
    return body;
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const isEdit = editingId !== null;
      const res = await fetch(isEdit ? `/api/clients/${editingId}` : "/api/clients", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildBody(!isEdit)),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        setError(humanError(data?.error, data?.detail));
        return;
      }
      cancel();
      router.refresh();
    } catch {
      setError("Falha de rede. Tente novamente.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(c: AdminClient) {
    if (!window.confirm(`Remover o cliente "${c.name}"? Esta ação não pode ser desfeita.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/clients/${c.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Não foi possível remover o cliente.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const showForm = creating || editingId !== null;

  return (
    <div className="space-y-6">
      {!showForm && (
        <button
          onClick={startCreate}
          className="rounded-lg border border-orange-300/35 bg-orange-400/10 px-4 py-2 text-sm font-medium text-orange-200 transition hover:bg-orange-400/20"
        >
          + Novo cliente
        </button>
      )}

      {showForm && (
        <div className="rounded-xl border border-cyan-300/15 bg-[#070b1a]/80 p-5">
          <h2 className="mb-4 text-lg font-semibold text-white">
            {editingId ? "Editar cliente" : "Novo cliente"}
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Slug{editingId ? " (imutável)" : ""}</label>
              <input {...field("slug")} disabled={editingId !== null} placeholder="brunobracaioli" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Nome</label>
              <input {...field("name")} placeholder="Bruno Bracaioli" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Ad Account ID</label>
              <input {...field("ad_account_id")} placeholder="225179730538661" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Business Manager ID</label>
              <input {...field("business_manager_id")} placeholder="(opcional)" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Facebook Page ID</label>
              <input {...field("facebook_page_id")} placeholder="(opcional)" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>URL de landing padrão</label>
              <input {...field("default_landing_url")} placeholder="https://… (opcional)" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Orçamento diário (cap)</label>
              <input {...field("daily_budget_cap")} inputMode="decimal" placeholder="50" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Moeda</label>
              <input {...field("currency")} placeholder="BRL" maxLength={3} className={inputClass} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Caminho dos materiais</label>
              <input {...field("materials_path")} placeholder=".claude/materiais-das-empresas/… (opcional)" className={inputClass} />
            </div>
          </div>

          {error && <p className="mt-4 text-sm text-red-300">{error}</p>}

          <div className="mt-5 flex gap-3">
            <button
              onClick={submit}
              disabled={busy}
              className="rounded-lg border border-orange-300/35 bg-orange-400/15 px-4 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-400/25 disabled:opacity-50"
            >
              {busy ? "Salvando…" : editingId ? "Salvar alterações" : "Criar cliente"}
            </button>
            <button
              onClick={cancel}
              disabled={busy}
              className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/[0.04] disabled:opacity-50"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {initialClients.length === 0 && !showForm ? (
        <p className="text-sm text-white/50">Nenhum cliente ainda. Crie o primeiro para começar.</p>
      ) : (
        <ul className="space-y-3">
          {initialClients.map((c) => (
            <li
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-[#070b1a]/60 p-4"
            >
              <div className="min-w-0">
                <p className="truncate font-mono text-sm font-semibold text-white">{c.slug}</p>
                <p className="truncate text-sm text-white/60">{c.name}</p>
                <p className="mt-1 text-xs text-white/35">
                  act_{c.ad_account_id} · cap {c.currency} {(c.daily_budget_cap_cents / 100).toFixed(2)}/dia
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  onClick={() => startEdit(c)}
                  className="rounded-md border border-cyan-200/20 px-3 py-1.5 text-xs text-cyan-100/80 transition hover:bg-white/[0.04]"
                >
                  Editar
                </button>
                <button
                  onClick={() => remove(c)}
                  disabled={busy}
                  className="rounded-md border border-red-400/25 px-3 py-1.5 text-xs text-red-300/80 transition hover:bg-red-400/10 disabled:opacity-50"
                >
                  Remover
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function humanError(code?: string, detail?: string): string {
  switch (code) {
    case "slug_or_ad_account_in_use":
      return "Slug ou Ad Account ID já está em uso.";
    case "invalid_request":
      return detail ? `Dados inválidos: ${detail}` : "Dados inválidos.";
    case "unauthorized":
      return "Sessão expirada. Faça login novamente.";
    case "not_found":
      return "Cliente não encontrado.";
    default:
      return "Não foi possível salvar. Verifique os campos.";
  }
}
