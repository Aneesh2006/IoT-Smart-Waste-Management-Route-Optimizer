import type { Facility } from '@binsight/core';
import { Factory, Recycle, Warehouse } from 'lucide-react';
import { DISTRICT_LABEL, TRUCK_COLORS, fillCss } from '../lib/colors.ts';
import { fmtPct } from '../lib/format.ts';
import { BIN_HEIGHT } from '../scene/Bins.tsx';
import { LiveWorld } from '../live/LiveWorld.ts';
import { anchor } from '../scene/Labels.tsx';
import { useApp } from '../state/store.ts';

const FACILITY_ICON = { depot: Warehouse, landfill: Factory, recycling: Recycle } as const;
/** Labels start hidden; the projector shows them once it has placed them. */
const HIDDEN = { visibility: 'hidden' } as const;
const FACILITY_ACCENT = { depot: '#22d3ee', landfill: '#f59e0b', recycling: '#4ade80' } as const;

/** DOM labels pinned to 3D positions by the scene's LabelProjector. */
export function SceneLabels() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const simKey = useApp((s) => s.simKey);
  const selectedTruck = useApp((s) => s.selectedTruck);
  const hovered = useApp((s) => s.hoveredBin);
  const { depot, landfill, recycling } = sim.city;
  return (
    <div key={simKey} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {[depot, landfill, recycling].map((f) => (
        <FacilityLabel key={f.kind} f={f} />
      ))}
      {sim.trucks.map((t) => {
        const color = TRUCK_COLORS[t.id % TRUCK_COLORS.length];
        return (
          <div
            key={t.id}
            ref={anchor(`truck-${t.id}`, () => [t.x, 16, t.z])}
            className={`glass absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-md px-1.5 py-0.5 font-mono text-[10px] ${selectedTruck === t.id ? 'ring-1 ring-neon' : ''}`}
            style={HIDDEN}
          >
            <span className="size-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
            T{t.id + 1}
            {t.status === 'broken' && <span className="text-amber">⚠</span>}
            <span className="h-1 w-8 overflow-hidden rounded-full bg-white/10">
              <span className="block h-full rounded-full" style={{ width: `${Math.min(100, (t.load / t.capacity) * 100)}%`, background: color }} />
            </span>
          </div>
        );
      })}
      {hovered !== null && hovered < sim.bins.length && <HoverTip id={hovered} />}
      {sim instanceof LiveWorld &&
        [...sim.phones.values()].map((p) => (
          <div
            key={p.id}
            ref={anchor(`phone-${p.id}`, () => [p.x, BIN_HEIGHT * 1.3 + 12, p.z])}
            className={`glass absolute left-0 top-0 flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] ${p.dispatched ? 'ring-1 ring-fuchsia-400' : ''}`}
            style={HIDDEN}
          >
            <span>{p.emoji}</span>
            <span className="max-w-24 truncate text-slate-100">{p.nick}</span>
            <span className="font-mono text-[10px]" style={{ color: fillCss(p.r) }}>
              {Math.round(p.r * 100)}%
            </span>
            {p.dispatched && <span className="text-fuchsia-300">🚛</span>}
          </div>
        ))}
    </div>
  );
}

function FacilityLabel({ f }: { f: Facility }) {
  const Icon = FACILITY_ICON[f.kind];
  const accent = FACILITY_ACCENT[f.kind];
  return (
    <div
      ref={anchor(`facility-${f.kind}`, () => [f.x, 46, f.z])}
      className="glass absolute left-0 top-0 flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-medium text-slate-100"
      style={{ ...HIDDEN, borderColor: `${accent}55` }}
    >
      <Icon size={13} style={{ color: accent }} />
      {f.name}
    </div>
  );
}

function HoverTip({ id }: { id: number }) {
  const sim = useApp((s) => s.sim);
  const site = sim.city.bins[id];
  const st = sim.bins[id];
  return (
    <div ref={anchor('hover', () => [site.x, BIN_HEIGHT + 14, site.z])} className="glass absolute left-0 top-0 min-w-36 rounded-lg px-2.5 py-1.5 text-[11px] leading-tight" style={HIDDEN}>
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono font-semibold text-slate-100">{site.label}</span>
        <span className="font-mono font-semibold" style={{ color: st.sensorOk ? fillCss(st.reading) : '#94a3b8' }}>
          {st.sensorOk ? fmtPct(st.reading) : 'offline'}
        </span>
      </div>
      <div className="mt-0.5 text-slate-400">
        {DISTRICT_LABEL[site.district]} · {site.stream === 'wet' ? 'Wet' : 'Dry'} · {site.capacityL} L
      </div>
    </div>
  );
}
