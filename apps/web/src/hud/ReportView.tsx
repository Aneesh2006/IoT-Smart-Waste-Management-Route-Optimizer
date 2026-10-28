import {
  EXACT_LIMIT,
  LAB_INFO,
  POLICIES,
  PROCESSING,
  makeLabProblem,
  policyOrder,
  customPolicyCode,
  runLab,
  type CompareRow,
  type LabAlgorithm,
} from '@binsight/core';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { POLICY_COLORS } from '../lib/colors.ts';
import { fmtInr, fmtInt } from '../lib/format.ts';
import { PRICES, pipelineCost } from '../lib/pricing.ts';
import { useApp } from '../state/store.ts';

/**
 * A printable report of this city's results, for the project submission.
 * Every number is computed here from the same code the app runs.
 */
const LAB_ALGS: LabAlgorithm[] = ['nearest', 'savings', 'twoopt', 'oropt', 'anneal', 'ants', 'exact'];

export function ReportView() {
  const sim = useApp((s) => s.sim);
  const costs = sim.config.costs;
  const [rows, setRows] = useState<CompareRow[]>([]);
  const days = 7;

  useEffect(() => {
    const worker = new Worker(new URL('../workers/compare.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ type: 'row'; row: CompareRow } | { type: 'done' }>) => {
      if (e.data.type === 'row') {
        const row = e.data.row;
        setRows((r) => [...r, row]);
      }
    };
    worker.postMessage({ config: { ...structuredClone(sim.config), events: [] }, days, customCode: customPolicyCode() });
    return () => worker.terminate();
  }, [sim]);

  const lab = useMemo(() => {
    const problem = makeLabProblem(sim.city, sim.table, EXACT_LIMIT, `${sim.config.seed}-report`);
    const runs = LAB_ALGS.map((a) => runLab(problem, a, `${sim.config.seed}-report`));
    const best = runs.find((r) => r.algorithm === 'exact')!.cost;
    return runs.map((r) => ({ alg: r.algorithm, km: r.cost / 1000, gap: (r.cost - best) / best, ms: r.ms }));
  }, [sim]);

  const fixed = rows.find((r) => r.policy === 'fixed');
  const done = rows.length >= policyOrder().length;
  const close = () => useApp.getState().setReportOpen(false);
  const pct = (a: number, b: number) => (b ? `${a <= b ? '−' : '+'}${Math.abs(((a - b) / b) * 100).toFixed(0)}%` : '—');
  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <div className="report-root fixed inset-0 z-[70] overflow-y-auto bg-slate-100 text-slate-900 print:static print:overflow-visible print:bg-white">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white/90 px-6 py-3 backdrop-blur print:hidden">
        <button onClick={close} className="flex items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-slate-700 hover:bg-slate-200">
          <ArrowLeft size={15} /> Back to the city
        </button>
        <div className="text-[12px] text-slate-500">{done ? 'Ready. Print and choose “Save as PDF”.' : `Simulating policies… ${rows.length}/${policyOrder().length}`}</div>
        <button onClick={() => window.print()} disabled={!done} className="flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-40">
          <Printer size={15} /> Print / PDF
        </button>
      </div>

      <article className="mx-auto my-6 max-w-[820px] bg-white px-12 py-10 shadow-sm print:my-0 print:max-w-none print:px-0 print:py-0 print:shadow-none">
        <header className="border-b-2 border-slate-900 pb-4">
          <div className="text-[11px] uppercase tracking-[0.2em] text-slate-500">BCS VII semester · Cloud Computing group project</div>
          <h1 className="mt-1 text-3xl font-bold">BinSight: IoT Smart Waste Management &amp; Route Optimizer</h1>
          <div className="mt-1 text-[13px] text-slate-600">
            Results report · {today} · city seed <code>{sim.config.seed}</code> · {sim.config.bins} bins · {sim.config.trucks} trucks
          </div>
        </header>

        <h2 className="mt-6 text-xl font-bold">1. Summary</h2>
        <p className="mt-2 text-[14px] leading-relaxed">
          Smart bins measure their fill level with an ultrasonic sensor and report it over HTTPS to a serverless ingest function on Vercel, which stores every
          reading in MongoDB Atlas and streams it over Ably to a 3D digital twin of the city. A forecaster learns each bin’s daily rhythm, a collection policy decides
          which bins need a truck, and a capacitated vehicle-routing solver plans multi-trip routes for the fleet.
          {fixed && rows.find((r) => r.policy === 'predictive') && (
            <>
              {' '}
              Over one simulated week on this city, the predictive policy cut litter (bin-hours spent overflowing) by{' '}
              <b>{pct(rows.find((r) => r.policy === 'predictive')!.metrics.overflowBinHours, fixed.metrics.overflowBinHours).replace('−', '')}</b> and wasted pickups by{' '}
              <b>{pct(rows.find((r) => r.policy === 'predictive')!.metrics.wastedVisits, fixed.metrics.wastedVisits).replace('−', '')}</b> against a fixed daily
              schedule, for a running-cost change of <b>{pct(rows.find((r) => r.policy === 'predictive')!.metrics.costInr, fixed.metrics.costInr)}</b>.
            </>
          )}
        </p>

        <h2 className="mt-6 text-xl font-bold">2. Architecture: Vercel, MongoDB Atlas and Ably</h2>
        <ArchitectureFigure />
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13.5px] leading-relaxed">
          <li>
            <b>Vercel functions</b>: one serverless API. Bins and phones POST readings to the ingest route, which validates them, stores the latest state and a
            history row, raises alerts and dispatches trucks to phone bins.
          </li>
          <li>
            <b>MongoDB Atlas</b> keeps bins, readings (expired by TTL), the control record, per-minute pipeline counters, and an <b>inbox</b> of readings waiting
            for another try (dead letters after three).
          </li>
          <li>
            <b>Ably</b> pushes results to browsers and phones; clients subscribe with short-lived tokens the API mints, so no key reaches the browser.
          </li>
          <li>
            The virtual fleet <b>ticks lazily</b>: API requests advance the deterministic simulation to the current time under a MongoDB lease, with a daily
            Vercel Cron as backup. Operators sign in with a password and a signed HttpOnly cookie; Vercel hosts the app; fire alerts go to an optional webhook.
          </li>
        </ul>

        <h2 className="mt-6 text-xl font-bold">3. Collection policies, one seeded week</h2>
        <p className="mt-2 text-[13.5px] text-slate-700">Every policy runs from cold on an identical copy of the city with the same seed, so the same waste lands in the same bins.</p>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              {['Policy', 'Distance', 'Diesel', 'CO₂', 'Cost', 'Pickups', 'Wasted', 'Overflows', 'Litter'].map((h, i) => (
                <th key={h} className={`py-1.5 ${i ? 'text-right' : ''}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {policyOrder().map((id) => {
              const r = rows.find((x) => x.policy === id);
              const m = r?.metrics;
              return (
                <tr key={id} className="border-b border-slate-200">
                  <td className="py-1.5">
                    <span className="mr-1.5 inline-block size-2.5 rounded-full" style={{ background: POLICY_COLORS[id] }} />
                    {POLICIES[id].name}
                  </td>
                  {m ? (
                    <>
                      <td className="text-right font-mono">{(m.distanceM / 1000).toFixed(0)} km</td>
                      <td className="text-right font-mono">{m.fuelL.toFixed(0)} L</td>
                      <td className="text-right font-mono">{m.co2Kg.toFixed(0)} kg</td>
                      <td className="text-right font-mono">{fmtInr(m.costInr)}</td>
                      <td className="text-right font-mono">{fmtInt(m.visits)}</td>
                      <td className="text-right font-mono">{m.visits ? ((m.wastedVisits / m.visits) * 100).toFixed(0) : 0}%</td>
                      <td className="text-right font-mono">{m.overflowEvents}</td>
                      <td className="text-right font-mono">{m.overflowBinHours.toFixed(0)} bin-h</td>
                    </>
                  ) : (
                    <td colSpan={8} className="text-right text-slate-400">
                      simulating…
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {done && <OverflowChart rows={rows} days={days} />}

        <h2 className="mt-6 text-xl font-bold">4. Routing algorithms</h2>
        <p className="mt-2 text-[13.5px] text-slate-700">
          One truck, {EXACT_LIMIT} bins chosen at random, road distances from Dijkstra. Each heuristic is scored against the exact optimum from Held–Karp dynamic
          programming.
        </p>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-1.5">Algorithm</th>
              <th>Family</th>
              <th className="text-right">Tour</th>
              <th className="text-right">Gap to optimum</th>
              <th className="text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {lab.map((r) => (
              <tr key={r.alg} className="border-b border-slate-200">
                <td className="py-1.5">{LAB_INFO[r.alg].name}</td>
                <td className="text-slate-600">{LAB_INFO[r.alg].family}</td>
                <td className="text-right font-mono">{r.km.toFixed(2)} km</td>
                <td className="text-right font-mono">{r.gap < 0.0005 ? 'optimal' : `+${(r.gap * 100).toFixed(1)}%`}</td>
                <td className="text-right font-mono">{r.ms < 1 ? '<1' : r.ms.toFixed(0)} ms</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2 className="mt-6 text-xl font-bold">5. What the cloud would cost</h2>
        <p className="mt-2 text-[13.5px] text-slate-700">
          Every bin reporting every 15 minutes, pipeline as deployed, three dashboards watching. Approximate list prices; Atlas is the cluster tier the write rate
          needs.
        </p>
        <table className="mt-3 w-full border-collapse text-[12.5px]">
          <thead>
            <tr className="border-b-2 border-slate-900 text-left">
              <th className="py-1.5">City size</th>
              <th className="text-right">Readings / month</th>
              <th className="text-right">Vercel</th>
              <th className="text-right">Ably</th>
              <th className="text-right">MongoDB Atlas</th>
              <th className="text-right">Total / month</th>
            </tr>
          </thead>
          <tbody>
            {[120, 1000, 10000, 100000].map((n) => {
              const readings = n * 4 * 24 * 30;
              const c = pipelineCost(readings);
              const usd = (v: number) => `$${v < 10 ? v.toFixed(2) : Math.round(v).toLocaleString('en-IN')}`;
              return (
                <tr key={n} className="border-b border-slate-200">
                  <td className="py-1.5">{n.toLocaleString('en-IN')} bins</td>
                  <td className="text-right font-mono">{fmtInt(readings)}</td>
                  <td className="text-right font-mono">{usd(c.fn)}</td>
                  <td className="text-right font-mono">{usd(c.realtime)}</td>
                  <td className="text-right font-mono">
                    {usd(c.db)} <span className="text-slate-500">{c.dbTier}</span>
                  </td>
                  <td className="text-right font-mono font-bold">
                    {usd(c.total)} <span className="font-normal text-slate-500">(₹{Math.round(c.total * PRICES.usdToInr).toLocaleString('en-IN')})</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <h2 className="mt-6 text-xl font-bold">6. Assumptions</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-slate-700">
          <li>
            Diesel ₹{costs.dieselInrPerL}/L at {costs.fuelLPerKm} L/km, {costs.co2KgPerL} kg CO₂ per litre, crew ₹{costs.crewInrPerHour}/hour, {costs.serviceSeconds} s per
            bin and {Math.round(costs.unloadSeconds / 60)} min per tip.
          </li>
          <li>
            Waste generation follows per-district hourly and weekly curves with per-bin variation and noise; a pickup under {Math.round(costs.wastedBelow * 100)}% full counts
            as wasted.
          </li>
          <li>
            {PROCESSING.densityKgPerL} kg per litre of loose waste; {Math.round(PROCESSING.wetToCompost * 100)}% of wet waste composted,{' '}
            {Math.round(PROCESSING.dryToRecycling * 100)}% of dry waste recovered.
          </li>
          <li>Cloud prices are approximate list prices; check the Vercel, Ably and MongoDB pricing pages before quoting.</li>
        </ul>
        <footer className="mt-8 border-t border-slate-300 pt-3 text-[11px] text-slate-500">
          Generated by BinSight from seed “{sim.config.seed}”. The same seed reproduces every number in this report.
        </footer>
      </article>
    </div>
  );
}

function OverflowChart({ rows, days }: { rows: CompareRow[]; days: number }) {
  const W = 720;
  const H = 160;
  const n = days * 24;
  const max = Math.max(1, ...rows.flatMap((r) => r.overflowing));
  const x = (i: number) => 40 + (i / (n - 1)) * (W - 50);
  const y = (v: number) => H - 20 - (v / max) * (H - 30);
  return (
    <figure className="mt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        <line x1={40} x2={W - 10} y1={H - 20} y2={H - 20} stroke="#94a3b8" />
        <text x={36} y={y(max) + 4} textAnchor="end" className="fill-slate-500 text-[10px]">
          {max}
        </text>
        <text x={36} y={H - 16} textAnchor="end" className="fill-slate-500 text-[10px]">
          0
        </text>
        {Array.from({ length: days }, (_, d) => (
          <text key={d} x={x(d * 24 + 12)} y={H - 4} textAnchor="middle" className="fill-slate-500 text-[10px]">
            Day {d + 1}
          </text>
        ))}
        {rows.map((r) => (
          <path
            key={r.policy}
            d={r.overflowing.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}
            fill="none"
            stroke={POLICY_COLORS[r.policy]}
            strokeWidth={1.6}
          />
        ))}
      </svg>
      <figcaption className="text-center text-[11.5px] text-slate-500">Overflowing bins, hour by hour, per policy.</figcaption>
    </figure>
  );
}

function ArchitectureFigure() {
  const box = (x: number, y: number, label: string, sub: string) => (
    <g transform={`translate(${x} ${y})`}>
      <rect width={118} height={44} rx={8} fill="#f8fafc" stroke="#0f172a" />
      <text x={59} y={19} textAnchor="middle" className="fill-slate-900 text-[12px] font-semibold">
        {label}
      </text>
      <text x={59} y={34} textAnchor="middle" className="fill-slate-500 text-[9.5px]">
        {sub}
      </text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#0f172a" strokeWidth={1.4} markerEnd="url(#arrow)" />;
  return (
    <figure className="mt-3">
      <svg viewBox="0 0 740 200" className="w-full">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">
            <path d="M0,0 L10,5 L0,10 z" fill="#0f172a" />
          </marker>
        </defs>
        {box(4, 20, 'Smart bins', 'HTTPS POST')}
        {box(4, 120, 'Lazy tick', '→ ƒ fleet')}
        {box(150, 70, 'ƒ ingest', 'Vercel function')}
        {box(296, 20, 'MongoDB Atlas', 'bins · readings')}
        {box(296, 120, 'Inbox', 'retries · dead letters')}
        {box(442, 70, 'Ably', 'pub/sub')}
        {box(588, 70, 'Browsers', '3D twin · phones')}
        {box(442, 150, 'ƒ api', 'state · auth · tick')}
        {arrow(122, 42, 150, 82)}
        {arrow(122, 142, 150, 104)}
        {arrow(268, 82, 296, 48)}
        {arrow(268, 102, 296, 136)}
        {arrow(268, 92, 442, 92)}
        {arrow(560, 92, 588, 92)}
        {arrow(588, 110, 560, 165)}
      </svg>
      <figcaption className="text-center text-[11.5px] text-slate-500">Readings flow left to right; Ably pushes the results to browsers and phones.</figcaption>
    </figure>
  );
}
