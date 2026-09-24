"use client";

// Dithered area chart: the area is a field of small dots under a gradient, the
// top line is solid with a glow. Horizontal gradient runs with time; vertical
// puts the brightest colour at the top.
import { useId } from "react";

export interface DitherChartProps {
  series: number[];
  /** accessible name: what this line is */
  label: string;
  className?: string;
  orient?: "horizontal" | "vertical";
}

const W = 300;
const H = 100;

export function DitherChart({ series, label, className, orient = "horizontal" }: DitherChartProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (series.length < 2) return null;

  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const y = (n: number) => H - 8 - ((n - min) / span) * (H - 20);
  const pts = series.map((n, i) => `${(i * W) / (series.length - 1)},${y(n).toFixed(2)}`);
  const line = pts.join(" ");
  const area = `0,${H} ${line} ${W},${H}`;

  const g = { hgrad: `dh-h-${uid}`, vfade: `dh-v-${uid}`, dots: `dh-d-${uid}`, dotMask: `dh-dm-${uid}`, fadeMask: `dh-fm-${uid}`, glow: `dh-g-${uid}` };

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={label} className={className ?? "h-[86px] w-full"}>
      <defs>
        <linearGradient id={g.hgrad} x1="0" y1={orient === "vertical" ? "1" : "0"} x2={orient === "vertical" ? "0" : "1"} y2="0">
          <stop offset="0%" stopColor="#f6c489" />
          <stop offset="52%" stopColor="#e8944c" />
          <stop offset="100%" stopColor="#c76a45" />
        </linearGradient>
        <linearGradient id={g.vfade} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff" stopOpacity="1" />
          <stop offset="60%" stopColor="#fff" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#fff" stopOpacity="0.45" />
        </linearGradient>
        {/* preserveAspectRatio="none" stretches x, so the dots are drawn flat and end up square */}
        <pattern id={g.dots} width="3.4" height="2.4" patternUnits="userSpaceOnUse">
          <rect width="2" height="1.6" fill="#fff" />
        </pattern>
        <mask id={g.dotMask}>
          <rect width={W} height={H} fill={`url(#${g.dots})`} />
        </mask>
        <mask id={g.fadeMask}>
          <rect width={W} height={H} fill={`url(#${g.vfade})`} />
        </mask>
        <filter id={g.glow} x="-20%" y="-40%" width="140%" height="180%">
          <feGaussianBlur stdDeviation="2.4" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <g mask={`url(#${g.fadeMask})`}>
        <polygon points={area} fill={`url(#${g.hgrad})`} mask={`url(#${g.dotMask})`} />
      </g>
      <polyline points={line} fill="none" stroke={`url(#${g.hgrad})`} strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" filter={`url(#${g.glow})`} />
    </svg>
  );
}
