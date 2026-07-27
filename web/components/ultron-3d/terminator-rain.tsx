"use client";

import { useEffect, useRef } from "react";
import type { NeuralCoreState } from "@/components/live/neural-core-state";

/**
 * Red "digital rain" backdrop for the T-800 rig — Matrix-style streaming binary behind the chrome
 * endoskeleton (the transparent avatar canvas composites over it). Each column is a string of 0/1
 * that scrolls down SMOOTHLY (sub-pixel → fluid, not stepped), with a hot leading glyph and a
 * fading red trail; the digits are stable enough to read and only flip value occasionally.
 * Drop-in replacement for NeuralCoreScene in UltronStage's backdrop slot.
 *
 * Crispness: the canvas is fully CLEARED each frame and every glyph is redrawn from a per-column
 * character buffer with an explicit brightness gradient — there is NO translucent "wash"
 * accumulation (that smeared/ghosted the digits and made them unreadable). Only the leading glyph
 * carries a small glow; the trail is drawn sharp.
 *
 * Reads the SAME NeuralCoreState the arc reactor uses (passed in — no second poll): while agents
 * are active (`mode === "activated"`) the streams fall faster, flip more, and the head glow
 * oscillates, all ramped smoothly via one `activeness` scalar.
 *
 * Mount/loop/cleanup mirror ultron-stage.tsx: one useEffect, per-frame state in closures/refs
 * (never React state), ResizeObserver for HiDPI, cleanup cancels the frame + detaches the canvas.
 * Honors prefers-reduced-motion by slowing (not freezing) and pauses while the tab is hidden.
 *
 * Visual constants are grouped at the top for quick live tuning.
 */

const FONT_SIZE = 16; // px cell — dense binary field like the reference
const HEAD_RGB = "255, 124, 112"; // hot, near-white leading glyph
const BODY_RGB = "255, 46, 46"; // vivid red trail
const GLOW_COLOR = "#ff5a2a"; // warm halo on the leading glyph only

// Fall speed in CELLS PER SECOND (advanced as smooth sub-pixel motion → fluid). Range by depth:
// far columns fall slow + dim, near columns fall fast + bright. Natural Matrix pace, readable
// because the trail glyphs are stable (they slide as a unit and only flip occasionally).
const SPEED_MIN = 2.6;
const SPEED_DEPTH_SPAN = 3.4; // near columns add up to this many cells/sec
const SPEED_ACTIVE_MULT = 0.9; // extra speed factor at full activeness (also scaled by agent count)
const COUNT_CAP = 4;

// Trail length in glyphs (varies by depth: near = longer streams).
const TRAIL_MIN = 12;
const TRAIL_DEPTH_SPAN = 22;

// Per-column odds per frame of flipping one random trail glyph in place ("eventually change values").
const FLIP_IDLE = 0.01;
const FLIP_ACTIVE = 0.035;

const HEAD_BLUR = 6; // glow radius on the leading glyph (× depth)
const PULSE_HZ = 0.8; // head-glow oscillation while agents are active

const ACTIVENESS_LERP = 0.05;
const REDUCED_MOTION_SCALE = 0.4;

type Column = {
  x: number; // px, left edge of the column
  posPx: number; // head Y in px (continuous → smooth scroll)
  cell: number; // last integer cell the head occupied (detects boundary crossings to emit heads)
  speed: number; // cells/sec
  depth: number; // 0..1 (far/dim/slow → near/bright/fast)
  trailLen: number;
  seq: string[]; // seq[0] = head glyph, seq[k] = k cells above the head
};

