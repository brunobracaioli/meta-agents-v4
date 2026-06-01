"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeuralCoreScene } from "./neural-core-scene";
import { deriveNeuralCoreState, type LiveEvent } from "./neural-core-state";

const POLL_MS = 2000;
const MAX_KEEP = 200;
const MAX_FEED = 34;

const EVENT_DOT: Record<string, string> = {
  start: "bg-cyan-300 shadow-[0_0_12px_rgba(103,232,249,0.8)]",
  step: "bg-white/40",
  decision: "bg-violet-300 shadow-[0_0_12px_rgba(196,181,253,0.8)]",
  error: "bg-red-400 shadow-[0_0_12px_rgba(248,113,113,0.8)]",
  end: "bg-emerald-300 shadow-[0_0_12px_rgba(110,231,183,0.8)]",
};

function timeOf(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", { timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(
    new Date(iso),
  );
}

function ageOf(iso: string, nowMs: number): string {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 1000));
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m`;
}

export function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(true);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sinceRef = useRef<string | undefined>(undefined);
  const seenRef = useRef<Set<string>>(new Set());

  const poll = useCallback(async () => {
    try {
      const url = sinceRef.current
        ? `/api/dashboard/events?since=${encodeURIComponent(sinceRef.current)}`
        : "/api/dashboard/events";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("poll");
      const data = (await res.json()) as { events: LiveEvent[]; now: string };
      setConnected(true);
      setNowMs(Date.parse(data.now));
      if (data.events.length > 0) {
        const fresh = data.events.filter((e) => !seenRef.current.has(e.id));
        fresh.forEach((e) => seenRef.current.add(e.id));
        if (fresh.length > 0) {
          setEvents((prev) => [...prev, ...fresh].slice(-MAX_KEEP));
        }
        const last = data.events[data.events.length - 1];
        if (last) sinceRef.current = last.ts;
      } else if (!sinceRef.current) {
        // First poll returned nothing; start the watermark so we only get new ones.
        sinceRef.current = data.now;
      }
    } catch {
      setConnected(false);
    }
  }, []);

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const coreState = useMemo(() => deriveNeuralCoreState(events, nowMs), [events, nowMs]);
  const feedEvents = useMemo(() => events.slice(-MAX_FEED).reverse(), [events]);
  const latestEvent = feedEvents[0] ?? null;
  const activeNodeCount = coreState.activeAgents.length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200/55">Neural Core Interface</p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Operação ao vivo</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/48">
            Espelho em tempo real de `agent_events`, com ativação baseada somente nos eventos recebidos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
              connected
                ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
                : "border-red-300/25 bg-red-500/10 text-red-200"
            }`}
            title={connected ? "conectado" : "reconectando"}
          >
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-red-400"}`} />
            {connected ? "Conectado" : "Reconectando"}
          </span>
          <span
            className={`inline-flex items-center gap-2 rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
              coreState.mode === "activated"
                ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-100"
                : "border-white/10 bg-white/[0.03] text-white/45"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${
                coreState.mode === "activated"
                  ? "bg-cyan-200 shadow-[0_0_14px_rgba(103,232,249,0.9)]"
                  : "bg-white/25"
              }`}
            />
            {coreState.mode}
          </span>
        </div>
      </div>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="overflow-hidden rounded-lg border border-cyan-200/20 bg-[#030712] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.34)]">
          <NeuralCoreScene state={coreState} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          <section className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/45">Core telemetry</p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="rounded border border-white/10 bg-white/[0.025] p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">Eventos 60s</p>
                <p className="mt-2 text-2xl font-semibold text-white">{coreState.recentEventCount}</p>
              </div>
              <div className="rounded border border-white/10 bg-white/[0.025] p-3">
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">Nós ativos</p>
                <p className="mt-2 text-2xl font-semibold text-white">{activeNodeCount}</p>
              </div>
            </div>
            <div className="mt-4 rounded border border-cyan-200/10 bg-cyan-300/[0.035] p-3">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-100/45">Último pulso</p>
              <p className="mt-2 text-sm text-white/80">
                {latestEvent ? `${latestEvent.agent_name} · ${ageOf(latestEvent.ts, nowMs)} atrás` : "Sem atividade carregada"}
              </p>
            </div>
          </section>

          <section className="tech-panel rounded-lg p-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/45">Subagents online</p>
            <div className="mt-4 space-y-2">
              {coreState.activeSubagents.length > 0 ? (
                coreState.activeSubagents.map((subagent) => (
                  <div key={subagent.name} className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.025] px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_14px_currentColor]"
                        style={{ backgroundColor: subagent.color, color: subagent.color }}
                      />
                      <span className="truncate text-sm text-white/82">{subagent.name}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
                      {subagent.eventCount} evt
                    </span>
                  </div>
                ))
              ) : (
                <p className="rounded border border-white/10 bg-white/[0.025] px-3 py-3 text-sm text-white/45">
                  Nenhum subagent com evento nos últimos 120s.
                </p>
              )}
              {coreState.overflowSubagentCount > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="truncate text-sm text-white/55">Subagents em overflow visual</span>
                  <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-cyan-100/45">
                    +{coreState.overflowSubagentCount}
                  </span>
                </div>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="tech-panel rounded-lg p-4">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/45">Fluxo de dados</p>
          <div className="mt-4 space-y-3">
            {["poll /api/dashboard/events", "agent_events stream", "HUD render"].map((label, index) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded border border-cyan-200/15 bg-cyan-300/10 font-mono text-[10px] text-cyan-100/70">
                  {index + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-white/76">{label}</p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                    <div
                      className={`h-full rounded-full ${
                        connected && coreState.mode === "activated" ? "bg-cyan-300 shadow-[0_0_14px_rgba(103,232,249,0.75)]" : "bg-white/20"
                      }`}
                      style={{ width: connected ? `${Math.max(28, 92 - index * 18)}%` : "18%" }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="tech-panel rounded-lg p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cyan-100/45">Feed recente</p>
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/32">
              {events.length} eventos carregados
            </span>
          </div>

          {feedEvents.length === 0 ? (
            <p className="mt-4 rounded border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-white/50">
              Aguardando atividade dos agents. Quando uma skill rodar, os passos aparecem aqui em tempo real.
            </p>
          ) : (
            <ol className="mt-4 max-h-[460px] space-y-1.5 overflow-y-auto pr-1">
              {feedEvents.map((e) => (
                <li key={e.id} className="flex items-start gap-3 rounded border border-white/10 bg-white/[0.025] px-4 py-3">
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.event_type] ?? "bg-white/30"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/85">
                      <span className="font-medium text-white">{e.agent_name}</span>
                      {e.summary ? <span className="text-white/60"> - {e.summary}</span> : null}
                    </p>
                    <p className="text-xs text-white/35">
                      {e.event_type}
                      {e.tool_name ? ` · ${e.tool_name}` : ""} · {timeOf(e.ts)}
                    </p>
                  </div>
                  <span className="hidden shrink-0 rounded border border-white/10 bg-white/[0.03] px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35 sm:inline">
                    {e.agent_type}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </section>
    </div>
  );
}
