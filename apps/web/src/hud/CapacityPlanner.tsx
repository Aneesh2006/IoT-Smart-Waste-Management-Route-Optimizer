import { POLICIES, customPolicyCode, type CompareRow, type Simulation } from '@binsight/core';
import { Loader2, Wand2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DISTRICT_LABEL } from '../lib/colors.ts';
import { fmtInr, fmtInt } from '../lib/format.ts';
import { useApp } from '../state/store.ts';
import { Segmented } from './ui.tsx';

type Kind = 'bigger' | 'compactor';

/**
 * Bigger bin: the next size up (240 → 660 → 1100 → a second 1100 L bin).
 * Solar compactor: crushes waste about 4:1 in the same footprint.
 * Prices are rough assumptions for comparison, not quotes.
 */
const UPGRADES: Record<Kind, { label: string; size: (litres: number) => number; price: (litres: number) => number; note: string }> = {
  bigger: {
    label: 'Bigger bin',
    size: (l) => (l < 660 ? 660 : l < 1100 ? 1100 : 2200),
    price: (l) => (l >= 1100 ? 18000 : ((l < 660 ? 660 : 1100) - l) * 20),
    note: '₹20 per extra litre, ₹18,000 for a second community bin',
  },
  compactor: {
    label: 'Solar compactor',
    size: (l) => l * 4,
    price: () => 250000,
    note: 'about ₹2.5 lakh per solar compacting bin, 4:1 compaction',
  },
};

/**
 * "Where should the city add capacity?" Ranks bins by hours spent overflowing,
 * proposes an upgrade for the worst, and simulates a week before and after.
 */
