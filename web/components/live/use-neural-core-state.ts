"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AGENT_TRIGGER_CHANNEL, AGENT_TRIGGER_EVENT, isAgentTrigger } from "@/lib/ultron/agent-trigger";
import { deriveNeuralCoreState, type LiveEvent, type LiveProcess, type NeuralCoreState } from "./neural-core-state";
import {
  liveProcessFromAgentTrigger,
  mergeLiveProcesses,
  pruneOptimisticProcesses,
  type OptimisticLiveProcess,
} from "./optimistic-processes";

const POLL_MS = 4000;
const MAX_KEEP = 200;

// Headless mirror of LiveFeed's polling + state derivation (minus the whole HUD/metrics),
// so the 3D Ultron tab can drive the SAME arc reactor with the SAME agent-activation
// behavior — it activates whenever agents run, including when Ultron triggers them via the
// agent_trigger CustomEvent/BroadcastChannel. The /dashboard/live page is left untouched;
// the shared truth is deriveNeuralCoreState + the optimistic-process helpers.
export function useNeuralCoreState(): NeuralCoreState {
  const [events, setEvents] = useState<LiveEvent[]>([]);
  const [processes, setProcesses] = useState<LiveProcess[]>([]);
  const [optimisticProcesses, setOptimisticProcesses] = useState<OptimisticLiveProcess[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const sinceRef = useRef<string | undefined>(undefined);
  const seenRef = useRef<Set<string>>(new Set());
  // Timestamps are server-minted; measure the browser↔server skew on each poll so the 1s
  // tick can keep the activity windows honest instead of trusting a skewed local clock.
  const clockSkewMsRef = useRef(0);
  const pollSeqRef = useRef(0);
  const appliedSeqRef = useRef(0);

  const serverNow = useCallback(() => Date.now() + clockSkewMsRef.current, []);

  const poll = useCallback(async () => {
    const seq = ++pollSeqRef.current;
    try {
      const url = sinceRef.current
        ? `/api/dashboard/events?since=${encodeURIComponent(sinceRef.current)}`
        : "/api/dashboard/events";
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error("poll");
      const data = (await res.json()) as { events: LiveEvent[]; processes?: LiveProcess[]; now: string };
      // A slow response can land after a newer one; applying it would rewind state.
      if (seq <= appliedSeqRef.current) return;
      appliedSeqRef.current = seq;
      const nextProcesses = data.processes ?? [];
      const serverNowMs = Date.parse(data.now);
      clockSkewMsRef.current = serverNowMs - Date.now();
      setNowMs(serverNowMs);
      setProcesses(nextProcesses);
      setOptimisticProcesses((prev) => pruneOptimisticProcesses(nextProcesses, prev, serverNowMs));
      if (data.events.length > 0) {
        const fresh = data.events.filter((e) => !seenRef.current.has(e.id));
        fresh.forEach((e) => seenRef.current.add(e.id));
        if (fresh.length > 0) setEvents((prev) => [...prev, ...fresh].slice(-MAX_KEEP));
        const last = data.events[data.events.length - 1];
        if (last) sinceRef.current = last.ts;
      } else if (!sinceRef.current) {
        sinceRef.current = data.now;
      }
    } catch {
      // transient; keep the last known state and retry next tick
    }
  }, []);

  const addOptimisticProcess = useCallback(
    (value: unknown) => {
      if (!isAgentTrigger(value)) return;
      const receivedAtMs = serverNow();
      const process = liveProcessFromAgentTrigger(value, receivedAtMs);
      setNowMs(receivedAtMs);
      setOptimisticProcesses((prev) =>
        [process, ...pruneOptimisticProcesses([], prev, receivedAtMs).filter((item) => item.id !== process.id)].slice(0, 12),
      );
    },
    [serverNow],
  );

  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), POLL_MS);
    return () => clearInterval(id);
  }, [poll]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(serverNow()), 1000);
    return () => clearInterval(id);
  }, [serverNow]);

  useEffect(() => {
    const onLocalTrigger = (event: Event) => addOptimisticProcess((event as CustomEvent<unknown>).detail);
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
    [processes, optimisticProcesses, nowMs],
  );
  return useMemo(() => deriveNeuralCoreState(events, nowMs, liveProcesses), [events, nowMs, liveProcesses]);
}
