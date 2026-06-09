import { getUtms } from "./utm";
import { getAffiliate, getHotmartAffiliate, AFFILIATE_CHECKOUT_PARAM } from "./affiliate";

// Builds the destination for the primary CTA. In open-cart mode it points at the
// Hubla checkout with captured UTMs appended and, when the visitor arrived via an
// affiliate link (?aff=<token>), that token re-attached as the Hubla `ref` param.
// A Hotmart affiliate link (?hmt=<code>) takes precedence: the primary CTA swaps to
// the Hotmart checkout (offer.secondaryCtaHref) with the code as Hotmart's `ref` —
// Hubla can't attribute a Hotmart affiliate, so the whole funnel moves platforms.
// In closed-cart mode it points at the waitlist target (WhatsApp). See SPEC-011 §6.

export interface CheckoutConfig {
  checkoutUrl: string;
  cartState: "open" | "closed";
  waitlistUrl?: string; // e.g. https://wa.me/<number>?text=...
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
  return appendParams(config.checkoutUrl, getAffiliate());
}

/** Destination for the secondary "international" CTA (always Hotmart). Only the Hotmart
 * affiliate code is ever attached — a Hubla ?aff= token means nothing to Hotmart. */
export function buildInternationalCheckoutHref(internationalCheckoutUrl: string): string {
  return appendParams(internationalCheckoutUrl, getHotmartAffiliate());
}
