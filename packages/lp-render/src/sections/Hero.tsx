"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";

export function Hero() {
  const { messages, contentSpec, isCartClosed: closed } = useContent();
  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  return (
    <section className="hero">
      <div className="container container--narrow">
        {contentSpec.logo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-logo" src={contentSpec.logo} alt={`${contentSpec.product} logo`} />
        ) : null}
        {messages.hero.badge && !closed ? <div className="badge">{messages.hero.badge}</div> : null}
        <h1>{headline}</h1>
        <p className="lead">{subhead}</p>
        <div style={{ marginTop: 32 }}>
          <CheckoutButton label={ctaLabel} pulse />
        </div>
        {messages.hero.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-visual" src={messages.hero.image} alt="" />
        ) : null}
      </div>
    </section>
  );
}
