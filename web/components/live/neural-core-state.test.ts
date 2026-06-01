import { describe, expect, it } from "vitest";
import { deriveNeuralCoreState, type LiveEvent } from "./neural-core-state";

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

describe("deriveNeuralCoreState", () => {
  it("returns stand-by with no events", () => {
    expect(deriveNeuralCoreState([], NOW)).toMatchObject({
      mode: "stand-by",
      recentEventCount: 0,
      activeSubagents: [],
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

  it("activates the core when any event is recent", () => {
    const state = deriveNeuralCoreState(
      [event({ agent_name: "Planner", ts: new Date(NOW - 20_000).toISOString() })],
      NOW,
    );

    expect(state.mode).toBe("activated");
    expect(state.activeAgents).toEqual(["Planner"]);
    expect(state.recentEventCount).toBe(1);
  });

  it("creates colored branches for recent subagents", () => {
    const state = deriveNeuralCoreState(
      [
        event({ agent_name: "Audience", agent_type: "subagent", ts: new Date(NOW - 10_000).toISOString() }),
        event({ agent_name: "Creative", agent_type: "subagent", ts: new Date(NOW - 20_000).toISOString() }),
      ],
      NOW,
    );

    expect(state.activeSubagents).toEqual([
      expect.objectContaining({ name: "Audience", color: "#f472b6" }),
      expect.objectContaining({ name: "Creative", color: "#6ee7b7" }),
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

  it("limits visual subagents to four", () => {
    const state = deriveNeuralCoreState(
      ["A", "B", "C", "D", "E"].map((name, index) =>
        event({
          agent_name: name,
          agent_type: "subagent",
          ts: new Date(NOW - index * 1_000).toISOString(),
        }),
      ),
      NOW,
    );

    expect(state.activeSubagents).toHaveLength(4);
    expect(state.activeSubagents.map((subagent) => subagent.name)).toEqual(["A", "B", "C", "D"]);
  });
});
