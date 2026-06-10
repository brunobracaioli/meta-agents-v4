import { memo } from "react";

const VIEW_WIDTH = 240;
const VIEW_HEIGHT = 60;
const MID_Y = VIEW_HEIGHT / 2;

// Periods must divide VIEW_WIDTH so the path is continuous across the seam of
// the duplicated copy (seamless translateX(-50%) loop).
function sinePath(amplitude: number, period: number, phase: number, harmonic = 0): string {
  const samples = 96;
  const parts: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = (i / samples) * VIEW_WIDTH;
    const y =
      MID_Y +
      Math.sin((x / period) * Math.PI * 2 + phase) * amplitude +
      (harmonic > 0 ? Math.sin((x / (period / 2)) * Math.PI * 2 + phase * 1.7) * harmonic : 0);
    parts.push(`${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`);
  }
  return parts.join(" ");
}

const WAVE_MAIN = sinePath(13, 60, 0, 4);
const WAVE_GHOST = sinePath(7, 40, 1.3);

function WaveSvg() {
  return (
    <svg viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} preserveAspectRatio="none" className="h-full w-1/2">
      <line
        x1={0}
        y1={MID_Y}
        x2={VIEW_WIDTH}
        y2={MID_Y}
        stroke="#67e8f9"
        strokeOpacity={0.14}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      <path d={WAVE_GHOST} fill="none" stroke="#67e8f9" strokeOpacity={0.3} strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <path d={WAVE_MAIN} fill="none" stroke="#a5f3fc" strokeOpacity={0.8} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

type WaveformProps = {
  className?: string;
};

/**
 * Flowing oscilloscope wave (decorative). Two copies of a periodic path slide
 * left forever (translateX(-50%) keyframe on the track = one copy width).
 * Speed is modulated in CSS via --wave-dur keyed off [data-mode].
 */
function WaveformBase({ className = "" }: WaveformProps) {
  return (
    <div aria-hidden className={`hud-wave overflow-hidden ${className}`}>
      <div className="hud-wave-track flex h-full w-[200%]">
        <WaveSvg />
        <WaveSvg />
      </div>
    </div>
  );
}

export const Waveform = memo(WaveformBase);
