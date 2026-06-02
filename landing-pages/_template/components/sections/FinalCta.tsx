import { messages, isCartClosed } from "@/lib/content";
import { CheckoutButton } from "@/components/CheckoutButton";

export function FinalCta() {
  const closed = isCartClosed();
  const headline = closed ? messages.cartClosed.headline : messages.finalCta.headline;
  const ctaLabel = closed ? messages.cartClosed.waitlistCtaLabel : messages.finalCta.ctaLabel;
  return (
    <section className="section final">
      <div className="container">
        <h2>{headline}</h2>
        <div style={{ marginTop: 24 }}>
          <CheckoutButton label={ctaLabel} />
        </div>
      </div>
    </section>
  );
}
