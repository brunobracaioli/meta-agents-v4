"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_TRIGGER_CHANNEL, AGENT_TRIGGER_EVENT, isAgentTrigger } from "@/lib/ultron/agent-trigger";
import { ActivitySparkline } from "./hud/activity-sparkline";
import { AnimatedCounter } from "./hud/animated-counter";
import { ArcGauge } from "./hud/arc-gauge";
import { ArcReactorOverlay } from "./hud/arc-reactor-overlay";
import { TypeOn, useBootSequence } from "./hud/boot-sequence";
import { EqBars } from "./hud/eq-bars";
import { Waveform } from "./hud/waveform";
import { HudCorners, HudPanel } from "./hud/hud-panel";
import { RadarSweep } from "./hud/radar-sweep";
import { SpectrumBars } from "./hud/spectrum-bars";
import { bucketEventsPerMinute, eventsPerMinuteNow, eventTypeCounts } from "./live-metrics";
import { NeuralCoreScene } from "./neural-core-scene";
import { deriveNeuralCoreState, type LiveEvent, type LiveProcess } from "./neural-core-state";
import {
  liveProcessFromAgentTrigger,
  mergeLiveProcesses,
  pruneOptimisticProcesses,
  type OptimisticLiveProcess,
} from "./optimistic-processes";

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

function statusClass(state: "activated" | "stand-by" | "success" | "error"): string {
  if (state === "activated") return "border-cyan-300/30 bg-cyan-400/10 text-cyan-100";
  if (state === "success") return "border-emerald-300/25 bg-emerald-400/10 text-emerald-200";
  if (state === "error") return "border-red-300/25 bg-red-500/10 text-red-200";
  return "border-white/10 bg-white/[0.03] text-white/45";
}

function statusDotClass(state: "activated" | "stand-by" | "success" | "error"): string {
  if (state === "activated") return "bg-cyan-200 shadow-[0_0_14px_rgba(103,232,249,0.9)]";
  if (state === "success") return "bg-emerald-300 shadow-[0_0_14px_rgba(110,231,183,0.75)]";
  if (state === "error") return "bg-red-400 shadow-[0_0_14px_rgba(248,113,113,0.75)]";
  return "bg-white/25";
}

function formatUptime(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000));
  const hours = String(Math.floor(totalSeconds / 3600)).padStart(2, "0");
  const minutes = String(Math.floor((totalSeconds % 3600) / 60)).padStart(2, "0");
  const seconds = String(totalSeconds % 60).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

function processSummary(process: LiveProcess | null, nowMs: number): string {
  if (!process) return "Nenhum processo carregado";
  const marker = process.state === "active" ? process.phase : process.state;
  const iso = process.finishedAt ?? process.startedAt;
  const age = iso ? ` · ${ageOf(iso, nowMs)} atrás` : "";
  const error = process.error ? ` · ${process.error}` : "";
  return `${process.skill} · ${marker}${age}${error}`;
}

