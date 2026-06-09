"use client";

import { useEffect, useState, type CSSProperties } from "react";

const BOOT_DONE_KEY = "ultron-boot-done";
const BOOT_TOTAL_MS = 2400;

export type BootPhase = "pending" | "running" | "done";

/**
 * Page boot phase for the HUD power-on animation. Runs once per tab session
 * (sessionStorage gate); reduced-motion users skip straight to "done".
 * CSS keys off the root's data-boot attribute: "pending" hides .hud-boot
 * panels pre-hydration (no flash), "running" plays the staggered entrance.
 */
export function useBootSequence(): BootPhase {
  const [phase, setPhase] = useState<BootPhase>("pending");

  useEffect(() => {
    let alreadyBooted = false;
    try {
      alreadyBooted = sessionStorage.getItem(BOOT_DONE_KEY) === "1";
    } catch {
      alreadyBooted = true; // storage unavailable: never gate content on the animation
    }
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (alreadyBooted || reducedMotion) {
      setPhase("done");
      return;
    }
    setPhase("running");
    const id = setTimeout(() => {
      setPhase("done");
      try {
        sessionStorage.setItem(BOOT_DONE_KEY, "1");
      } catch {
        // best-effort; replaying the boot next visit is harmless
      }
    }, BOOT_TOTAL_MS);
    return () => clearTimeout(id);
  }, []);

  return phase;
}

type TypeOnProps = {
  text: string;
  className?: string;
  /** Letter-spacing inherited from the parent, in em — needed because the ch-based width must include tracking. */
  letterSpacingEm?: number;
};

/** Terminal-style type-on text (CSS steps over a monospace width in ch). */
export function TypeOn({ text, className = "", letterSpacingEm = 0 }: TypeOnProps) {
  const width =
    letterSpacingEm > 0
      ? `calc(${text.length}ch + ${(text.length * letterSpacingEm).toFixed(2)}em)`
      : `${text.length}ch`;
  return (
    <span
      className={`hud-type-on ${className}`}
      style={{ "--type-w": width, "--type-steps": String(text.length) } as CSSProperties}
    >
      {text}
    </span>
  );
}
