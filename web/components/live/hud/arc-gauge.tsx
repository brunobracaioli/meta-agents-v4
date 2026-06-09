"use client";

import { AnimatedCounter } from "./animated-counter";

const SIZE = 96;
const STROKE = 6;
const RADIUS = (SIZE - STROKE) / 2;
const SWEEP_DEG = 270;
const SWEEP_LENGTH = (SWEEP_DEG / 360) * 2 * Math.PI * RADIUS;

type ArcGaugeProps = {
  label: string;
  value: number;
  max: number;
  unit?: string;
};

/**
 * 270° arc gauge in the "Power 100%" JARVIS style. The fill animates via a
 * CSS transition on stroke-dashoffset whenever value/max changes.
 */
export function ArcGauge({ label, value, max, unit }: ArcGaugeProps) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const dashOffset = SWEEP_LENGTH * (1 - ratio);

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative" style={{ width: SIZE, height: SIZE }}>
        <svg aria-hidden viewBox={`0 0 ${SIZE} ${SIZE}`} className="h-full w-full -rotate-[135deg]">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#67e8f9"
            strokeOpacity={0.12}
            strokeWidth={STROKE}
            strokeDasharray={`${SWEEP_LENGTH} ${2 * Math.PI * RADIUS}`}
            strokeLinecap="round"
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="#67e8f9"
            strokeOpacity={0.85}
            strokeWidth={STROKE}
            strokeDasharray={`${SWEEP_LENGTH} ${2 * Math.PI * RADIUS}`}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{ transition: "stroke-dashoffset 600ms ease-out", filter: "drop-shadow(0 0 6px rgba(103,232,249,0.5))" }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-hud text-xl text-white">
            <AnimatedCounter value={value} />
            {unit ? <span className="ml-0.5 text-[10px] text-cyan-100/60">{unit}</span> : null}
          </span>
        </div>
      </div>
      <p className="font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/50">{label}</p>
    </div>
  );
}
