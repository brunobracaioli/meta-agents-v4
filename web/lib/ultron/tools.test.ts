import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Mocks (declared before importing the module under test) ---

type Result = { data: unknown; error: unknown };

const state = {
  clients: { data: null as unknown, error: null as unknown } as Result,
  campaigns: { data: null as unknown, error: null as unknown } as Result,
  jobInsert: { data: { id: "job-1" } as unknown, error: null as unknown } as Result,
  inserts: [] as Array<{ table: string; row: unknown }>,
};

function query(table: string) {
  const q: Record<string, unknown> = {};
  Object.assign(q, {
    select: () => q,
    eq: () => q,
    order: () => q,
    limit: () => q,
    insert: (row: unknown) => {
      state.inserts.push({ table, row });
      return q;
    },
    maybeSingle: () =>
      Promise.resolve(table === "clients" ? state.clients : table === "campaigns" ? state.campaigns : { data: null, error: null }),
    single: () => Promise.resolve(table === "agent_jobs" ? state.jobInsert : { data: null, error: null }),
  });
  return q;
}

vi.mock("@/lib/db/client", () => ({ db: () => ({ from: (t: string) => query(t) }) }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimiters: { campaignCreation: () => ({}), campaignActivation: () => ({}) },
  enforceLimit: vi.fn(async () => ({ allowed: true })),
}));

import { runTool } from "@/lib/ultron/tools";

const KNOWN_CLIENT = { id: "client-uuid", name: "Bruno", currency: "BRL", daily_budget_cap_cents: 5000 };

function pausedCampaign(overrides: Record<string, unknown> = {}) {
  return { data: { name: "[TRF][CCA] camp", status: "PAUSED", daily_budget_cents: 5000, meta_campaign_id: "120", ...overrides }, error: null };
}

beforeEach(() => {
  state.clients = { data: null, error: null };
  state.campaigns = { data: null, error: null };
  state.jobInsert = { data: { id: "job-1" }, error: null };
  state.inserts = [];
});

describe("request_campaign_creation", () => {
  it("with confirm=false asks for confirmation and does NOT enqueue", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    const out = (await runTool("request_campaign_creation", { client_slug: "brunobracaioli", confirm: false })) as Record<string, unknown>;
    expect(out.confirmation_required).toBe(true);
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects an unknown client and does NOT enqueue", async () => {
    state.clients = { data: null, error: null };
    const out = (await runTool("request_campaign_creation", { client_slug: "ghost", confirm: true })) as Record<string, unknown>;
    expect(out.error).toBeDefined();
    expect(state.inserts).toHaveLength(0);
  });

  it("rejects a client missing from the create allowlist", async () => {
    // Resolvable client row, but slug not in CREATE_SKILL_BY_SLUG.
    state.clients = { data: { ...KNOWN_CLIENT }, error: null };
    const out = (await runTool("request_campaign_creation", { client_slug: "outro", confirm: true })) as Record<string, unknown>;
    expect(out.error).toBeDefined();
    expect(state.inserts).toHaveLength(0);
  });

  it("with confirm=true enqueues a create job", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    const out = (await runTool("request_campaign_creation", { client_slug: "brunobracaioli", confirm: true })) as Record<string, unknown>;
    expect(out.enqueued).toBe(true);
    expect(out.job_id).toBe("job-1");
    expect(out.client_slug).toBe("brunobracaioli");
    expect(out.kind).toBe("create");
    expect(out.skill).toBe("create-traffic-brunobracaioli-campaign");
    expect(typeof out.queued_at).toBe("string");
    expect(state.inserts).toHaveLength(1);
    expect((state.inserts[0]!.row as Record<string, unknown>).kind).toBe("create");
    expect((state.inserts[0]!.row as Record<string, unknown>).skill).toBe("create-traffic-brunobracaioli-campaign");
  });

  it("surfaces an in-flight duplicate (unique violation) instead of throwing", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    state.jobInsert = { data: null, error: { code: "23505" } };
    const out = (await runTool("request_campaign_creation", { client_slug: "brunobracaioli", confirm: true })) as Record<string, unknown>;
    expect(out.enqueued).toBe(false);
    expect(out.reason).toContain("andamento");
  });
});

describe("request_campaign_activation", () => {
  it("with confirm=false on a PAUSED in-budget campaign asks for confirmation with a real-spend warning", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    state.campaigns = pausedCampaign();
    const out = (await runTool("request_campaign_activation", {
      client_slug: "brunobracaioli",
      campaign_meta_id: "120",
      confirm: false,
    })) as Record<string, unknown>;
    expect(out.confirmation_required).toBe(true);
    expect(out.warning).toBeDefined();
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses to activate an already-ACTIVE campaign", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    state.campaigns = pausedCampaign({ status: "ACTIVE" });
    const out = (await runTool("request_campaign_activation", {
      client_slug: "brunobracaioli",
      campaign_meta_id: "120",
      confirm: true,
    })) as Record<string, unknown>;
    expect(out.error).toBeDefined();
    expect(state.inserts).toHaveLength(0);
  });

  it("refuses to activate when daily budget exceeds the client cap", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    state.campaigns = pausedCampaign({ daily_budget_cents: 9000 });
    const out = (await runTool("request_campaign_activation", {
      client_slug: "brunobracaioli",
      campaign_meta_id: "120",
      confirm: true,
    })) as Record<string, unknown>;
    expect(out.error).toBeDefined();
    expect(state.inserts).toHaveLength(0);
  });

  it("with confirm=true on a valid PAUSED campaign enqueues an activate job", async () => {
    state.clients = { data: KNOWN_CLIENT, error: null };
    state.campaigns = pausedCampaign();
    const out = (await runTool("request_campaign_activation", {
      client_slug: "brunobracaioli",
      campaign_meta_id: "120",
      confirm: true,
    })) as Record<string, unknown>;
    expect(out.enqueued).toBe(true);
    expect(out.job_id).toBe("job-1");
    expect(out.client_slug).toBe("brunobracaioli");
    expect(out.kind).toBe("activate");
    expect(out.skill).toBe("activate-campaign-brunobracaioli");
    expect(typeof out.queued_at).toBe("string");
    expect(state.inserts).toHaveLength(1);
    expect((state.inserts[0]!.row as Record<string, unknown>).kind).toBe("activate");
    expect((state.inserts[0]!.row as Record<string, unknown>).args).toEqual({ campaign_meta_id: "120" });
  });
});
