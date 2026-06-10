import { describe, expect, it } from "vitest";
import {
  compareSnapshots,
  pickPrimaryFinding,
  snapshotDisplayName,
  type FindingLike,
  type SortableSnapshot,
} from "./analyses-table-utils";

function snap(overrides: Partial<SortableSnapshot>): SortableSnapshot {
  return {
    meta_entity_id: "id",
    entity_name: "Campanha",
    spend_cents: null,
    ctr: null,
    cpc_cents: null,
    cplpv_cents: null,
    cpm_cents: null,
    results: null,
    ...overrides,
  };
}

function finding(overrides: Partial<FindingLike>): FindingLike {
  return {
    severity: "info",
    is_significant: false,
    recommendation_type: "observe",
    created_at: "2026-06-10T00:00:00Z",
    ...overrides,
  };
}

describe("compareSnapshots", () => {
  it("sorts descending metrics with highest first", () => {
    const rows = [snap({ ctr: 2.1 }), snap({ ctr: 10.7 }), snap({ ctr: 4.6 })];
    const sorted = [...rows].sort(compareSnapshots("ctr_desc"));
    expect(sorted.map((r) => r.ctr)).toEqual([10.7, 4.6, 2.1]);
  });

  it("sorts ascending metrics with lowest first", () => {
    const rows = [snap({ cpc_cents: 140 }), snap({ cpc_cents: 13 })];
    const sorted = [...rows].sort(compareSnapshots("cpc_asc"));
    expect(sorted.map((r) => r.cpc_cents)).toEqual([13, 140]);
  });

  it("always sinks null metrics to the bottom, regardless of direction", () => {
    const rows = [snap({ cpc_cents: null }), snap({ cpc_cents: 50 }), snap({ cpc_cents: null })];
    expect([...rows].sort(compareSnapshots("cpc_asc")).map((r) => r.cpc_cents)).toEqual([
      50,
      null,
      null,
    ]);
    const spendRows = [snap({ spend_cents: null }), snap({ spend_cents: 100 })];
    expect(
      [...spendRows].sort(compareSnapshots("spend_desc")).map((r) => r.spend_cents),
    ).toEqual([100, null]);
  });

  it("sorts by display name with meta_entity_id as fallback", () => {
    const rows = [
      snap({ entity_name: "Zebra" }),
      snap({ entity_name: null, meta_entity_id: "120001" }),
      snap({ entity_name: "Alfa" }),
    ];
    const sorted = [...rows].sort(compareSnapshots("name_asc"));
    expect(sorted.map(snapshotDisplayName)).toEqual(["120001", "Alfa", "Zebra"]);
  });
});

describe("pickPrimaryFinding", () => {
  it("returns null when there are no findings", () => {
    expect(pickPrimaryFinding([])).toBeNull();
  });

  it("prefers the highest severity", () => {
    const result = pickPrimaryFinding([
      finding({ severity: "low" }),
      finding({ severity: "critical" }),
      finding({ severity: "medium" }),
    ]);
    expect(result?.severity).toBe("critical");
  });

  it("breaks severity ties by significance", () => {
    const result = pickPrimaryFinding([
      finding({ severity: "medium", is_significant: false }),
      finding({ severity: "medium", is_significant: true }),
    ]);
    expect(result?.is_significant).toBe(true);
  });

  it("prefers actionable recommendations over observe/none", () => {
    const result = pickPrimaryFinding([
      finding({ recommendation_type: "observe" }),
      finding({ recommendation_type: "scale" }),
      finding({ recommendation_type: "none" }),
    ]);
    expect(result?.recommendation_type).toBe("scale");
  });

  it("breaks remaining ties by recency", () => {
    const result = pickPrimaryFinding([
      finding({ created_at: "2026-06-09T00:00:00Z" }),
      finding({ created_at: "2026-06-10T12:00:00Z" }),
    ]);
    expect(result?.created_at).toBe("2026-06-10T12:00:00Z");
  });

  it("treats unknown severities as lowest rank", () => {
    const result = pickPrimaryFinding([
      finding({ severity: "weird_value" }),
      finding({ severity: "info" }),
    ]);
    expect(result?.severity).toBe("info");
  });
});
