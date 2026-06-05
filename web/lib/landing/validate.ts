import { z } from "zod";
import { FONT_ALLOWLIST } from "./constants";

// Validation for the landing-page editor's write boundary (SPEC-012 §7). The draft is
// rendered both in the dashboard preview and, on publish, into a static site — so every
// edited value is untrusted input that must be bounded and sanitized here.

// ---------- Theme tokens ----------
// Theme values become a `:root { --token: value }` stylesheet (serializer buildThemeCss).
// Constraining colors to hex and fonts to an allowlist guarantees a value can never contain
// "</style>" or other CSS/HTML-breaking sequences — the injection vector for the preview.

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "cor inválida (use hex, ex.: #FF6B1A)");

const font = z
  .string()
  .refine((v) => (FONT_ALLOWLIST as readonly string[]).includes(v), "fonte não permitida");

export const themeSchema = z
  .object({
    fonts: z.object({ title: font.optional(), body: font.optional() }).strict().optional(),
    scale: z.number().min(0.8).max(1.3).optional(),
    colors: z
      .object({
        orange: hex.optional(),
        orangeHi: hex.optional(),
        navy900: hex.optional(),
        navy800: hex.optional(),
        text: hex.optional(),
        textDim: hex.optional(),
        bg: hex.optional(),
        bgAlt: hex.optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type ThemePatch = z.infer<typeof themeSchema>;

// ---------- Page settings (editable subset) ----------
// Only fields the operator may change here; subdomain/site_url are NOT editable post-generation
// (they define identity/deploy). The PUBLIC tracking IDs are editable (see trackingPatchSchema
// below); tracking SECRETS are not (separate store, Phase 2). Patches merge into the settings.

const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https?:\/\//i.test(u), "use uma URL http(s)");

/** A brand/og image URL: http(s) OR empty (empty clears the field). */
const imageUrlOrEmpty = z
  .string()
  .max(2000)
  .refine((u) => u === "" || /^https?:\/\//i.test(u), "use uma URL http(s) de imagem");

// ---------- Tracking IDs (PUBLIC only) ----------
// These IDs are baked into the public static site (content-spec.json), so they are the
// operator's untrusted input and must be strictly shaped: a whitelisting regex guarantees a
// value can never contain `<`, `"` or `</script>` (the injection vector). SERVER-SIDE SECRETS
// (CAPI token, GA4 API secret) are NOT accepted here — they live in a separate RLS-locked
// store the serializer never reads (Phase 2). See ADR 0021 / SPEC-015.
const MAX_IDS = 10;
const metaPixelId = z.string().regex(/^\d{15,16}$/, "Pixel ID inválido (15–16 dígitos)");
const ga4Id = z.string().regex(/^G-[A-Z0-9]{6,12}$/, "GA4 inválido (ex.: G-XXXXXXX)");
// Google Ads conversion tag: AW-<id> with an optional "/<conversion_label>".
const googleAdsId = z
  .string()
  .regex(/^AW-[0-9]{9,12}(\/[A-Za-z0-9_-]{1,40})?$/, "Google Ads inválido (ex.: AW-123456789 ou AW-123456789/AbC-D)");

const trackingPatchSchema = z
  .object({
    meta_pixels: z.array(metaPixelId).max(MAX_IDS),
    ga4_ids: z.array(ga4Id).max(MAX_IDS),
    google_ads_ids: z.array(googleAdsId).max(MAX_IDS),
  })
  .partial()
  .strict();

// ---------- Tracking SECRETS (write-only; SEPARATE store, never settings/content-spec) ----------
// Phase 2 (ADR 0021 / SPEC-015 §7.5). These never touch `settings.tracking` — they go to the
// RLS-locked `lp_tracking_secrets` table via PUT /api/landing-pages/:id/tracking-secrets. The
// GET status endpoint NEVER returns these values. Tokens are opaque, printable, bounded.
const secretToken = z.string().min(10).max(4096).regex(/^[\x21-\x7E]+$/, "token inválido (sem espaços)");
const adsCustomerId = z.string().regex(/^(AW-)?\d{9,12}$/, "customer id inválido (ex.: 1234567890)");
const testEventCode = z.string().max(40).regex(/^[A-Za-z0-9]+$/, "test_event_code inválido");

const metaSecretEntry = z
  .object({
    provider: z.literal("meta"),
    public_id: metaPixelId,
    secret: z.object({ capi_token: secretToken }).strict(),
    test_event_code: testEventCode.optional(),
  })
  .strict();
const ga4SecretEntry = z
  .object({
    provider: z.literal("ga4"),
    public_id: ga4Id,
    secret: z.object({ api_secret: secretToken }).strict(),
  })
  .strict();
const googleAdsSecretEntry = z
  .object({
    provider: z.literal("google_ads"),
    public_id: adsCustomerId,
    secret: z
      .object({
        developer_token: secretToken,
        conversion_action: z.string().regex(/^\d{6,20}$/, "conversion action inválida"),
        login_customer_id: z.string().regex(/^\d{9,12}$/, "login customer id inválido").optional(),
        client_id: z.string().min(10).max(200),
        client_secret: secretToken,
        refresh_token: secretToken,
      })
      .strict(),
  })
  .strict();

export const trackingSecretsSchema = z
  .object({
    entries: z
      .array(z.discriminatedUnion("provider", [metaSecretEntry, ga4SecretEntry, googleAdsSecretEntry]))
      .min(1)
      .max(30),
  })
  .strict();

export type TrackingSecretsInput = z.infer<typeof trackingSecretsSchema>;

export const trackingSecretDeleteSchema = z
  .object({
    provider: z.enum(["meta", "ga4", "google_ads"]),
    public_id: z.string().min(1).max(64),
  })
  .strict();

export const settingsPatchSchema = z
  .object({
    seo: z
      .object({
        title: z.string().max(200),
        description: z.string().max(400),
        ogAlt: z.string().max(200),
        ogImage: imageUrlOrEmpty,
      })
      .partial()
      .strict()
      .optional(),
    logo: imageUrlOrEmpty.optional(),
    tracking: trackingPatchSchema.optional(),
    checkout_url: httpUrl.optional(),
    waitlist_url: httpUrl.optional(),
    price_cents: z.number().int().min(0).max(100_000_000).optional(),
    cart_state: z.enum(["open", "closed"]).optional(),
    deadline: z.string().max(40).optional(),
    cartClosed: z
      .object({
        headline: z.string().max(300),
        subhead: z.string().max(600),
        waitlistCtaLabel: z.string().max(120),
      })
      .partial()
      .strict()
      .optional(),
  })
  .strict();

export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

// ---------- Section fields ----------
// `fields` is a per-type copy object; rather than hardcode 17 shapes here (Wave 6 adds
// per-type Zod), v1 enforces structural bounds + sanitizes link hrefs. React escapes text
// on render, so the residual risk is hostile hrefs and oversized payloads.

const MAX_DEPTH = 6;
const MAX_STRING = 8000;
const MAX_ARRAY = 200;
const MAX_KEYS = 100;
const MAX_NODES = 3000;

/** Reject hrefs that aren't http(s), root-relative, anchor, mailto or tel — blocks
 * `javascript:`/`data:` URIs. Shared with the per-type section schemas (section-schemas.ts). */
export function isSafeHref(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith("javascript:") || v.startsWith("data:") || v.startsWith("vbscript:")) return false;
  return /^(https?:\/\/|\/|#|mailto:|tel:)/.test(v);
}

export function validateSectionFields(input: unknown): { ok: true } | { ok: false; error: string } {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "fields deve ser um objeto" };
  }
  let nodes = 0;
  const visit = (value: unknown, depth: number, key: string | null): string | null => {
    if (++nodes > MAX_NODES) return "conteúdo grande demais";
    if (depth > MAX_DEPTH) return "estrutura aninhada demais";
    if (value === null) return null;
    switch (typeof value) {
      case "string":
        if (value.length > MAX_STRING) return "texto longo demais";
        if (key === "href" && !isSafeHref(value)) return "link não permitido (use http(s))";
        return null;
      case "number":
        return Number.isFinite(value) ? null : "número inválido";
      case "boolean":
        return null;
      case "object": {
        if (Array.isArray(value)) {
          if (value.length > MAX_ARRAY) return "lista grande demais";
          for (const item of value) {
            const err = visit(item, depth + 1, key);
            if (err) return err;
          }
          return null;
        }
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length > MAX_KEYS) return "objeto com chaves demais";
        for (const [k, v] of entries) {
          const err = visit(v, depth + 1, k);
          if (err) return err;
        }
        return null;
      }
      default:
        return "tipo de valor não suportado";
    }
  };
  const err = visit(input, 1, null);
  return err ? { ok: false, error: err } : { ok: true };
}
