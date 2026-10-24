import { useId } from 'react';

/** Minimal area sparkline. Values are plotted against their own range unless `max` is given. */
export function Sparkline({
  values,
  color = '#5eead4',
  height = 36,
  max,
  min = 0,
  marker,
}: {
  values: number[];
  color?: string;
  height?: number;
  max?: number;
  min?: number;
  /** Draws a dashed horizontal line at this value (e.g. "full"). */
  marker?: number;
}) {
  const id = useId();
  const w = 100;
  if (values.length < 2) return <div style={{ height }} className="rounded-md bg-white/[0.03]" />;
  const hi = Math.max(max ?? -Infinity, ...values, marker ?? -Infinity, min + 1e-9);
  const x = (i: number) => (i / (values.length - 1)) * w;
  const y = (v: number) => height - ((v - min) / (hi - min)) * (height - 3) - 1.5;
  const line = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`).join('');
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={color} stopOpacity="0.35" />
          <stop offset="1" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {marker !== undefined && (
        <line x1="0" x2={w} y1={y(marker)} y2={y(marker)} stroke="#ef4444" strokeOpacity="0.6" strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
      )}
      <path d={`${line}L${w},${height}L0,${height}Z`} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
