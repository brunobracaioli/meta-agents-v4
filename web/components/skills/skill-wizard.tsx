"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TOOL_GROUPS, selectionHasWrite, deriveSelectedGroups } from "@/lib/skills/catalog";
import type { EditableSkill } from "@/lib/services/skills-admin";

// SPEC-018 Wave 3 + SPEC-018.1 — guided, AI-assisted skill authoring, scoped to a PRODUCT. The
// product is fixed by the route (no picker); the wizard only carries its id for the API calls and
// its slug/name for context + the draft prompt. Step 1 turns a plain-language goal into a draft via
// /api/skills/draft; the operator reviews/edits the body + tool selection, optionally exposes it to
// Ultron, and creates it. Reused in edit mode (existingSkill set) without step 1. All persistence
// goes through /api/skills/* where auth + ownership + validation live.

type ProductContext = { id: string; slug: string; name: string };

const input = "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-orange,#fb923c)]";
const label = "block text-xs font-medium uppercase tracking-wide text-white/45";
const card = "rounded-xl border border-cyan-300/15 bg-[#070b1a]/80 p-5 space-y-4";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 40);
}

type UltronFn = { name: string; description: string; parametersText: string };

export function SkillWizard({
  product,
  clientSlug,
  existingSkill,
}: {
  product: ProductContext;
  clientSlug: string;
  existingSkill?: EditableSkill;
}) {
  const router = useRouter();
  const isEdit = !!existingSkill;
  const backHref = `/dashboard/clients/${clientSlug}/${product.slug}`;

  const [goal, setGoal] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [hasDraft, setHasDraft] = useState(isEdit);

  const [name, setName] = useState(existingSkill?.name ?? "");
  const [slug, setSlug] = useState(existingSkill?.slug ?? "");
  const [slugTouched, setSlugTouched] = useState(isEdit);
  const [description, setDescription] = useState(existingSkill?.description ?? "");
  const [body, setBody] = useState(existingSkill?.body ?? "");
  const [groups, setGroups] = useState<string[]>(
    existingSkill ? deriveSelectedGroups(existingSkill.allowed_tools) : [],
  );
  const [ultronEnabled, setUltronEnabled] = useState(existingSkill?.ultron_enabled ?? false);
  const [ultronFn, setUltronFn] = useState<UltronFn>({
    name: existingSkill?.ultron_function?.name ?? "",
    description: existingSkill?.ultron_function?.description ?? "",
    parametersText: JSON.stringify(
      existingSkill?.ultron_function?.parameters ?? { type: "object", properties: {} },
      null,
      2,
    ),
  });

  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const capability: "read" | "write" = selectionHasWrite(groups) ? "write" : "read";

  function setNameAndSlug(v: string) {
    setName(v);
    if (!slugTouched) setSlug(slugify(v));
  }

  function toggleGroup(id: string) {
    setGroups((g) => (g.includes(id) ? g.filter((x) => x !== id) : [...g, id]));
  }

  async function generate() {
    if (goal.trim().length < 8) {
      setError("Descreva o objetivo com um pouco mais de detalhe.");
      return;
    }
    setDrafting(true);
    setError(null);
    try {
      const res = await fetch("/api/skills/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId: product.id, goal: goal.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { name?: string; description?: string; body?: string; tool_groups?: string[]; error?: string }
        | null;
      if (!res.ok) {
        setError(draftError(data?.error));
        return;
      }
      setNameAndSlug(data?.name ?? "");
      setDescription(data?.description ?? "");
      setBody(data?.body ?? "");
      setGroups(Array.isArray(data?.tool_groups) ? data!.tool_groups! : []);
      setHasDraft(true);
    } catch {
      setError("Falha de rede ao gerar o rascunho.");
    } finally {
      setDrafting(false);
    }
  }

  function buildUltronFunction(): { ok: true; value: unknown } | { ok: false; error: string } {
    if (!ultronEnabled) return { ok: true, value: null };
    if (!/^[a-z0-9_]{2,48}$/.test(ultronFn.name)) return { ok: false, error: "Nome da função: use [a-z0-9_], 2-48." };
    let parameters: unknown;
    try {
      parameters = JSON.parse(ultronFn.parametersText);
    } catch {
      return { ok: false, error: "Parâmetros da função: JSON inválido." };
    }
    if (typeof parameters !== "object" || parameters === null) return { ok: false, error: "Parâmetros devem ser um objeto JSON." };
    return { ok: true, value: { name: ultronFn.name, description: ultronFn.description, parameters } };
  }

  async function save() {
    setError(null);
    const fn = buildUltronFunction();
    if (!fn.ok) {
      setError(fn.error);
      return;
    }
    setBusy(true);
    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || undefined,
        body,
        tool_groups: groups,
        capability,
        ultron_enabled: ultronEnabled,
        ultron_function: fn.value,
      };
      let res: Response;
      if (isEdit) {
        res = await fetch(`/api/skills/${existingSkill!.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, version: existingSkill!.version }),
        });
      } else {
        res = await fetch("/api/skills", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...payload, productId: product.id, slug, status: "draft" }),
        });
      }
      const data = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
      if (!res.ok) {
        setError(saveError(data?.error, data?.detail));
        return;
      }
      router.push(backHref);
      router.refresh();
    } catch {
      setError("Falha de rede ao salvar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Step 1 — goal (create only) */}
      {!isEdit && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-white">1 · Objetivo</h2>
          <p className="text-xs text-white/40">
            Produto: <span className="text-cyan-100/80">{product.name}</span>{" "}
            <span className="font-mono text-white/30">({product.slug})</span>
          </p>
          <div>
            <label className={label}>O que essa automação deve fazer?</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              rows={4}
              placeholder="Ex.: todo dia de manhã, ler o ROAS das campanhas ativas e me mandar um resumo no Telegram."
              className={input}
            />
          </div>
          <button
            onClick={generate}
            disabled={drafting}
            className="rounded-lg border border-orange-300/35 bg-orange-400/15 px-4 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-400/25 disabled:opacity-50"
          >
            {drafting ? "Gerando com IA…" : "Gerar rascunho com IA"}
          </button>
        </div>
      )}

      {/* Step 2 — review */}
      {hasDraft && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-white">{isEdit ? "Editar skill" : "2 · Revisar"}</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label}>Nome</label>
              <input value={name} onChange={(e) => setNameAndSlug(e.target.value)} className={input} />
            </div>
            <div>
              <label className={label}>Slug{isEdit ? " (imutável)" : ""}</label>
              <input
                value={slug}
                disabled={isEdit}
                onChange={(e) => {
                  setSlugTouched(true);
                  setSlug(slugify(e.target.value));
                }}
                className={input}
              />
            </div>
          </div>
          <div>
            <label className={label}>Descrição</label>
            <input value={description} onChange={(e) => setDescription(e.target.value)} className={input} />
          </div>
          <div>
            <label className={label}>Instruções (corpo da skill)</label>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className={`${input} font-mono`} />
          </div>

          <div>
            <label className={label}>Ferramentas que a skill pode usar</label>
            <p className="mb-2 text-xs text-white/35">
              Capacidade:{" "}
              <span className={capability === "write" ? "text-orange-200" : "text-emerald-200"}>{capability}</span>
              {capability === "write" && " — sobe pausado e respeita o budget cap."}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              {TOOL_GROUPS.map((g) => (
                <label
                  key={g.id}
                  className="flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm"
                >
                  <input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggleGroup(g.id)} className="mt-0.5" />
                  <span>
                    <span className="text-white/85">
                      {g.label}{" "}
                      <span className={g.tier === "write" ? "text-orange-300/70" : "text-emerald-300/70"}>({g.tier})</span>
                    </span>
                    <span className="block text-xs text-white/40">{g.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Step 3 — Ultron exposure */}
      {hasDraft && (
        <div className={card}>
          <h2 className="text-lg font-semibold text-white">{isEdit ? "Ultron" : "3 · Ultron (opcional)"}</h2>
          <label className="flex cursor-pointer items-center gap-2 text-sm text-white/80">
            <input type="checkbox" checked={ultronEnabled} onChange={(e) => setUltronEnabled(e.target.checked)} />
            Permitir que o Ultron acione esta skill por voz (function calling)
          </label>
          {ultronEnabled && (
            <div className="space-y-4 border-l border-violet-300/20 pl-4">
              <div>
                <label className={label}>Nome da função</label>
                <input
                  value={ultronFn.name}
                  onChange={(e) => setUltronFn((f) => ({ ...f, name: e.target.value }))}
                  placeholder="resumo_roas_diario"
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Quando o Ultron deve chamar?</label>
                <input
                  value={ultronFn.description}
                  onChange={(e) => setUltronFn((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Quando o operador pedir o resumo de ROAS do dia."
                  className={input}
                />
              </div>
              <div>
                <label className={label}>Parâmetros (JSON Schema)</label>
                <textarea
                  value={ultronFn.parametersText}
                  onChange={(e) => setUltronFn((f) => ({ ...f, parametersText: e.target.value }))}
                  rows={6}
                  className={`${input} font-mono`}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {error && <p className="text-sm text-red-300">{error}</p>}

      {hasDraft && (
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={busy || !name.trim() || !slug || !body.trim()}
            className="rounded-lg border border-orange-300/35 bg-orange-400/15 px-5 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-400/25 disabled:opacity-50"
          >
            {busy ? "Salvando…" : isEdit ? "Salvar alterações" : "Criar skill"}
          </button>
          <a
            href={backHref}
            className="rounded-lg border border-white/10 px-5 py-2 text-sm text-white/60 transition hover:bg-white/[0.04]"
          >
            Cancelar
          </a>
        </div>
      )}
    </div>
  );
}

function draftError(code?: string): string {
  switch (code) {
    case "rate_limited":
      return "Muitas gerações seguidas. Aguarde um instante.";
    case "draft_failed":
      return "A IA não conseguiu gerar agora. Tente de novo.";
    case "not_found":
      return "Produto inválido.";
    default:
      return "Não foi possível gerar o rascunho.";
  }
}

function saveError(code?: string, detail?: string): string {
  switch (code) {
    case "slug_in_use":
      return "Já existe uma skill com esse slug para o produto.";
    case "version_conflict":
      return "A skill foi alterada em outra aba. Recarregue a página.";
    case "invalid_request":
      return detail ? `Dados inválidos: ${detail}` : "Dados inválidos.";
    case "not_found":
      return "Produto ou skill não encontrado.";
    default:
      return "Não foi possível salvar a skill.";
  }
}