export function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [processes, setProcesses] = useState<LiveProcess[]>([]);
  const [optimisticProcesses, setOptimisticProcesses] = useState<OptimisticLiveProcess[]>([]);
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
      const data = (await res.json()) as { events: LiveEvent[]; processes?: LiveProcess[]; now: string };
      const nextProcesses = data.processes ?? [];
      const serverNowMs = Date.parse(data.now);
      setConnected(true);
      setNowMs(serverNowMs);
      setProcesses(nextProcesses);
      setOptimisticProcesses((prev) => pruneOptimisticProcesses(nextProcesses, prev, serverNowMs));
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

  const addOptimisticProcess = useCallback((value: unknown) => {
    if (!isAgentTrigger(value)) return;
    const receivedAtMs = Date.now();
    const process = liveProcessFromAgentTrigger(value, receivedAtMs);
    setNowMs(receivedAtMs);
    setOptimisticProcesses((prev) => [
      process,
      ...pruneOptimisticProcesses([], prev, receivedAtMs).filter((item) => item.id !== process.id),
    ].slice(0, 12));
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

  useEffect(() => {
    setOptimisticProcesses((prev) => pruneOptimisticProcesses(processes, prev, nowMs));
  }, [nowMs, processes]);

  useEffect(() => {
    const onLocalTrigger = (event: Event) => {
      addOptimisticProcess((event as CustomEvent<unknown>).detail);
    };

    window.addEventListener(AGENT_TRIGGER_EVENT, onLocalTrigger);

    if (!("BroadcastChannel" in window)) {
      return () => window.removeEventListener(AGENT_TRIGGER_EVENT, onLocalTrigger);
    }

    const channel = new BroadcastChannel(AGENT_TRIGGER_CHANNEL);
    channel.onmessage = (event: MessageEvent<unknown>) => addOptimisticProcess(event.data);

    return () => {
      window.removeEventListener(AGENT_TRIGGER_EVENT, onLocalTrigger);
      channel.close();
    };
  }, [addOptimisticProcess]);

  const liveProcesses = useMemo(
    () => mergeLiveProcesses(processes, optimisticProcesses, nowMs),
    [optimisticProcesses, processes, nowMs],
  );
  // Metrics are sampled on a 15s grid so the 1s clock tick doesn't recompute them.
  const metricsNowMs = Math.floor(nowMs / 15_000) * 15_000;
  const activityBuckets = useMemo(() => bucketEventsPerMinute(events, metricsNowMs), [events, metricsNowMs]);
  const spectrumCounts = useMemo(() => eventTypeCounts(events, metricsNowMs), [events, metricsNowMs]);
  const eventsPerMinute = useMemo(() => eventsPerMinuteNow(events, metricsNowMs), [events, metricsNowMs]);
  const gaugeMax = Math.max(10, ...activityBuckets);
  const sessionStartMsRef = useRef<number>(Date.now());
  const bootPhase = useBootSequence();
  const coreState = useMemo(() => deriveNeuralCoreState(events, nowMs, liveProcesses), [events, nowMs, liveProcesses]);
  const feedEvents = useMemo(() => events.slice(-MAX_FEED).reverse(), [events]);
  const latestEvent = feedEvents[0] ?? null;
  const displayState: "activated" | "stand-by" | "success" | "error" =
    coreState.mode === "activated"
      ? "activated"
      : coreState.lastProcess?.state === "success" || coreState.lastProcess?.state === "error"
        ? coreState.lastProcess.state
        : "stand-by";

  return (
    // Full-bleed cockpit: breaks out of the dashboard max-w-7xl via negative
    // margins (no transform — RadarSweep/connectors are absolutely positioned).
    // data-mode is the CSS hub that modulates every decorative instrument.
    <div
      data-boot={bootPhase}
      data-mode={coreState.mode}
      className="relative mx-[calc(50%-50vw)] space-y-5 px-4 sm:px-6"
    >
      <RadarSweep />
      <div className="hud-boot flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="font-hud text-xs uppercase tracking-[0.3em] text-cyan-200/70">
            <TypeOn text="U.L.T.R.O.N // NEURAL CORE ONLINE" letterSpacingEm={0.3} />
            <span aria-hidden className="hud-caret ml-1 text-cyan-300">▌</span>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-white sm:text-3xl">Operação ao vivo</h1>
          <p className="mt-1 max-w-2xl text-sm text-white/48">
            Estado baseado em `agent_jobs` e lifecycle de `run-skill.sh`; `agent_events` alimenta o feed de passos.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`hud-clip-sm inline-flex items-center gap-2 border px-3 py-2 font-hud text-[10px] uppercase tracking-[0.16em] ${
              connected
                ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
                : "border-red-300/25 bg-red-500/10 text-red-200"
            }`}
            title={connected ? "conectado" : "reconectando"}
          >
            <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-red-400"}`} />
            {connected ? "Uplink ativo" : "Reconectando"}
          </span>
          <span
            className={`hud-clip-sm inline-flex items-center gap-2 border px-3 py-2 font-hud text-[10px] uppercase tracking-[0.16em] ${statusClass(
              displayState,
            )}`}
          >
            <span className={`h-2 w-2 rounded-full ${statusDotClass(displayState)}`} />
            {displayState}
          </span>
        </div>
      </div>

      <section className="relative grid items-start gap-4 sm:grid-cols-2 xl:grid-cols-[300px_minmax(0,1fr)_300px] 2xl:grid-cols-[340px_minmax(0,1fr)_340px]">
        {/* CENTER — DOM-first so it stacks on top below xl */}
        <div className="relative sm:col-span-2 xl:col-span-1 xl:col-start-2 xl:row-start-1">
          <div className="hud-boot hud-scan-host relative overflow-hidden border border-cyan-200/20 bg-[#030712] shadow-[inset_0_1px_0_rgba(255,255,255,0.05),0_24px_80px_rgba(0,0,0,0.34)]">
            <NeuralCoreScene state={coreState} heightClassName="h-[420px] min-h-[340px] sm:h-[560px] xl:h-[640px]" />
            <ArcReactorOverlay mode={coreState.mode} />
            <div
              aria-hidden
              className="pointer-events-none absolute left-3 top-3 z-10 font-hud text-[10px] uppercase tracking-[0.24em] text-cyan-100/70"
            >
              <span className="mr-2 inline-block border border-cyan-300/30 bg-cyan-400/10 px-1.5 py-0.5 text-cyan-200/90">
                01
              </span>
              Arc Reactor
            </div>
            <HudCorners />
          </div>
        </div>

        {/* LEFT column */}
        <div className="grid content-start gap-4 xl:col-start-1 xl:row-start-1">
          <HudPanel index="02" title="Core Telemetry" bootStep={1}>
            <div className="grid grid-cols-2 gap-3">
              <div className="border border-white/10 bg-white/[0.025] p-3">
                <p className="font-hud text-[10px] uppercase tracking-[0.14em] text-white/35">Processos ativos</p>
                <p className="mt-2 font-hud text-2xl text-white">
                  <AnimatedCounter value={coreState.activeProcessCount} />
                </p>
              </div>
              <div className="border border-white/10 bg-white/[0.025] p-3">
                <p className="font-hud text-[10px] uppercase tracking-[0.14em] text-white/35">Subagents 120s</p>
                <p className="mt-2 font-hud text-2xl text-white">
                  <AnimatedCounter value={coreState.activeSubagents.length} />
                </p>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3 border border-cyan-200/10 bg-cyan-300/[0.035] p-3">
              <ArcGauge label="evt/min" value={eventsPerMinute} max={gaugeMax} />
              <div className="text-right">
                <p className="font-hud text-[10px] uppercase tracking-[0.14em] text-white/35">Uptime sessão</p>
                <p className="mt-1 font-hud text-lg text-white">{formatUptime(nowMs - sessionStartMsRef.current)}</p>
                <p className="mt-2 font-hud text-[10px] uppercase tracking-[0.14em] text-cyan-100/45">
                  {events.length} evt no buffer
                </p>
              </div>
            </div>
            <div className="mt-4 border border-cyan-200/10 bg-cyan-300/[0.035] p-3">
              <p className="font-hud text-[10px] uppercase tracking-[0.16em] text-cyan-100/45">Processo</p>
              <p className="mt-2 text-sm text-white/80">{processSummary(coreState.lastProcess, nowMs)}</p>
            </div>
            <div className="mt-3 border border-cyan-200/10 bg-cyan-300/[0.035] p-3">
              <p className="font-hud text-[10px] uppercase tracking-[0.16em] text-cyan-100/45">Último passo</p>
              <p className="mt-2 text-sm text-white/80">
                {latestEvent ? `${latestEvent.agent_name} · ${ageOf(latestEvent.ts, nowMs)} atrás` : "Sem atividade carregada"}
              </p>
            </div>
          </HudPanel>

          <HudPanel index="03" title="Signal // Freq" bootStep={2}>
            <EqBars className="h-16" />
            <p className="mt-1 font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/45">
              Canal A · atividade neural
            </p>
            <Waveform className="mt-4 h-14" />
            <p className="mt-1 font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/45">
              Canal B · onda portadora
            </p>
          </HudPanel>
        </div>

        {/* RIGHT column */}
        <div className="grid content-start gap-4 xl:col-start-3 xl:row-start-1">
          <HudPanel index="04" title="Subagents Online" bootStep={3}>
            <div className="space-y-2">
              {coreState.activeSubagents.length > 0 ? (
                coreState.activeSubagents.map((subagent) => (
                  <div key={subagent.name} className="flex items-center justify-between gap-3 border border-white/10 bg-white/[0.025] px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full shadow-[0_0_14px_currentColor]"
                        style={{ backgroundColor: subagent.color, color: subagent.color }}
                      />
                      <span className="truncate text-sm text-white/82">{subagent.name}</span>
                    </span>
                    <span className="shrink-0 font-hud text-[10px] uppercase tracking-[0.12em] text-white/35">
                      {subagent.eventCount} evt
                    </span>
                  </div>
                ))
              ) : (
                <p className="border border-white/10 bg-white/[0.025] px-3 py-3 text-sm text-white/45">
                  Nenhum subagent com evento nos últimos 120s.
                </p>
              )}
              {coreState.overflowSubagentCount > 0 ? (
                <div className="flex items-center justify-between gap-3 border border-white/10 bg-white/[0.02] px-3 py-2">
                  <span className="truncate text-sm text-white/55">Subagents em overflow visual</span>
                  <span className="shrink-0 font-hud text-[10px] uppercase tracking-[0.12em] text-cyan-100/45">
                    +{coreState.overflowSubagentCount}
                  </span>
                </div>
              ) : null}
            </div>
          </HudPanel>

          <HudPanel index="05" title="Data Flow" bootStep={4}>
          <div className="space-y-3">
            {["agent_jobs/lifecycle state", "agent_events stream", "HUD render"].map((label, index) => (
              <div key={label} className="flex items-center gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center border border-cyan-200/15 bg-cyan-300/10 font-hud text-[10px] text-cyan-100/70">
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
          <div className="mt-4 space-y-4 border-t border-white/10 pt-4">
            <ActivitySparkline buckets={activityBuckets} />
            <SpectrumBars counts={spectrumCounts} />
          </div>
          </HudPanel>
        </div>
      </section>

      <HudPanel
        index="06"
        title="Event Stream"
        bootStep={5}
          actions={
            <span className="font-hud text-[10px] uppercase tracking-[0.14em] text-white/32">
              {events.length} eventos carregados
            </span>
          }
        >
          {feedEvents.length === 0 ? (
            <p className="border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-white/50">
              Aguardando atividade dos agents. Quando uma skill rodar, os passos aparecem aqui em tempo real.
            </p>
          ) : (
            <ol className="max-h-[380px] space-y-1.5 overflow-y-auto pr-1">
              {feedEvents.map((e) => (
                <li
                  key={e.id}
                  className="flex items-start gap-3 border border-white/10 border-l-2 border-l-cyan-300/30 bg-white/[0.025] px-4 py-3"
                >
                  <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.event_type] ?? "bg-white/30"}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-white/85">
                      <span className="font-medium text-white">{e.agent_name}</span>
                      {e.summary ? <span className="text-white/60"> - {e.summary}</span> : null}
                    </p>
                    <p className="font-hud text-xs text-white/35">
                      {e.event_type}
                      {e.tool_name ? ` · ${e.tool_name}` : ""} · {timeOf(e.ts)}
                    </p>
                  </div>
                  <span className="hidden shrink-0 border border-white/10 bg-white/[0.03] px-2 py-1 font-hud text-[10px] uppercase tracking-[0.12em] text-white/35 sm:inline">
                    {e.agent_type}
                  </span>
                </li>
              ))}
            </ol>
          )}
      </HudPanel>
    </div>
  );
}
