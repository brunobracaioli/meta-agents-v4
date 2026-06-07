import { getUtms } from "./utm";
import { getAffiliate, AFFILIATE_CHECKOUT_PARAM } from "./affiliate";

// Builds the destination for the primary CTA. In open-cart mode it points at the
// Hubla checkout with captured UTMs appended and, when the visitor arrived via an
// affiliate link (?aff=<token>), that token re-attached as the Hubla `ref` param;
// in closed-cart mode it points at the waitlist target (WhatsApp). See SPEC-011 §6.

export interface CheckoutConfig {
  checkoutUrl: string;
  cartState: "open" | "closed";
  waitlistUrl?: string; // e.g. https://wa.me/<number>?text=...
}

export function buildCheckoutHref(config: CheckoutConfig): string {
  if (config.cartState === "closed") {
    // No external waitlist target → scroll to the offer/waitlist block (section id="oferta").
    return config.waitlistUrl ?? "#oferta";
  }
  const utms = getUtms();
  const affiliate = getAffiliate();
  if (Object.keys(utms).length === 0 && !affiliate) return config.checkoutUrl;
  try {
    const url = new URL(config.checkoutUrl);
    for (const [key, value] of Object.entries(utms)) {
      url.searchParams.set(key, value);
    }
    if (affiliate) url.searchParams.set(AFFILIATE_CHECKOUT_PARAM, affiliate);
    return url.toString();
  } catch {
    return config.checkoutUrl;
  }
}
