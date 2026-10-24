import { PROCESSING, type DistrictKind, type Metrics, type Simulation } from '@binsight/core';
import { Leaf, X } from 'lucide-react';
import { DISTRICT_COLORS, DISTRICT_LABEL, STREAM_COLORS } from '../lib/colors.ts';
import { fmtInt } from '../lib/format.ts';
import { useApp } from '../state/store.ts';
import { IconButton, Panel } from './ui.tsx';

type NodeId = string;
interface SNode {
  id: NodeId;
  label: string;
  color: string;
  col: number;
  value: number;
}
interface SLink {
  from: NodeId;
  to: NodeId;
  value: number;
  color: string;
}

const DISTRICTS: DistrictKind[] = ['market', 'residential', 'commercial', 'institutional', 'industrial', 'park'];

/** Districts → wet/dry → compost, recycling, landfill, from what the trucks actually collected. */
function flows(m: Metrics) {
  const nodes: SNode[] = [];
  const links: SLink[] = [];
  let wet = 0;
  let dry = 0;
  for (const d of DISTRICTS) {
    const w = m.collectedFlows[`${d}:wet`] ?? 0;
    const y = m.collectedFlows[`${d}:dry`] ?? 0;
    if (w + y <= 0) continue;
    nodes.push({ id: d, label: DISTRICT_LABEL[d], color: DISTRICT_COLORS[d], col: 0, value: w + y });
    if (w > 0) links.push({ from: d, to: 'wet', value: w, color: STREAM_COLORS.wet });
    if (y > 0) links.push({ from: d, to: 'dry', value: y, color: STREAM_COLORS.dry });
    wet += w;
    dry += y;
  }
  const compost = wet * PROCESSING.wetToCompost;
  const recycled = dry * PROCESSING.dryToRecycling;
  const landfill = wet + dry - compost - recycled;
  nodes.push({ id: 'wet', label: 'Wet waste', color: STREAM_COLORS.wet, col: 1, value: wet });
  nodes.push({ id: 'dry', label: 'Dry waste', color: STREAM_COLORS.dry, col: 1, value: dry });
  nodes.push({ id: 'compost', label: 'Compost', color: '#84cc16', col: 2, value: compost });
  nodes.push({ id: 'recycle', label: 'Recycling', color: '#38bdf8', col: 2, value: recycled });
  nodes.push({ id: 'landfill', label: 'Landfill', color: '#a8a29e', col: 2, value: landfill });
  links.push({ from: 'wet', to: 'compost', value: compost, color: '#84cc16' });
  links.push({ from: 'wet', to: 'landfill', value: wet - compost, color: '#a8a29e' });
  links.push({ from: 'dry', to: 'recycle', value: recycled, color: '#38bdf8' });
  links.push({ from: 'dry', to: 'landfill', value: dry - recycled, color: '#a8a29e' });
  return { nodes, links, wet, dry, compost, recycled, landfill };
}

