import { DAY, HOUR, formatClock, type Simulation, type TruckStatus } from '@binsight/core';
import { TRUCK_COLORS } from '../lib/colors.ts';

const STATUS_COLOR: Record<TruckStatus, string> = {
  idle: 'transparent',
  driving: '#38bdf8',
  collecting: '#34d399',
  unloading: '#fbbf24',
  returning: '#818cf8',
  broken: '#f43f5e',
};

const STATUS_LABEL: Record<TruckStatus, string> = {
  idle: 'At depot',
  driving: 'Driving',
  collecting: 'Emptying bins',
  unloading: 'Tipping',
  returning: 'Returning',
  broken: 'Broken down',
};

/** What every truck did over the last 24 sim-hours, as a Gantt chart. */
export function FleetTimeline({ sim }: { sim: Simulation }) {
  const end = sim.time;
  const start = Math.max(end - DAY, sim.config.startHour * HOUR);
  const span = Math.max(1, end - start);
  const W = 900;
  const rowH = 26;
  const left = 70;
  const x = (t: number) => left + ((t - start) / span) * (W - left - 10);
  const hours = Array.from({ length: 25 }, (_, k) => Math.ceil(start / HOUR) * HOUR + k * HOUR).filter((t) => t <= end);

  const rows = sim.trucks.map((t) => {
    const segs: { a: number; b: number; s: TruckStatus }[] = [];
    const log = t.log;
    for (let i = 0; i < log.length; i++) {
      const a = Math.max(start, log[i].t);
      const b = Math.min(end, i + 1 < log.length ? log[i + 1].t : end);
      if (b > a && log[i].s !== 'idle') segs.push({ a, b, s: log[i].s });
    }
    const busy = segs.reduce((s, g) => s + (g.b - g.a), 0);
    return { t, segs, util: busy / span };
  });

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${rows.length * rowH + 30}`} className="w-full">
        {hours.map((h) => (
          <g key={h}>
            <line x1={x(h)} x2={x(h)} y1={0} y2={rows.length * rowH} stroke="rgba(148,163,184,0.12)" />
            {(h / HOUR) % 3 === 0 && (
              <text x={x(h)} y={rows.length * rowH + 14} textAnchor="middle" className="fill-slate-500 font-mono text-[10px]">
                {formatClock(h).slice(4)}
              </text>
            )}
          </g>
        ))}
        {rows.map((r, i) => (
          <g key={r.t.id} transform={`translate(0 ${i * rowH})`}>
            <circle cx={10} cy={rowH / 2} r={4} fill={TRUCK_COLORS[r.t.id % TRUCK_COLORS.length]} />
            <text x={20} y={rowH / 2 + 4} className="fill-slate-300 text-[11px]">
              {r.t.name}
            </text>
            <rect x={left} y={5} width={W - left - 10} height={rowH - 10} rx={3} fill="rgba(255,255,255,0.03)" />
            {r.segs.map((g, k) => (
              <rect key={k} x={x(g.a)} y={5} width={Math.max(1, x(g.b) - x(g.a))} height={rowH - 10} fill={STATUS_COLOR[g.s]} opacity={0.85}>
                <title>{`${STATUS_LABEL[g.s]} ${formatClock(g.a)}–${formatClock(g.b).slice(4)}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-400">
        {(['driving', 'collecting', 'unloading', 'returning', 'broken'] as TruckStatus[]).map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: STATUS_COLOR[s] }} /> {STATUS_LABEL[s]}
          </span>
        ))}
        <span className="ml-auto font-mono">
          utilisation {rows.map((r) => `T${r.t.id + 1} ${Math.round(r.util * 100)}%`).join(' · ')}
        </span>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-slate-500">
        The last 24 hours of city time. Gaps are trucks parked at the depot: under a smart policy most of the fleet idles most of the day, which is the saving.
      </p>
    </div>
  );
}
