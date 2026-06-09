import { memo } from "react";
import type { NeuralCoreMode } from "../neural-core-state";

const CENTER = 500;
const TICK_RING_RADIUS = 452;
const MAJOR_TICK_LENGTH = 16;
const MINOR_TICK_LENGTH = 8;
const TICK_COUNT = 72;
const LABEL_RADIUS = 487;
const CYAN = "#67e8f9";

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

const TICKS = Array.from({ length: TICK_COUNT }, (_, i) => {
  const deg = (i / TICK_COUNT) * 360;
  const major = i % 6 === 0;
  const inner = polar(TICK_RING_RADIUS - (major ? MAJOR_TICK_LENGTH : MINOR_TICK_LENGTH), deg);
  const outer = polar(TICK_RING_RADIUS, deg);
  return { key: i, major, x1: inner.x, y1: inner.y, x2: outer.x, y2: outer.y };
});

const DEGREE_LABELS = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30;
  const pos = polar(LABEL_RADIUS, deg);
  return { key: deg, label: String(deg).padStart(3, "0"), x: pos.x, y: pos.y };
});

// 3 long arcs with gaps, the classic segmented HUD ring.
const SEGMENT_ARCS = [
  arcPath(408, 10, 100),
  arcPath(408, 130, 220),
  arcPath(408, 250, 340),
];

const ACCENT_ARCS = [arcPath(372, 300, 30), arcPath(372, 120, 210)];

type ArcReactorOverlayProps = {
  mode: NeuralCoreMode;
};

/**
 * Screen-space "arc reactor" HUD over the 3D neural core canvas. Pure
 * decoration: pointer-events pass through to OrbitControls underneath, and
 * ring rotation lives entirely in CSS (.hud-ring-*) keyed by data-mode.
 */
function ArcReactorOverlayBase({ mode }: ArcReactorOverlayProps) {
  return (
    <svg
      aria-hidden
      data-mode={mode}
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid meet"
      className="pointer-events-none absolute inset-0 z-10 h-full w-full opacity-60 transition-opacity duration-700 data-[mode=activated]:opacity-95"
    >
      {/* Outer dashed ring, slow clockwise */}
      <g className="hud-ring-cw">
        <circle
          cx={CENTER}
          cy={CENTER}
          r={432}
          fill="none"
          stroke={CYAN}
          strokeOpacity={0.32}
          strokeWidth={2}
          strokeDasharray="4 12"
        />
        <circle
          cx={CENTER}
          cy={CENTER}
          r={440}
          fill="none"
          stroke={CYAN}
          strokeOpacity={0.12}
          strokeWidth={1}
        />
      </g>

      {/* Segmented mid ring, counter-clockwise */}
      <g className="hud-ring-ccw">
        {SEGMENT_ARCS.map((d) => (
          <path key={d} d={d} fill="none" stroke={CYAN} strokeOpacity={0.42} strokeWidth={3.5} />
        ))}
        {ACCENT_ARCS.map((d) => (
          <path key={d} d={d} fill="none" stroke={CYAN} strokeOpacity={0.18} strokeWidth={1.5} />
        ))}
      </g>

      {/* Tick ring, slow clockwise */}
      <g className="hud-ring-ticks">
        {TICKS.map((tick) => (
          <line
            key={tick.key}
            x1={tick.x1}
            y1={tick.y1}
            x2={tick.x2}
            y2={tick.y2}
            stroke={CYAN}
            strokeOpacity={tick.major ? 0.5 : 0.22}
            strokeWidth={tick.major ? 2 : 1}
          />
        ))}
      </g>

      {/* Static degree numerals */}
      <g className="font-hud" fill={CYAN} fillOpacity={0.38} fontSize={17} textAnchor="middle">
        {DEGREE_LABELS.map((item) => (
          <text key={item.key} x={item.x} y={item.y} dominantBaseline="central">
            {item.label}
          </text>
        ))}
      </g>
    </svg>
  );
}

export const ArcReactorOverlay = memo(ArcReactorOverlayBase);
