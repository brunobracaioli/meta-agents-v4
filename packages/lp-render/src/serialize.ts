// contentDocToFiles: the deterministic bridge from the editable ContentDoc (Supabase)
// to the exact artifacts the static-export build already consumes. Pure function — no
// I/O, no Date.now() — so it is trivially testable (round-trip) and identical whether it
// runs in the web app or on the Fly runner during a publish. See ADR 0015 / SPEC-012.

import type { ContentDoc, SectionDoc } from "./content-doc";
import {
  MIDDLE_SECTION_TYPES,
  type ContentSpec,
  type Messages,
  type SectionType,
} from "./content-types";

export interface SerializedFiles {
  /** messages/pt.json — all human copy. */
  messages: Messages;
  /** content-spec.json — machine spec (section order, tracking, seo, cart state). */
  contentSpec: ContentSpec;
  /** theme.css — :root token overrides; "" when the theme is empty. */
  themeCss: string;
}

const MIDDLE = new Set<SectionType>(MIDDLE_SECTION_TYPES);

function indexByType(sections: SectionDoc[]): Map<SectionType, SectionDoc> {
  const m = new Map<SectionType, SectionDoc>();
  for (const s of sections) m.set(s.type, s);
  return m;
}

/** Ordered list of the section types that are enabled, sorted by position. This is the
 * render order the template's PageBody iterates over (content-spec.json `sections`). */
function orderedEnabledTypes(sections: SectionDoc[]): SectionType[] {
  return [...sections]
    .filter((s) => s.enabled)
    .sort((a, b) => a.position - b.position)
    .map((s) => s.type);
}

function buildMessages(doc: ContentDoc): Messages {
  const byType = indexByType(doc.sections);
  const f = (t: SectionType): Record<string, unknown> => byType.get(t)?.fields ?? {};

  const middle: Messages["sections"] = {};
  for (const t of MIDDLE_SECTION_TYPES) {
    const s = byType.get(t);
    if (s) (middle as Record<string, unknown>)[t] = s.fields;
  }

  const faqSection = byType.get("faq");
  const faqItems = Array.isArray(faqSection?.fields.items)
    ? (faqSection.fields.items as Messages["faq"])
    : [];

  return {
    seo: doc.settings.seo,
    hero: f("hero") as Messages["hero"],
    sections: middle,
    offer: f("offer") as Messages["offer"],
    faq: faqItems,
    finalCta: f("finalCta") as Messages["finalCta"],
    cartClosed: doc.settings.cartClosed,
    footer: f("footer") as Messages["footer"],
  };
}

function buildContentSpec(doc: ContentDoc): ContentSpec {
  const s = doc.settings;
  const spec: ContentSpec = {
    subdomain: s.subdomain,
    name: s.name,
    product: s.product,
    price_cents: s.price_cents,
    checkout_url: s.checkout_url,
    cart_state: s.cart_state,
    noindex: s.noindex,
    site_url: s.site_url,
    sections: orderedEnabledTypes(doc.sections),
    tracking: s.tracking,
    seo: { title: s.seo.title, description: s.seo.description },
  };
  if (s.seo.ogImage) spec.seo.ogImage = s.seo.ogImage;
  if (s.logo) spec.logo = s.logo;
  if (s.waitlist_url) spec.waitlist_url = s.waitlist_url;
  if (s.deadline) spec.deadline = s.deadline;
  return spec;
}

// Maps Theme keys → the CSS custom properties defined in globals.css :root.
const COLOR_VARS: Record<string, string> = {
  orange: "--orange",
  orangeHi: "--orange-hi",
  navy900: "--navy-900",
  navy800: "--navy-800",
  text: "--text",
  textDim: "--text-dim",
  bg: "--bg",
  bgAlt: "--bg-alt",
};

function buildThemeCss(doc: ContentDoc): string {
  const { theme } = doc;
  const decls: string[] = [];
  if (theme.colors) {
    for (const [key, cssVar] of Object.entries(COLOR_VARS)) {
      const value = theme.colors[key as keyof typeof theme.colors];
      if (value) decls.push(`  ${cssVar}: ${value};`);
    }
  }
  if (theme.fonts?.title) decls.push(`  --font-title: ${quoteFamily(theme.fonts.title)};`);
  if (theme.fonts?.body) decls.push(`  --font-body: ${quoteFamily(theme.fonts.body)};`);

  const rootBlock = decls.length ? `:root {\n${decls.join("\n")}\n}\n` : "";
  const scaleBlock =
    typeof theme.scale === "number" && theme.scale > 0 && theme.scale !== 1
      ? `html { font-size: ${(theme.scale * 100).toFixed(2)}%; }\n`
      : "";
  return rootBlock + scaleBlock;
}

/** Wrap a font family in quotes if it isn't already, appending a sane fallback stack. */
function quoteFamily(family: string): string {
  const name = family.replace(/^["']|["']$/g, "").trim();
  return `"${name}", ui-sans-serif, system-ui, sans-serif`;
}

export function contentDocToFiles(doc: ContentDoc): SerializedFiles {
  return {
    messages: buildMessages(doc),
    contentSpec: buildContentSpec(doc),
    themeCss: buildThemeCss(doc),
  };
}
