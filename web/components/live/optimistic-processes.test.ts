import { describe, expect, it } from "vitest";
import type { AgentTrigger } from "@/lib/ultron/agent-trigger";
import { deriveNeuralCoreState, type LiveProcess } from "./neural-core-state";
import {
  OPTIMISTIC_PROCESS_TTL_MS,
  liveProcessFromAgentTrigger,
  mergeLiveProcesses,
  pruneOptimisticProcesses,
} from "./optimistic-processes";

const NOW = Date.parse("2026-06-01T13:00:00.000Z");

const TRIGGER: AgentTrigger = {
  jobId: "job-1",
  skill: "create-traffic-brunobracaioli-campaign",
  kind: "create",
  clientSlug: "brunobracaioli",
  queuedAt: "2026-06-01T13:00:00.000Z",
  source: "ultron",
};

function realProcess(overrides: Partial<LiveProcess> = {}): LiveProcess {
  return {
    id: overrides.id ?? "job-real",
    source: overrides.source ?? "agent_job",
    skill: overrides.skill ?? "activate-campaign-brunobracaioli",
    kind: overrides.kind ?? "activate",
    state: overrides.state ?? "active",
    phase: overrides.phase ?? "running",
    startedAt: overrides.startedAt ?? new Date(NOW - 1_000).toISOString(),
    finishedAt: overrides.finishedAt ?? null,
    error: overrides.error ?? null,
  };
}

describe("optimistic live processes", () => {
  it("converts an agent trigger into an active pending process", () => {
    expect(liveProcessFromAgentTrigger(TRIGGER, NOW)).toMatchObject({
      id: "job-1",
      source: "agent_job",
      skill: "create-traffic-brunobracaioli-campaign",
      kind: "create",
      state: "active",
      phase: "pending",
      startedAt: "2026-06-01T13:00:00.000Z",
      finishedAt: null,
      error: null,
      expiresAt: NOW + OPTIMISTIC_PROCESS_TTL_MS,
    });
  });

  it("activates the neural core before polling returns the real job", () => {
    const optimistic = liveProcessFromAgentTrigger(TRIGGER, NOW);
    const merged = mergeLiveProcesses([], [optimistic], NOW);
    const state = deriveNeuralCoreState([], NOW, merged);

    expect(state.mode).toBe("activated");
    expect(state.activeProcessCount).toBe(1);
    expect(state.lastProcess).toEqual(expect.objectContaining({ id: "job-1", phase: "pending" }));
  });

  it("removes optimistic processes once polling returns the same job or the TTL expires", () => {
    const optimistic = liveProcessFromAgentTrigger(TRIGGER, NOW);

    expect(pruneOptimisticProcesses([realProcess({ id: "job-1" })], [optimistic], NOW)).toEqual([]);
    expect(pruneOptimisticProcesses([], [optimistic], NOW + OPTIMISTIC_PROCESS_TTL_MS + 1)).toEqual([]);
  });
});
