import { describe, it, expect } from "vitest";
import type { ContentDoc, Settings, Theme } from "@b2tech/lp-render/content-doc";
import { reconcile, deepEqual, sectionDirtyKey, THEME_DIRTY_KEY, SETTINGS_DIRTY_KEY } from "./reconcile";

const theme: Theme = { scale: 1, colors: { orange: "#FF6B1A" } };
const settings = {
  subdomain: "cca-e2e",
  name: "CCA",
  product: "cca",
  site_url: "https://cca-e2e.b2tech.io",
  seo: { title: "t", description: "d", ogAlt: "a" },
  tracking: { fb_pixel_id: "", ga4_id: "", consent_key: "" },
  checkout_url: "https://pay.example/cca",
  price_cents: 9700,
  cart_state: "open",
  noindex: true,
  cartClosed: { headline: "h", subhead: "s", waitlistCtaLabel: "c" },
} as Settings;

function doc(heroHeadline: string, faqTitle = "faq"): ContentDoc {
  return {
    settings,
    theme,
    sections: [
      { type: "hero", position: 0, enabled: true, fields: { headline: heroHeadline, subhead: "x" } },
      { type: "faq", position: 1, enabled: true, fields: { title: faqTitle } },
    ],
  };
}

describe("deepEqual", () => {
  it("compares nested objects/arrays regardless of key order", () => {
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { b: { c: [1, 2] }, a: 1 })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });
});

describe("reconcile", () => {
  it("applies a remote section whose version advanced and is not dirty", () => {
    const r = reconcile({
      localDoc: doc("antigo"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: doc("novo"),
      remoteVersions: { hero: 2, faq: 1 },
      dirty: new Set(),
    });
    expect(r.changed).toBe(true);
    expect(r.doc.sections.find((s) => s.type === "hero")?.fields.headline).toBe("novo");
    expect(r.versions.hero).toBe(2);
    expect(r.versions.faq).toBe(1);
  });

  it("local wins: skips a section the operator is editing (dirty)", () => {
    const r = reconcile({
      localDoc: doc("digitando…"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: doc("novo do ultron"),
      remoteVersions: { hero: 2, faq: 1 },
      dirty: new Set([sectionDirtyKey("hero")]),
    });
    expect(r.changed).toBe(false);
    expect(r.doc.sections.find((s) => s.type === "hero")?.fields.headline).toBe("digitando…");
    expect(r.versions.hero).toBe(1);
  });

  it("ignores a remote version that is not newer", () => {
    const r = reconcile({
      localDoc: doc("atual"),
      localVersions: { hero: 3, faq: 1 },
      remoteDoc: doc("velho"),
      remoteVersions: { hero: 2, faq: 1 },
      dirty: new Set(),
    });
    expect(r.changed).toBe(false);
    expect(r.doc.sections.find((s) => s.type === "hero")?.fields.headline).toBe("atual");
  });

  it("applies theme changes by content when theme is not dirty", () => {
    const remote = { ...doc("antigo"), theme: { ...theme, scale: 1.2 } };
    const r = reconcile({
      localDoc: doc("antigo"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: remote,
      remoteVersions: { hero: 1, faq: 1 },
      dirty: new Set(),
    });
    expect(r.changed).toBe(true);
    expect(r.doc.theme.scale).toBe(1.2);
  });

  it("local wins on theme: skips when theme is dirty", () => {
    const remote = { ...doc("antigo"), theme: { ...theme, scale: 1.2 } };
    const r = reconcile({
      localDoc: doc("antigo"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: remote,
      remoteVersions: { hero: 1, faq: 1 },
      dirty: new Set([THEME_DIRTY_KEY]),
    });
    expect(r.changed).toBe(false);
    expect(r.doc.theme.scale).toBe(1);
  });

  it("applies settings changes by content unless dirty", () => {
    const remote = { ...doc("antigo"), settings: { ...settings, price_cents: 12000 } };
    const applied = reconcile({
      localDoc: doc("antigo"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: remote,
      remoteVersions: { hero: 1, faq: 1 },
      dirty: new Set(),
    });
    expect(applied.changed).toBe(true);
    expect(applied.doc.settings.price_cents).toBe(12000);

    const skipped = reconcile({
      localDoc: doc("antigo"),
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: remote,
      remoteVersions: { hero: 1, faq: 1 },
      dirty: new Set([SETTINGS_DIRTY_KEY]),
    });
    expect(skipped.changed).toBe(false);
  });

  it("returns the original doc reference unchanged when nothing applies", () => {
    const localDoc = doc("igual");
    const r = reconcile({
      localDoc,
      localVersions: { hero: 1, faq: 1 },
      remoteDoc: doc("igual"),
      remoteVersions: { hero: 1, faq: 1 },
      dirty: new Set(),
    });
    expect(r.changed).toBe(false);
    expect(r.doc).toBe(localDoc);
  });
});
