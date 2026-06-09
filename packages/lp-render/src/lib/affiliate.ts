// Affiliate checkout router: read an affiliate token from the LP URL on mount, persist it
// to sessionStorage, and re-attach it to the checkout URL so each affiliate's sale is
// attributed. Mirrors utm.ts. Two channels, one param each:
//   ?aff=<token> → Hubla checkout, forwarded as the Hubla `ref` param
//   ?hmt=<code>  → Hotmart checkout (offer.secondaryCtaHref), forwarded as Hotmart `ref`
//     (the code at the end of a Hotmart hotlink — the checkout page shows it as "REF")
// Pass-through by design: any token is forwarded (the platform validates `ref` server-side),
// so onboarding a new affiliate needs no code change. See checkout.ts / SPEC-011 §6.

export const AFFILIATE_URL_PARAM = "aff"; // incoming param on the LP URL (Hubla)
export const HOTMART_URL_PARAM = "hmt"; // incoming param on the LP URL (Hotmart)
export const AFFILIATE_CHECKOUT_PARAM = "ref"; // outgoing param on the checkout URL (both platforms)

const STORAGE_KEY = "b2tech_aff_v1";
const HOTMART_STORAGE_KEY = "b2tech_hmt_v1";

export function captureAffiliate(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const aff = params.get(AFFILIATE_URL_PARAM);
    if (aff) window.sessionStorage.setItem(STORAGE_KEY, aff);
    const hmt = params.get(HOTMART_URL_PARAM);
    if (hmt) window.sessionStorage.setItem(HOTMART_STORAGE_KEY, hmt);
  } catch {
    // non-fatal: affiliate attribution is best-effort
  }
}

// Reads the URL first (self-healing against useEffect ordering between <CheckoutButton/>
// and <Tracking/>, and resilient to in-page anchor navigation), then falls back to the
// value captured into sessionStorage. Returns null when no token is present.
function readToken(urlParam: string, storageKey: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get(urlParam);
    if (fromUrl) {
      window.sessionStorage.setItem(storageKey, fromUrl);
      return fromUrl;
    }
    return window.sessionStorage.getItem(storageKey);
  } catch {
    return null;
  }
}

/** Hubla affiliate token (?aff=), or null. */
export function getAffiliate(): string | null {
  return readToken(AFFILIATE_URL_PARAM, STORAGE_KEY);
}

/** Hotmart affiliate code (?hmt=), or null. */
export function getHotmartAffiliate(): string | null {
  return readToken(HOTMART_URL_PARAM, HOTMART_STORAGE_KEY);
}
