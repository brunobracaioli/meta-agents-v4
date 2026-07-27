"use client";

import { useEffect, useRef } from "react";
import type { NeuralCoreState } from "@/components/live/neural-core-state";

/**
 * Red "digital rain" backdrop for the T-800 rig — the Skynet-terminal look behind the chrome
 * endoskeleton (the transparent avatar canvas composites over it). Streams of numbers/binary +
 * a few tech glyphs fall SLOWLY in an endless loop — each glyph snaps to a row grid and holds
 * long enough to read, with a bright head + orange glow trailing into a fading maroon tail.
 * Drop-in replacement for NeuralCoreScene in UltronStage's backdrop slot.
 *
 * It reads the SAME NeuralCoreState the arc reactor uses (passed in — no second poll): while
 * agents are active (`mode === "activated"`) the flow speeds up + densifies (scaled by
 * activeProcessCount) and the glow oscillates. Everything ramps smoothly via a single
 * `activeness` scalar lerped toward the live state, so entering/leaving activity never snaps.
 *
 * Mount/loop/cleanup mirror ultron-stage.tsx: one useEffect, all per-frame state in
 * closures/refs (never React state), ResizeObserver for HiDPI, cleanup cancels the frame and
 * detaches the canvas. Honors prefers-reduced-motion by slowing down (not freezing) and pauses
 * while the tab is hidden.
 *
 * Visual constants are grouped at the top for quick live tuning.
 */

const FONT_SIZE = 18; // a touch larger than before so the digits are easier to read
// Glyph pool, weighted toward 0/1 for the binary-stream read, with digits and a few tech marks
// to echo the reference (squares/brackets/dashes scattered through the code).
const GLYPHS = "01010101010123456789+<>[]▪╌";
const HEAD_RGB = "255, 62, 52"; // vivid red head, a touch luminous so the leading digit reads
const GLOW_COLOR = "#ff6b1a"; // --color-orange — warm halo on the leading glyph
const NAVY = "5, 8, 20"; // --color-navy #050814 — the field the trails fade into

// Trail length: lower wash alpha = longer-lived (more readable) trails. Kept low so a column of
// digits stays legible; a hair shorter when agents are active for a punchier, denser field.
const WASH_IDLE = 0.05;
const WASH_ACTIVE = 0.06;
// Fall speed in ROWS PER SECOND (not per frame): slow enough to read each digit. Idle baseline +
// the bump added at full activeness (scaled by how many agents run, up to COUNT_CAP).
const FALL_IDLE_RPS = 3.6;
const FALL_ACTIVE_RPS_SPAN = 3.0; // base speed-up when agents run
const FALL_COUNT_RPS_SPAN = 4.0; // extra speed-up scaled by agent count
const COUNT_CAP = 4;
// Per-frame odds a finished column restarts; scaled by activeness → denser streams when active.
const RESET_PROB = 0.02;
const RESET_ACTIVE_MULT = 1.8;
// Glow pulse (only amplitude-active while agents run).
const PULSE_HZ = 0.8;
const BASE_BLUR = 7;
// Smoothing of the activeness ramp (per frame @60fps) and how far reduced-motion slows things.
const ACTIVENESS_LERP = 0.045;
const REDUCED_MOTION_SCALE = 0.45;

