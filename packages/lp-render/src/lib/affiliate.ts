// Affiliate checkout router: read an affiliate token from the LP URL on mount, persist it
// to sessionStorage, and re-attach it to the checkout URL so each affiliate's sale is
// attributed. Mirrors utm.ts. Two channels, one param each:
//   ?aff=<token> → Hubla checkout, forwarded as the Hubla `ref` param
//   ?hmt=<code>  → Hotmart checkout (offer.secondaryCtaHref), forwarded as Hotmart `ref`
//     (the code at the end of a Hotmart hotlink — the checkout page shows it as "REF")
// Pass-through by design: any token is forwarded (the platform validates `ref` server-side),
// so onboarding a new affiliate needs no code change. See checkout.ts / SPEC-011 §6.
//
// Attribution model: LAST CLICK. A URL that carries any affiliate param is the source of
// truth for BOTH channels — it sets its own token and clears the other channel's stored one,
// so a visitor who later arrives via a different affiliate's link is re-attributed. A URL
// with no affiliate param falls back to what the session captured earlier (attribution
// survives reloads and in-page navigation; sessionStorage dies with the tab).

export const AFFILIATE_URL_PARAM = "aff"; // incoming param on the LP URL (Hubla)
export const HOTMART_URL_PARAM = "hmt"; // incoming param on the LP URL (Hotmart)
export const AFFILIATE_CHECKOUT_PARAM = "ref"; // outgoing param on the checkout URL (both platforms)

const STORAGE_KEY = "b2tech_aff_v1";
const HOTMART_STORAGE_KEY = "b2tech_hmt_v1";

interface AffiliateTokens {
  aff: string | null;
  hmt: string | null;
}

// Reads the URL first (self-healing against useEffect ordering between <CheckoutButton/>
// and <Tracking/>), syncing sessionStorage as a side effect; falls back to the stored
// values when the URL carries no affiliate param at all.
function resolveTokens(): AffiliateTokens {
  if (typeof window === "undefined") return { aff: null, hmt: null };
  try {
    const params = new URLSearchParams(window.location.search);
    const urlAff = params.get(AFFILIATE_URL_PARAM);
    const urlHmt = params.get(HOTMART_URL_PARAM);
    const store = window.sessionStorage;
    if (urlAff || urlHmt) {
      // Explicit affiliate link → last click wins on both channels.
      if (urlAff) store.setItem(STORAGE_KEY, urlAff);
      else store.removeItem(STORAGE_KEY);
      if (urlHmt) store.setItem(HOTMART_STORAGE_KEY, urlHmt);
      else store.removeItem(HOTMART_STORAGE_KEY);
      return { aff: urlAff, hmt: urlHmt };
    }
    return { aff: store.getItem(STORAGE_KEY), hmt: store.getItem(HOTMART_STORAGE_KEY) };
  } catch {
    // non-fatal: affiliate attribution is best-effort
    return { aff: null, hmt: null };
  }
}

export function captureAffiliate(): void {
  resolveTokens();
}

/** Hubla affiliate token (?aff=), or null. */
export function getAffiliate(): string | null {
  return resolveTokens().aff;
}

/** Hotmart affiliate code (?hmt=), or null. */
export function getHotmartAffiliate(): string | null {
  return resolveTokens().hmt;
}
