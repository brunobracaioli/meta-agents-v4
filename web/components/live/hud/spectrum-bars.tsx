import { memo } from "react";
import { SPECTRUM_EVENT_TYPES, type SpectrumEventType } from "../live-metrics";

const BAR_COLOR: Record<SpectrumEventType, string> = {
  start: "bg-cyan-300",
  step: "bg-white/50",
  decision: "bg-violet-300",
  error: "bg-red-400",
  end: "bg-emerald-300",
};

type SpectrumBarsProps = {
  counts: Record<SpectrumEventType, number>;
  label?: string;
};

/** Per-event-type bars (5-minute window), animated via scaleY on change. */
function SpectrumBarsBase({ counts, label = "Espectro · 5 min" }: SpectrumBarsProps) {
  const peak = Math.max(1, ...SPECTRUM_EVENT_TYPES.map((type) => counts[type]));

  return (
    <div>
      <div className="flex h-12 items-end gap-2" aria-hidden>
        {SPECTRUM_EVENT_TYPES.map((type) => {
          const ratio = counts[type] / peak;
          return (
            <div key={type} className="flex h-full flex-1 flex-col justify-end gap-1">
              <div className="relative h-full overflow-hidden bg-white/[0.04]">
                <div
                  className={`absolute inset-0 origin-bottom ${BAR_COLOR[type]}`}
                  style={{
                    transform: `scaleY(${Math.max(0.02, ratio).toFixed(3)})`,
                    transition: "transform 500ms ease-out",
                    opacity: counts[type] > 0 ? 0.8 : 0.25,
                  }}
                />
              </div>
              <p className="text-center font-hud text-[9px] uppercase tracking-wide text-white/35">{type}</p>
            </div>
          );
        })}
      </div>
      <p className="mt-1 font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/45">{label}</p>
    </div>
  );
}

export const SpectrumBars = memo(SpectrumBarsBase);
