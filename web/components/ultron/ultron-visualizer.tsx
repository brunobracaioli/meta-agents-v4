"use client";

import type { CSSProperties } from "react";
import { usePrefersReducedMotion } from "@/components/live/hud/use-reduced-motion";
import type { UltronStatus } from "./use-ultron-voice";

type UltronVisualizerProps = {
  status: UltronStatus;
  outputLevel: number;
  outputBands: number[];
};

type ModeStyle = {
  label: string;
  text: string;
  border: string;
  core: string;
  rgb: string;
};

const MODE_STYLES: Record<UltronStatus, ModeStyle> = {
  idle: {
    label: "STANDBY",
    text: "text-slate-300",
    border: "border-slate-400/20",
    core: "from-slate-200/45 via-cyan-200/20 to-transparent",
    rgb: "148, 163, 184",
  },
  armed: {
    label: "ARMED",
    text: "text-cyan-200",
    border: "border-cyan-300/35",
    core: "from-cyan-200/70 via-cyan-400/25 to-transparent",
    rgb: "103, 232, 249",
  },
  listening: {
    label: "LISTEN",
    text: "text-sky-200",
    border: "border-sky-300/35",
    core: "from-sky-200/70 via-cyan-400/20 to-transparent",
    rgb: "125, 211, 252",
  },
  recording: {
    label: "REC",
    text: "text-orange-200",
    border: "border-orange-300/40",
    core: "from-orange-200/75 via-red-500/25 to-transparent",
    rgb: "251, 146, 60",
  },
  transcribing: {
    label: "STT",
    text: "text-amber-200",
    border: "border-amber-300/35",
    core: "from-amber-200/70 via-orange-400/25 to-transparent",
    rgb: "252, 211, 77",
  },
  thinking: {
    label: "THINK",
    text: "text-violet-200",
    border: "border-violet-300/35",
    core: "from-violet-200/70 via-fuchsia-400/20 to-transparent",
    rgb: "196, 181, 253",
  },
  capturing: {
    label: "SCREEN",
    text: "text-fuchsia-200",
    border: "border-fuchsia-300/35",
    core: "from-fuchsia-200/70 via-violet-400/20 to-transparent",
    rgb: "240, 171, 252",
  },
  speaking: {
    label: "VOICE",
    text: "text-emerald-200",
    border: "border-emerald-300/40",
    core: "from-emerald-200/80 via-cyan-300/35 to-transparent",
    rgb: "110, 231, 183",
  },
  error: {
    label: "FAULT",
    text: "text-red-200",
    border: "border-red-300/40",
    core: "from-red-200/75 via-red-500/25 to-transparent",
    rgb: "248, 113, 113",
  },
};

// Compact arc reactor: same ring grammar as live/hud/arc-reactor-overlay.tsx,
// rebuilt on a 240-unit viewBox so the geometry fits the voice console panel.
const CENTER = 120;
const BAND_COUNT = 18;
const SPOKE_COUNT = 36;
const SPOKE_BASE_RADIUS = 74;
const SPOKE_MAX_LENGTH = 20;
const TICK_RING_RADIUS = 117;
const TICK_COUNT = 36;

