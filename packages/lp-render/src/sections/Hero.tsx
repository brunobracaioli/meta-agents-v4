"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";

// Hero. A cut-out PORTRAIT (`messages.hero.portrait`) switches the hero to a two-column
// split (copy left, portrait right) — the portrait blends into the dark hero via a brand
// glow + bottom fade mask. Without a portrait the hero stays the original centered single
// column, optionally showing the AI-generated hero visual (`messages.hero.image`) as a
// banner below the CTA. So a product without a portrait asset renders exactly as before.
// Optional aurora-gradient second line on the H1 (claude-code look). Suppressed when the
// cart is closed (the waitlist headline is a single plain line).
function Headline({ text, accent }: { text: string; accent?: string | undefined }) {
  return (
    <h1>
      {text}
      {accent ? (
        <>
          <br />
          <span className="gradient-text">{accent}</span>
        </>
      ) : null}
    </h1>
  );
}

// Optional code-window mockup. Renders nothing when messages.hero.terminal is absent, so a
// product that doesn't define it looks exactly as before.
function Terminal({ data }: { data: NonNullable<ReturnType<typeof useContent>["messages"]["hero"]["terminal"]> }) {
  if (!data?.prompt) return null;
  return (
    <div className="terminal" aria-hidden="true">
      <div className="terminal-bar">
        <span className="terminal-dot terminal-dot--r" />
        <span className="terminal-dot terminal-dot--y" />
        <span className="terminal-dot terminal-dot--g" />
        <span className="terminal-title">{data.title ?? "~/agencia · claude-code"}</span>
      </div>
      <div className="terminal-body">
        <div className="terminal-prompt">
          <span>$</span>
          {data.prompt}
        </div>
        {(data.lines ?? []).map((line, i) => (
          <div className="terminal-line" key={i}>
            <span>●</span>
            {line}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Hero() {
  const { messages, contentSpec, isCartClosed: closed } = useContent();
  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const accent = closed ? undefined : messages.hero.headlineAccent;
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  const terminal = closed ? undefined : messages.hero.terminal;
  const logo = contentSpec.logo ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img className="hero-logo" src={contentSpec.logo} alt={`${contentSpec.product} logo`} />
  ) : null;
  const badge = messages.hero.badge && !closed ? <div className="badge">{messages.hero.badge}</div> : null;

  if (messages.hero.portrait) {
    return (
      <section className="hero hero--split" id="top">
        <div className="hero-inner container">
          <div className="hero-copy">
            {logo}
            {badge}
            <Headline text={headline} accent={accent} />
            <p className="lead">{subhead}</p>
            <div className="hero-cta">
              <CheckoutButton label={ctaLabel} pulse />
            </div>
            {terminal ? <Terminal data={terminal} /> : null}
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
    <section className="hero" id="top">
      <div className="container container--narrow">
        {logo}
        {badge}
        <Headline text={headline} accent={accent} />
        <p className="lead">{subhead}</p>
        <div className="hero-cta">
          <CheckoutButton label={ctaLabel} pulse />
        </div>
        {terminal ? <Terminal data={terminal} /> : null}
        {messages.hero.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="hero-visual" src={messages.hero.image} alt="" />
        ) : null}
      </div>
    </section>
  );
}
