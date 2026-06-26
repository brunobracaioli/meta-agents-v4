"use client";

// SPEC-019 — base holographic panel. A panel materializes (scale + blur + glow) and
// dematerializes on exit via framer-motion. Visual language reuses the HUD utility classes
// from globals.css (cut-corner clip, cyan frame, scanlines) for cohesion with the cockpit.
import { motion } from "framer-motion";
import { type ReactNode } from "react";
import { type Anchor } from "@/lib/ultron/render-intents";

export function HoloPanel({
  title,
  anchor: _anchor = "center",
  focused = false,
  onDismiss,
  children,
}: {
  title: string;
  // Reserved for viewport anchoring (Wave E polish); currently the layer centers panels.
  anchor?: Anchor;
  focused?: boolean;
  onDismiss?: () => void;
  children: ReactNode;
}) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.85, filter: "blur(8px)" }}
      animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
      exit={{ opacity: 0, scale: 0.9, filter: "blur(8px)" }}
      transition={{ duration: 0.32, ease: [0.22, 1, 0.36, 1] }}
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
        <div className="hud-clip hud-frame-bg relative w-[min(92vw,460px)] overflow-hidden">
          <div className="hud-scanlines pointer-events-none absolute inset-0 opacity-70" />
          <header className="relative flex items-center justify-between gap-3 border-b border-cyan-300/15 px-4 py-2.5">
            <span className="truncate font-hud text-xs uppercase tracking-[0.22em] text-cyan-100/85">
              {title}
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
