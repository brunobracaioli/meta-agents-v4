import type { AgentTrigger } from "@/lib/ultron/agent-trigger";
import type { LiveProcess } from "./neural-core-state";

export const OPTIMISTIC_PROCESS_TTL_MS = 20_000;

export type OptimisticLiveProcess = LiveProcess & {
  expiresAt: number;
};

export function liveProcessFromAgentTrigger(trigger: AgentTrigger, receivedAtMs: number): OptimisticLiveProcess {
  const queuedAtMs = Date.parse(trigger.queuedAt);
  const startedAt = Number.isFinite(queuedAtMs) ? trigger.queuedAt : new Date(receivedAtMs).toISOString();

  return {
    id: trigger.jobId,
    source: "agent_job",
    skill: trigger.skill,
    kind: trigger.kind,
    state: "active",
    phase: "pending",
    startedAt,
    finishedAt: null,
    error: null,
    expiresAt: receivedAtMs + OPTIMISTIC_PROCESS_TTL_MS,
  };
}

export function pruneOptimisticProcesses(
  realProcesses: LiveProcess[],
  optimisticProcesses: OptimisticLiveProcess[],
  nowMs: number,
): OptimisticLiveProcess[] {
  const realIds = new Set(realProcesses.map((process) => process.id));
  return optimisticProcesses.filter((process) => process.expiresAt > nowMs && !realIds.has(process.id));
}

export function mergeLiveProcesses(
  realProcesses: LiveProcess[],
  optimisticProcesses: OptimisticLiveProcess[],
  nowMs: number,
): LiveProcess[] {
  return [
    ...pruneOptimisticProcesses(realProcesses, optimisticProcesses, nowMs).map(({ expiresAt: _expiresAt, ...process }) => process),
    ...realProcesses,
  ];
}
