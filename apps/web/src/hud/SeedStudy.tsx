import { POLICIES, customPolicyCode, policyOrder, type CompareRow, type Metrics, type PolicyId, type SimConfig } from '@binsight/core';
import { Loader2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { POLICY_COLORS } from '../lib/colors.ts';
import { fmtInr } from '../lib/format.ts';

/**
 * Every policy on several different cities: means, 95% intervals and a dot per
 * city, so a single lucky seed can't carry the argument.
 */
const CITIES = 8;

const METRICS: { key: string; label: string; value: (m: Metrics) => number; fmt: (v: number) => string }[] = [
  { key: 'litter', label: 'Litter (bin-h)', value: (m) => m.overflowBinHours, fmt: (v) => v.toFixed(0) },
  { key: 'wasted', label: 'Wasted pickups', value: (m) => (m.visits ? (m.wastedVisits / m.visits) * 100 : 0), fmt: (v) => `${v.toFixed(0)}%` },
  { key: 'km', label: 'Distance (km)', value: (m) => m.distanceM / 1000, fmt: (v) => v.toFixed(0) },
  { key: 'cost', label: 'Cost', value: (m) => m.costInr, fmt: fmtInr },
];

const stats = (xs: number[]) => {
  const n = xs.length;
  const mean = xs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  const sd = n > 1 ? Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1)) : 0;
  return { mean, ci: n > 1 ? (1.96 * sd) / Math.sqrt(n) : 0 };
};

export function SeedStudy({ config, days }: { config: SimConfig; days: number }) {
  const [rows, setRows] = useState<{ seed: string; row: CompareRow }[]>([]);
  const seeds = Array.from({ length: CITIES }, (_, i) => `${config.seed}-${i + 1}`);
  const total = seeds.length * policyOrder().length;

  useEffect(() => {
    setRows([]);
    // Spread the cities over a few workers so it finishes in seconds.
    const lanes = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1));
    const workers = Array.from({ length: lanes }, (_, lane) => {
      const w = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
      w.onmessage = (e: MessageEvent<{ type: 'row'; name: string; row: CompareRow } | { type: 'done' }>) => {
        if (e.data.type === 'row') {
          const { name, row } = e.data;
          setRows((r) => [...r, { seed: name, row }]);
        }
      };
      w.postMessage({ seeds: seeds.filter((_, i) => i % lanes === lane), config: { ...structuredClone(config), events: [] }, days, customCode: customPolicyCode() });
      return w;
    });
    return () => workers.forEach((w) => w.terminate());
    // Re-run only when the city settings or the horizon change.
  }, [config.seed, config.bins, config.trucks, days]);

  const by = (p: PolicyId) => rows.filter((r) => r.row.policy === p);
  const smart = policyOrder().filter((p) => p !== 'fixed');
  const wins = (p: PolicyId) =>
    seeds.filter((s) => {
      const a = rows.find((r) => r.seed === s && r.row.policy === p);
      const f = rows.find((r) => r.seed === s && r.row.policy === 'fixed');
      return a && f && a.row.metrics.overflowBinHours < f.row.metrics.overflowBinHours;
    }).length;

  return (
    <div className="px-5 py-3">
      <p className="text-[12px] text-slate-400">
        {CITIES} different cities (seeds {seeds[0]} … {seeds[seeds.length - 1]}), {days} days each, every policy. Mean ± 95% interval; each dot is one city.
      </p>
      {rows.length < total && (
        <div className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
          <Loader2 size={13} className="animate-spin" /> {rows.length} of {total} runs
        </div>
      )}
      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {METRICS.map((m) => {
          const max = Math.max(1e-9, ...rows.map((r) => m.value(r.row.metrics)));
          return (
            <div key={m.key} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
              <div className="eyebrow mb-2">{m.label}</div>
              {policyOrder().map((p) => {
                const xs = by(p).map((r) => m.value(r.row.metrics));
                const s = stats(xs);
                return (
                  <div key={p} className="mb-1.5 flex items-center gap-2">
                    <span className="w-20 truncate text-[11px]" style={{ color: POLICY_COLORS[p] }}>
                      {POLICIES[p].short}
                    </span>
                    <svg viewBox="0 0 200 14" className="h-3.5 flex-1">
                      <line x1={0} x2={200} y1={7} y2={7} stroke="rgba(148,163,184,0.15)" />
                      {xs.length > 1 && (
                        <rect x={((s.mean - s.ci) / max) * 196 + 2} y={3} width={Math.max(1, ((2 * s.ci) / max) * 196)} height={8} rx={4} fill={POLICY_COLORS[p]} opacity={0.25} />
                      )}
                      {xs.map((x, i) => (
                        <circle key={i} cx={(x / max) * 196 + 2} cy={7} r={2.2} fill={POLICY_COLORS[p]} opacity={0.85} />
                      ))}
                      {xs.length > 0 && <line x1={(s.mean / max) * 196 + 2} x2={(s.mean / max) * 196 + 2} y1={1} y2={13} stroke="#fff" strokeWidth={1.4} />}
                    </svg>
                    <span className="w-28 text-right font-mono text-[10.5px] text-slate-300">{xs.length ? `${m.fmt(s.mean)} ± ${m.fmt(s.ci)}` : '…'}</span>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {by('fixed').length === CITIES && (
        <p className="mt-3 text-[12px] text-slate-300">
          {smart.map((p, i) => (
            <span key={p}>
              {i > 0 && ' · '}
              <span style={{ color: POLICY_COLORS[p] }}>{POLICIES[p].short}</span> left less litter than Fixed in{' '}
              <b>
                {wins(p)} of {CITIES}
              </b>{' '}
              cities
            </span>
          ))}
        </p>
      )}
    </div>
  );
}
