import { describe, it, expect } from "vitest";
import {
  validateSectionFields,
  themeSchema,
  settingsPatchSchema,
  trackingSecretsSchema,
  trackingSecretDeleteSchema,
} from "./validate";

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

  it("accepts well-formed tracking ID arrays (SPEC-015)", () => {
    const r = settingsPatchSchema.safeParse({
      tracking: {
        meta_pixels: ["653995666521954", "100200300400500"],
        ga4_ids: ["G-Z60CJ7W2Z8"],
        google_ads_ids: ["AW-123456789", "AW-123456789/AbC-D_efG"],
      },
    });
    expect(r.success).toBe(true);
  });

  it("rejects malformed tracking IDs, oversized arrays and consent_key injection", () => {
    expect(settingsPatchSchema.safeParse({ tracking: { meta_pixels: ["123"] } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ tracking: { ga4_ids: ["UA-12345"] } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ tracking: { google_ads_ids: ["12345"] } }).success).toBe(false);
    expect(
      settingsPatchSchema.safeParse({ tracking: { meta_pixels: ['1234567890123"><script>'] } }).success,
    ).toBe(false);
    expect(
      settingsPatchSchema.safeParse({ tracking: { meta_pixels: new Array(11).fill("653995666521954") } }).success,
    ).toBe(false);
    // consent_key (and any secret) is not an accepted key here — the schema is strict.
    expect(settingsPatchSchema.safeParse({ tracking: { consent_key: "x" } }).success).toBe(false);
    expect(settingsPatchSchema.safeParse({ tracking: { capi_token: "secret" } }).success).toBe(false);
  });
});

describe("trackingSecretsSchema (Phase 2 — write-only secrets)", () => {
  it("accepts well-formed meta/ga4/google_ads secret entries", () => {
    const r = trackingSecretsSchema.safeParse({
      entries: [
        { provider: "meta", public_id: "653995666521954", secret: { capi_token: "EAABsbCS1iHgBA_long_token_value" }, test_event_code: "TEST12345" },
        { provider: "ga4", public_id: "G-Z60CJ7W2Z8", secret: { api_secret: "abc123_apisecret_value" } },
        {
          provider: "google_ads",
          public_id: "1234567890",
          secret: {
            developer_token: "dev_token_1234567890",
            conversion_action: "987654321",
            client_id: "1234567890-abc.apps.googleusercontent.com",
            client_secret: "GOCSPX-secret_value_123",
            refresh_token: "1//refresh_token_value_123",
          },
        },
      ],
    });
    expect(r.success).toBe(true);
  });

  it("rejects unknown keys, malformed ids, and empty/oversized payloads", () => {
    // extra/unknown key in the entry (.strict)
    expect(
      trackingSecretsSchema.safeParse({ entries: [{ provider: "meta", public_id: "653995666521954", secret: { capi_token: "tokenvalue1" }, evil: 1 }] }).success,
    ).toBe(false);
    // unknown key inside secret (.strict) — can't smuggle extra fields
    expect(
      trackingSecretsSchema.safeParse({ entries: [{ provider: "meta", public_id: "653995666521954", secret: { capi_token: "tokenvalue1", extra: "x" } }] }).success,
    ).toBe(false);
    // malformed pixel id
    expect(
      trackingSecretsSchema.safeParse({ entries: [{ provider: "meta", public_id: "123", secret: { capi_token: "tokenvalue1" } }] }).success,
    ).toBe(false);
    // token with a space (not printable-only)
    expect(
      trackingSecretsSchema.safeParse({ entries: [{ provider: "meta", public_id: "653995666521954", secret: { capi_token: "has space" } }] }).success,
    ).toBe(false);
    // empty entries
    expect(trackingSecretsSchema.safeParse({ entries: [] }).success).toBe(false);
    // wrong secret shape for provider (ga4 needs api_secret, not capi_token)
    expect(
      trackingSecretsSchema.safeParse({ entries: [{ provider: "ga4", public_id: "G-Z60CJ7W2Z8", secret: { capi_token: "tokenvalue1" } }] }).success,
    ).toBe(false);
  });

  it("validates the delete payload (provider + public_id only)", () => {
    expect(trackingSecretDeleteSchema.safeParse({ provider: "meta", public_id: "653995666521954" }).success).toBe(true);
    expect(trackingSecretDeleteSchema.safeParse({ provider: "ga4", public_id: "G-Z60CJ7W2Z8" }).success).toBe(true);
    expect(trackingSecretDeleteSchema.safeParse({ provider: "facebook", public_id: "x" }).success).toBe(false);
    expect(trackingSecretDeleteSchema.safeParse({ provider: "meta", public_id: "x", secret: { capi_token: "y" } }).success).toBe(false);
  });
});
