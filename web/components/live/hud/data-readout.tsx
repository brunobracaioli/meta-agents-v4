import { memo } from "react";

export const FALLBACK_READOUT_LINES = [
  "> SYS.CHK ............ OK",
  "> MEM.POOL 0x3F2A .... OK",
  "> NEURAL.LINK ..... ARMED",
  "> META.GRAPH ...... READY",
  "> SUPABASE.IO ..... READY",
  "> QSTASH.QUEUE ....... OK",
  "> PIXEL.CAPI ...... READY",
  "> VAD.WORKLET ..... ARMED",
  "> TTS.CHANNEL ........ OK",
  "> WATCHDOG 0x01A4 .... OK",
];

type DataReadoutProps = {
  lines: string[];
  className?: string;
};

/**
 * Vertical terminal readout marquee (decorative). The list is rendered twice
 * and the track loops translateY(-50%); content changes don't restart the
 * animation because it lives on the track, not the items.
 */
function DataReadoutBase({ lines, className = "" }: DataReadoutProps) {
  const items = lines.length > 0 ? lines : FALLBACK_READOUT_LINES;
  return (
    <div
      aria-hidden
      className={`overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_15%,black_85%,transparent)] ${className}`}
    >
      <div className="hud-readout-track">
        {[0, 1].map((copy) => (
          <ul key={copy} className="space-y-1.5 py-1">
            {items.map((line, i) => (
              <li key={i} className="truncate font-hud text-[10px] tracking-[0.08em] text-cyan-100/55">
                {line}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export const DataReadout = memo(DataReadoutBase);
