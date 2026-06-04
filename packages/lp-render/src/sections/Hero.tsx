"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";

// Hero. A cut-out PORTRAIT (`messages.hero.portrait`) switches the hero to a two-column
// split (copy left, portrait right) — the portrait blends into the dark hero via a brand
// glow + bottom fade mask. Without a portrait the hero stays the original centered single
// column, optionally showing the AI-generated hero visual (`messages.hero.image`) as a
// banner below the CTA. So a product without a portrait asset renders exactly as before.
export function Hero() {
  const { messages, contentSpec, isCartClosed: closed } = useContent();
  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  const logo = contentSpec.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="hero-logo" src={contentSpec.logo} alt={`${contentSpec.product} logo`} />
  ) : null;
  const badge = messages.hero.badge && !closed ? <div className="badge">{messages.hero.badge}</div> : null;

  if (messages.hero.portrait) {
    return (
      <section className="hero hero--split">
        <div className="hero-inner container">
          <div className="hero-copy">
            {logo}
            {badge}
            <h1>{headline}</h1>
            <p className="lead">{subhead}</p>
            <div className="hero-cta">
              <CheckoutButton label={ctaLabel} pulse />
            </div>
          </div>
          <div className="hero-figure">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="hero-portrait" src={messages.hero.portrait} alt="" />
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="hero">
      <div className="container container--narrow">
        {logo}
        {badge}
        <h1>{headline}</h1>
        <p className="lead">{subhead}</p>
        <div className="hero-cta">
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
