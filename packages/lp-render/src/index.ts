// Public surface of @b2tech/lp-render.
//
// Data layer (React-free — also reachable via the ./serialize, ./content-doc and
// ./content-types subpaths, which the Fly publish runner imports without pulling React):
export * from "./content-types";
export * from "./content-doc";
export * from "./serialize";

// Render layer (client components — the single page body shared by the static template
// and the live web preview). Consumers of this barrel must have React available.
export * from "./content"; // ContentProvider, useContent, ContentValue, ResolvedContent
export * from "./PageBody"; // PageBody
export { ReviewBridge } from "./sections/ReviewBridge"; // Live Review postMessage bridge (SPEC-014)

// Browser helpers reused by the template shell (e.g. <Tracking/> captures UTMs).
export { captureUtms, getUtms } from "./lib/utm";
export { buildCheckoutHref, type CheckoutConfig } from "./lib/checkout";
