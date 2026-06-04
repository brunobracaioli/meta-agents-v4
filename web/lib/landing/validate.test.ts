import { describe, it, expect } from "vitest";
import { validateSectionFields, themeSchema, settingsPatchSchema } from "./validate";

describe("validateSectionFields", () => {
  it("accepts a normal nested section object", () => {
    const fields = {
      heading: "Recursos",
      items: [
        { icon: "bolt", title: "Rápido", desc: "Muito rápido." },
        { icon: "lock", title: "Seguro", desc: "Defesa em profundidade." },
      ],
    };
    expect(validateSectionFields(fields)).toEqual({ ok: true });
  });

  it("rejects a non-object root", () => {
    expect(validateSectionFields("x").ok).toBe(false);
    expect(validateSectionFields([]).ok).toBe(false);
    expect(validateSectionFields(null).ok).toBe(false);
  });

  it("rejects a javascript: href but accepts http(s)/relative/mailto", () => {
    expect(validateSectionFields({ links: [{ label: "x", href: "javascript:alert(1)" }] }).ok).toBe(false);
    expect(validateSectionFields({ links: [{ label: "x", href: "  JAVASCRIPT:alert(1)" }] }).ok).toBe(false);
    expect(validateSectionFields({ links: [{ label: "x", href: "data:text/html,x" }] }).ok).toBe(false);
    expect(validateSectionFields({ footer: { href: "https://b2tech.io" } }).ok).toBe(true);
    expect(validateSectionFields({ footer: { href: "/termos" } }).ok).toBe(true);
    expect(validateSectionFields({ footer: { href: "mailto:a@b.io" } }).ok).toBe(true);
  });

  it("rejects an oversized string", () => {
    expect(validateSectionFields({ body: "a".repeat(8001) }).ok).toBe(false);
  });

  it("rejects excessive nesting depth", () => {
    let deep: Record<string, unknown> = { v: 1 };
    for (let i = 0; i < 8; i++) deep = { nested: deep };
    expect(validateSectionFields(deep).ok).toBe(false);
  });

  it("rejects an over-long array", () => {
    expect(validateSectionFields({ items: new Array(201).fill("x") }).ok).toBe(false);
  });
});

describe("themeSchema", () => {
  it("accepts valid hex colors, allowlisted fonts and an in-range scale", () => {
    const r = themeSchema.safeParse({
      colors: { orange: "#FF6B1A", navy900: "#0A0F1A" },
      fonts: { title: "Inter", body: "DM Sans" },
      scale: 1.1,
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-hex color (blocks </style> injection)", () => {
    expect(themeSchema.safeParse({ colors: { orange: "#fff;}</style><script>" } }).success).toBe(false);
    expect(themeSchema.safeParse({ colors: { orange: "red" } }).success).toBe(false);
  });

  it("rejects a font outside the allowlist", () => {
    expect(themeSchema.safeParse({ fonts: { title: "Comic Sans" } }).success).toBe(false);
  });

  it("rejects an out-of-range scale and unknown keys", () => {
    expect(themeSchema.safeParse({ scale: 3 }).success).toBe(false);
    expect(themeSchema.safeParse({ bogus: 1 }).success).toBe(false);
  });
});

describe("settingsPatchSchema", () => {
  it("accepts a partial patch with an http(s) checkout url", () => {
    const r = settingsPatchSchema.safeParse({
      seo: { title: "Título" },
      checkout_url: "https://pay.hotmart.com/x",
      price_cents: 149700,
      cart_state: "open",
    });
    expect(r.success).toBe(true);
  });

  it("rejects a non-http checkout url and unknown keys", () => {
    expect(settingsPatchSchema.safeParse({ checkout_url: "javascript:alert(1)" }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ subdomain: "hijack" }).success).toBe(false);
  });

  it("rejects an invalid cart_state", () => {
    expect(settingsPatchSchema.safeParse({ cart_state: "halfopen" }).success).toBe(false);
  });

  it("accepts a brand logo / og image URL and empty (clear), rejects non-http (ADR 0018)", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/landing-assets/lp/logo.png";
    expect(settingsPatchSchema.safeParse({ logo: url }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ logo: "" }).success).toBe(true); // clear
    expect(settingsPatchSchema.safeParse({ seo: { ogImage: url } }).success).toBe(true);
    expect(settingsPatchSchema.safeParse({ logo: "javascript:alert(1)" }).success).toBe(false);
  });
});
