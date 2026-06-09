import { memo } from "react";

/**
 * Faint rotating radar sweep behind the whole page. The rotating element is
 * nested inside a centered wrapper so the CSS rotation animation doesn't
 * override the centering translate.
 */
function RadarSweepBase() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div className="absolute left-1/2 top-1/2 h-[150vmax] w-[150vmax] -translate-x-1/2 -translate-y-1/2">
        <div className="hud-radar-layer h-full w-full rounded-full" />
      </div>
    </div>
  );
}

export const RadarSweep = memo(RadarSweepBase);
