// SPEC-019 Wave C.1 — URL guard for the ARC landing preview. Pure (no server-only, no React) so
// BOTH boundaries can call it: the show_landing render-tool (server) before emitting the intent,
// and the LandingPreviewPanel (client) before mounting the iframe. Calling it at both boundaries
// is the defense-in-depth (threat model §I) — a tampered payload can never frame an arbitrary
// origin. Only the agency's own https://*.b2tech.io pages are embeddable.
export function isB2TechUrl(raw: string | null | undefined): boolean {
  if (!raw) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && (u.hostname === "b2tech.io" || u.hostname.endsWith(".b2tech.io"));
  } catch {
    return false;
  }
}
