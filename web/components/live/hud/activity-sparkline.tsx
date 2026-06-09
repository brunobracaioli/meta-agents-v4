import { memo } from "react";

const WIDTH = 240;
const HEIGHT = 48;
const PADDING_Y = 4;

type ActivitySparklineProps = {
  /** Events-per-minute buckets, oldest first. */
  buckets: number[];
  label?: string;
};

/** Sparkline of agent event activity with a pulsing dot on the latest bucket. */
function ActivitySparklineBase({ buckets, label = "Atividade · eventos/min" }: ActivitySparklineProps) {
  const peak = Math.max(1, ...buckets);
  const stepX = buckets.length > 1 ? WIDTH / (buckets.length - 1) : WIDTH;
  const points = buckets.map((count, i) => {
    const x = i * stepX;
    const y = HEIGHT - PADDING_Y - (count / peak) * (HEIGHT - PADDING_Y * 2);
    return { x, y };
  });
  const polyline = points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const area = `0,${HEIGHT} ${polyline} ${WIDTH},${HEIGHT}`;
  const last = points[points.length - 1];

  return (
    <div>
      <svg
        aria-hidden
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-12 w-full"
      >
        <defs>
          <linearGradient id="hud-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#67e8f9" stopOpacity={0.28} />
            <stop offset="100%" stopColor="#67e8f9" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <polygon points={area} fill="url(#hud-spark-fill)" />
        <polyline
          points={polyline}
          fill="none"
          stroke="#67e8f9"
          strokeOpacity={0.7}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
        {last ? (
          <circle cx={last.x} cy={last.y} r={2.5} fill="#bff7ff" className="animate-pulse" />
        ) : null}
      </svg>
      <p className="mt-1 font-hud text-[10px] uppercase tracking-[0.18em] text-cyan-100/45">{label}</p>
    </div>
  );
}

export const ActivitySparkline = memo(ActivitySparklineBase);
