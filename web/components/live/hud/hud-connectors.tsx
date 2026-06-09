import { memo } from "react";

const CYAN = "#67e8f9";
const GLOW = "#bff7ff";

// Normalized coordinates over the top section at xl: the core frame fills the
// left column (~0..62%), the side panels the right 360px. preserveAspectRatio
// "none" stretches the curves with the container; non-scaling-stroke keeps the
// 1px line crisp.
const PATHS = [
  { id: "hud-conn-1", d: "M 700 252 C 745 252, 745 130, 784 130", startX: 700, startY: 252, dotBegin: "0s" },
  { id: "hud-conn-2", d: "M 700 308 C 745 308, 745 430, 784 430", startX: 700, startY: 308, dotBegin: "1.7s" },
];

/**
 * Decorative bezier connectors between the arc reactor frame and the side
 * panels, with light pulses travelling along each path (SMIL animateMotion).
 * Desktop-only; hidden below xl where the layout stacks.
 */
function HudConnectorsBase() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 1000 560"
      preserveAspectRatio="none"
      className="pointer-events-none absolute inset-0 z-10 hidden h-full w-full xl:block"
    >
      {PATHS.map((path) => (
        <g key={path.id}>
          <path
            id={path.id}
            d={path.d}
            fill="none"
            stroke={CYAN}
            strokeOpacity={0.28}
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

export const HudConnectors = memo(HudConnectorsBase);
