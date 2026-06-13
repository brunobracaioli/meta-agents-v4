import { getUtms } from "./utm";
import { getAffiliate, getHotmartAffiliate, AFFILIATE_CHECKOUT_PARAM } from "./affiliate";

// Builds the destination for the primary CTA. In open-cart mode it routes per channel:
//   - no affiliate param        → the producer checkout (checkoutUrl), UTMs only, no ref.
//   - ?hmt=<code> (Hotmart)      → the Hotmart checkout (internationalCheckoutUrl) + ref.
//   - ?aff=<token> (Hubla)       → the Hubla checkout + ref. The Hubla base is
//     affiliateCheckoutUrl when set (LPs whose producer checkout migrated to another
//     platform), else checkoutUrl itself (legacy LPs whose producer checkout IS Hubla).
// A Hotmart link (?hmt=) takes precedence over a Hubla link (?aff=) when both resolve —
// a token never crosses platforms, since one platform can't attribute the other's affiliate.
// In closed-cart mode it points at the waitlist target (WhatsApp). See SPEC-011 §6.

export interface CheckoutConfig {
  checkoutUrl: string;
  cartState: "open" | "closed";
  waitlistUrl?: string; // e.g. https://wa.me/<number>?text=...
  /** Hubla checkout base for the ?aff= route, used when the producer checkout (checkoutUrl)
   * lives on a different platform (e.g. migrated to Hotmart). When absent, an ?aff= token is
   * appended to checkoutUrl instead — the legacy single-platform behaviour. */
  affiliateCheckoutUrl?: string;
  /** Hotmart checkout (offer.secondaryCtaHref). Required for the ?hmt= route; when absent
   * the hmt token is ignored (never forwarded to Hubla — the platforms don't share refs). */
  internationalCheckoutUrl?: string;
}

function appendParams(baseUrl: string, ref: string | null): string {
  const utms = getUtms();
  if (Object.keys(utms).length === 0 && !ref) return baseUrl;
  try {
    const url = new URL(baseUrl);
    for (const [key, value] of Object.entries(utms)) {
      url.searchParams.set(key, value);
    }
    if (ref) url.searchParams.set(AFFILIATE_CHECKOUT_PARAM, ref);
    return url.toString();
  } catch {
    return baseUrl;
  }
}

export function buildCheckoutHref(config: CheckoutConfig): string {
  if (config.cartState === "closed") {
    // No external waitlist target → scroll to the offer/waitlist block (section id="oferta").
    return config.waitlistUrl ?? "#oferta";
  }
  const hotmartAffiliate = getHotmartAffiliate();
  if (hotmartAffiliate && config.internationalCheckoutUrl) {
    return appendParams(config.internationalCheckoutUrl, hotmartAffiliate);
  }
  const hublaAffiliate = getAffiliate();
  if (hublaAffiliate) {
    // Dedicated Hubla base when the producer checkout moved off Hubla; otherwise the
    // producer checkout itself is the Hubla base (legacy single-platform LPs).
    return appendParams(config.affiliateCheckoutUrl ?? config.checkoutUrl, hublaAffiliate);
  }
  // No affiliate → producer checkout, UTMs only. Never attach a stray ref (a leftover Hubla
  // token must not ride on a Hotmart producer URL — it would not attribute and only confuses).
  return appendParams(config.checkoutUrl, null);
}

/** Destination for the secondary "international" CTA (always Hotmart). Only the Hotmart
 * affiliate code is ever attached — a Hubla ?aff= token means nothing to Hotmart. */
export function buildInternationalCheckoutHref(internationalCheckoutUrl: string): string {
  return appendParams(internationalCheckoutUrl, getHotmartAffiliate());
}
