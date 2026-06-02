import { messages, isCartClosed } from "@/lib/content";
import { CheckoutButton } from "@/components/CheckoutButton";

export function Hero() {
  const closed = isCartClosed();
  const headline = closed ? messages.cartClosed.headline : messages.hero.headline;
  const subhead = closed ? messages.cartClosed.subhead : messages.hero.subhead;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.hero.ctaLabel;
  return (
    <section className="hero">
      <div className="container">
        <h1>{headline}</h1>
        <p className="lead">{subhead}</p>
        <div style={{ marginTop: 32 }}>
          <CheckoutButton label={ctaLabel} />
        </div>
      </div>
    </section>
  );
}
