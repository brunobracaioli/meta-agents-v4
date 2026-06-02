import contentSpecJson from "@/content-spec.json";
import messagesJson from "@/messages/pt.json";

// Typed access to the two content files. `content-spec.json` is the machine spec
// (subdomain, product, price, tracking, section order); `messages/pt.json` is ALL
// human copy (filled by the lp-copywriter subagent). See SPEC-011 §5.

export type SectionType =
  | "hero"
  | "problem"
  | "solution"
  | "features"
  | "curriculum"
  | "proof"
  | "offer"
  | "faq"
  | "finalCta"
  | "footer";

export interface ContentSpec {
  subdomain: string;
  name: string;
  product: string;
  price_cents: number;
  checkout_url: string;
  waitlist_url?: string;
  cart_state: "open" | "closed";
  noindex: boolean;
  site_url: string;
  sections: SectionType[];
  tracking: {
    fb_pixel_id: string;
    ga4_id: string;
    consent_key: string;
  };
  seo: { title: string; description: string };
}

export interface Messages {
  seo: { title: string; description: string; ogAlt: string };
  hero: { headline: string; subhead: string; ctaLabel: string };
  sections: {
    problem?: { heading: string; body: string; bullets?: string[] };
    solution?: { heading: string; body: string };
    features?: { heading: string; items: { title: string; desc: string }[] };
    curriculum?: { heading: string; modules: { title: string; desc: string }[] };
    proof?: { heading: string; testimonials: { quote: string; author: string }[] };
  };
  offer: {
    heading: string;
    priceLabel: string;
    anchor?: string;
    bonuses?: string[];
    guarantee?: string;
    ctaLabel: string;
  };
  faq: { q: string; a: string }[];
  finalCta: { headline: string; ctaLabel: string };
  cartClosed: { headline: string; subhead: string; waitlistCtaLabel: string };
  footer: { legal: string; links: { label: string; href: string }[] };
}

export const contentSpec = contentSpecJson as ContentSpec;
export const messages = messagesJson as Messages;

export function isCartClosed(): boolean {
  return contentSpec.cart_state === "closed";
}
