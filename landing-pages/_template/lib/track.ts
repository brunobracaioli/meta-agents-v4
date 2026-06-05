// Client-side event instrumentation for the landing page (SPEC-015 §4). Framework-agnostic
// (no React) and browser-only — every entry point guards `typeof window`. It is wired up by
// <Tracking/> ONLY after LGPD consent is granted, and torn down if consent is revoked.
//
// Phase 1 fires events into the already-injected Pixel(s)/GA4/Google Ads tags. Phase 2 adds a
// deduplicated server-side hit: when contentSpec.tracking.server is present, each standard Meta
// event also POSTs to the Cloudflare tagging server with the SAME `event_id` the Pixel got, so
// Meta deduplicates the browser Pixel against the server CAPI hit. The Worker fires only the
// destinations that have secrets configured (Meta CAPI by default → no double-counting of
// client-side GA4/Ads). See ADR 0021 / SPEC-015 §7.

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

// Phase 2: the multi-tenant tagging server. Set per-page from contentSpec.tracking.server.
// When present, each (deduplicable) Meta event also POSTs to the Worker with the SAME
// event_id the Pixel got, so Meta deduplicates Pixel↔CAPI. See ADR 0021 / SPEC-015 §7.
let serverCfg: { endpoint: string; lp_id: string } | undefined;

function cookie(name: string): string | undefined {
  if (typeof document === "undefined") return undefined;
  const m = document.cookie.match(new RegExp("(^|;)\\s*" + name + "\\s*=\\s*([^;]+)"));
  return m ? decodeURIComponent(m[2]!) : undefined;
}

function queryParam(name: string): string | undefined {
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) || undefined;
}

/** First-party attribution signals the Worker needs (no PII — that stays out of Phase 1). */
function signals(): Record<string, unknown> {
  const utms: Record<string, string> = {};
  for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"]) {
    const v = queryParam(k);
    if (v) utms[k] = v;
  }
  return {
    event_source_url: typeof window !== "undefined" ? window.location.href : undefined,
    fbp: cookie("_fbp"),
    fbc: cookie("_fbc"),
    fbclid: queryParam("fbclid"),
    gclid: queryParam("gclid") || cookie("_gcl_aw"),
    utms: Object.keys(utms).length ? utms : undefined,
  };
}

/** Fire a deduplicated server-side hit for a standard Meta event, sharing `eventId`. */
function postServer(eventName: string, eventId: string, params: Params): void {
  if (!serverCfg || typeof fetch === "undefined") return;
  const body = {
    lp_id: serverCfg.lp_id,
    event_name: eventName,
    event_id: eventId,
    value: params.value,
    currency: params.currency,
    ...signals(),
  };
  try {
    void fetch(`${serverCfg.endpoint.replace(/\/+$/, "")}/e`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include", // send/receive the first-party _fbp/_fbc cookies
      body: JSON.stringify(body),
      keepalive: true, // survive page unload (navigation to checkout)
    });
  } catch {
    // best-effort: a failed beacon must never break the page
  }
}

/**
 * Fire a Meta event. `custom` → trackCustom (non-standard, e.g. ScrollDepth). `server` (default
 * true) → also POST to the tagging server with the SAME event_id (dedup). Engagement-only
 * signals (ScrollDepth) pass `server:false` to keep CAPI volume to conversion-grade events.
 */
function meta(name: string, params: Params, opts: { custom?: boolean; server?: boolean } = {}): void {
  if (typeof window === "undefined") return;
  const eventId = uuid();
  if (window.fbq) window.fbq(opts.custom ? "trackCustom" : "track", name, params, { eventID: eventId });
  if (opts.server !== false) postServer(name, eventId, params);
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

  // Phase 2: point the deduplicated server hits at the tagging server, if configured (public).
  serverCfg = spec.tracking.server?.endpoint && spec.tracking.server.lp_id ? spec.tracking.server : undefined;

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
        meta("ScrollDepth", { depth: t }, { custom: true, server: false });
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
