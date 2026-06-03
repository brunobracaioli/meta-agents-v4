import { describe, it, expect } from "vitest";
import { applyScalarEdit } from "./edit-path";

describe("applyScalarEdit", () => {
  it("sets an existing top-level string leaf without mutating the input", () => {
    const fields = { headline: "antigo", subhead: "x" };
    const r = applyScalarEdit(fields, "headline", "novo");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.fields).toEqual({ headline: "novo", subhead: "x" });
      expect(r.applied).toEqual({ from: "antigo", to: "novo" });
    }
    expect(fields.headline).toBe("antigo"); // immutability
  });

  it("sets a nested array item field by path", () => {
    const fields = { items: [{ title: "a", desc: "x" }, { title: "b", desc: "y" }] };
    const r = applyScalarEdit(fields, "items.1.title", "novo");
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.fields.items as { title: string }[])[1]!.title).toBe("novo");
  });

  it("coerces to the leaf's number type", () => {
    const r = applyScalarEdit({ count: 3 }, "count", "7");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.fields.count).toBe(7);
    expect(applyScalarEdit({ count: 3 }, "count", "abc").ok).toBe(false);
  });

  it("coerces to the leaf's boolean type (pt/en truthy/falsy)", () => {
    const t = applyScalarEdit({ on: false }, "on", "sim");
    expect(t.ok && t.fields.on).toBe(true);
    const f = applyScalarEdit({ on: true }, "on", "não");
    expect(f.ok && f.fields.on).toBe(false);
    expect(applyScalarEdit({ on: true }, "on", "talvez").ok).toBe(false);
  });

  it("rejects non-existent keys (cannot create structure)", () => {
    expect(applyScalarEdit({ a: "x" }, "b", "y").ok).toBe(false);
    expect(applyScalarEdit({ a: { b: "x" } }, "a.c", "y").ok).toBe(false);
  });

  it("rejects out-of-range array indices", () => {
    expect(applyScalarEdit({ items: ["a"] }, "items.5", "y").ok).toBe(false);
  });

  it("rejects setting a non-scalar (object/array) leaf", () => {
    expect(applyScalarEdit({ items: ["a"] }, "items", "y").ok).toBe(false);
    expect(applyScalarEdit({ obj: { a: 1 } }, "obj", "y").ok).toBe(false);
  });

  it("rejects an empty path", () => {
    expect(applyScalarEdit({ a: "x" }, "", "y").ok).toBe(false);
  });
});
