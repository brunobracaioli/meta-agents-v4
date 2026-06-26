"use client";

// SPEC-019 (ADR 0031) — ARC: the holographic "Tony Stark Mode" stage. A fullscreen overlay
// that reuses the shared Ultron voice/avatar pipeline (UltronProvider is mounted by the
// dashboard layout) and layers the Render Bus panel stack on top. z-30 covers the dashboard
// chrome (sticky header is z-10) but stays below the floating voice console (z-50), so the
// microphone remains usable in this mode. The classic dashboard is left fully intact.
import Link from "next/link";
import { UltronStage } from "@/components/ultron-3d/ultron-stage";
import { RenderBusProvider } from "./render-bus";
import { PanelLayer } from "./panel-layer";
import { ArcBridge } from "./arc-bridge";
import { ArcPopoutHost, openArcPopout } from "./arc-popout";

export function ArcStage() {
  return (
    <div
      data-mode="stand-by"
      className="fixed inset-0 z-30 overflow-hidden bg-[#02030a]"
    >
      <div className="hud-scanlines pointer-events-none absolute inset-0 z-10 opacity-50" />

      {/* Central avatar — the interface IS the Ultron speaking. */}
      <div className="absolute inset-0 z-0 p-2 sm:p-4">
        <UltronStage />
      </div>

      {/* Holographic panel stack, summoned by voice. ArcBridge feeds UIIntents from the
          (out-of-scope) voice provider into the bus via the ARC_RENDER event/channel. */}
      <RenderBusProvider>
        <ArcBridge />
        {/* Opens/answers the mirror "second screen" window when popout_element fires. */}
        <ArcPopoutHost />
        <PanelLayer />
      </RenderBusProvider>

      {/* Top strip: identity + second screen + exit back to the classic dashboard. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3 sm:px-6">
        <span className="hud-chip hud-clip-sm pointer-events-auto px-3 py-1.5 font-hud text-xs uppercase tracking-[0.28em] text-cyan-100/85">
          ARC · Ultron
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => openArcPopout()}
            className="hud-chip hud-clip-sm pointer-events-auto px-3 py-1.5 font-hud text-xs uppercase tracking-[0.2em] text-cyan-100/70 transition hover:text-cyan-50"
            title="Abrir os painéis numa segunda tela (espelho)"
          >
            ⧉ 2ª tela
          </button>
          <Link
            href="/dashboard"
            className="hud-chip hud-clip-sm pointer-events-auto px-3 py-1.5 font-hud text-xs uppercase tracking-[0.2em] text-cyan-100/70 transition hover:text-cyan-50"
          >
            ◄ Sair
          </Link>
        </div>
      </header>
    </div>
  );
}
