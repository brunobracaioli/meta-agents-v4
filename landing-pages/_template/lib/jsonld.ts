import type { ContentSpec } from "@/lib/content";

// Builds Course + Organization JSON-LD from the content spec. Injected in <head>
// (server-rendered into the static HTML) for rich results. See SPEC-011 §5.

export function buildJsonLd(spec: ContentSpec, seoTitle: string, seoDescription: string) {
  const priceBrl = (spec.price_cents / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "B2 Tech",
        url: "https://b2tech.io",
      },
      {
        "@type": "Course",
        name: spec.product,
        description: seoDescription,
        provider: { "@type": "Organization", name: "B2 Tech", url: "https://b2tech.io" },
        offers: {
          "@type": "Offer",
          price: priceBrl,
          priceCurrency: "BRL",
          availability:
            spec.cart_state === "open"
              ? "https://schema.org/InStock"
              : "https://schema.org/PreOrder",
          url: spec.checkout_url,
        },
      },
    ],
  };
}
