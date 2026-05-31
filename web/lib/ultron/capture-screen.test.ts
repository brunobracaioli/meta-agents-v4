import { describe, it, expect, vi } from "vitest";

// tools.ts touches db()/ratelimit lazily inside handlers; stub them so module load
// and runTool() stay isolated from real infra.
vi.mock("@/lib/db/client", () => ({ db: () => ({ from: () => ({}) }) }));
vi.mock("@/lib/ratelimit", () => ({
  rateLimiters: {},
  enforceLimit: () => Promise.resolve({ allowed: true }),
}));

import { toolSpecs, runTool, CLIENT_TOOLS } from "@/lib/ultron/tools";

describe("capture_screen tool", () => {
  it("is advertised to Claude in toolSpecs", () => {
    expect(toolSpecs.some((t) => t.name === "capture_screen")).toBe(true);
  });

  it("is the only client-side tool", () => {
    expect([...CLIENT_TOOLS]).toEqual(["capture_screen"]);
  });

  it("never executes server-side — runTool has no handler for it", async () => {
    const res = (await runTool("capture_screen", {})) as Record<string, unknown>;
    expect(res.error).toBeTruthy();
  });
});
