"use client";

// SPEC-019 (ADR 0031) — ARC: the holographic "Tony Stark Mode" stage. A fullscreen overlay
// that reuses the shared Ultron voice/avatar pipeline (UltronProvider is mounted by the
// dashboard layout) and layers the Render Bus panel stack on top. z-30 covers the dashboard
// chrome (sticky header is z-10) but stays below the floating voice console (z-50), so the
// microphone remains usable in this mode. The classic dashboard is left fully intact.
import Link from "next/link";
import { useEffect, useState } from "react";
import { UltronStage } from "@/components/ultron-3d/ultron-stage";
import { RIGS, type RigId } from "@/components/ultron-3d/rigs";
import { setActivePersona } from "@/lib/ultron/active-persona";
import { RenderBusProvider } from "./render-bus";
import { PanelLayer } from "./panel-layer";
import { ArcBridge } from "./arc-bridge";
import { ArcPopoutHost, openArcPopout } from "./arc-popout";

// Persist the operator's avatar choice for the ARC stage (Ultron ⇄ Terminator T-800).
const MODEL_STORAGE_KEY = "ultron_arc_model";

export function ArcStage() {
  // The 3D avatar shown by the ARC. The server always renders the default so hydration
  // matches; the persisted choice is applied on mount. The toggle lives only here.
  const [rigId, setRigId] = useState<RigId>("ultron");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(MODEL_STORAGE_KEY);
      if (saved === "ultron" || saved === "terminator") setRigId(saved);
    } catch {
      // storage blocked → keep the default avatar
    }
  }, []);

  // Signal the shared voice hook which persona is speaking. The T-800 gets its own name
  // ("TE OITOCENTOS") + ElevenLabs voice; on unmount (leaving the ARC, where only Ultron
  // exists) or a swap back, reset to Ultron so the voice matches the avatar you actually see.
  useEffect(() => {
    setActivePersona(rigId);
    return () => setActivePersona("ultron");
  }, [rigId]);

  const rig = RIGS[rigId];
  const nextRig = rigId === "ultron" ? RIGS.terminator : RIGS.ultron;

  const swapModel = () => {
    setRigId(nextRig.id);
    try {
      localStorage.setItem(MODEL_STORAGE_KEY, nextRig.id);
    } catch {
      // ignore persistence failures — the swap still applies for this session
    }
  };

  return (
    <div
      data-mode="stand-by"
      className="fixed inset-0 z-30 overflow-hidden bg-[#02030a]"
    >
      <div className="hud-scanlines pointer-events-none absolute inset-0 z-10 opacity-50" />

      {/* Central avatar — the interface IS the Ultron speaking. The `key` remounts the stage
          on a model swap so the old WebGL scene tears down cleanly and the new GLB loads
          (the 18 MB T-800 is fetched only when selected). */}
      <div className="absolute inset-0 z-0 p-2 sm:p-4">
        <UltronStage key={rig.id} rig={rig} />
      </div>

      {/* Holographic panel stack, summoned by voice. ArcBridge feeds UIIntents from the
          (out-of-scope) voice provider into the bus via the ARC_RENDER event/channel. */}
      <RenderBusProvider>
        <ArcBridge />
        {/* Opens/answers the mirror "second screen" window when popout_element fires. */}
        <ArcPopoutHost />
        <PanelLayer />
      </RenderBusProvider>

      {/* Top strip: identity + avatar swap + second screen + exit back to the classic dashboard. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 py-3 sm:px-6">
        <span className="hud-chip hud-clip-sm pointer-events-auto px-3 py-1.5 font-hud text-xs uppercase tracking-[0.28em] text-cyan-100/85">
          ARC · Ultron
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={swapModel}
            aria-label={`Trocar o avatar para ${nextRig.displayName}`}
            title={`Avatar atual: ${rig.displayName}. Clique para trocar para ${nextRig.displayName}.`}
            className="hud-chip hud-clip-sm pointer-events-auto px-3 py-1.5 font-hud text-xs uppercase tracking-[0.2em] text-cyan-100/70 transition hover:text-cyan-50"
          >
            ⌁ {nextRig.displayName}
          </button>
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
