import { memo } from "react";

const DEFAULT_BAR_COUNT = 24;

type EqBarsProps = {
  bars?: number;
  className?: string;
};

/**
 * Audio-equalizer style dancing bars (decorative). Per-bar duration/delay are
 * deterministic functions of the index (no randomness at render), and a
 * negative delay starts each bar mid-cycle so the set never moves in unison.
 * Amplitude is modulated purely in CSS via --eq-amp keyed off [data-mode].
 */
function EqBarsBase({ bars = DEFAULT_BAR_COUNT, className = "" }: EqBarsProps) {
  return (
    <div aria-hidden className={`hud-eq flex items-end justify-between gap-[3px] ${className}`}>
      {Array.from({ length: bars }, (_, i) => (
        <span
          key={i}
          className="hud-eq-bar h-full w-1 bg-gradient-to-t from-cyan-400/80 via-cyan-300/60 to-cyan-100/90"
          style={{
            animationDuration: `${(0.8 + ((i * 7) % 5) * 0.14).toFixed(2)}s`,
            animationDelay: `-${((i * 0.41) % 1.3).toFixed(2)}s`,
          }}
        />
      ))}
    </div>
  );
}

export const EqBars = memo(EqBarsBase);
