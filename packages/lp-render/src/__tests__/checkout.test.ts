import { afterEach, describe, expect, it } from "vitest";
import { buildCheckoutHref } from "../lib/checkout";
import { captureUtms } from "../lib/utm";

// buildCheckoutHref reads UTMs and the affiliate token from `window` at call time, so we
// stub a minimal browser: a settable location.search + an in-memory sessionStorage. The
// real Hubla checkout/waitlist URLs from the imersao-agencia landing page are used.

const CHECKOUT = "https://pay.hub.la/YftyuP6fkiKfL2daF0o1";
const WAITLIST = "https://wa.me/5500000000000?text=quero";
const AFF = "Gj8LqsTsGarzucZ48XHr";

function browser(search: string): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    location: { search },
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe("buildCheckoutHref — affiliate router", () => {
  it("returns the bare checkout URL when there is no aff and no UTM", () => {
    browser("");
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(CHECKOUT);
  });

  it("appends the affiliate token as `ref` when arriving via ?aff=", () => {
    browser(`?aff=${AFF}`);
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(`${CHECKOUT}?ref=${AFF}`);
  });

  it("keeps both UTMs and the affiliate ref when both are present", () => {
    browser(`?utm_source=ig&aff=${AFF}`);
    captureUtms(); // UTMs are read from sessionStorage, populated on mount from the URL
    const href = new URL(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" }));
    expect(href.searchParams.get("ref")).toBe(AFF);
    expect(href.searchParams.get("utm_source")).toBe("ig");
  });

  it("does not attach ref in closed-cart mode — goes to the waitlist", () => {
    browser(`?aff=${AFF}`);
    expect(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "closed", waitlistUrl: WAITLIST }),
    ).toBe(WAITLIST);
  });

  it("falls back to the affiliate token persisted in sessionStorage (no aff in URL)", () => {
    browser(`?aff=${AFF}`);
    // First call (with aff in URL) persists it; a later in-page navigation drops the param.
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "";
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(`${CHECKOUT}?ref=${AFF}`);
  });
});