function polar(radius: number, deg: number): { x: number; y: number } {
  const rad = ((deg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

function arcPath(radius: number, startDeg: number, endDeg: number): string {
  const start = polar(radius, startDeg);
  const end = polar(radius, endDeg);
  const largeArc = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

const SEGMENT_ARCS = [arcPath(64, 10, 100), arcPath(64, 130, 220), arcPath(64, 250, 340)];

const ACCENT_ARCS = [arcPath(56, 300, 30), arcPath(56, 120, 210)];

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const deg = (i / TICK_COUNT) * 360;
  const major = i % 6 === 0;
  const inner = polar(TICK_RING_RADIUS - (major ? 7 : 3.5), deg);
  const outer = polar(TICK_RING_RADIUS, deg);
  return { key: i, major, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

// 18 frequency bands mirrored into 36 radial spikes (band i at i*10° and i*10°+180°).
const SPOKES = Array.from({ length: SPOKE_COUNT }, (_, i) => ({ deg: i * 10, band: i % BAND_COUNT }));

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function UltronVisualizer({ status, outputLevel, outputBands }: UltronVisualizerProps) {
  const reducedMotion = usePrefersReducedMotion();
  const mode = MODE_STYLES[status];
  const speaking = status === "speaking";
  const level = speaking && !reducedMotion ? clamp(outputLevel) : 0;
  const bands = Array.from({ length: BAND_COUNT }, (_, index) =>
    speaking ? clamp(outputBands[index] ?? 0) : 0,
  );

  // Every ring/spoke strokes through this variable so a status change recolors
  // the whole reactor with one CSS transition.
  const panelStyle = { "--reactor-rgb": mode.rgb } as CSSProperties;

  const ringStroke = (opacity: number): CSSProperties => ({
    stroke: `rgba(var(--reactor-rgb), ${opacity})`,
    transition: "stroke 300ms ease",
  });

  // Scale lives on a wrapper div: the .hud-ring-* CSS rotation would overwrite
  // an inline transform on the same element.
  const reactorScaleStyle: CSSProperties = {
    transform: `translate(-50%, -50%) scale(${1 + level * 0.05})`,
    transition: "transform 100ms linear",
  };

  const coreStyle: CSSProperties = {
    transform: `translate(-50%, -50%) scale(${1 + level * 0.32})`,
    boxShadow: `0 0 ${18 + level * 70}px rgba(${mode.rgb}, ${0.24 + level * 0.46})`,
  };

  return (
    <div
      className="tech-grid relative h-56 overflow-hidden rounded-lg border border-cyan-300/15 bg-[#030711]"
      style={panelStyle}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.14),transparent_52%)]" />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
        <span className={`h-1.5 w-1.5 rounded-full ${speaking ? "bg-emerald-300" : "bg-white/35"}`} />
        U-CORE
      </div>
      <div
        className={`absolute right-3 top-3 z-10 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${mode.text} ${mode.border} bg-black/25`}
      >
        {mode.label}
      </div>

      <div className="absolute left-1/2 top-1/2 h-48 w-48" style={reactorScaleStyle}>
        <svg aria-hidden viewBox="0 0 240 240" className="h-full w-full opacity-90">
          {/* Static halo ring */}
          <circle cx={CENTER} cy={CENTER} r={112} fill="none" strokeWidth={0.75} style={ringStroke(0.12)} />

          {/* Tick ring, slow clockwise */}
          <g className="hud-ring-ticks" style={{ animationDuration: speaking ? "16s" : "48s" }}>
            {TICKS.map((tick) => (
              <line
                key={tick.key}
                x1={tick.x1}
                y1={tick.y1}
                x2={tick.x2}
                y2={tick.y2}
                strokeWidth={tick.major ? 1.5 : 0.75}
                style={ringStroke(tick.major ? 0.55 : 0.26)}
              />
            ))}
          </g>

          {/* Outer dashed ring, clockwise */}
          <g className="hud-ring-cw" style={{ animationDuration: speaking ? "9s" : "30s" }}>
            <circle
              cx={CENTER}
              cy={CENTER}
              r={104}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="3 10"
              style={ringStroke(0.5)}
            />
          </g>

          {/* Circular EQ: 18 mirrored frequency bands vibrating with the TTS audio */}
          <g>
            {SPOKES.map(({ deg, band }) => {
              const value = bands[band] ?? 0;
              const scale = reducedMotion ? 0.45 : 0.2 + value * 0.8;
              return (
                <g key={deg} transform={`rotate(${deg} ${CENTER} ${CENTER})`}>
                  <line
                    x1={CENTER}
                    y1={CENTER - SPOKE_BASE_RADIUS}
                    x2={CENTER}
                    y2={CENTER - SPOKE_BASE_RADIUS - SPOKE_MAX_LENGTH}
                    strokeWidth={2}
                    strokeLinecap="round"
                    style={{
                      stroke: "rgba(var(--reactor-rgb), 1)",
                      strokeOpacity: speaking ? 0.3 + value * 0.7 : 0.18,
                      transform: `scaleY(${scale})`,
                      transformOrigin: `${CENTER}px ${CENTER - SPOKE_BASE_RADIUS}px`,
                      transition: reducedMotion
                        ? "stroke 300ms ease"
                        : "transform 75ms linear, stroke-opacity 75ms linear, stroke 300ms ease",
                    }}
                  />
                </g>
              );
            })}
          </g>

          {/* Segmented mid ring, counter-clockwise */}
          <g className="hud-ring-ccw" style={{ animationDuration: speaking ? "6s" : "20s" }}>
            {SEGMENT_ARCS.map((d) => (
              <path key={d} d={d} fill="none" strokeWidth={2.5} style={ringStroke(0.6)} />
            ))}
            {ACCENT_ARCS.map((d) => (
              <path key={d} d={d} fill="none" strokeWidth={1} style={ringStroke(0.28)} />
            ))}
          </g>

          {/* Inner housing ring around the core */}
          <circle cx={CENTER} cy={CENTER} r={46} fill="none" strokeWidth={0.75} style={ringStroke(0.2)} />
        </svg>
      </div>

      <div
        className={`absolute left-1/2 top-1/2 h-16 w-16 rounded-full border ${mode.border} bg-[radial-gradient(circle,var(--tw-gradient-stops))] ${mode.core} transition-[box-shadow,transform] duration-100`}
        style={coreStyle}
      >
        <div className="absolute inset-3 rounded-full border border-white/20 bg-black/35" />
        <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85" />
      </div>
    </div>
  );
}
