import { memo } from "react";

const CYAN = "#67e8f9";
const GLOW = "#bff7ff";

// Anchored to the center-cell wrapper (96px wide strips straddling the grid
// gap on each side). Column widths and gaps are fixed at xl, so the horizontal
// geometry is stable in px; only Y stretches with the frame height
// (preserveAspectRatio="none" + non-scaling-stroke keeps lines crisp).
type ConnectorPath = { id: string; d: string; startX: number; startY: number; dotBegin: string };

const LEFT_PATHS: ConnectorPath[] = [
  { id: "hud-conn-l1", d: "M 96 224 C 52 224, 52 96, 0 96", startX: 96, startY: 224, dotBegin: "0s" },
  { id: "hud-conn-l2", d: "M 96 392 C 52 392, 52 530, 0 530", startX: 96, startY: 392, dotBegin: "1.2s" },
];

const RIGHT_PATHS: ConnectorPath[] = [
  { id: "hud-conn-r1", d: "M 0 224 C 44 224, 44 96, 96 96", startX: 0, startY: 224, dotBegin: "0.6s" },
  { id: "hud-conn-r2", d: "M 0 392 C 44 392, 44 530, 96 530", startX: 0, startY: 392, dotBegin: "1.8s" },
];

function ConnectorSvg({ paths, className }: { paths: ConnectorPath[]; className: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 96 640"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute top-0 z-10 hidden h-full w-24 xl:block ${className}`}
    >
      {paths.map((path) => (
        <g key={path.id}>
          <path
            id={path.id}
            d={path.d}
            fill="none"
            stroke={CYAN}
            strokeOpacity={0.3}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle cx={path.startX} cy={path.startY} r={3} fill={CYAN} fillOpacity={0.5} />
          <circle className="hud-connector-dot" r={2.5} fill={GLOW}>
            <animateMotion dur="3.4s" begin={path.dotBegin} repeatCount="indefinite">
              <mpath href={`#${path.id}`} />
            </animateMotion>
          </circle>
        </g>
      ))}
    </svg>
  );
}

/**
 * Decorative bezier connectors with travelling light pulses (SMIL), linking
 * the reactor frame to the instrument columns on both sides. Desktop-only.
 */
function HudConnectorsBase() {
  return (
    <>
      <ConnectorSvg paths={LEFT_PATHS} className="-left-4" />
      <ConnectorSvg paths={RIGHT_PATHS} className="-right-4" />
    </>
  );
}

export const HudConnectors = memo(HudConnectorsBase);