export function CapacityPlanner({ sim }: { sim: Simulation }) {
  const [count, setCount] = useState(8);
  const [kind, setKind] = useState<Kind>('bigger');
  const up = UPGRADES[kind];
  const [result, setResult] = useState<{ before?: CompareRow; after?: CompareRow; running: boolean } | null>(null);

  const ranked = useMemo(
    () =>
      sim.bins
        .filter((b) => b.overflowHours > 0.5)
        .sort((a, b) => b.overflowHours - a.overflowHours)
        .map((b) => ({ b, site: sim.city.bins[b.id] })),
    // Recomputed when the panel opens; overflow hours only grow.
    [sim],
  );
  const picks = ranked.slice(0, count);

  const simulate = () => {
    const overrides: Record<number, number> = { ...sim.config.capacityOverrides };
    for (const { site } of picks) overrides[site.id] = up.size(site.capacityL);
    const base = { ...structuredClone(sim.config), events: [], policyChanges: [] };
    setResult({ running: true });
    const worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: 'row'; name: string; row: CompareRow } | { type: 'done' }>) => {
      if (e.data.type === 'row') {
        const { name, row } = e.data;
        setResult((r) => ({ ...r, running: true, [name]: row }));
      } else {
        setResult((r) => ({ ...r, running: false }));
        worker.terminate();
      }
    };
    worker.postMessage({
      variants: [
        { name: 'before', config: base },
        { name: 'after', config: { ...base, capacityOverrides: overrides } },
      ],
      policy: sim.config.policy,
      days: 7,
      customCode: customPolicyCode(),
    });
  };

  const apply = () => {
    const overrides: Record<number, number> = { ...sim.config.capacityOverrides };
    for (const { site } of picks) overrides[site.id] = up.size(site.capacityL);
    useApp.getState().rebuildCity({ capacityOverrides: overrides });
    useApp.getState().setImpactOpen(false);
    useApp.getState().showToast(`Rebuilt the city with ${picks.length} ${kind === 'compactor' ? 'solar compactors' : 'bigger bins'}.`);
  };

  if (ranked.length === 0) {
    return <p className="py-8 text-center text-[13px] text-slate-500">No bin has overflowed yet. Run the city for a day or two (try the Fixed or Threshold policy), then come back.</p>;
  }

  const b = result?.before?.metrics;
  const a = result?.after?.metrics;
  const delta = (x?: number, y?: number) => (x === undefined || y === undefined || x === 0 ? '' : `${y <= x ? '−' : '+'}${Math.abs(((y - x) / x) * 100).toFixed(0)}%`);
  const cost = picks.reduce((s, p) => s + up.price(p.site.capacityL), 0);

  return (
    <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
      <div>
        <div className="mb-2 flex items-center justify-between gap-2 text-[12px] text-slate-400">
          <Segmented<Kind>
            size="sm"
            value={kind}
            onChange={(k) => {
              setKind(k);
              setResult(null);
            }}
            options={[
              { value: 'bigger', label: UPGRADES.bigger.label },
              { value: 'compactor', label: UPGRADES.compactor.label },
            ]}
          />
          <label className="flex items-center gap-2">
            upgrade top
            <input type="range" min={1} max={Math.min(20, ranked.length)} value={Math.min(count, ranked.length)} onChange={(e) => setCount(+e.target.value)} />
            <span className="w-5 font-mono text-slate-200">{Math.min(count, ranked.length)}</span>
          </label>
        </div>
        <table className="w-full text-[12px]">
          <thead>
            <tr className="text-left">
              {['Bin', 'District', 'Overflowing', 'Now', 'Proposed'].map((h, i) => (
                <th key={h} className={`eyebrow py-1 font-normal ${i > 1 ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {picks.map(({ b, site }) => (
              <tr key={site.id} className="border-t border-white/5">
                <td className="py-1.5">
                  <button onClick={() => useApp.getState().selectBin(site.id, true)} className="font-mono text-slate-200 hover:text-neon">
                    {site.label}
                  </button>
                </td>
                <td className="text-slate-400">{DISTRICT_LABEL[site.district]}</td>
                <td className="text-right font-mono text-rose-300">{b.overflowHours.toFixed(1)} h</td>
                <td className="text-right font-mono">{site.capacityL} L</td>
                <td className="text-right font-mono text-lime">
                  {kind === 'compactor' ? `compactor (${up.size(site.capacityL)} L)` : up.size(site.capacityL) >= 2200 ? '+1 × 1100 L' : `${up.size(site.capacityL)} L`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-500">Rough hardware cost ≈ {fmtInr(cost)} ({up.note}). Assumption, not a quote.</p>
      </div>
      <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
        <div className="eyebrow mb-1">One week, {POLICIES[sim.config.policy].name}</div>
        <p className="text-[11.5px] text-slate-400">Same seed, same waste. Only the bin sizes change.</p>
        <button
          onClick={simulate}
          disabled={result?.running}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-400 to-lime-400 px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-60"
        >
          {result?.running ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />} Simulate before / after
        </button>
        {b && (
          <table className="mt-3 w-full text-[12px]">
            <thead>
              <tr className="text-left">
                <th className="eyebrow py-1 font-normal" />
                <th className="eyebrow py-1 text-right font-normal">Before</th>
                <th className="eyebrow py-1 text-right font-normal">After</th>
                <th className="eyebrow py-1 text-right font-normal">Change</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {(
                [
                  ['Litter (bin-h)', b.overflowBinHours, a?.overflowBinHours, (v: number) => v.toFixed(0)],
                  ['Overflow events', b.overflowEvents, a?.overflowEvents, fmtInt],
                  ['Pickups', b.visits, a?.visits, fmtInt],
                  ['Distance (km)', b.distanceM / 1000, a ? a.distanceM / 1000 : undefined, (v: number) => v.toFixed(0)],
                  ['Running cost', b.costInr, a?.costInr, fmtInr],
                ] as const
              ).map(([label, x, y, f]) => (
                <tr key={label} className="border-t border-white/5">
                  <td className="py-1.5 font-sans text-slate-300">{label}</td>
                  <td className="text-right">{f(x)}</td>
                  <td className="text-right">{y === undefined ? '…' : f(y)}</td>
                  <td className={`text-right ${y !== undefined && y <= x ? 'text-emerald-300' : 'text-rose-300'}`}>{delta(x, y)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a && (
          <button onClick={apply} className="mt-3 w-full rounded-xl bg-white/[0.06] px-3 py-2 text-[12.5px] font-medium ring-1 ring-white/10 hover:bg-white/10">
            Apply the upgrades to this city
          </button>
        )}
      </div>
    </div>
  );
}
