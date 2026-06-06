"use client";

import { useContent } from "../content";

// Fixed glass header imported from claude-code.b2tech.io: a code-style wordmark on the
// left and a single anchor CTA on the right that jumps to the offer block (#oferta).
// Deliberately minimal (one action) to keep the page focused on conversion. Reads the
// product name + cart state from content context, so every LP gets it for free once it is
// mounted at the top of <PageBody />. The CTA is a same-page anchor (not the checkout) —
// it scrolls to the offer, where the real CheckoutButton lives with its UTM handling.
export function SiteHeader() {
  const { messages, contentSpec, isCartClosed: closed } = useContent();
  const label = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  // Wordmark tail: the subdomain reads like a code path ("B2Tech / imersao-agencia").
  const tail = contentSpec.subdomain;

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <a className="site-brand" href="#top" aria-label={contentSpec.product}>
          <span className="bracket">[</span>
          <span>
            B2Tech
            <span className="site-brand-tail">
              <span className="slash">/</span>
              <span className="gradient-text">{tail}</span>
            </span>
          </span>
          <span className="bracket">]</span>
        </a>
        <a className="site-header-cta" href="#oferta">
          {label}
        </a>
      </div>
    </header>
  );
}
