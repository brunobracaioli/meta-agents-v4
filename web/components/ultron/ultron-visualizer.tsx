"use client";

import type { CSSProperties } from "react";
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

const BAND_COLORS = ["bg-cyan-300", "bg-emerald-300", "bg-orange-300", "bg-violet-300"];

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

export function UltronVisualizer({ status, outputLevel, outputBands }: UltronVisualizerProps) {
  const mode = MODE_STYLES[status];
  const level = status === "speaking" ? clamp(outputLevel) : 0;
  const bands = Array.from({ length: 18 }, (_, index) => clamp(outputBands[index] ?? 0));
  const coreScale = 1 + level * 0.32;
  const outerScale = 1 + level * 0.18;

  const coreStyle: CSSProperties = {
    transform: `translate(-50%, -50%) scale(${coreScale})`,
    boxShadow: `0 0 ${22 + level * 82}px rgba(${mode.rgb}, ${0.24 + level * 0.46})`,
  };

  const outerRingStyle: CSSProperties = {
    transform: `translate(-50%, -50%) scale(${outerScale})`,
  };

  return (
    <div className="tech-grid relative h-44 overflow-hidden rounded-lg border border-cyan-300/15 bg-[#030711]">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-200/60 to-transparent" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(34,211,238,0.14),transparent_52%)]" />

      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-white/45">
        <span className={`h-1.5 w-1.5 rounded-full ${status === "speaking" ? "bg-emerald-300" : "bg-white/35"}`} />
        U-CORE
      </div>
      <div
        className={`absolute right-3 top-3 z-10 rounded border px-2 py-1 font-mono text-[10px] uppercase tracking-[0.18em] ${mode.text} ${mode.border} bg-black/25`}
      >
        {mode.label}
      </div>

      <div
        className={`absolute left-1/2 top-1/2 h-32 w-32 rounded-full border ${mode.border} transition-transform duration-100`}
        style={outerRingStyle}
      />
      <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/10" />
      <div
        className={`absolute left-1/2 top-1/2 h-20 w-20 rounded-full border ${mode.border} bg-[radial-gradient(circle,var(--tw-gradient-stops))] ${mode.core} transition-[box-shadow,transform] duration-100`}
        style={coreStyle}
      >
        <div className="absolute inset-4 rounded-full border border-white/20 bg-black/35" />
        <div className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/85" />
      </div>

      <div className="absolute bottom-4 left-4 right-4 z-10 flex h-16 items-end gap-1.5">
        {bands.map((band, index) => (
          <span
            key={index}
            className={`block w-full rounded-t-sm ${BAND_COLORS[index % BAND_COLORS.length]} transition-[height,opacity] duration-75`}
            style={{
              height: `${6 + band * 58}px`,
              opacity: status === "speaking" ? 0.35 + band * 0.65 : 0.18,
            }}
          />
        ))}
      </div>
    </div>
  );
}
