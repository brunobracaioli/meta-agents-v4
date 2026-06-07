// Affiliate checkout router: read an affiliate token from the LP URL (?aff=<token>)
// on mount, persist it to sessionStorage, and re-attach it to the checkout URL as the
// Hubla `ref` param so each affiliate's sale is attributed. Mirrors utm.ts. Pass-through
// by design: any token is forwarded (Hubla validates `ref` server-side), so onboarding a
// new affiliate needs no code change. See checkout.ts / SPEC-011 §6.

export const AFFILIATE_URL_PARAM = "aff"; // incoming param on the LP URL
export const AFFILIATE_CHECKOUT_PARAM = "ref"; // outgoing param appended to the checkout URL (Hubla)

const STORAGE_KEY = "b2tech_aff_v1";

export function captureAffiliate(): void {
  if (typeof window === "undefined") return;
  try {
    const value = new URLSearchParams(window.location.search).get(AFFILIATE_URL_PARAM);
    if (value) window.sessionStorage.setItem(STORAGE_KEY, value);
  } catch {
    // non-fatal: affiliate attribution is best-effort
  }
}

// Reads the URL first (self-healing against useEffect ordering between <CheckoutButton/>
// and <Tracking/>, and resilient to in-page anchor navigation), then falls back to the
// value captured into sessionStorage. Returns null when no affiliate is present.
export function getAffiliate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(AFFILIATE_URL_PARAM);
    if (fromUrl) {
      window.sessionStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
