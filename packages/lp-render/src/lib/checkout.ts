import { getUtms } from "./utm";
import { getAffiliate, getHotmartAffiliate, AFFILIATE_CHECKOUT_PARAM } from "./affiliate";

// Builds the destination for the primary CTA. In open-cart mode it routes per channel:
//   - no affiliate param         → the producer checkout (checkoutUrl), UTMs only, no ref.
//   - ?hmt=<hotlink> (Hotmart)   → the affiliate's Hotmart hotlink: https://go.hotmart.com/<hotlink>.
//     Hotmart attributes the affiliate via a COOKIE set when the buyer passes through that
//     hotlink (and the product page it redirects to). The pay.hotmart.com checkout URL carries
//     NO affiliate id (two different affiliates produce byte-identical checkout URLs — only the
//     session `bid` differs), so we MUST route to the hotlink, not the checkout. Appending a
//     `ref`/`off` to the pay URL never attributes. The buyer takes one extra hop through the
//     Hotmart product page — unavoidable, it is how Hotmart sets the affiliate cookie.
//     Takes precedence over a Hubla ?aff= link when both resolve.
//   - ?aff=<token> (Hubla)       → the Hubla checkout + ref (Hubla DOES carry attribution on
//     the checkout URL). The Hubla base is affiliateCheckoutUrl when set (producer checkout
//     migrated off Hubla), else checkoutUrl itself (legacy single-platform LPs).
// A token never crosses platforms. In closed-cart mode it points at the waitlist. See SPEC-011 §6.

// Hotmart hotlink domain — platform constant, identical for every product/affiliate.
const HOTMART_HOTLINK_BASE = "https://go.hotmart.com/";

export interface CheckoutConfig {
  checkoutUrl: string;
  cartState: "open" | "closed";
  waitlistUrl?: string; // e.g. https://wa.me/<number>?text=...
  /** Hubla checkout base for the ?aff= route, used when the producer checkout (checkoutUrl)
   * lives on a different platform (e.g. migrated to Hotmart). When absent, an ?aff= token is
   * appended to checkoutUrl instead — the legacy single-platform behaviour. */
  affiliateCheckoutUrl?: string;
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
  if (hotmartAffiliate) {
    // Route through the affiliate's Hotmart hotlink so Hotmart's cookie attributes the sale.
    // UTMs forwarded; the code is a URL path segment, so encode it.
    return appendParams(`${HOTMART_HOTLINK_BASE}${encodeURIComponent(hotmartAffiliate)}`, null);
  }
  const hublaAffiliate = getAffiliate();
  if (hublaAffiliate) {
    // Dedicated Hubla base when the producer checkout moved off Hubla; otherwise the
    // producer checkout itself is the Hubla base (legacy single-platform LPs).
    return appendParams(config.affiliateCheckoutUrl ?? config.checkoutUrl, hublaAffiliate);
  }
  // No affiliate → producer checkout, UTMs only. Never attach a stray ref.
  return appendParams(config.checkoutUrl, null);
}

/** Destination for the optional secondary "international purchase" CTA (Hotmart). Kept for LPs
 * that still expose it; the primary ?hmt= affiliate route no longer depends on it. UTMs only —
 * a Hubla ?aff= token means nothing to Hotmart, and Hotmart attribution is cookie-based. */
export function buildInternationalCheckoutHref(internationalCheckoutUrl: string): string {
  return appendParams(internationalCheckoutUrl, null);
}
