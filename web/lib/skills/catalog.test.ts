import { describe, it, expect } from "vitest";
import {
  BASE_TOOLS,
  TOOL_GROUPS,
  expandAllowedTools,
  selectionHasWrite,
  deriveSelectedGroups,
  isValidGroupId,
} from "./catalog";

describe("skill tool catalog", () => {
  it("always includes base tools when expanding", () => {
    // arrange + act
    const tools = expandAllowedTools([]);
    // assert
    for (const base of BASE_TOOLS) expect(tools).toContain(base);
  });

  it("expands a read group without duplicating base tools", () => {
    const tools = expandAllowedTools(["meta_insights"]);
    const reads = tools.filter((t) => t === "Read");
    expect(reads).toHaveLength(1);
    expect(tools).toContain("mcp__claude_ai_MCP_META_ADS_B2_TECH__get_insights");
  });

  it("flags write-tier selections", () => {
    expect(selectionHasWrite(["meta_insights"])).toBe(false);
    expect(selectionHasWrite(["meta_insights", "meta_campaign_write"])).toBe(true);
    expect(selectionHasWrite(["meta_activate"])).toBe(true);
  });

  it("ignores unknown group ids", () => {
    expect(isValidGroupId("does_not_exist")).toBe(false);
    // expandAllowedTools silently drops unknown ids (only base tools survive)
    expect(expandAllowedTools(["does_not_exist"]).sort()).toEqual([...BASE_TOOLS].sort());
  });

  it("round-trips expand -> derive for every single group", () => {
    for (const g of TOOL_GROUPS) {
      const derived = deriveSelectedGroups(expandAllowedTools([g.id]));
      expect(derived).toContain(g.id);
    }
  });

  it("derive only reports groups whose full tool set is present", () => {
    // meta_insights tools alone must NOT imply a write group is selected
    const derived = deriveSelectedGroups(expandAllowedTools(["meta_insights"]));
    expect(derived).toContain("meta_insights");
    expect(derived).not.toContain("meta_campaign_write");
    expect(derived).not.toContain("meta_activate");
  });
});
