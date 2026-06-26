"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminProduct } from "@/lib/services/products-admin";

// SPEC-018.1 — product management on the client detail page. A product groups landing pages AND
// skills, so deleting one cascades to its skills/schedules (warned). Writes hit /api/products
// (auth + ownership + Zod live there); router.refresh() re-reads via RLS after each.

type FormState = { slug: string; name: string; default_subdomain: string; status: "active" | "archived" };
const EMPTY: FormState = { slug: "", name: "", default_subdomain: "", status: "active" };

const input = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-orange,#fb923c)]";
const label = "block text-xs font-medium uppercase tracking-wide text-white/45";

export function ProductsManager({
  clientId,
  clientSlug,
  initialProducts,
}: {
  clientId: string;
  clientSlug: string;
  initialProducts: AdminProduct[];
}) {
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
  function startEdit(p: AdminProduct) {
    setForm({ slug: p.slug, name: p.name, default_subdomain: p.default_subdomain ?? "", status: p.status as "active" | "archived" });
    setEditingId(p.id);
    setCreating(false);
    setError(null);
  }
  function cancel() {
    setCreating(false);
    setEditingId(null);
    setError(null);
  }
  function field(key: keyof FormState) {
    return { value: form[key], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [key]: e.target.value })) };
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const isEdit = editingId !== null;
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        default_subdomain: form.default_subdomain.trim() || null,
        status: form.status,
      };
      if (!isEdit) {
        body.clientId = clientId;
        body.slug = form.slug.trim();
      }
      const res = await fetch(isEdit ? `/api/products/${editingId}` : "/api/products", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        setError(
          data?.error === "slug_in_use"
            ? "Já existe um produto com esse slug neste cliente."
            : data?.error === "invalid_request"
              ? `Dados inválidos: ${data.detail ?? ""}`
              : "Não foi possível salvar o produto.",
        );
        return;
      }
      cancel();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: AdminProduct) {
    if (!window.confirm(`Remover o produto "${p.name}"? As skills e agendas desse produto também serão removidas.`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/products/${p.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setError("Não foi possível remover o produto.");
    } finally {
      setBusy(false);
    }
  }

  const showForm = creating || editingId !== null;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Produtos &amp; skills</h2>
          <p className="mt-1 text-sm text-white/40">
            As skills ficam <span className="text-cyan-200/70">dentro de cada produto</span> — abra um produto para criar e gerenciar suas skills.
          </p>
        </div>
        {!showForm && (
          <button
            onClick={startCreate}
            className="shrink-0 rounded-lg border border-orange-300/35 bg-orange-400/10 px-3 py-1.5 text-sm font-medium text-orange-200 transition hover:bg-orange-400/20"
          >
            + Novo produto
          </button>
        )}
      </div>

      {showForm && (
        <div className="tech-panel rounded-xl border border-cyan-300/15 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className={label}>Slug{editingId ? " (imutável)" : ""}</label>
              <input {...field("slug")} disabled={editingId !== null} placeholder="cca" className={input} />
            </div>
            <div>
              <label className={label}>Nome</label>
              <input {...field("name")} placeholder="Claude Code Architect" className={input} />
            </div>
            <div>
              <label className={label}>Subdomínio padrão</label>
              <input {...field("default_subdomain")} placeholder="(opcional)" className={input} />
            </div>
            <div>
              <label className={label}>Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm((f) => ({ ...f, status: e.target.value as "active" | "archived" }))}
                className={input}
              >
                <option value="active" className="bg-[#070b1a]">Ativo</option>
                <option value="archived" className="bg-[#070b1a]">Arquivado</option>
              </select>
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
          <div className="mt-4 flex gap-3">
            <button onClick={submit} disabled={busy} className="rounded-lg border border-orange-300/35 bg-orange-400/15 px-4 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-400/25 disabled:opacity-50">
              {busy ? "Salvando…" : editingId ? "Salvar" : "Criar produto"}
            </button>
            <button onClick={cancel} disabled={busy} className="rounded-lg border border-white/10 px-4 py-2 text-sm text-white/60 transition hover:bg-white/[0.04]">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {initialProducts.length === 0 && !showForm ? (
        <p className="text-sm text-white/50">Nenhum produto. Crie o primeiro para anexar skills e landing pages.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {initialProducts.map((p) => (
            <div key={p.id} className="tech-panel flex flex-col rounded-xl border border-white/8 p-4">
              <Link href={`/dashboard/clients/${clientSlug}/${p.slug}`} className="block transition hover:opacity-80">
                <p className="truncate text-sm font-medium text-white/90">{p.name}</p>
                <p className="mt-1 font-mono text-xs text-white/40">{p.slug}</p>
              </Link>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href={`/dashboard/clients/${clientSlug}/${p.slug}`}
                  className="rounded-md border border-orange-300/35 bg-orange-400/10 px-2.5 py-1 text-xs font-medium text-orange-200 transition hover:bg-orange-400/20"
                >
                  Abrir · skills →
                </Link>
                <button onClick={() => startEdit(p)} className="rounded-md border border-cyan-200/20 px-2.5 py-1 text-xs text-cyan-100/80 transition hover:bg-white/[0.04]">
                  Editar
                </button>
                <button onClick={() => remove(p)} disabled={busy} className="rounded-md border border-red-400/25 px-2.5 py-1 text-xs text-red-300/80 transition hover:bg-red-400/10 disabled:opacity-50">
                  Remover
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
