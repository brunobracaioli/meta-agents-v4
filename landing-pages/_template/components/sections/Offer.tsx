import { messages, isCartClosed } from "@/lib/content";
import { CheckoutButton } from "@/components/CheckoutButton";

export function Offer() {
  const closed = isCartClosed();
  if (closed) {
    return (
      <section className="section" id="waitlist">
        <div className="container">
          <div className="offer">
            <h2>{messages.cartClosed.headline}</h2>
            <p>{messages.cartClosed.subhead}</p>
            <div style={{ marginTop: 24 }}>
              <CheckoutButton label={messages.cartClosed.waitlistCtaLabel} />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const data = messages.offer;
  return (
    <section className="section">
      <div className="container">
        <div className="offer">
          <h2>{data.heading}</h2>
          {data.anchor ? <span className="anchor">{data.anchor}</span> : null}
          <div className="price">{data.priceLabel}</div>
          {data.bonuses && data.bonuses.length > 0 ? (
            <ul className="bullets" style={{ textAlign: "left", display: "inline-block" }}>
              {data.bonuses.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
          <div style={{ marginTop: 24 }}>
            <CheckoutButton label={data.ctaLabel} />
          </div>
          {data.guarantee ? <p className="guarantee">{data.guarantee}</p> : null}
        </div>
      </div>
    </section>
  );
}
