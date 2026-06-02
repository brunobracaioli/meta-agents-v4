// LGPD consent helpers. Tracking (FB Pixel + GA4) is injected ONLY after the user
// grants consent — never on initial static HTML. See ADR 0012 / SPEC-011 §6.

export const CONSENT_KEY = "b2tech_consent_v1";
export const CONSENT_EVENT = "b2tech:consent";

export interface ConsentRecord {
  v: 1;
  granted: boolean;
  ts: number;
}

export function getConsent(): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    return parsed.v === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function setConsent(granted: boolean): void {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = { v: 1, granted, ts: Date.now() };
  window.localStorage.setItem(CONSENT_KEY, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent<ConsentRecord>(CONSENT_EVENT, { detail: record }));
}
