"use client";

// SPEC-019 Wave C.2b — the ARC second-screen surface (rendered at /arc-popout, outside the
// dashboard layout so it carries NO voice provider/console — a single mic session stays in the
// main tab). It holds its own Render Bus fed by <ArcBridge> (live ARC_RENDER stream) plus
// <ArcPopoutClient> (the hello/sync catch-up), and renders the same <PanelLayer> as the main
// stage — so the panels mirror what the operator summoned.
import { RenderBusProvider } from "./render-bus";
import { PanelLayer } from "./panel-layer";
import { ArcBridge } from "./arc-bridge";
import { ArcPopoutClient } from "./arc-popout";

export function ArcPopoutStage() {
  return (
    <div className="fixed inset-0 z-30 overflow-hidden bg-[#02030a]">
      <div className="hud-scanlines pointer-events-none absolute inset-0 z-10 opacity-50" />

      <RenderBusProvider>
        <ArcBridge />
        <ArcPopoutClient />
        <PanelLayer />
      </RenderBusProvider>

      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center px-4 py-3 sm:px-6">
        <span className="hud-chip hud-clip-sm px-3 py-1.5 font-hud text-xs uppercase tracking-[0.28em] text-cyan-100/85">
          ARC · 2ª tela
        </span>
      </header>
    </div>
  );
}
