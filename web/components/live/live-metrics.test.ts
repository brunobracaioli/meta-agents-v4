import { describe, expect, it } from "vitest";
import { bucketEventsPerMinute, eventsPerMinuteNow, eventTypeCounts } from "./live-metrics";
import type { LiveEvent } from "./neural-core-state";

const NOW = Date.parse("2026-06-01T13:00:00.000Z");
let nextId = 0;

function event(overrides: Partial<LiveEvent> = {}): LiveEvent {
  return {
    id: overrides.id ?? `evt-${(nextId += 1)}`,
    run_id: overrides.run_id ?? null,
    ts: overrides.ts ?? new Date(NOW).toISOString(),
    agent_name: overrides.agent_name ?? "Core Agent",
    agent_type: overrides.agent_type ?? "agent",
    event_type: overrides.event_type ?? "step",
    tool_name: overrides.tool_name ?? null,
    summary: overrides.summary ?? null,
  };
}

function eventAt(msAgo: number, eventType = "step"): LiveEvent {
  return event({ ts: new Date(NOW - msAgo).toISOString(), event_type: eventType });
}

describe("bucketEventsPerMinute", () => {
  it("returns all-zero buckets when there are no events", () => {
    expect(bucketEventsPerMinute([], NOW, 5)).toEqual([0, 0, 0, 0, 0]);
  });

  it("places events in minute buckets, oldest first", () => {
    const events = [eventAt(30_000), eventAt(45_000), eventAt(4 * 60_000 + 30_000)];
    expect(bucketEventsPerMinute(events, NOW, 5)).toEqual([1, 0, 0, 0, 2]);
  });

  it("ignores events outside the window and malformed timestamps", () => {
    const events = [
      eventAt(10 * 60_000), // beyond a 5-minute window
      eventAt(-60_000), // in the future
      event({ ts: "not-a-date" }),
      eventAt(10_000),
    ];
    expect(bucketEventsPerMinute(events, NOW, 5)).toEqual([0, 0, 0, 0, 1]);
  });

  it("clamps an event exactly at now into the last bucket", () => {
    expect(bucketEventsPerMinute([eventAt(0)], NOW, 3)).toEqual([0, 0, 1]);
  });
});

describe("eventsPerMinuteNow", () => {
  it("counts only events from the last 60s", () => {
    const events = [eventAt(10_000), eventAt(59_000), eventAt(61_000), eventAt(120_000)];
    expect(eventsPerMinuteNow(events, NOW)).toBe(2);
  });
});

describe("eventTypeCounts", () => {
  it("counts events by type inside the window", () => {
    const events = [
      eventAt(10_000, "start"),
      eventAt(20_000, "step"),
      eventAt(30_000, "step"),
      eventAt(40_000, "error"),
      eventAt(50_000, "end"),
      eventAt(6 * 60_000, "decision"), // outside the 5-minute window
      eventAt(15_000, "unknown-type"), // ignored
    ];
    expect(eventTypeCounts(events, NOW)).toEqual({ start: 1, step: 2, decision: 0, error: 1, end: 1 });
  });
});
