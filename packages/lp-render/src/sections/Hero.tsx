"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";

export function Hero() {
  const { messages, isCartClosed: closed } = useContent();
  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  return (
    <section className="hero">
      <div className="container container--narrow">
        {messages.hero.badge && !closed ? <div className="badge">{messages.hero.badge}</div> : null}
        <h1>{headline}</h1>
        <p className="lead">{subhead}</p>
        <div style={{ marginTop: 32 }}>
          <CheckoutButton label={ctaLabel} pulse />
        </div>
      </div>
    </section>
  );
}
