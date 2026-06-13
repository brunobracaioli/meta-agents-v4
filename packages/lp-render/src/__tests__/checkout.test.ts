import { afterEach, describe, expect, it } from "vitest";
import { buildCheckoutHref, buildInternationalCheckoutHref } from "../lib/checkout";
import { captureUtms } from "../lib/utm";

// buildCheckoutHref reads UTMs and the affiliate token from `window` at call time, so we
// stub a minimal browser: a settable location.search + an in-memory sessionStorage. The
// real Hubla checkout/waitlist URLs from the imersao-agencia landing page are used.

const CHECKOUT = "https://pay.hub.la/YftyuP6fkiKfL2daF0o1"; // Hubla base (?aff= / legacy primary)
const WAITLIST = "https://wa.me/5500000000000?text=quero";
const AFF = "Gj8LqsTsGarzucZ48XHr"; // Hubla affiliate token
const HMT = "N106235919G"; // Hotmart affiliate hotlink code
const HOTLINK = "https://go.hotmart.com/N106235919G"; // where ?hmt= must route (cookie attribution)
const INTL = "https://pay.hotmart.com/A106205617B?checkoutMode=10"; // secondary "international" CTA

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

describe("buildCheckoutHref — Hubla affiliate router (?aff=)", () => {
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

describe("buildCheckoutHref — Hotmart affiliate route (?hmt= → go.hotmart.com hotlink)", () => {
  it("routes the primary CTA to the affiliate's Hotmart hotlink", () => {
    browser(`?hmt=${HMT}`);
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(HOTLINK);
  });

  it("never appends a ref/off to a pay.hotmart URL — Hotmart attribution is cookie-based", () => {
    browser(`?hmt=${HMT}`);
    const href = buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    expect(href.startsWith("https://go.hotmart.com/")).toBe(true);
    expect(href).not.toContain("pay.hotmart.com");
    expect(href).not.toContain("ref=");
  });

  it("hmt wins over aff when both are present (Hotmart hotlink, not Hubla)", () => {
    browser(`?aff=${AFF}&hmt=${HMT}`);
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(HOTLINK);
  });

  it("appends UTMs to the hotlink", () => {
    browser(`?utm_source=ig&hmt=${HMT}`);
    captureUtms();
    const href = new URL(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" }));
    expect(href.origin + href.pathname).toBe(HOTLINK);
    expect(href.searchParams.get("utm_source")).toBe("ig");
  });

  it("persists hmt in sessionStorage across in-page navigation", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "";
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(HOTLINK);
  });

  it("encodes the hotlink code as a path segment (defends against odd input)", () => {
    browser(`?hmt=${encodeURIComponent("a/b?c")}`);
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(
      "https://go.hotmart.com/a%2Fb%3Fc",
    );
  });

  it("still goes to the waitlist in closed-cart mode", () => {
    browser(`?hmt=${HMT}`);
    expect(
      buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "closed", waitlistUrl: WAITLIST }),
    ).toBe(WAITLIST);
  });
});

describe("affiliate router — last-click attribution across platforms", () => {
  it("a later ?aff= link overrides a stored hmt token — back to Hubla", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    (globalThis as { window: { location: { search: string } } }).window.location.search = `?aff=${AFF}`;
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(`${CHECKOUT}?ref=${AFF}`);
  });

  it("a later ?hmt= link overrides a stored aff token — to the Hotmart hotlink", () => {
    browser(`?aff=${AFF}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    (globalThis as { window: { location: { search: string } } }).window.location.search = `?hmt=${HMT}`;
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(HOTLINK);
  });

  it("a bare URL (no affiliate param) keeps the stored attribution — sticky within the tab", () => {
    browser(`?hmt=${HMT}`);
    buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" });
    (globalThis as { window: { location: { search: string } } }).window.location.search = "?utm_source=ig";
    expect(buildCheckoutHref({ checkoutUrl: CHECKOUT, cartState: "open" })).toBe(HOTLINK);
  });
});

describe("buildCheckoutHref — producer migrated to Hotmart, Hubla kept for affiliates", () => {
  // checkoutUrl is now the Hotmart producer link; affiliateCheckoutUrl carries the Hubla base
  // for the ?aff= channel. Mirrors imersao-agencia after the 2026-06-13 Hubla→Hotmart migration.
  const PRODUCER = "https://pay.hotmart.com/A106205617B?bid=1781362751851";

  it("no affiliate param → producer Hotmart link, no stray ref", () => {
    browser("");
    expect(
      buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT }),
    ).toBe(PRODUCER);
  });

  it("?aff= → Hubla affiliate base + ref, never the producer Hotmart URL", () => {
    browser(`?aff=${AFF}`);
    const href = new URL(
      buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT }),
    );
    expect(href.hostname).toBe("pay.hub.la");
    expect(href.searchParams.get("ref")).toBe(AFF);
  });

  it("?hmt= → Hotmart hotlink, not the producer pay URL", () => {
    browser(`?hmt=${HMT}`);
    expect(
      buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT }),
    ).toBe(HOTLINK);
  });

  it("hmt wins over aff — goes to the Hotmart hotlink, not Hubla", () => {
    browser(`?aff=${AFF}&hmt=${HMT}`);
    expect(
      buildCheckoutHref({ checkoutUrl: PRODUCER, cartState: "open", affiliateCheckoutUrl: CHECKOUT }),
    ).toBe(HOTLINK);
  });
});

describe("buildInternationalCheckoutHref — secondary CTA (Hotmart, UTMs only)", () => {
  it("returns the bare international URL when there are no UTMs", () => {
    browser("");
    expect(buildInternationalCheckoutHref(INTL)).toBe(INTL);
  });

  it("appends UTMs but never an affiliate ref (Hotmart attribution is cookie-based)", () => {
    browser(`?utm_source=ig&hmt=${HMT}`);
    captureUtms();
    const href = new URL(buildInternationalCheckoutHref(INTL));
    expect(href.searchParams.get("utm_source")).toBe("ig");
    expect(href.searchParams.get("ref")).toBeNull();
    expect(href.searchParams.get("checkoutMode")).toBe("10");
  });
});