function Sankey({ m }: { m: Metrics }) {
  const { nodes, links } = flows(m);
  const W = 760;
  const H = 330;
  const nodeW = 14;
  // The middle column labels sit above their nodes, so it needs wider gaps.
  const gapOf = (c: number) => (c === 1 ? 44 : 12);
  const colX = [150, W / 2 - nodeW / 2, W - 150 - nodeW];
  const k = Math.min(
    ...[0, 1, 2].map((c) => {
      const col = nodes.filter((n) => n.col === c);
      const sum = col.reduce((s, n) => s + n.value, 0);
      return sum > 0 ? (H - 20 - gapOf(c) * (col.length - 1)) / sum : Infinity;
    }),
  );
  const pos = new Map<NodeId, { x: number; y: number; h: number; outY: number; inY: number }>();
  for (const c of [0, 1, 2]) {
    const col = nodes.filter((n) => n.col === c);
    const gap = gapOf(c);
    const used = col.reduce((s, n) => s + n.value * k, 0) + gap * (col.length - 1);
    let y = (H - used) / 2 + 10;
    for (const n of col) {
      const h = Math.max(1, n.value * k);
      pos.set(n.id, { x: colX[c], y, h, outY: y, inY: y });
      y += h + gap;
    }
  }
  return (
    <svg viewBox={`0 0 ${W} ${H + 10}`} className="w-full">
      {links.map((l) => {
        const a = pos.get(l.from);
        const b = pos.get(l.to);
        if (!a || !b || l.value <= 0) return null;
        const h = l.value * k;
        const y0 = a.outY + h / 2;
        const y1 = b.inY + h / 2;
        a.outY += h;
        b.inY += h;
        const x0 = a.x + nodeW;
        const x1 = b.x;
        const mx = (x0 + x1) / 2;
        return (
          <path key={`${l.from}-${l.to}`} d={`M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`} stroke={l.color} strokeOpacity={0.35} strokeWidth={Math.max(1, h)} fill="none">
            <title>{`${l.from} → ${l.to}: ${fmtInt(l.value)} L`}</title>
          </path>
        );
      })}
      {nodes.map((n) => {
        const p = pos.get(n.id)!;
        const left = n.col === 0;
        return (
          <g key={n.id}>
            <rect x={p.x} y={p.y} width={nodeW} height={p.h} rx={3} fill={n.color} />
            <text
              x={left ? p.x - 8 : n.col === 2 ? p.x + nodeW + 8 : p.x + nodeW / 2}
              y={n.col === 1 ? p.y - 6 : p.y + p.h / 2 + 4}
              textAnchor={left ? 'end' : n.col === 2 ? 'start' : 'middle'}
              className="fill-slate-200 text-[12px]"
            >
              {n.label} <tspan className="fill-slate-500 font-mono text-[11px]">{fmtInt((n.value * PROCESSING.densityKgPerL) / 1000)} t</tspan>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export function ImpactPanel() {
  const open = useApp((s) => s.impactOpen);
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  if (!open) return null;
  return <Impact sim={sim} />;
}

function Impact({ sim }: { sim: Simulation }) {
  const m = sim.metrics;
  const f = flows(m);
  const tonnes = (l: number) => (l * PROCESSING.densityKgPerL) / 1000;
  const collected = f.wet + f.dry;
  const diverted = collected ? (f.compost + f.recycled) / collected : 0;
  const days = Math.max(1 / 24, (sim.time - sim.config.startHour * 3600) / 86400);
  const rows = DISTRICTS.map((d) => {
    const bins = sim.bins.filter((b) => sim.city.bins[b.id].district === d);
    return {
      d,
      bins: bins.length,
      generated: bins.reduce((s, b) => s + b.generatedL, 0),
      collected: m.collectedByDistrict[d] ?? 0,
      overflow: bins.reduce((s, b) => s + b.overflowHours, 0),
    };
  }).filter((r) => r.bins > 0);
  const close = () => useApp.getState().setImpactOpen(false);

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/55 p-4 backdrop-blur-sm" onClick={close}>
      <Panel className="scroll-thin max-h-full w-full max-w-[1000px] overflow-y-auto">
        <div onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3 border-b border-white/5 px-5 py-4">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <Leaf size={12} /> Impact
              </div>
              <h2 className="text-xl font-bold">Where the city’s waste goes</h2>
              <p className="mt-0.5 text-[12px] text-slate-400">Everything the trucks have collected since the start, {days < 1 ? `${Math.round(days * 24)} hours` : `${days.toFixed(1)} days`} of city time.</p>
            </div>
            <IconButton onClick={close} title="Close (Esc)">
              <X size={15} />
            </IconButton>
          </div>
          <div className="grid grid-cols-2 gap-2 px-5 pt-4 md:grid-cols-4">
            {[
              ['Collected', `${tonnes(collected).toFixed(1)} t`, `${fmtInt(collected)} L`],
              ['Kept out of landfill', `${Math.round(diverted * 100)}%`, 'composted or recycled'],
              ['Truck CO₂', `${m.co2Kg.toFixed(0)} kg`, `${(m.co2Kg / Math.max(0.001, tonnes(collected))).toFixed(1)} kg per tonne collected`],
              ['Litter', `${m.overflowBinHours.toFixed(0)} bin-h`, `${m.overflowEvents} overflow events`],
            ].map(([k, v, sub]) => (
              <div key={k} className="rounded-xl bg-white/[0.03] px-3 py-2.5 ring-1 ring-white/5">
                <div className="text-[11px] text-slate-400">{k}</div>
                <div className="tabular font-mono text-2xl font-bold text-slate-100">{v}</div>
                <div className="text-[10.5px] text-slate-500">{sub}</div>
              </div>
            ))}
          </div>
          <div className="px-5 py-3">
            {collected > 0 ? <Sankey m={m} /> : <p className="py-10 text-center text-slate-500">No waste collected yet. Let a shift run first.</p>}
          </div>
          <div className="px-5 pb-5">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-left">
                  {['District', 'Bins', 'Generated', 'Collected', 'Overflow'].map((h, i) => (
                    <th key={h} className={`eyebrow py-1.5 font-normal ${i ? 'text-right' : ''}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.d} className="border-t border-white/5">
                    <td className="py-1.5">
                      <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: DISTRICT_COLORS[r.d] }} />
                      {DISTRICT_LABEL[r.d]}
                    </td>
                    <td className="tabular text-right font-mono">{r.bins}</td>
                    <td className="tabular text-right font-mono">{tonnes(r.generated).toFixed(1)} t</td>
                    <td className="tabular text-right font-mono">{tonnes(r.collected).toFixed(1)} t</td>
                    <td className={`tabular text-right font-mono ${r.overflow > 5 ? 'text-rose-300' : ''}`}>{r.overflow.toFixed(0)} bin-h</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[10.5px] leading-snug text-slate-500">
              Assumes {PROCESSING.densityKgPerL} kg per litre of loose waste, {Math.round(PROCESSING.wetToCompost * 100)}% of wet waste composted and{' '}
              {Math.round(PROCESSING.dryToRecycling * 100)}% of dry waste recovered at the recycling centre; the rest is landfilled. Teaching numbers, set in one place.
            </p>
          </div>
        </div>
      </Panel>
    </div>
  );
}
