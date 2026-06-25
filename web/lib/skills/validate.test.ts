import { describe, it, expect } from "vitest";
import { skillCreateSchema, RESERVED_SLUGS } from "./validate";

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
