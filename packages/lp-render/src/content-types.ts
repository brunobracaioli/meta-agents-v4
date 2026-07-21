// Canonical content types for landing pages. These mirror the template's original
// lib/content.ts shapes (SPEC-011 §5) but WITHOUT importing the JSON singletons — they
// are pure types so both the static template and the live web preview can share them.
// The editable runtime representation (DB-backed) is the ContentDoc in ./content-doc.ts;
// the serializer turns a ContentDoc into the two files the Next build still consumes.

export type SectionType =
  | "hero"
  | "urgency"
  | "video"
  | "problem"
  | "comparison"
  | "solution"
  | "features"
  | "curriculum"
  | "stats"
  | "proof"
  | "logos"
  | "persona"
  | "authority"
  | "ccaf"
  | "offer"
  | "guarantee"
  | "faq"
  | "finalCta"
  | "footer";

export interface ContentSpec {
  subdomain: string;
  name: string;
  product: string;
  price_cents: number;
  checkout_url: string;
  /** Hubla checkout base for the ?aff= affiliate route, when the producer checkout_url lives
   * on another platform (e.g. migrated to Hotmart). Absent ⇒ ?aff= falls back to checkout_url.
   * See lib/checkout.ts. */
  affiliate_checkout_url?: string;
  waitlist_url?: string;
  cart_state: "open" | "closed";
  noindex: boolean;
  site_url: string;
  /** Brand logo URL (page-level, rendered at the top of the hero). Optional. */
  logo?: string;
  /** Optional cinematic 3D panel (pinned-scroll WebGL stage) rendered ABOVE the hero. */
  stage3d?: { model: string; poster?: string; rain?: boolean; color?: string; logo?: string };
  /** ISO 8601 deadline for the countdown in the urgency bar. Omit/past → bar shows scarcity only. */
  deadline?: string;
  sections: SectionType[];
  /** PUBLIC tracking IDs baked into the static site (see Settings.tracking in content-doc.ts).
   * Never carries server-side secrets. `*_ids` arrays, when present, take precedence over the
   * legacy single fields. */
  tracking: {
    fb_pixel_id: string;
    ga4_id: string;
    consent_key: string;
    meta_pixels?: string[];
    ga4_ids?: string[];
    google_ads_ids?: string[];
    /** Phase 2: PUBLIC config for the multi-tenant tagging server. `endpoint` = Worker base,
     * `lp_id` = this LP's UUID (the Worker resolves secrets by it). Absent ⇒ Phase-1 only. */
    server?: { endpoint: string; lp_id: string };
  };
  seo: { title: string; description: string; ogImage?: string };
}

/** A comparison cell: true = ✓, false = ✗, string = custom text. */
export type CompareCell = boolean | string;

export interface Messages {
  seo: { title: string; description: string; ogAlt: string; ogImage?: string };
  /** `image` = AI-generated hero visual (landscape banner, single-column hero).
   * `portrait` = optional cut-out portrait that switches the hero to a two-column split.
   * `headlineAccent` = optional second line rendered with the aurora gradient (claude-code look).
   * `terminal` = optional code-window mockup (prompt + agent log lines). All optional ⇒ no-op. */
  hero: {
    badge?: string;
    headline: string;
    headlineAccent?: string;
    subhead: string;
    ctaLabel: string;
    image?: string;
    portrait?: string;
    terminal?: { title?: string; prompt: string; lines?: string[] };
  };
  sections: {
    urgency?: { label: string; scarcity?: string };
    /** VSL / sales video. `youtubeId` is the bare YouTube id (e.g. "m0YlrfscReE"); the block
     * renders a click-to-play facade → youtube-nocookie player. `poster` overrides the
     * auto-derived thumbnail. */
    video?: { eyebrow?: string; heading: string; subhead?: string; youtubeId: string; poster?: string };
    problem?: { heading: string; body: string; bullets?: string[]; image?: string };
    comparison?: {
      heading: string;
      subhead?: string;
      ours: string;
      theirs: string;
      rows: { label: string; ours: CompareCell; theirs: CompareCell }[];
    };
    solution?: { heading: string; body: string; image?: string };
    features?: { heading: string; subhead?: string; image?: string; items: { icon?: string; title: string; desc: string }[] };
    curriculum?: { heading: string; subhead?: string; modules: { title: string; desc: string }[] };
    stats?: { heading?: string; items: { value: string; label: string }[] };
    proof?: { eyebrow?: string; heading: string; subhead?: string; image?: string; testimonials: { quote: string; author: string }[] };
    logos?: { heading?: string; items: string[] };
    persona?: { eyebrow?: string; heading: string; subhead?: string; items: { icon?: string; title: string; desc: string }[] };
    /** `role` = mono accent line under the name; `quote` = pull-quote with a cyan rule;
     * `products` = mono pills under `productsLabel`. All optional ⇒ the block degrades to the
     * legacy photo + bio + credentials layout. (claude-code instructor-section parity.) */
    authority?: {
      eyebrow?: string;
      /** Big centered section title above the photo+bio grid (claude-code SectionHeader).
       * Absent ⇒ the header collapses (only the eyebrow, or nothing). */
      title?: string;
      name: string;
      role?: string;
      bio: string;
      quote?: string;
      credentials?: string[];
      productsLabel?: string;
      products?: string[];
      image?: string;
    };
    /** Certification authority block (claude-code ccaf-section parity): certificate image +
     * scarcity stat + verify CTA + exam-facts grid + weighted domain bars. `image` is the
     * certificate; `verifyUrl` makes the image and CTA clickable. Everything optional except
     * the title, so a partially-filled draft never crashes. */
    ccaf?: {
      eyebrow?: string;
      heading: string;
      subhead?: string;
      badge?: string;
      image?: string;
      verifyUrl?: string;
      verifyLabel?: string;
      verifyHint?: string;
      scarcityNumber?: string;
      scarcityLabel?: string;
      scarcityLine?: string;
      lead?: string;
      examTitle?: string;
      examNote?: string;
      examFacts?: { title: string; description: string }[];
      domainsTitle?: string;
      domainsSubtitle?: string;
      domains?: { label: string; weight: number }[];
    };
    guarantee?: { heading: string; body: string; seal?: string };
  };
  offer: {
    eyebrow?: string;
    heading: string;
    priceLabel: string;
    anchor?: string;
    installments?: string;
    bonuses?: string[];
    guarantee?: string;
    payments?: string[];
    secure?: string;
    ctaLabel: string;
    /** Optional secondary checkout (e.g. Hotmart "Compra internacional"). Both fields must be
     * present to render. Also the base URL for the ?hmt= affiliate route (see lib/checkout.ts). */
    secondaryCtaHref?: string;
    secondaryCtaLabel?: string;
  };
  faq: { q: string; a: string }[];
  finalCta: { headline: string; ctaLabel: string };
  cartClosed: { headline: string; subhead: string; waitlistCtaLabel: string };
  footer: { legal: string; links: { label: string; href: string }[] };
}

/** Background tone for "flow" sections — PageBody alternates white / #F7F9FC. */
export type Tone = "light" | "alt";

/** The 12 "middle" sections that live under messages.sections.* (everything except the
 * top-level hero/offer/faq/finalCta/footer, which the template exposes at the root). */
export const MIDDLE_SECTION_TYPES = [
  "urgency",
  "video",
  "problem",
  "comparison",
  "solution",
  "features",
  "curriculum",
  "stats",
  "proof",
  "logos",
  "persona",
  "authority",
  "ccaf",
  "guarantee",
] as const satisfies readonly SectionType[];

export type MiddleSectionType = (typeof MIDDLE_SECTION_TYPES)[number];
