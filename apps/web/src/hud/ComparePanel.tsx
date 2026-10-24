import { CHAOS_INFO, CHAOS_ORDER, POLICIES, WEEKDAYS, customPolicyCode, policyOrder, type ChaosEvent, type ChaosKind, type CompareRow, type Metrics, type PolicyId } from '@binsight/core';
import { Loader2, Scale, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { POLICY_COLORS } from '../lib/colors.ts';
import { fmtInr, fmtInt } from '../lib/format.ts';
import { useApp } from '../state/store.ts';
import { IconButton, Panel, Segmented } from './ui.tsx';

type Column = {
  key: string;
  label: string;
  value: (m: Metrics) => number;
  format: (v: number) => string;
  hint?: string;
};

const COLUMNS: Column[] = [
  { key: 'km', label: 'Distance', value: (m) => m.distanceM / 1000, format: (v) => `${v.toFixed(0)} km` },
  { key: 'fuel', label: 'Diesel', value: (m) => m.fuelL, format: (v) => `${v.toFixed(0)} L` },
  { key: 'co2', label: 'CO₂', value: (m) => m.co2Kg, format: (v) => `${v.toFixed(0)} kg` },
  { key: 'cost', label: 'Cost', value: (m) => m.costInr, format: fmtInr, hint: 'Diesel plus crew time' },
  { key: 'visits', label: 'Pickups', value: (m) => m.visits, format: fmtInt },
  { key: 'wasted', label: 'Wasted', value: (m) => (m.visits ? m.wastedVisits / m.visits : 0), format: (v) => `${(v * 100).toFixed(0)}%`, hint: 'Pickups of bins under 30% full' },
  { key: 'events', label: 'Overflows', value: (m) => m.overflowEvents, format: fmtInt, hint: 'Times a bin crossed 100%' },
  { key: 'litter', label: 'Litter', value: (m) => m.overflowBinHours, format: (v) => `${v.toFixed(0)} bin-h`, hint: 'Total hours bins spent overflowing' },
];

/** When each scenario is scheduled in a compare run: Wednesday, at an hour where it bites. */
const SCENARIO_HOUR: Record<ChaosKind, number> = { festival: 16, flood: 5.8, breakdown: 6.2, sensors: 6, fire: 16 };

function scenarioEvents(kind: ChaosKind | 'none'): ChaosEvent[] {
  return kind === 'none' ? [] : [{ at: 2 * 86400 + SCENARIO_HOUR[kind] * 3600, kind }];
}

export function ComparePanel() {
  const open = useApp((s) => s.compareOpen);
  const sim = useApp((s) => s.sim);
  const scenario = useApp((s) => s.compareScenario);
  const { setCompareOpen, setCompareScenario } = useApp.getState();
  const [days, setDays] = useState(7);
  const [rows, setRows] = useState<CompareRow[]>([]);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!open) return;
    setRows([]);
    setRunning(true);
    const worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: 'row'; row: CompareRow } | { type: 'done' }>) => {
      if (e.data.type === 'row') {
        const row = e.data.row;
        setRows((r) => [...r, row]);
      } else setRunning(false);
    };
    worker.postMessage({ config: { ...structuredClone(sim.config), events: scenarioEvents(scenario) }, days, customCode: customPolicyCode() });
    return () => worker.terminate();
  }, [open, days, sim, scenario]);

  if (!open) return null;

  const fixed = rows.find((r) => r.policy === 'fixed');
  const smart = rows.filter((r) => r.policy !== 'fixed').sort((a, b) => a.metrics.overflowBinHours - b.metrics.overflowBinHours)[0];

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={() => setCompareOpen(false)}>
      <Panel className="scroll-thin max-h-full w-full max-w-[1080px] overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <Scale size={12} /> Compare policies
              </div>
              <h2 className="mt-0.5 text-xl font-bold">Same city, same waste, different decisions</h2>
              <p className="mt-1 max-w-2xl text-[12px] text-slate-400">
                Every policy runs from cold on a fresh copy of <span className="font-mono text-slate-200">{sim.config.seed}</span> with the same seed, so identical waste lands in identical bins.
                Nothing here touches the live simulation.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <select
                value={scenario}
                onChange={(e) => setCompareScenario(e.target.value as ChaosKind | 'none')}
                className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12px] text-slate-200 ring-1 ring-white/10 outline-none"
                title="Replay a disruption on Wednesday under every policy"
              >
                <option value="none">Normal week</option>
                {CHAOS_ORDER.map((k) => (
                  <option key={k} value={k}>
                    {CHAOS_INFO[k].name} on Wednesday
                  </option>
                ))}
              </select>
              <Segmented
                size="sm"
                value={days}
                onChange={setDays}
                options={[3, 7, 14].map((d) => ({ value: d, label: `${d} days` }))}
              />
              <IconButton onClick={() => setCompareOpen(false)} title="Close (Esc)">
                <X size={15} />
              </IconButton>
            </div>
          </div>

          {fixed && smart && <Headline fixed={fixed} smart={smart} />}

          <div className="overflow-x-auto px-5 py-3">
            <table className="w-full min-w-[760px] text-[12px]">
              <thead>
                <tr className="text-left">
                  <th className="eyebrow py-2 font-normal">Policy</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="eyebrow py-2 text-right font-normal" title={c.hint}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {policyOrder().map((id) => {
                  const row = rows.find((r) => r.policy === id);
                  return (
                    <tr key={id} className="border-t border-white/5">
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2 font-semibold">
                          <span className="size-2.5 rounded-full" style={{ background: POLICY_COLORS[id], boxShadow: `0 0 8px ${POLICY_COLORS[id]}` }} />
                          {POLICIES[id].name}
                        </div>
                      </td>
                      {COLUMNS.map((c) => {
                        if (!row) return <td key={c.key} className="py-2.5 text-right text-slate-600">…</td>;
                        const v = c.value(row.metrics);
                        const values = rows.map((r) => c.value(r.metrics));
                        const best = rows.length === policyOrder().length && v === Math.min(...values);
                        const base = fixed ? c.value(fixed.metrics) : null;
                        const delta = base && id !== 'fixed' && base !== 0 ? (v - base) / base : null;
                        return (
                          <td key={c.key} className="tabular py-2.5 text-right font-mono">
                            <div className={best ? 'font-bold text-lime' : 'text-slate-200'}>{c.format(v)}</div>
                            {delta !== null && (
                              <div className={`text-[10px] ${delta <= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                                {delta > 0 ? '+' : ''}
                                {(delta * 100).toFixed(0)}%
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {running && (
              <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
                <Loader2 size={13} className="animate-spin" /> Simulating {rows.length + 1} of {policyOrder().length}…
              </div>
            )}
          </div>

          <div className="grid gap-3 px-5 pb-5 lg:grid-cols-[1.6fr_1fr]">
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <div className="eyebrow mb-2">Overflowing bins, hour by hour</div>
              <LineChart rows={rows} days={days} pick={(r) => r.overflowing} />
            </div>
            <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <div className="eyebrow mb-2">Cumulative distance driven</div>
              <LineChart rows={rows} days={days} pick={(r) => r.distanceKm} unit="km" width={380} />
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function Headline({ fixed, smart }: { fixed: CompareRow; smart: CompareRow }) {
  const f = fixed.metrics;
  const s = smart.metrics;
  const pct = (a: number, b: number) => (b === 0 ? 0 : (a - b) / b);
  const cards = [
    { label: 'Litter on the street', delta: pct(s.overflowBinHours, f.overflowBinHours), detail: `${s.overflowBinHours.toFixed(0)} vs ${f.overflowBinHours.toFixed(0)} bin-hours` },
    { label: 'Wasted pickups', delta: pct(s.wastedVisits, f.wastedVisits), detail: `${s.wastedVisits} vs ${f.wastedVisits} near-empty bins emptied` },
    { label: 'Pickups needed', delta: pct(s.visits, f.visits), detail: `${s.visits} vs ${f.visits} bin visits` },
    { label: 'Running cost', delta: pct(s.costInr, f.costInr), detail: `${fmtInr(s.costInr)} vs ${fmtInr(f.costInr)}` },
  ];
  return (
    <div className="px-5 pt-4">
      <div className="mb-2 text-[12px] text-slate-400">
        <span className="font-semibold" style={{ color: POLICY_COLORS[smart.policy] }}>
          {POLICIES[smart.policy].name}
        </span>{' '}
        against the fixed schedule, over {smart.days} days:
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
            <div className="text-[11px] text-slate-400">{c.label}</div>
            <div className={`tabular font-mono text-2xl font-bold ${c.delta <= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {c.delta > 0 ? '+' : '−'}
              {Math.abs(c.delta * 100).toFixed(0)}%
            </div>
            <div className="text-[10.5px] text-slate-500">{c.detail}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function LineChart({
  rows,
  days,
  pick,
  unit = '',
  width = 600,
}: {
  rows: CompareRow[];
  days: number;
  pick: (r: CompareRow) => number[];
  unit?: string;
  width?: number;
}) {
  const W = width;
  const H = 170;
  const pad = { l: unit ? 52 : 34, r: 8, t: 6, b: 18 };
  const n = days * 24;
  const all = rows.flatMap(pick);
  const max = Math.max(1, ...all);
  const x = (i: number) => pad.l + (i / Math.max(1, n - 1)) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const ticks = [0, 0.5, 1].map((f) => f * max);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(148 163 184 / 0.12)" />
          <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" className="fill-slate-500 font-mono text-[9px]">
            {t >= 10 ? t.toFixed(0) : t.toFixed(1)}
            {unit && t === max ? ` ${unit}` : ''}
          </text>
        </g>
      ))}
      {Array.from({ length: days }, (_, d) => (
        <text key={d} x={x(d * 24 + 12)} y={H - 4} textAnchor="middle" className="fill-slate-500 font-mono text-[9px]">
          {days <= 7 ? WEEKDAYS[d % 7] : d % 2 === 0 ? `D${d + 1}` : ''}
        </text>
      ))}
      {rows.map((r) => {
        const vals = pick(r);
        const d = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
        return <path key={r.policy} d={d} fill="none" stroke={POLICY_COLORS[r.policy as PolicyId]} strokeWidth={1.6} strokeLinejoin="round" />;
      })}
    </svg>
  );
}