export function TerminatorRain({
  state,
  heightClassName = "h-full",
}: {
  state: NeuralCoreState;
  heightClassName?: string;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  // Mirror the live agent state into a ref so the once-built rAF closure reads the latest value
  // each frame without restarting the loop on every 4s poll (same trick as coreActiveRef).
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const motion = reducedMotion ? REDUCED_MOTION_SCALE : 1;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);

    const canvas = document.createElement("canvas");
    canvas.style.display = "block";
    canvas.style.width = "100%";
    canvas.style.height = "100%";
    host.appendChild(canvas);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      canvas.remove();
      return;
    }

    let cssW = 1;
    let cssH = 1;
    let columns = 0;
    // Per-column continuous head row (in FONT_SIZE units), the glyph the head currently shows, the
    // last integer row drawn (so a fresh glyph is picked only when the head STEPS to a new cell —
    // keeps each digit crisp + readable), and a depth tier (background dim/slow → foreground bright).
    let drops: number[] = [];
    let heads: string[] = [];
    let lastRow: number[] = [];
    let depth: number[] = [];
    let primed = false;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      cssW = Math.max(rect.width, 1);
      cssH = Math.max(rect.height, 1);
      canvas.width = Math.floor(cssW * pixelRatio);
      canvas.height = Math.floor(cssH * pixelRatio);
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.font = `${FONT_SIZE}px "Share Tech Mono", ui-monospace, monospace`;
      ctx.textBaseline = "top";
      const next = Math.ceil(cssW / FONT_SIZE);
      // Preserve existing columns on resize; seed any new ones staggered above the top.
      drops = Array.from({ length: next }, (_, i) => drops[i] ?? Math.random() * -(cssH / FONT_SIZE));
      heads = Array.from({ length: next }, (_, i) => heads[i] ?? GLYPHS[(Math.random() * GLYPHS.length) | 0]!);
      lastRow = Array.from({ length: next }, (_, i) => lastRow[i] ?? -9999);
      depth = Array.from({ length: next }, (_, i) => depth[i] ?? 0.35 + Math.random() * 0.65);
      columns = next;
      primed = false; // repaint the dark field before trails resume
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let raf = 0;
    let last = performance.now();
    let elapsedSec = 0;
    let activeness = 0; // 0 = idle, 1 = agents fully active (smoothly ramped)

    const render = (now: number) => {
      // Skip work while the tab is hidden — resume cleanly on return.
      if (document.hidden) {
        last = now;
        raf = window.requestAnimationFrame(render);
        return;
      }
      const dt = Math.min((now - last) / 16.667, 3); // frames elapsed @60fps, capped
      last = now;
      elapsedSec += dt / 60; // dt is frames @60fps → dt/60 ≈ seconds, frame-rate independent

      const core = stateRef.current;
      const active = core.mode === "activated";
      activeness += ((active ? 1 : 0) - activeness) * ACTIVENESS_LERP * dt;
      const countBoost = Math.min(core.activeProcessCount, COUNT_CAP) / COUNT_CAP;

      // rows/sec → rows advanced THIS frame (dt is frames @60fps, so dt/60 = seconds).
      const rowsPerSec = FALL_IDLE_RPS + activeness * (FALL_ACTIVE_RPS_SPAN + countBoost * FALL_COUNT_RPS_SPAN);
      const rowsThisFrame = (rowsPerSec * motion * dt) / 60;
      const wash = WASH_IDLE + activeness * (WASH_ACTIVE - WASH_IDLE);
      const resetProb = RESET_PROB * (1 + activeness * (RESET_ACTIVE_MULT - 1));
      // Glow oscillates only when active; amplitude scales with activeness so it eases in/out.
      const pulse = 0.5 + activeness * 0.5 * Math.sin(elapsedSec * 2 * Math.PI * PULSE_HZ * motion);

      // Dark field + fading trails: prime once with a solid navy, then wash each frame.
      ctx.shadowBlur = 0;
      ctx.fillStyle = `rgba(${NAVY}, ${primed ? wash : 1})`;
      ctx.fillRect(0, 0, cssW, cssH);
      primed = true;

      ctx.shadowColor = GLOW_COLOR;
      const blur = BASE_BLUR * (0.6 + 0.8 * pulse);
      for (let i = 0; i < columns; i++) {
        const d = depth[i]!;
        // Advance on the row grid; nearer (brighter) columns fall a touch faster (parallax).
        drops[i]! += rowsThisFrame * (0.7 + 0.6 * d);
        const row = Math.floor(drops[i]!);
        // New glyph ONLY when the head steps to a new cell — the head then holds one crisp,
        // readable digit for the whole time it sits in that row (no per-frame smear).
        if (row !== lastRow[i]) {
          lastRow[i] = row;
          heads[i] = GLYPHS[(Math.random() * GLYPHS.length) | 0]!;
        }
        const y = row * FONT_SIZE;
        if (y >= -FONT_SIZE && y <= cssH) {
          // Redraw the head at its fixed integer position each frame so it stays bright + sharp;
          // the cells it left behind aren't redrawn, so they fade via the wash into the trail.
          const alpha = Math.min(1, (0.5 + 0.5 * d) * (0.72 + 0.55 * pulse));
          ctx.shadowBlur = blur * d;
          ctx.fillStyle = `rgba(${HEAD_RGB}, ${alpha})`;
          ctx.fillText(heads[i]!, i * FONT_SIZE, y);
        }
        if (y > cssH && Math.random() < resetProb) {
          drops[i] = -Math.random() * 8;
          lastRow[i] = Math.floor(drops[i]!) - 1; // force a fresh glyph when it re-enters
        }
      }

      raf = window.requestAnimationFrame(render);
    };
    raf = window.requestAnimationFrame(render);

    return () => {
      window.cancelAnimationFrame(raf);
      observer.disconnect();
      canvas.remove();
    };
  }, []);

  return (
    <div
      ref={hostRef}
      aria-hidden
      className={`pointer-events-none relative w-full overflow-hidden bg-black ${heightClassName}`}
    />
  );
}
