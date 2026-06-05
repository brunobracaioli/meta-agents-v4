// Client-side event instrumentation for the landing page (SPEC-015 §4). Framework-agnostic
// (no React) and browser-only — every entry point guards `typeof window`. It is wired up by
// <Tracking/> ONLY after LGPD consent is granted, and torn down if consent is revoked.
//
// Phase 1 fires the events straight into the already-injected Pixel(s)/GA4/Google Ads tags.
// Each event carries its own `event_id` (passed to the Pixel as `eventID`); Phase 2 will
// reuse that id on a first-party POST to the Cloudflare Worker so Meta deduplicates the
// browser Pixel against the server CAPI hit. See ADR 0021.

import type { ContentSpec } from "@b2tech/lp-render";

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
    gtag?: (...args: unknown[]) => void;
  }
}

type Params = Record<string, unknown>;

export interface ResolvedTrackingIds {
  metaPixels: string[];
  ga4Ids: string[];
  googleAdsIds: string[];
}

/** Resolve the effective ID lists: the multi-arrays win; the legacy single fields are the
 * fallback for pages generated before SPEC-015. Empty/blank entries are dropped. */
export function resolveTrackingIds(tracking: ContentSpec["tracking"]): ResolvedTrackingIds {
  const clean = (arr?: string[]): string[] => (arr ?? []).map((s) => s.trim()).filter(Boolean);
  const metaMulti = clean(tracking.meta_pixels);
  const ga4Multi = clean(tracking.ga4_ids);
  return {
    metaPixels: metaMulti.length ? metaMulti : tracking.fb_pixel_id ? [tracking.fb_pixel_id] : [],
    ga4Ids: ga4Multi.length ? ga4Multi : tracking.ga4_id ? [tracking.ga4_id] : [],
    googleAdsIds: clean(tracking.google_ads_ids),
  };
}

function uuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function meta(name: string, params: Params, custom = false): void {
  if (typeof window === "undefined" || !window.fbq) return;
  // Standard events use `track`; non-standard (e.g. ScrollDepth) must use `trackCustom`.
  window.fbq(custom ? "trackCustom" : "track", name, params, { eventID: uuid() });
}

function ga4(name: string, params: Params): void {
  if (typeof window === "undefined" || !window.gtag) return;
  window.gtag("event", name, params);
}

function adsConversion(ids: string[], params: Params): void {
  if (typeof window === "undefined" || !window.gtag) return;
  for (const id of ids) window.gtag("event", "conversion", { send_to: id, ...params });
}

/** Run `cb` once the Pixel/gtag stubs exist. They are defined synchronously by the injected
 * snippets, but the effect can land a beat earlier — poll briefly (≤4s) so the initial
 * ViewContent is never dropped. Interaction events attach immediately (tags are ready by
 * the time a user scrolls/clicks). */
function whenTagsReady(cb: () => void, tries = 40): void {
  if (typeof window === "undefined") return;
  if (window.fbq || window.gtag || tries <= 0) {
    cb();
    return;
  }
  window.setTimeout(() => whenTagsReady(cb, tries - 1), 100);
}

/** Normalize a URL to origin+pathname (query/hash/trailing-slash agnostic) so a CTA whose
 * href has UTMs appended still matches the configured checkout/waitlist target. */
function baseOf(url: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const u = new URL(url, window.location.href);
    return u.origin + u.pathname.replace(/\/+$/, "");
  } catch {
    return null;
  }
}

function sameTarget(href: string, target: string | undefined): boolean {
  if (!target) return false;
  const a = baseOf(href);
  const b = baseOf(target);
  return a !== null && a === b;
}

/**
 * Attach the landing-page event listeners. Returns a teardown function.
 *
 * | trigger                                  | Meta                          | GA4            |
 * |------------------------------------------|-------------------------------|----------------|
 * | mount                                    | ViewContent                   | view_item      |
 * | scroll 25/50/75/90%                       | ScrollDepth (custom)          | scroll         |
 * | click CTA → checkout_url                  | AddToCart + InitiateCheckout  | begin_checkout |
 * | click CTA → waitlist_url                  | Lead                          | generate_lead  |
 *
 * Google Ads conversions fire on the checkout click for each configured AW- id.
 */
export function initEventTracking(spec: ContentSpec, opts: { googleAdsIds: string[] }): () => void {
  if (typeof window === "undefined") return () => {};

  const value = spec.price_cents ? spec.price_cents / 100 : undefined;
  const moneyParams: Params = value !== undefined ? { value, currency: "BRL" } : { currency: "BRL" };
  const ads = opts.googleAdsIds;

  // 1) ViewContent on mount.
  whenTagsReady(() => {
    meta("ViewContent", moneyParams);
    ga4("view_item", moneyParams);
  });

  // 2) Scroll depth — each threshold fires at most once.
  const thresholds = [25, 50, 75, 90];
  const fired = new Set<number>();
  const onScroll = () => {
    const scrollable = document.documentElement.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return;
    const pct = (window.scrollY / scrollable) * 100;
    for (const t of thresholds) {
      if (pct >= t && !fired.has(t)) {
        fired.add(t);
        meta("ScrollDepth", { depth: t }, true);
        ga4("scroll", { percent_scrolled: t });
      }
    }
  };
  window.addEventListener("scroll", onScroll, { passive: true });

  // 3) Conversion CTAs (checkout / waitlist). Capture phase so we fire before navigation.
  const onClick = (e: MouseEvent) => {
    const target = e.target as Element | null;
    const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;
    const href = anchor.getAttribute("href") || "";
    if (sameTarget(href, spec.checkout_url)) {
      meta("AddToCart", moneyParams);
      meta("InitiateCheckout", moneyParams);
      ga4("begin_checkout", moneyParams);
      adsConversion(ads, moneyParams);
    } else if (sameTarget(href, spec.waitlist_url)) {
      meta("Lead", moneyParams);
      ga4("generate_lead", moneyParams);
    }
  };
  document.addEventListener("click", onClick, true);

  return () => {
    window.removeEventListener("scroll", onScroll);
    document.removeEventListener("click", onClick, true);
  };
}
