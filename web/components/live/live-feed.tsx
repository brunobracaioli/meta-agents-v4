"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type LiveEvent = {
  id: string;
  run_id: string | null;
  ts: string;
  agent_name: string;
  agent_type: string;
  event_type: string;
  tool_name: string | null;
  summary: string | null;
};

const POLL_MS = 2000;
const MAX_KEEP = 200;

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

export function LiveFeed() {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [connected, setConnected] = useState(true);
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

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-cyan-200/55">Fluxo de eventos</p>
          <h1 className="mt-1 text-2xl font-semibold text-white">Agents ao vivo</h1>
        </div>
        <span
          className={`inline-flex items-center gap-2 rounded border px-3 py-2 font-mono text-[10px] uppercase tracking-[0.16em] ${
            connected
              ? "border-emerald-300/25 bg-emerald-400/10 text-emerald-200"
              : "border-red-300/25 bg-red-500/10 text-red-200"
          }`}
          title={connected ? "conectado" : "reconectando…"}
        >
          <span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-300" : "bg-red-400"}`} />
          {connected ? "Conectado" : "Reconectando"}
        </span>
      </div>

      {events.length === 0 ? (
        <p className="tech-panel rounded-lg px-4 py-3 text-sm text-white/50">
          Aguardando atividade dos agents. Quando uma skill rodar (criação ou análise de
          campanha), os passos aparecem aqui em tempo real.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {events.map((e) => (
            <li
              key={e.id}
              className="tech-panel flex items-start gap-3 rounded-lg px-4 py-3"
            >
              <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.event_type] ?? "bg-white/30"}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-white/85">
                  <span className="font-medium text-white">{e.agent_name}</span>
                  {e.summary ? <span className="text-white/60"> — {e.summary}</span> : null}
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
  );
}
