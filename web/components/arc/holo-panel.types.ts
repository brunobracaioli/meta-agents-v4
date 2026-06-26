// SPEC-019 — panel size token, in its own module so pure/node-testable code (arc-geometry)
// can import it without pulling in the "use client" holo-panel component (and framer-motion).
export type PanelSize = "default" | "wide";
