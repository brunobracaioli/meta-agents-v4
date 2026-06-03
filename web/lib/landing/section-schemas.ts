import { z } from "zod";
import type { SectionType } from "@b2tech/lp-render/content-types";
import { isSafeHref, validateSectionFields } from "./validate";

// Per-type whitelist schemas for a section's `fields` (SPEC-012 §7, Wave 6 hardening).
//
// `fields` mirrors the template's Messages shape (one object per SectionType). Wave 4 shipped
// only a structural guard (depth/size/href caps in validateSectionFields); this adds a per-type
// schema so each section is a true WHITELIST: unknown keys are rejected (`.strict()`), values
// are type-checked, and link hrefs are sanitized. Tampering via an unrendered/oversized key,
// or a hostile `comparison.rows` cell type, is rejected at the write boundary.
//
// Design choices:
// - Every field is `.optional()` on purpose. The schema validates SHAPE and KEYS, not content
//   completeness — a half-generated draft (some fields empty) must still be editable/saveable.
//   Required-ness is a content-quality concern, not a security boundary.
// - `.strict()` everywhere is the actual whitelist: a key the renderer never reads can't be
//   smuggled into storage.
// - String caps come from the structural guard (validateSectionFields, MAX_STRING) which always
//   runs first; here `txt` is generously bounded so real generated copy is never rejected.

const MAX_STRING = 8000;
const MAX_ARRAY = 200;

const txt = z.string().max(MAX_STRING);
/** A comparison cell: true = ✓, false = ✗, string = custom text (CompareCell). */
const compareCell = z.union([z.boolean(), txt]);
/** A footer/link href, restricted to safe schemes (blocks javascript:/data:/vbscript:). */
const href = z.string().max(2000).refine(isSafeHref, "link não permitido (use http(s))");

const arr = <T extends z.ZodTypeAny>(item: T) => z.array(item).max(MAX_ARRAY);

const iconCard = z.object({ icon: txt.optional(), title: txt.optional(), desc: txt.optional() }).strict();

/** Maps each SectionType to the strict schema of its editable `fields`. */
export const SECTION_SCHEMAS: Record<SectionType, z.ZodTypeAny> = {
  hero: z
    .object({ badge: txt.optional(), headline: txt.optional(), subhead: txt.optional(), ctaLabel: txt.optional() })
    .strict(),
  urgency: z.object({ label: txt.optional(), scarcity: txt.optional() }).strict(),
  problem: z.object({ heading: txt.optional(), body: txt.optional(), bullets: arr(txt).optional() }).strict(),
  comparison: z
    .object({
      heading: txt.optional(),
      subhead: txt.optional(),
      ours: txt.optional(),
      theirs: txt.optional(),
      rows: arr(
        z.object({ label: txt.optional(), ours: compareCell.optional(), theirs: compareCell.optional() }).strict(),
      ).optional(),
    })
    .strict(),
  solution: z.object({ heading: txt.optional(), body: txt.optional() }).strict(),
  features: z.object({ heading: txt.optional(), subhead: txt.optional(), items: arr(iconCard).optional() }).strict(),
  curriculum: z
    .object({
      heading: txt.optional(),
      subhead: txt.optional(),
      modules: arr(z.object({ title: txt.optional(), desc: txt.optional() }).strict()).optional(),
    })
    .strict(),
  stats: z
    .object({
      heading: txt.optional(),
      items: arr(z.object({ value: txt.optional(), label: txt.optional() }).strict()).optional(),
    })
    .strict(),
  proof: z
    .object({
      heading: txt.optional(),
      subhead: txt.optional(),
      testimonials: arr(z.object({ quote: txt.optional(), author: txt.optional() }).strict()).optional(),
    })
    .strict(),
  logos: z.object({ heading: txt.optional(), items: arr(txt).optional() }).strict(),
  persona: z.object({ heading: txt.optional(), subhead: txt.optional(), items: arr(iconCard).optional() }).strict(),
  authority: z
    .object({
      eyebrow: txt.optional(),
      name: txt.optional(),
      bio: txt.optional(),
      credentials: arr(txt).optional(),
      image: txt.optional(),
    })
    .strict(),
  guarantee: z.object({ heading: txt.optional(), body: txt.optional(), seal: txt.optional() }).strict(),
  offer: z
    .object({
      heading: txt.optional(),
      priceLabel: txt.optional(),
      anchor: txt.optional(),
      installments: txt.optional(),
      bonuses: arr(txt).optional(),
      guarantee: txt.optional(),
      payments: arr(txt).optional(),
      secure: txt.optional(),
      ctaLabel: txt.optional(),
    })
    .strict(),
  faq: z.object({ items: arr(z.object({ q: txt.optional(), a: txt.optional() }).strict()).optional() }).strict(),
  finalCta: z.object({ headline: txt.optional(), ctaLabel: txt.optional() }).strict(),
  footer: z
    .object({
      legal: txt.optional(),
      links: arr(z.object({ label: txt.optional(), href: href.optional() }).strict()).optional(),
    })
    .strict(),
};

/**
 * Validate a section's `fields` for a given type at the write boundary. Runs the universal
 * structural guard first (depth/size/href caps — defends against pathological payloads on any
 * key), then the per-type whitelist schema (known keys + correct types). Returns a flat
 * ok/error result so API handlers and Ultron tools share one validation path.
 */
export function validateSection(type: string, fields: unknown): { ok: true } | { ok: false; error: string } {
  const structural = validateSectionFields(fields);
  if (!structural.ok) return structural;
  const schema = SECTION_SCHEMAS[type as SectionType];
  if (!schema) return { ok: false, error: `tipo de seção desconhecido: ${type}` };
  const parsed = schema.safeParse(fields);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "campos inválidos" };
  return { ok: true };
}
