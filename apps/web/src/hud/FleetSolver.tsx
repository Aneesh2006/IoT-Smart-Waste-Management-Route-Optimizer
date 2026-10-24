import { solveVrp, type Construction, type Simulation, type VrpSolution, type VrpStop } from '@binsight/core';
import { useEffect, useMemo, useRef } from 'react';
import { TRUCK_COLORS } from '../lib/colors.ts';

/**
 * The whole shift at once: every bin, the real fleet and truck capacity, with
 * multi-trip routes through the transfer station. Each solver combination is
 * solved on the same demand so the totals compare like for like.
 */
const VARIANTS: { label: string; construction: Construction; improve: boolean }[] = [
  { label: 'Nearest neighbour', construction: 'nearest', improve: false },
  { label: 'Nearest + 2-opt/Or-opt', construction: 'nearest', improve: true },
  { label: 'Clarke–Wright savings', construction: 'savings', improve: false },
  { label: 'Savings + 2-opt/Or-opt', construction: 'savings', improve: true },
];

export function FleetSolver({ sim }: { sim: Simulation }) {
  const { stops, results } = useMemo(() => {
    const stops: VrpStop[] = sim.bins.map((b) => ({ node: sim.city.bins[b.id].node, demand: Math.max(0.05, Math.min(1.2, b.reading)) * sim.city.bins[b.id].capacityL, ref: b.id }));
    const results = VARIANTS.map((v) => ({
      ...v,
      sol: solveVrp(
        {
          depot: sim.city.depot.node,
          hub: sim.city.landfill.node,
          stops,
          capacity: sim.config.truckCapacityL,
          trucks: sim.config.trucks,
          dist: (a, b) => sim.table.distance(a, b),
          serviceSeconds: sim.config.costs.serviceSeconds,
          unloadSeconds: sim.config.costs.unloadSeconds,
          avgSpeed: 8,
        },
        { construction: v.construction, improve: v.improve },
      ),
    }));
    return { stops, results };
  }, [sim]);
  const best = Math.min(...results.map((r) => r.sol.totalLength));
  const litres = stops.reduce((s, x) => s + x.demand, 0);

  return (
    <div className="space-y-3 p-4">
      <p className="text-[12px] leading-snug text-slate-400">
        Every one of the {stops.length} bins, {Math.round(litres).toLocaleString('en-IN')} L in all, shared between {sim.config.trucks} trucks of{' '}
        {sim.config.truckCapacityL.toLocaleString('en-IN')} L that tip at the transfer station whenever they fill. This is the problem the planner solves at every shift.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {results.map((r) => (
          <div key={r.label} className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
            <div className="flex items-baseline justify-between">
              <div className="text-[12.5px] font-semibold text-slate-200">{r.label}</div>
              <div className={`font-mono text-[13px] font-bold ${r.sol.totalLength <= best + 1 ? 'text-lime' : 'text-slate-200'}`}>{(r.sol.totalLength / 1000).toFixed(1)} km</div>
            </div>
            <div className="mb-2 flex gap-3 font-mono text-[10.5px] text-slate-500">
              <span>{r.sol.tripCount} trips</span>
              <span>shift {(r.sol.makespan / 3600).toFixed(1)} h</span>
              <span>{r.sol.totalLength <= best + 1 ? 'best' : `+${(((r.sol.totalLength - best) / best) * 100).toFixed(1)}%`}</span>
              <span>{r.sol.ms < 1 ? '<1' : r.sol.ms.toFixed(0)} ms</span>
            </div>
            <PlanMap sim={sim} sol={r.sol} stops={stops} />
          </div>
        ))}
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        Savings builds trips that sweep outwards from the transfer station; nearest neighbour strands far-off bins until last. Local search repairs both, but it can't fix a
        poor grouping of bins into trips: that is why construction still matters.
      </p>
    </div>
  );
}

function PlanMap({ sim, sol, stops }: { sim: Simulation; sol: VrpSolution; stops: VrpStop[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const w = c.clientWidth;
    const h = c.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const { x0, x1, z0, z1 } = sim.city.bounds;
    const s = Math.min((w - 12) / (x1 - x0), (h - 12) / (z1 - z0));
    const px = (x: number) => 6 + (x - x0) * s + (w - 12 - (x1 - x0) * s) / 2;
    const pz = (z: number) => 6 + (z - z0) * s + (h - 12 - (z1 - z0) * s) / 2;
    const node = (n: number) => sim.city.nodes[n];
    g.strokeStyle = 'rgba(148,163,184,0.12)';
    g.lineWidth = 0.7;
    for (const e of sim.city.edges) {
      g.beginPath();
      g.moveTo(px(node(e.a).x), pz(node(e.a).z));
      g.lineTo(px(node(e.b).x), pz(node(e.b).z));
      g.stroke();
    }
    sol.trucks.forEach((t, k) => {
      if (!t.trips.length) return;
      g.strokeStyle = TRUCK_COLORS[k % TRUCK_COLORS.length];
      g.globalAlpha = 0.85;
      g.lineWidth = 1.3;
      const seq = [sim.city.depot.node];
      for (const trip of t.trips) {
        for (const i of trip.stops) seq.push(stops[i].node);
        seq.push(sim.city.landfill.node);
      }
      seq.push(sim.city.depot.node);
      g.beginPath();
      for (let i = 1; i < seq.length; i++) {
        const path = sim.table.path(seq[i - 1], seq[i]);
        path.forEach((n, j) => (i === 1 && j === 0 ? g.moveTo(px(node(n).x), pz(node(n).z)) : g.lineTo(px(node(n).x), pz(node(n).z))));
      }
      g.stroke();
      g.globalAlpha = 1;
    });
  }, [sim, sol, stops]);
  return <canvas ref={ref} className="h-40 w-full rounded-lg bg-black/40" />;
}
