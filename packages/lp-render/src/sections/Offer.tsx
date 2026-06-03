"use client";

import { useContent } from "../content";
import { CheckoutButton } from "../components/CheckoutButton";
import { FadeIn } from "../components/FadeIn";

export function Offer() {
  const { messages, isCartClosed: closed } = useContent();
  if (closed) {
    return (
      <section className="section section--dark section--center" id="waitlist">
        <FadeIn className="container">
          <div className="offer">
            <h2>{messages.cartClosed.headline}</h2>
            <p>{messages.cartClosed.subhead}</p>
            <div style={{ marginTop: 24 }}>
              <CheckoutButton label={messages.cartClosed.waitlistCtaLabel} pulse />
            </div>
          </div>
        </FadeIn>
      </section>
    );
  }

  const data = messages.offer;
  return (
    <section className="section section--dark section--center">
      <FadeIn className="container">
        <div className="offer">
          <h2>{data.heading}</h2>
          {data.bonuses && data.bonuses.length > 0 ? (
            <ul className="bullets" style={{ textAlign: "left", display: "inline-block" }}>
              {data.bonuses.map((b, i) => (
                <li key={i}>{b}</li>
              ))}
            </ul>
          ) : null}
          {data.anchor ? <div className="anchor">{data.anchor}</div> : null}
          <div className="price">{data.priceLabel}</div>
          {data.installments ? <p className="installments">{data.installments}</p> : null}
          <div style={{ marginTop: 20 }}>
            <CheckoutButton label={data.ctaLabel} pulse />
          </div>
          {data.guarantee ? <p className="guarantee-line">{data.guarantee}</p> : null}
          {data.payments && data.payments.length > 0 ? (
            <div className="payments">
              {data.payments.map((p, i) => (
                <span className="pay-pill" key={i}>
                  {p}
                </span>
              ))}
            </div>
          ) : null}
          {data.secure ? <p className="secure-note">{data.secure}</p> : null}
        </div>
      </FadeIn>
    </section>
  );
}
