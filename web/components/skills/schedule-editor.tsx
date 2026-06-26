"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SkillScheduleView } from "@/lib/services/skills-admin";

// SPEC-018 Wave 4 — friendly recurrence picker for a skill. Compiles to a cron expression + a
// server-computed next_run_at via /api/skills/:id/schedule. The poller (poll-skill-schedules.sh)
// enqueues a job when due. No by-minute option exists: hourly (every N hours) is the floor.

type Freq = "hourly" | "daily" | "weekly" | "monthly";

const input = "rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none focus:border-[var(--color-orange,#fb923c)]";
const label = "block text-xs font-medium uppercase tracking-wide text-white/45";
const WEEKDAYS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

export function ScheduleEditor({ skillId, initial }: { skillId: string; initial: SkillScheduleView | null }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [freq, setFreq] = useState<Freq>((initial?.recurrence.freq as Freq) ?? "daily");
  const [time, setTime] = useState(initial?.recurrence.time ?? "09:00");
  const [weekday, setWeekday] = useState<number>(initial?.recurrence.weekday ?? 1);
  const [monthday, setMonthday] = useState<number>(initial?.recurrence.monthday ?? 1);
  const [everyN, setEveryN] = useState<number>(initial?.recurrence.every_n_hours ?? 6);
  const [exists, setExists] = useState(!!initial);
  const [nextRun, setNextRun] = useState<string | null>(initial?.next_run_at ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildRecurrence(): Record<string, unknown> {
    switch (freq) {
      case "hourly":
        return { freq, every_n_hours: everyN };
      case "daily":
        return { freq, time };
      case "weekly":
        return { freq, time, weekday };
      case "monthly":
        return { freq, time, monthday };
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skills/${skillId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recurrence: buildRecurrence(), enabled }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string; next_run_at?: string } | null;
      if (!res.ok) {
        setError(data?.error === "invalid_request" ? "Recorrência inválida." : "Não foi possível salvar a agenda.");
        return;
      }
      setExists(true);
      setNextRun(data?.next_run_at ?? null);
      router.refresh();
    } catch {
      setError("Falha de rede ao salvar a agenda.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      const res = await fetch(`/api/skills/${skillId}/schedule`, { method: "DELETE" });
      if (res.ok) {
        setExists(false);
        setNextRun(null);
        router.refresh();
      } else setError("Não foi possível remover a agenda.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-cyan-300/15 bg-[#070b1a]/80 p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Agenda (opcional)</h2>
        {exists && (
          <label className="flex cursor-pointer items-center gap-2 text-xs text-white/60">
            <input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />
            Ativa
          </label>
        )}
      </div>
      <p className="text-xs text-white/40">
        Rode esta skill automaticamente. Horários no fuso America/Sao_Paulo. A skill precisa estar “Ativa”
        para a agenda disparar.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className={label}>Frequência</label>
          <select value={freq} onChange={(e) => setFreq(e.target.value as Freq)} className={input}>
            <option value="hourly" className="bg-[#070b1a]">A cada N horas</option>
            <option value="daily" className="bg-[#070b1a]">Diária</option>
            <option value="weekly" className="bg-[#070b1a]">Semanal</option>
            <option value="monthly" className="bg-[#070b1a]">Mensal</option>
          </select>
        </div>

        {freq === "hourly" && (
          <div>
            <label className={label}>A cada (horas)</label>
            <input
              type="number"
              min={1}
              max={24}
              value={everyN}
              onChange={(e) => setEveryN(Math.min(24, Math.max(1, Number(e.target.value))))}
              className={`${input} w-24`}
            />
          </div>
        )}
        {freq !== "hourly" && (
          <div>
            <label className={label}>Horário</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={input} />
          </div>
        )}
        {freq === "weekly" && (
          <div>
            <label className={label}>Dia da semana</label>
            <select value={weekday} onChange={(e) => setWeekday(Number(e.target.value))} className={input}>
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i} className="bg-[#070b1a]">
                  {d}
                </option>
              ))}
            </select>
          </div>
        )}
        {freq === "monthly" && (
          <div>
            <label className={label}>Dia do mês (1–28)</label>
            <input
              type="number"
              min={1}
              max={28}
              value={monthday}
              onChange={(e) => setMonthday(Math.min(28, Math.max(1, Number(e.target.value))))}
              className={`${input} w-24`}
            />
          </div>
        )}
      </div>

      {nextRun && (
        <p className="text-xs text-cyan-100/50">
          Próxima execução: {new Date(nextRun).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}
        </p>
      )}
      {error && <p className="text-sm text-red-300">{error}</p>}

      <div className="flex gap-3">
        <button
          onClick={save}
          disabled={busy}
          className="rounded-lg border border-orange-300/35 bg-orange-400/15 px-4 py-2 text-sm font-medium text-orange-100 transition hover:bg-orange-400/25 disabled:opacity-50"
        >
          {busy ? "Salvando…" : exists ? "Atualizar agenda" : "Agendar"}
        </button>
        {exists && (
          <button
            onClick={remove}
            disabled={busy}
            className="rounded-lg border border-red-400/25 px-4 py-2 text-sm text-red-300/80 transition hover:bg-red-400/10 disabled:opacity-50"
          >
            Remover agenda
          </button>
        )}
      </div>
    </div>
  );
}
