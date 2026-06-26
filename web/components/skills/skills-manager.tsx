"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminSkill } from "@/lib/services/skills-admin";

// SPEC-018 (+ SPEC-018.1 nesting) — skills list with lifecycle actions (run now / enable-disable /
// delete). Creation and editing happen in the guided wizard, nested under the product
// (/dashboard/clients/<client>/<product>/skills/...). Writes hit /api/skills/* where auth +
// ownership + validation live; we router.refresh() after each to re-read via RLS.

const STATUS_LABEL: Record<string, string> = { draft: "Rascunho", active: "Ativa", disabled: "Desativada" };
const STATUS_CLASS: Record<string, string> = {
  draft: "border-amber-300/30 text-amber-200/80",
  active: "border-emerald-300/30 text-emerald-200/80",
  disabled: "border-white/15 text-white/40",
};

export function SkillsManager({
  initialSkills,
  clientSlug,
  productSlug,
}: {
  initialSkills: AdminSkill[];
  clientSlug: string;
  productSlug: string;
}) {
  const router = useRouter();
  const skillsBase = `/dashboard/clients/${clientSlug}/${productSlug}/skills`;
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function runNow(s: AdminSkill) {
    setBusyId(s.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/skills/${s.id}/run`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as { error?: string; jobId?: string } | null;
      if (res.ok) setNotice(`"${s.name}" enfileirada (job ${data?.jobId?.slice(0, 8)}…).`);
      else setNotice(runError(data?.error));
    } catch {
      setNotice("Falha de rede ao enfileirar.");
    } finally {
      setBusyId(null);
    }
  }

  async function setStatus(s: AdminSkill, status: "active" | "disabled") {
    setBusyId(s.id);
    setNotice(null);
    try {
      const res = await fetch(`/api/skills/${s.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, version: s.version }),
      });
      if (res.ok) router.refresh();
      else setNotice("Não foi possível atualizar o status.");
    } finally {
      setBusyId(null);
    }
  }

  async function remove(s: AdminSkill) {
    if (!window.confirm(`Remover a skill "${s.name}"?`)) return;
    setBusyId(s.id);
    try {
      const res = await fetch(`/api/skills/${s.id}`, { method: "DELETE" });
      if (res.ok) router.refresh();
      else setNotice("Não foi possível remover.");
    } finally {
      setBusyId(null);
    }
  }

  if (initialSkills.length === 0) {
    return (
      <p className="text-sm text-white/50">
        Nenhuma skill ainda. Use <span className="text-orange-200">+ Nova skill</span> para criar a primeira.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p className="rounded-lg border border-cyan-300/20 bg-cyan-400/[0.06] px-4 py-2 text-sm text-cyan-100/80">
          {notice}
        </p>
      )}
      <ul className="space-y-3">
        {initialSkills.map((s) => (
          <li
            key={s.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-cyan-300/15 bg-[#070b1a]/60 p-4"
          >
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-mono text-sm font-semibold text-white">{s.slug}</p>
                <span className={`rounded border px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${STATUS_CLASS[s.status]}`}>
                  {STATUS_LABEL[s.status]}
                </span>
                {s.capability === "write" && (
                  <span className="rounded border border-orange-300/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-orange-200/80">
                    escrita
                  </span>
                )}
                {s.ultron_enabled && (
                  <span className="rounded border border-violet-300/30 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-violet-200/80">
                    Ultron
                  </span>
                )}
              </div>
              <p className="truncate text-sm text-white/60">{s.name}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2">
              <button
                onClick={() => runNow(s)}
                disabled={busyId === s.id || s.status === "disabled"}
                className="rounded-md border border-emerald-300/25 px-3 py-1.5 text-xs text-emerald-200/80 transition hover:bg-emerald-400/10 disabled:opacity-40"
              >
                Rodar agora
              </button>
              {s.status === "active" ? (
                <button
                  onClick={() => setStatus(s, "disabled")}
                  disabled={busyId === s.id}
                  className="rounded-md border border-white/15 px-3 py-1.5 text-xs text-white/60 transition hover:bg-white/[0.04] disabled:opacity-40"
                >
                  Desativar
                </button>
              ) : (
                <button
                  onClick={() => setStatus(s, "active")}
                  disabled={busyId === s.id}
                  className="rounded-md border border-cyan-200/20 px-3 py-1.5 text-xs text-cyan-100/80 transition hover:bg-white/[0.04] disabled:opacity-40"
                >
                  Ativar
                </button>
              )}
              <a
                href={`${skillsBase}/${s.id}`}
                className="rounded-md border border-cyan-200/20 px-3 py-1.5 text-xs text-cyan-100/80 transition hover:bg-white/[0.04]"
              >
                Editar
              </a>
              <button
                onClick={() => remove(s)}
                disabled={busyId === s.id}
                className="rounded-md border border-red-400/25 px-3 py-1.5 text-xs text-red-300/80 transition hover:bg-red-400/10 disabled:opacity-40"
              >
                Remover
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function runError(code?: string): string {
  switch (code) {
    case "runner_not_ready":
      return "Seu runner ainda não está pronto — conclua o onboarding.";
    case "already_in_flight":
      return "Já existe um job desta skill em andamento.";
    case "skill_disabled":
      return "A skill está desativada.";
    case "not_found":
      return "Skill não encontrada.";
    default:
      return "Não foi possível enfileirar a skill.";
  }
}
