import { afterEach, describe, expect, it } from "vitest";
import { buildCheckoutHref, buildInternationalCheckoutHref } from "../lib/checkout";
import { captureUtms } from "../lib/utm";

// buildCheckoutHref reads UTMs and the affiliate token from `window` at call time, so we
// stub a minimal browser: a settable location.search + an in-memory sessionStorage. The
// real Hubla checkout/waitlist URLs from the imersao-agencia landing page are used.

const CHECKOUT = "https://pay.hub.la/YftyuP6fkiKfL2daF0o1";
const WAITLIST = "https://wa.me/5500000000000?text=quero";
const AFF = "Gj8LqsTsGarzucZ48XHr";
const HOTMART = "https://pay.hotmart.com/A106205617B?checkoutMode=10";
const HMT = "N106235919G";

function browser(search: string): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).window = {
    location: { search },
    sessionStorage: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
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

describe("buildCheckoutHref — Hotmart affiliate route (?hmt=)", () => {
  it("swaps the primary CTA to the Hotmart checkout with ref=<hmt>, keeping existing params", () => {
    browser(`?hmt=${HMT}`);
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.origin + href.pathname).toBe("https://pay.hotmart.com/A106205617B");
    expect(href.searchParams.get("checkoutMode")).toBe("10");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("hmt wins over aff when both are present", () => {
    browser(`?aff=${AFF}&hmt=${HMT}`);
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.hostname).toBe("pay.hotmart.com");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("ignores hmt when no international checkout is configured — never forwards it to Hubla", () => {
    browser(`?hmt=${HMT}`);
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(CHECKOUT);
  });

  it("appends UTMs to the Hotmart checkout as well", () => {
    browser(`?utm_source=ig&hmt=${HMT}`);
    captureUtms();
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.searchParams.get("utm_source")).toBe("ig");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("persists hmt in sessionStorage across in-page navigation", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "";
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("still goes to the waitlist in closed-cart mode", () => {
    browser(`?hmt=${HMT}`);
    expect(
      buildCheckoutHref({
        checkoutUrl: CHECKOUT,
        cartState: "closed",
        waitlistUrl: WAITLIST,
        internationalCheckoutUrl: HOTMART,
      }),
    ).toBe(WAITLIST);
  });
});

describe("affiliate router — last-click attribution across platforms", () => {
  it("a later ?aff= link overrides a stored hmt token — back to Hubla", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART });
    (globalThis as { window: { location: { search: string } } }).window.location.search = `?aff=${AFF}`;
    expect(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    ).toBe(`${CHECKOUT}?ref=${AFF}`);
  });

  it("a later ?hmt= link overrides a stored aff token — to Hotmart", () => {
    browser(`?aff=${AFF}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART });
    (globalThis as { window: { location: { search: string } } }).window.location.search = `?hmt=${HMT}`;
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.hostname).toBe("pay.hotmart.com");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("a bare URL (no affiliate param) keeps the stored attribution — sticky within the tab", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "?utm_source=ig";
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open", internationalCheckoutUrl: HOTMART }),
    );
    expect(href.hostname).toBe("pay.hotmart.com");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });
});

describe("buildCheckoutHref — producer migrated to Hotmart, Hubla kept for affiliates", () => {
  // checkoutUrl is now the Hotmart producer link; affiliateCheckoutUrl carries the Hubla base
  // for the ?aff= channel. Mirrors imersao-agencia after the 2026-06-13 Hubla→Hotmart migration.
  const PRODUCER = "https://pay.hotmart.com/A106205617B?bid=1781362751851";

  it("no affiliate param → producer Hotmart link, no stray ref", () => {
    browser("");
    expect(
      buildCheckoutHref({
        checkoutUrl: PRODUCER,
        cartState: "open",
        affiliateCheckoutUrl: CHECKOUT,
        internationalCheckoutUrl: HOTMART,
      }),
    ).toBe(PRODUCER);
  });

  it("?aff= → Hubla affiliate base + ref, never the producer Hotmart URL", () => {
    browser(`?aff=${AFF}`);
    const href = new URL(
      buildCheckoutHref({
        checkoutUrl: PRODUCER,
        cartState: "open",
        affiliateCheckoutUrl: CHECKOUT,
        internationalCheckoutUrl: HOTMART,
      }),
    );
    expect(href.hostname).toBe("pay.hub.la");
    expect(href.searchParams.get("ref")).toBe(AFF);
  });

  it("?hmt= → Hotmart checkout + ref", () => {
    browser(`?hmt=${HMT}`);
    const href = new URL(
      buildCheckoutHref({
        checkoutUrl: PRODUCER,
        cartState: "open",
        affiliateCheckoutUrl: CHECKOUT,
        internationalCheckoutUrl: HOTMART,
      }),
    );
    expect(href.hostname).toBe("pay.hotmart.com");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("hmt wins over aff — goes to Hotmart, not Hubla", () => {
    browser(`?aff=${AFF}&hmt=${HMT}`);
    const href = new URL(
      buildCheckoutHref({
        checkoutUrl: PRODUCER,
        cartState: "open",
        affiliateCheckoutUrl: CHECKOUT,
        internationalCheckoutUrl: HOTMART,
      }),
    );
    expect(href.hostname).toBe("pay.hotmart.com");
    expect(href.searchParams.get("ref")).toBe(HMT);
  });

  it("a stale Hubla token never rides on the producer Hotmart URL once cleared", () => {
    // Visit via ?aff= (stores it), then a bare reload: stays on Hubla (sticky, correct).
    // A later ?hmt= clears aff → Hotmart; a subsequent bare URL must NOT resurrect the Hubla ref.
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT, internationalCheckoutUrl: HOTMART });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "";
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT, internationalCheckoutUrl: HOTMART }),
    );
    expect(href.hostname).toBe("pay.hotmart.com"); // hmt sticky, not the producer-with-aff bug
    expect(href.searchParams.get("ref")).toBe(HMT);
  });
});

describe("buildInternationalCheckoutHref — secondary CTA (always Hotmart)", () => {
  it("attaches ref=<hmt> when the visitor arrived via ?hmt=", () => {
    browser(`?hmt=${HMT}`);
    const href = new URL(buildInternationalCheckoutHref(HOTMART));
    expect(href.searchParams.get("ref")).toBe(HMT);
    expect(href.searchParams.get("checkoutMode")).toBe("10");
  });

  it("never attaches the Hubla ?aff= token to the Hotmart URL", () => {
    browser(`?aff=${AFF}`);
    expect(buildInternationalCheckoutHref(HOTMART)).toBe(HOTMART);
  });
});
