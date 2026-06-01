import { beforeEach, describe, expect, it, vi } from "vitest";

type Result = { data: unknown; error: unknown };

const state = {
  results: {
    agent_jobs: [] as Result[],
    agent_events: [] as Result[],
  },
};

function query(table: "agent_jobs" | "agent_events") {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    in: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    then: (onfulfilled: (value: Result) => unknown, onrejected?: (reason: unknown) => unknown) => {
      const result = state.results[table].shift() ?? { data: [], error: null };
      return Promise.resolve(result).then(onfulfilled, onrejected);
    },
  });
  return q;
}

vi.mock("@/lib/db/client", () => ({
  db: () => ({ from: (table: "agent_jobs" | "agent_events") => query(table) }),
}));

import {
  getProcesses,
  mapAgentJobToLiveProcess,
  mapRunLifecycleEventsToLiveProcesses,
} from "@/lib/services/events";

const BASE_JOB = {
  id: "job-1",
  skill: "create-traffic-brunobracaioli-campaign",
  kind: "create",
  created_at: "2026-06-01T12:00:00.000Z",
  claimed_at: null,
  started_at: null,
  finished_at: null,
  error: null,
};

beforeEach(() => {
  state.results.agent_jobs = [];
  state.results.agent_events = [];
});

describe("mapAgentJobToLiveProcess", () => {
  it.each([
    ["pending", "active"],
    ["claimed", "active"],
    ["running", "active"],
    ["completed", "success"],
    ["failed", "error"],
    ["cancelled", "error"],
  ] as const)("maps %s to %s", (status, expectedState) => {
    expect(mapAgentJobToLiveProcess({ ...BASE_JOB, status })).toMatchObject({
      id: "job-1",
      source: "agent_job",
      state: expectedState,
      phase: status,
    });
  });
});

describe("mapRunLifecycleEventsToLiveProcesses", () => {
  it("infers an active direct run from a run-skill start event", () => {
    expect(
      mapRunLifecycleEventsToLiveProcesses([
        {
          id: "evt-1",
          run_id: "run-1",
          ts: "2026-06-01T12:00:00.000Z",
          agent_name: "create-traffic-brunobracaioli-campaign",
          event_type: "start",
          summary: "skill iniciada",
          payload: { skill: "create-traffic-brunobracaioli-campaign" },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "run-1",
        source: "agent_run",
        state: "active",
        kind: "create",
        phase: "start",
      }),
    ]);
  });

  it("turns a direct run terminal on end or error events", () => {
    expect(
      mapRunLifecycleEventsToLiveProcesses([
        {
          id: "evt-1",
          run_id: "run-1",
          ts: "2026-06-01T12:00:00.000Z",
          agent_name: "activate-campaign-brunobracaioli",
          event_type: "start",
          summary: "skill iniciada",
          payload: { skill: "activate-campaign-brunobracaioli" },
        },
        {
          id: "evt-2",
          run_id: "run-1",
          ts: "2026-06-01T12:05:00.000Z",
          agent_name: "activate-campaign-brunobracaioli",
          event_type: "error",
          summary: "skill falhou com exit 1",
          payload: { skill: "activate-campaign-brunobracaioli", exit_code: 1 },
        },
      ]),
    ).toEqual([
      expect.objectContaining({
        id: "run-1",
        source: "agent_run",
        state: "error",
        kind: "activate",
        phase: "error",
        finishedAt: "2026-06-01T12:05:00.000Z",
        error: "skill falhou com exit 1",
      }),
    ]);
  });
});

describe("getProcesses", () => {
  it("returns active and terminal job processes plus direct run processes", async () => {
    state.results.agent_jobs = [
      {
        data: [
          {
            ...BASE_JOB,
            id: "job-active",
            status: "running",
            started_at: "2026-06-01T12:01:00.000Z",
          },
        ],
        error: null,
      },
      {
        data: [
          {
            ...BASE_JOB,
            id: "job-done",
            status: "completed",
            finished_at: "2026-06-01T12:10:00.000Z",
          },
        ],
        error: null,
      },
    ];
    state.results.agent_events = [
      {
        data: [
          {
            id: "evt-1",
            run_id: "run-direct",
            ts: "2026-06-01T12:02:00.000Z",
            agent_name: "create-traffic-brunobracaioli-campaign",
            event_type: "start",
            summary: "skill iniciada",
            payload: { skill: "create-traffic-brunobracaioli-campaign" },
          },
        ],
        error: null,
      },
    ];

    const processes = await getProcesses();

    expect(processes).toEqual([
      expect.objectContaining({ id: "run-direct", source: "agent_run", state: "active" }),
      expect.objectContaining({ id: "job-active", source: "agent_job", state: "active" }),
      expect.objectContaining({ id: "job-done", source: "agent_job", state: "success" }),
    ]);
  });
});
