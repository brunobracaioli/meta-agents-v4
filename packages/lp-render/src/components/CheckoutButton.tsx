"use client";

import { useEffect, useState } from "react";
import { useContent } from "../content";
import { buildCheckoutHref, buildInternationalCheckoutHref } from "../lib/checkout";

// Primary CTA. The href is computed client-side after mount so captured UTMs and the
// affiliate token (?aff= → Hubla, ?hmt= → Hotmart swap) are appended (open cart) or the
// waitlist target is used (closed cart). SSR falls back to the bare checkout/waitlist URL
// so the link works without JS.
export function CheckoutButton({ label, pulse = false }: { label: string; pulse?: boolean }) {
  const { contentSpec, messages } = useContent();
  const fallback =
    contentSpec.cart_state === "closed"
      ? contentSpec.waitlist_url ?? "#oferta"
      : contentSpec.checkout_url;
  const [href, setHref] = useState(fallback);

  useEffect(() => {
    setHref(
      buildCheckoutHref({
        checkoutUrl: contentSpec.checkout_url,
        cartState: contentSpec.cart_state,
        ...(contentSpec.waitlist_url ? { waitlistUrl: contentSpec.waitlist_url } : {}),
        ...(messages.offer.secondaryCtaHref
          ? { internationalCheckoutUrl: messages.offer.secondaryCtaHref }
          : {}),
      }),
    );
  }, []);

  return (
    <a className={pulse ? "cta cta--pulse" : "cta"} href={href} rel="noopener">
      {label}
    </a>
  );
}

// Secondary "international purchase" CTA (Hotmart). Renders nothing unless the offer
// carries both secondaryCta fields. Only the ?hmt= code is attached — never ?aff=.
export function InternationalCheckoutButton() {
  const { messages } = useContent();
  const base = messages.offer.secondaryCtaHref;
  const label = messages.offer.secondaryCtaLabel;
  const [href, setHref] = useState(base);

  useEffect(() => {
    if (base) setHref(buildInternationalCheckoutHref(base));
  }, []);

  if (!base || !label) return null;
  return (
    <div style={{ marginTop: 12 }}>
      <a className="cta cta--secondary" href={href} rel="noopener">
        {label}
      </a>
    </div>
  );
}
