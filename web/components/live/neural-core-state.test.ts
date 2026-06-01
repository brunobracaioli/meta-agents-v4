import { describe, expect, it } from "vitest";
import { deriveNeuralCoreState, type LiveEvent, type LiveProcess } from "./neural-core-state";

const NOW = Date.parse("2026-06-01T13:00:00.000Z");
let nextId = 0;

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: overrides.id ?? `evt-${nextId += 1}`,
    run_id: overrides.run_id ?? null,
    ts: overrides.ts ?? new Date(NOW).toISOString(),
    agent_name: overrides.agent_name ?? "Core Agent",
    agent_type: overrides.agent_type ?? "agent",
    event_type: overrides.event_type ?? "step",
    tool_name: overrides.tool_name ?? null,
    summary: overrides.summary ?? null,
  };
}

function process(overrides: Partial<LiveProcess> = {}): LiveProcess {
  return {
    id: overrides.id ?? "process-1",
    source: overrides.source ?? "agent_job",
    skill: overrides.skill ?? "create-traffic-brunobracaioli-campaign",
    kind: overrides.kind ?? "create",
    state: overrides.state ?? "active",
    phase: overrides.phase ?? "running",
    startedAt: overrides.startedAt ?? new Date(NOW - 5 * 60_000).toISOString(),
    finishedAt: overrides.finishedAt ?? null,
    error: overrides.error ?? null,
  };
}

describe("deriveNeuralCoreState", () => {
  it("returns stand-by with no events", () => {
    expect(deriveNeuralCoreState([], NOW)).toMatchObject({
      mode: "stand-by",
      recentEventCount: 0,
      activeSubagents: [],
      overflowSubagentCount: 0,
      activeProcessCount: 0,
      lastProcess: null,
      lastEventAt: null,
    });
  });

  it("returns stand-by when events are older than 60 seconds", () => {
    const state = deriveNeuralCoreState(
      [event({ ts: new Date(NOW - 61_000).toISOString() })],
      NOW,
    );

    expect(state.mode).toBe("stand-by");
    expect(state.recentEventCount).toBe(0);
  });

  it("counts recent events without activating the core by event recency alone", () => {
    const state = deriveNeuralCoreState(
      [event({ agent_name: "Planner", ts: new Date(NOW - 20_000).toISOString() })],
      NOW,
    );

    expect(state.mode).toBe("stand-by");
    expect(state.activeAgents).toEqual([]);
    expect(state.recentEventCount).toBe(1);
  });

  it("keeps the core activated while there is an active process, even without recent events", () => {
    const state = deriveNeuralCoreState(
      [event({ ts: new Date(NOW - 10 * 60_000).toISOString() })],
      NOW,
      [process({ state: "active", phase: "pending", startedAt: new Date(NOW - 10 * 60_000).toISOString() })],
    );

    expect(state.mode).toBe("activated");
    expect(state.activeAgents).toEqual(["create-traffic-brunobracaioli-campaign"]);
    expect(state.activeProcessCount).toBe(1);
  });

  it("turns the core off immediately when the process succeeds", () => {
    const state = deriveNeuralCoreState(
      [event({ ts: new Date(NOW - 5_000).toISOString() })],
      NOW,
      [process({ state: "success", phase: "completed", finishedAt: new Date(NOW - 4_000).toISOString() })],
    );

    expect(state.mode).toBe("stand-by");
    expect(state.activeProcessCount).toBe(0);
    expect(state.lastProcess).toEqual(expect.objectContaining({ state: "success", phase: "completed" }));
  });

  it("turns the core off for terminal errors and preserves the error result", () => {
    const state = deriveNeuralCoreState(
      [event({ ts: new Date(NOW - 5_000).toISOString() })],
      NOW,
      [
        process({
          state: "error",
          phase: "failed",
          finishedAt: new Date(NOW - 4_000).toISOString(),
          error: "Meta API failed",
        }),
      ],
    );

    expect(state.mode).toBe("stand-by");
    expect(state.lastProcess).toEqual(expect.objectContaining({ state: "error", error: "Meta API failed" }));
  });

  it("does not reactivate from a recent event when the related process already ended", () => {
    const state = deriveNeuralCoreState(
      [event({ run_id: "run-1", ts: new Date(NOW - 2_000).toISOString() })],
      NOW,
      [
        process({
          id: "run-1",
          source: "agent_run",
          state: "success",
          phase: "end",
          finishedAt: new Date(NOW - 1_000).toISOString(),
        }),
      ],
    );

    expect(state.mode).toBe("stand-by");
    expect(state.recentEventCount).toBe(1);
  });

  it("creates stable colored branches for recent subagents", () => {
    const state = deriveNeuralCoreState(
      [
        event({ agent_name: "Audience", agent_type: "subagent", ts: new Date(NOW - 10_000).toISOString() }),
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 20_000).toISOString() }),
      ],
      NOW,
    );

    expect(state.activeSubagents).toEqual([
      expect.objectContaining({ name: "Audience", color: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
      expect.objectContaining({ name: "Creative", color: expect.stringMatching(/^#[0-9a-f]{6}$/) }),
    ]);
  });

  it("preserves a subagent color when the active set changes", () => {
    const first = deriveNeuralCoreState(
      [event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 10_000).toISOString() })],
      NOW,
    );
    const second = deriveNeuralCoreState(
      [
        event({ agent_name: "Audience", agent_type: "subagent", ts: new Date(NOW - 8_000).toISOString() }),
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 10_000).toISOString() }),
        event({ agent_name: "Planner", agent_type: "subagent", ts: new Date(NOW - 12_000).toISOString() }),
      ],
      NOW,
    );

    expect(second.activeSubagents.find((subagent) => subagent.name === "Creative")?.color).toBe(
      first.activeSubagents[0]?.color,
    );
  });

  it("does not duplicate subagents when repeat events arrive", () => {
    const state = deriveNeuralCoreState(
      [
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 50_000).toISOString() }),
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 20_000).toISOString() }),
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 5_000).toISOString() }),
      ],
      NOW,
    );

    expect(state.activeSubagents).toEqual([
      expect.objectContaining({ name: "Creative", eventCount: 3, lastEventAt: new Date(NOW - 5_000).toISOString() }),
    ]);
  });

  it("expires subagents older than 120 seconds", () => {
    const state = deriveNeuralCoreState(
      [
        event({ agent_name: "Old Subagent", agent_type: "subagent", ts: new Date(NOW - 121_000).toISOString() }),
        event({ agent_name: "Fresh Subagent", agent_type: "subagent", ts: new Date(NOW - 119_000).toISOString() }),
      ],
      NOW,
    );

    expect(state.activeSubagents.map((subagent) => subagent.name)).toEqual(["Fresh Subagent"]);
  });

  it("limits visual subagents to six and reports overflow", () => {
    const state = deriveNeuralCoreState(
      ["A", "B", "C", "D", "E", "F", "G", "H"].map((name, index) =>
        event({
          agent_name: name,
          agent_type: "subagent",
          ts: new Date(NOW - index * 1_000).toISOString(),
        }),
      ),
      NOW,
    );

    expect(state.activeSubagents).toHaveLength(6);
    expect(state.activeSubagents.map((subagent) => subagent.name)).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(state.overflowSubagentCount).toBe(2);
  });
});
