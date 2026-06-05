// The ContentDoc is the editable, DB-backed representation of a landing page assembled
// from Supabase: `landing_pages.settings` + `landing_pages.theme` + the ordered
// `landing_page_sections` rows. It is the single source of truth for the DRAFT. The
// serializer (./serialize.ts) turns it into the two files the Next build consumes
// (messages/pt.json + content-spec.json) plus a theme.css of token overrides — so the
// existing static-export pipeline never changes. See ADR 0015.

import type { SectionType } from "./content-types";

/** Per-LP design tokens that override the template defaults in globals.css. Curated set
 * (fonts come from a fixed allowlist bundled in the template; colors are hex). */
export interface Theme {
  fonts?: { title?: string; body?: string };
  /** Type-scale multiplier applied to the root font-size (1 = default). */
  scale?: number;
  colors?: Partial<
    Record<"orange" | "orangeHi" | "navy900" | "navy800" | "text" | "textDim" | "bg" | "bgAlt", string>
  >;
}

/** Page-level settings that are not themselves a rendered block. */
export interface Settings {
  subdomain: string;
  name: string;
  product: string;
  site_url: string;
  /** Brand logo URL (page-level, rendered at the top of the hero). Optional. */
  logo?: string;
  /** Optional cinematic 3D panel rendered ABOVE the hero (pinned-scroll WebGL stage).
   * `model` is a .glb URL; `poster` a no-WebGL fallback image; `rain` toggles the matrix
   * digital-rain backdrop; `color` overrides the hologram/rain hue. Absent → no panel. */
  stage3d?: { model: string; poster?: string; rain?: boolean; color?: string; logo?: string };
  seo: { title: string; description: string; ogAlt: string; ogImage?: string };
  /** Pixels/measurement IDs injected into the (consent-gated) page. ALL fields here are
   * PUBLIC — they end up in content-spec.json, which is built into the public static site.
   * Server-side secrets (CAPI access token, GA4 API secret) must NEVER live here; they go
   * to the RLS-locked secrets store the serializer never reads. See ADR 0021 / SPEC-015.
   * The legacy single `fb_pixel_id`/`ga4_id` stay for back-compat; when the `*_ids` arrays
   * are present they take precedence (a page may carry more than one of each). */
  tracking: {
    fb_pixel_id: string;
    ga4_id: string;
    consent_key: string;
    meta_pixels?: string[];
    ga4_ids?: string[];
    google_ads_ids?: string[];
    /** Phase 2: public config pointing the browser at the multi-tenant tagging server.
     * `endpoint` is the Worker base (https://track.b2tech.io); `lp_id` is this LP's UUID —
     * BOTH are public (the Worker holds the secrets, resolved by lp_id). Absent ⇒ Phase-1
     * client-side only. The serializer never adds secrets here. See ADR 0021 / SPEC-015 §7. */
    server?: { endpoint: string; lp_id: string };
  };
  checkout_url: string;
  waitlist_url?: string;
  price_cents: number;
  cart_state: "open" | "closed";
  noindex: boolean;
  deadline?: string;
  /** Waitlist variant shown by hero/offer/finalCta when cart_state === 'closed'. */
  cartClosed: { headline: string; subhead: string; waitlistCtaLabel: string };
}

/** One editable block. `fields` carries the block's copy in the shape the matching
 * section component expects (e.g. hero → {badge?, headline, subhead, ctaLabel}). */
export interface SectionDoc {
  type: SectionType;
  position: number;
  enabled: boolean;
  fields: Record<string, unknown>;
}

export interface ContentDoc {
  settings: Settings;
  theme: Theme;
  sections: SectionDoc[];
}
