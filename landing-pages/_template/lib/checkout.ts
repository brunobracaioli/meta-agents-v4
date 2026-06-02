import { getUtms } from "@/lib/utm";

// Builds the destination for the primary CTA. In open-cart mode it points at the
// Hubla checkout with captured UTMs appended; in closed-cart mode it points at the
// waitlist target (WhatsApp). See SPEC-011 §6.

export interface CheckoutConfig {
  checkoutUrl: string;
  cartState: "open" | "closed";
  waitlistUrl?: string; // e.g. https://wa.me/<number>?text=...
}

export function buildCheckoutHref(config: CheckoutConfig): string {
  if (config.cartState === "closed") {
    return config.waitlistUrl ?? "#waitlist";
  }
  const utms = getUtms();
  if (Object.keys(utms).length === 0) return config.checkoutUrl;
  try {
    const url = new URL(config.checkoutUrl);
    for (const [key, value] of Object.entries(utms)) {
      url.searchParams.set(key, value);
    }
    return url.toString();
  } catch {
    return config.checkoutUrl;
  }
}
