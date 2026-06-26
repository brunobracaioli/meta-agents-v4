"use client";

// SPEC-019 — base holographic panel. A panel materializes (scale + blur + glow) and
// dematerializes on exit via framer-motion. Visual language reuses the HUD utility classes
// from globals.css (cut-corner clip, cyan frame, scanlines) for cohesion with the cockpit.
//
// The panel OWNS its width (one source of truth — bodies just fill it): `default` for compact
// readouts, `wide` for content-heavy panels (landing preview, creative gallery, analyses).
// Honours prefers-reduced-motion: a plain fade replaces the scale/blur for those users.
import { motion, useReducedMotion } from "framer-motion";
import { type ReactNode } from "react";
import { type Anchor } from "@/lib/ultron/render-intents";

export type PanelSize = "default" | "wide";

export function HoloPanel({
  title,
  anchor: _anchor = "center",
  size = "default",
  focused = false,
  onDismiss,
  children,
}: {
  title: string;
  // Reserved for viewport anchoring (Wave E polish); currently the layer centers panels.
  anchor?: Anchor;
  size?: PanelSize;
  focused?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  const reduce = useReducedMotion();
  const widthClass = size === "wide" ? "w-[min(94vw,600px)]" : "w-[min(92vw,460px)]";

  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.85, filter: "blur(8px)" }}
      animate={reduce ? { opacity: 1 } : { opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.9, filter: "blur(8px)" }}
      transition={reduce ? { duration: 0.15 } : { duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-auto"
      style={{ perspective: 1000, transformStyle: "preserve-3d" }}
    >
      <div
        className={`hud-clip hud-frame p-px transition-shadow ${
          focused
            ? "shadow-[0_0_44px_rgba(103,232,249,0.38)]"
            : "shadow-[0_0_22px_rgba(103,232,249,0.14)]"
        }`}
      >
        <div className={`hud-clip hud-frame-bg relative overflow-hidden ${widthClass}`}>
          <div className="hud-scanlines pointer-events-none absolute inset-0 opacity-70" />
          <header
            className={`relative flex items-center justify-between gap-3 border-b px-4 py-2.5 transition-colors ${
              focused ? "border-cyan-300/40 bg-cyan-300/[0.06]" : "border-cyan-300/15"
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                aria-hidden
                className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
                  focused ? "bg-cyan-300 shadow-[0_0_8px_rgba(103,232,249,0.9)]" : "bg-cyan-300/35"
                }`}
              />
              <span className="truncate font-hud text-xs uppercase tracking-[0.22em] text-cyan-100/85">
                {title}
              </span>
            </span>
            {onDismiss ? (
              <button
                type="button"
                onClick={onDismiss}
                aria-label="Dispensar painel"
                className="grid h-6 w-6 shrink-0 place-items-center rounded border border-cyan-300/25 font-hud text-xs text-cyan-100/70 transition hover:border-cyan-200/60 hover:text-cyan-50"
              >
                ✕
              </button>
            ) : null}
          </header>
          <div className="relative px-4 py-3 text-sm text-cyan-50/90">{children}</div>
        </div>
      </div>
    </motion.div>
  );
}
