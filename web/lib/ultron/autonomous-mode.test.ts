import { beforeEach, describe, expect, it, vi } from "vitest";

// Focused tests for start/stop_autonomous_mode (ADR 0019). These tools use query shapes
// (.in/.gte/.update().select()) the shared tools.test.ts mock does not model, so they get a
// purpose-built chainable + thenable db() mock here.

type Res = { data: unknown; error: unknown };

const S = {
  client: null as unknown, // clients.maybeSingle
  job: null as unknown, // agent_jobs.maybeSingle (the landing job to watch)
  watchInsert: { id: "watch-1" } as unknown,
  watchInsertError: null as unknown,
  stopRows: [] as unknown, // autonomous_watches update().select() result
  inserts: [] as Array<{ table: string; row: unknown }>,
  updates: [] as Array<{ table: string; patch: unknown }>,
};

function builder(table: string) {
  let op: "select" | "insert" | "update" = "select";
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b,
    eq: () => b,
    in: () => b,
    gte: () => b,
    is: () => b,
    order: () => b,
    limit: () => b,
    insert: (row: unknown) => {
      op = "insert";
      S.inserts.push({ table, row });
      return b;
    },
    update: (patch: unknown) => {
      op = "update";
      S.updates.push({ table, patch });
      return b;
    },
    maybeSingle: async (): Promise<Res> => {
      if (table === "clients") return { data: S.client, error: null };
      if (table === "agent_jobs") return { data: S.job, error: null };
      return { data: null, error: null };
    },
    single: async (): Promise<Res> => {
      if (table === "autonomous_watches" && op === "insert") return { data: S.watchInsert, error: S.watchInsertError };
      return { data: null, error: null };
    },
    // Thenable: supports `await db().from(...).update(...).eq(...).in(...).select(...)` (stop)
    // and `await db().from("operation_logs").insert(...)` (audit log).
    then: (resolve: (r: Res) => unknown) => {
      let result: Res = { data: null, error: null };
      if (table === "autonomous_watches" && op === "update") result = { data: S.stopRows, error: null };
      return Promise.resolve(result).then(resolve);
    },
  });
  return b;
}

vi.mock("@/lib/db/client", () => ({ db: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimiters: {},
  enforceLimit: vi.fn(async () => ({ allowed: true })),
}));

import { runTool } from "@/lib/ultron/tools";

const CLIENT = { id: "client-uuid", name: "Bruno", currency: "BRL", daily_budget_cap_cents: 5000 };
const CTX = { sessionId: "sess-xyz", operatorId: null };

beforeEach(() => {
  S.client = null;
  S.job = null;
  S.watchInsert = { id: "watch-1" };
  S.watchInsertError = null;
  S.stopRows = [];
  S.inserts = [];
  S.updates = [];
});

describe("start_autonomous_mode", () => {
  it("rejects an unknown client and does NOT create a watch", async () => {
    S.client = null;
    const out = (await runTool("start_autonomous_mode", { client_slug: "ghost" }, CTX)) as Record<string, unknown>;
    expect(out.error).toBeDefined();
    expect(S.inserts).toHaveLength(0);
  });

  it("returns started=false when there is no recent landing job to watch", async () => {
    S.client = CLIENT;
    S.job = null;
    const out = (await runTool("start_autonomous_mode", { client_slug: "brunobracaioli" }, CTX)) as Record<string, unknown>;
    expect(out.started).toBe(false);
    expect(S.inserts.some((i) => i.table === "autonomous_watches")).toBe(false);
  });

  it("creates a watch bound to the landing job + this session, carrying the subdomain hint", async () => {
    S.client = CLIENT;
    S.job = { id: "job-9", status: "running", args: { nome: "promo" }, created_at: new Date().toISOString() };
    const out = (await runTool("start_autonomous_mode", { client_slug: "brunobracaioli" }, CTX)) as Record<string, unknown>;
    expect(out.started).toBe(true);
    expect(out.watch_id).toBe("watch-1");
    expect(out.target_hint).toBe("promo");
    const watchRow = S.inserts.find((i) => i.table === "autonomous_watches")?.row as Record<string, unknown>;
    expect(watchRow).toBeDefined();
    expect(watchRow.agent_job_id).toBe("job-9");
    expect(watchRow.session_id).toBe("sess-xyz");
    expect(watchRow.target_kind).toBe("landing_page");
    expect(watchRow.target_hint).toBe("promo");
  });

  it("surfaces an already-watching duplicate (unique violation) instead of throwing", async () => {
    S.client = CLIENT;
    S.job = { id: "job-9", status: "running", args: {}, created_at: new Date().toISOString() };
    S.watchInsert = null;
    S.watchInsertError = { code: "23505" };
    const out = (await runTool("start_autonomous_mode", { client_slug: "brunobracaioli" }, CTX)) as Record<string, unknown>;
    expect(out.started).toBe(false);
    expect(String(out.reason)).toContain("monitorando");
  });
});

describe("stop_autonomous_mode", () => {
  it("reports how many active watches it closed for this session", async () => {
    S.stopRows = [{ id: "watch-1" }, { id: "watch-2" }];
    const out = (await runTool("stop_autonomous_mode", {}, CTX)) as Record<string, unknown>;
    expect(out.stopped).toBe(2);
    const patch = S.updates.find((u) => u.table === "autonomous_watches")?.patch as Record<string, unknown>;
    expect(patch.phase).toBe("done");
    expect(typeof patch.closed_at).toBe("string");
  });

  it("is a no-op message when nothing is being watched", async () => {
    S.stopRows = [];
    const out = (await runTool("stop_autonomous_mode", {}, CTX)) as Record<string, unknown>;
    expect(out.stopped).toBe(0);
  });
});
