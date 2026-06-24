"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";
import { HeroParticleField } from "./HeroParticleField";
import { HeroTypedHeader } from "./HeroTypedHeader";

// Hero — the white "antigravity" wave imported from claude-code.b2tech.io: a full-screen,
// centered column over an interactive WebGL particle wave (HeroParticleField). The headline
// types itself out (HeroTypedHeader). Layout: wordmark → uppercase eyebrow (the hero badge)
// → typewriter H1 → subhead → pill CTA. The cart-closed waitlist variant swaps the copy and
// drops the eyebrow. Style lives in globals.css under `.hero-wave`.
export function Hero() {
  const { messages, contentSpec, isCartClosed: closed } = useContent();

  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const accent = closed ? "" : messages.hero.headlineAccent ?? "";
  const typedText = [headline, accent].filter(Boolean).join(" ");
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  const eyebrow = messages.hero.badge && !closed ? messages.hero.badge : null;

  return (
    <section className="hero-wave" id="top">
      <HeroParticleField className="hero-wave-field" />
      <div className="hero-wave-scrim" aria-hidden="true" />

      <div className="hero-wave-content">
        <div className="hero-wave-wordmark fade-up" style={{ animationDelay: "0ms" }}>
          {contentSpec.logo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img className="hero-wave-mark" src={contentSpec.logo} alt="" />
          ) : null}
          <span className="hero-wave-brand">{contentSpec.product}</span>
        </div>

        {eyebrow ? (
          <p className="hero-wave-eyebrow fade-up" style={{ animationDelay: "80ms" }}>
            {eyebrow}
          </p>
        ) : null}

        <h1 className="hero-wave-title">
          <HeroTypedHeader text={typedText} />
        </h1>

        <p className="hero-wave-lead fade-up" style={{ animationDelay: "160ms" }}>
          {subhead}
        </p>

        <div className="hero-wave-cta fade-up" style={{ animationDelay: "240ms" }}>
          <CheckoutButton label={ctaLabel} />
        </div>
      </div>
    </section>
  );
}
