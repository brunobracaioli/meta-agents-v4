import { describe, it, expect } from "vitest";
import { skillCreateSchema, RESERVED_SLUGS, recurrenceSchema, recurrenceToCron } from "./validate";

const CLIENT = "11111111-1111-1111-1111-111111111111";

function base(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT,
    slug: "daily-roas-report",
    name: "Relatório ROAS",
    body: "## Passos\n1. Buscar insights.",
    tool_groups: ["meta_insights"],
    capability: "read",
    ...overrides,
  };
}

describe("skillCreateSchema", () => {
  it("accepts a minimal read skill", () => {
    const r = skillCreateSchema.safeParse(base());
    expect(r.success).toBe(true);
  });

  it("rejects a reserved (baked) slug", () => {
    const reserved = [...RESERVED_SLUGS][0]!;
    const r = skillCreateSchema.safeParse(base({ slug: reserved }));
    expect(r.success).toBe(false);
  });

  it("rejects an invalid slug charset", () => {
    expect(skillCreateSchema.safeParse(base({ slug: "Has Spaces" })).success).toBe(false);
    expect(skillCreateSchema.safeParse(base({ slug: "a" })).success).toBe(false);
  });

  it("requires capability=write when a write group is selected", () => {
    const bad = skillCreateSchema.safeParse(base({ tool_groups: ["meta_campaign_write"], capability: "read" }));
    expect(bad.success).toBe(false);
    const ok = skillCreateSchema.safeParse(base({ tool_groups: ["meta_campaign_write"], capability: "write" }));
    expect(ok.success).toBe(true);
  });

  it("rejects unknown tool groups", () => {
    expect(skillCreateSchema.safeParse(base({ tool_groups: ["nope"] })).success).toBe(false);
  });

  it("requires ultron_function when ultron_enabled", () => {
    const bad = skillCreateSchema.safeParse(base({ ultron_enabled: true }));
    expect(bad.success).toBe(false);
    const ok = skillCreateSchema.safeParse(
      base({
        ultron_enabled: true,
        ultron_function: { name: "run_report", description: "Quando pedir o relatório.", parameters: { type: "object" } },
      }),
    );
    expect(ok.success).toBe(true);
  });

  it("rejects an over-long body (DoS bound)", () => {
    expect(skillCreateSchema.safeParse(base({ body: "x".repeat(20_001) })).success).toBe(false);
  });
});

describe("recurrenceSchema", () => {
  it("requires the fields each freq needs", () => {
    expect(recurrenceSchema.safeParse({ freq: "hourly", every_n_hours: 6 }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ freq: "hourly" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "daily", time: "09:00" }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ freq: "daily" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "weekly", time: "08:00", weekday: 1 }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ freq: "weekly", time: "08:00" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "monthly", time: "10:00", monthday: 1 }).success).toBe(true);
    expect(recurrenceSchema.safeParse({ freq: "monthly", time: "10:00", monthday: 31 }).success).toBe(false);
  });

  it("rejects malformed times", () => {
    expect(recurrenceSchema.safeParse({ freq: "daily", time: "25:00" }).success).toBe(false);
    expect(recurrenceSchema.safeParse({ freq: "daily", time: "9:5" }).success).toBe(false);
  });

  it("compiles to a cron expression", () => {
    expect(recurrenceToCron({ freq: "daily", time: "09:30" })).toBe("30 9 * * *");
    expect(recurrenceToCron({ freq: "weekly", time: "08:00", weekday: 1 })).toBe("0 8 * * 1");
    expect(recurrenceToCron({ freq: "monthly", time: "10:00", monthday: 5 })).toBe("0 10 5 * *");
    expect(recurrenceToCron({ freq: "hourly", every_n_hours: 6 })).toBe("0 */6 * * *");
  });
});
