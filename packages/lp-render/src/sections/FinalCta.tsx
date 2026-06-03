"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";
import { FadeIn } from "../components/FadeIn";

export function FinalCta() {
  const { messages, isCartClosed: closed } = useContent();
  const headline = closed ? messages.cartClosed.headline : messages.finalCta.headline;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.finalCta.ctaLabel;
  return (
    <section className="section section--dark section--center">
      <FadeIn className="container container--narrow">
        <h2>{headline}</h2>
        <div style={{ marginTop: 24 }}>
          <CheckoutButton label={ctaLabel} pulse />
        </div>
      </FadeIn>
    </section>
  );
}
