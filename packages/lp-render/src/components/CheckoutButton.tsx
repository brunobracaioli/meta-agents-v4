"use client";

import { useEffect, useState } from "react";
import { useContent } from "../content";
import { buildCheckoutHref } from "../lib/checkout";

// Primary CTA. The href is computed client-side after mount so captured UTMs are
// appended (open cart) or the waitlist target is used (closed cart). SSR falls back
// to the bare checkout/waitlist URL so the link works without JS.
export function CheckoutButton({ label, pulse = false }: { label: string; pulse?: boolean }) {
  const { contentSpec } = useContent();
  const fallback =
    contentSpec.cart_state === "closed"
      ? contentSpec.waitlist_url ?? "#waitlist"
      : contentSpec.checkout_url;
  const [href, setHref] = useState(fallback);

  useEffect(() => {
    setHref(
      buildCheckoutHref({
        checkoutUrl: contentSpec.checkout_url,
        cartState: contentSpec.cart_state,
        ...(contentSpec.waitlist_url ? { waitlistUrl: contentSpec.waitlist_url } : {}),
      }),
    );
  }, []);

  return (
    <a className={pulse ? "cta cta--pulse" : "cta"} href={href} rel="noopener">
      {label}
    </a>
  );
}
