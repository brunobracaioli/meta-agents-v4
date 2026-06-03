// UTM capture: read whitelisted utm_* (+ fbclid/gclid) params from the URL on mount,
// persist to sessionStorage, and re-attach to the checkout URL. See SPEC-011 §6.

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
  "gclid",
] as const;

const STORAGE_KEY = "b2tech_utms_v1";

export function captureUtms(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const captured: Record<string, string> = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) captured[key] = value;
    }
    if (Object.keys(captured).length > 0) {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(captured));
    }
  } catch {
    // non-fatal: tracking/attribution is best-effort
  }
}

export function getUtms(): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
