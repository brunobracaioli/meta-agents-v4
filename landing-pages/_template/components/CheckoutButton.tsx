"use client";

import { useEffect, useState } from "react";
import { contentSpec } from "@/lib/content";
import { buildCheckoutHref } from "@/lib/checkout";

// Primary CTA. The href is computed client-side after mount so captured UTMs are
// appended (open cart) or the waitlist target is used (closed cart). SSR falls back
// to the bare checkout/waitlist URL so the link works without JS.
export function CheckoutButton({ label }: { label: string }) {
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
        waitlistUrl: contentSpec.waitlist_url,
      }),
    );
  }, []);

  return (
    <a className="cta" href={href} rel="noopener">
      {label}
    </a>
  );
}