function bit(): string {
  return Math.random() < 0.5 ? "0" : "1";
}

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
    let cols: Column[] = [];

    // seeded=true → start somewhere on screen with a full trail (instant populated field).
    // seeded=false (respawn) → start above the top with a random gap so streams re-enter
    // staggered and the field stays sparse (black between streams) like the reference.
    const makeColumn = (x: number, seeded: boolean): Column => {
      const depth = 0.32 + Math.random() * 0.68;
      const trailLen = Math.round(TRAIL_MIN + depth * TRAIL_DEPTH_SPAN);
      const rowsOnScreen = cssH / FONT_SIZE;
      const posPx = seeded
        ? Math.random() * cssH
        : -(Math.random() * rowsOnScreen + 2) * FONT_SIZE;
      const seq: string[] = [];
      const fill = seeded ? Math.min(trailLen, Math.max(0, Math.ceil(posPx / FONT_SIZE) + 1)) : 0;
      for (let k = 0; k < fill; k++) seq.push(bit());
      return {
        x,
        posPx,
        cell: Math.floor(posPx / FONT_SIZE),
        speed: SPEED_MIN + depth * SPEED_DEPTH_SPAN,
        depth,
        trailLen,
        seq,
      };
    };

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
      const prev = cols;
      cols = Array.from({ length: next }, (_, i) => prev[i] ?? makeColumn(i * FONT_SIZE, true));
      for (let i = 0; i < cols.length; i++) cols[i]!.x = i * FONT_SIZE; // keep x exact after resize
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
      const dSec = dt / 60; // seconds this frame, frame-rate independent
      elapsedSec += dSec;

      const core = stateRef.current;
      const active = core.mode === "activated";
      activeness += ((active ? 1 : 0) - activeness) * ACTIVENESS_LERP * dt;
      const countBoost = Math.min(core.activeProcessCount, COUNT_CAP) / COUNT_CAP;
      const speedMult = motion * (1 + activeness * SPEED_ACTIVE_MULT * (0.6 + countBoost));
      const flipProb = FLIP_IDLE + activeness * (FLIP_ACTIVE - FLIP_IDLE);
      // Head glow only oscillates while agents are active; amplitude eases in with activeness.
      const pulse = Math.sin(elapsedSec * 2 * Math.PI * PULSE_HZ * motion); // -1..1
      const headFactor = 0.82 + activeness * (0.18 + 0.22 * pulse);
      const blurFactor = 1 + activeness * 0.5 * (0.5 + 0.5 * pulse);

      // Crisp: fully clear (transparent → UltronStage's black shows through), then redraw sharp.
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.shadowColor = GLOW_COLOR;

      for (let i = 0; i < cols.length; i++) {
        const col = cols[i]!;
        col.posPx += col.speed * FONT_SIZE * speedMult * dSec;

        // Emit a fresh head glyph for every whole cell the head crossed this frame (smooth motion
        // between cells; a new random bit only when it steps to a new row → readable, not flicker).
        const cell = Math.floor(col.posPx / FONT_SIZE);
        while (col.cell < cell) {
          col.seq.unshift(bit());
          if (col.seq.length > col.trailLen) col.seq.pop();
          col.cell++;
        }
        // Occasionally flip one glyph already in the trail (values eventually change in place).
        if (col.seq.length > 1 && Math.random() < flipProb) {
          const idx = 1 + ((Math.random() * (col.seq.length - 1)) | 0);
          col.seq[idx] = bit();
        }

        const len = col.seq.length;
        const x = col.x;

        // Leading glyph — hot + small glow.
        if (len > 0 && col.posPx >= -FONT_SIZE && col.posPx <= cssH) {
          ctx.shadowBlur = HEAD_BLUR * col.depth * blurFactor;
          ctx.fillStyle = `rgba(${HEAD_RGB}, ${Math.min(1, col.depth * headFactor)})`;
          ctx.fillText(col.seq[0]!, x, col.posPx);
        }
        // Trail — sharp (glow off), fading up from the head.
        ctx.shadowBlur = 0;
        for (let k = 1; k < len; k++) {
          const y = col.posPx - k * FONT_SIZE;
          if (y < -FONT_SIZE || y > cssH) continue;
          const a = col.depth * Math.pow(1 - k / col.trailLen, 1.4);
          if (a < 0.02) continue;
          ctx.fillStyle = `rgba(${BODY_RGB}, ${a})`;
          ctx.fillText(col.seq[k]!, x, y);
        }

        // Respawn once the whole stream has passed the bottom → new depth/speed/length + a gap.
        if (col.posPx - len * FONT_SIZE > cssH) cols[i] = makeColumn(x, false);
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
