import { formatClock, type EventKind } from '@binsight/core';
import { AlertTriangle, ArrowDownToLine, Home, Info, Route, Siren } from 'lucide-react';
import { STREAM_COLORS } from '../lib/colors.ts';
import { useApp } from '../state/store.ts';
import { Panel } from './ui.tsx';

const KIND: Record<EventKind, { icon: React.ReactNode; color: string }> = {
  plan: { icon: <Route size={12} />, color: '#5eead4' },
  overflow: { icon: <Siren size={12} />, color: '#f87171' },
  unload: { icon: <ArrowDownToLine size={12} />, color: '#fbbf24' },
  return: { icon: <Home size={12} />, color: '#94a3b8' },
  info: { icon: <Info size={12} />, color: '#94a3b8' },
  warn: { icon: <AlertTriangle size={12} />, color: '#fb923c' },
};

export function BottomBar() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const { selectBin, selectTruck } = useApp.getState();
  const events = sim.events.slice(-5).reverse();
  // One line per event keeps the log a fixed height above the side panels.
  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-40 flex items-end gap-3">
      <Panel className="pointer-events-auto w-full max-w-[560px] px-3 py-2">
        <div className="eyebrow mb-1">Event log</div>
        <ul className="space-y-0.5">
          {events.map((e) => (
            <li key={e.id}>
              <button
                onClick={() => (e.binId !== undefined ? selectBin(e.binId, true) : e.truckId !== undefined ? selectTruck(e.truckId) : undefined)}
                className="flex w-full items-start gap-2 rounded px-1 text-left text-[11.5px] leading-5 hover:bg-white/5"
                title={e.text}
              >
                <span className="mt-[3px]" style={{ color: KIND[e.kind].color }}>
                  {KIND[e.kind].icon}
                </span>
                <span className="w-[76px] shrink-0 font-mono text-[10.5px] text-slate-500">{formatClock(e.time)}</span>
                <span className="truncate text-slate-300">{e.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="flex-1" />
      <Panel className="pointer-events-auto hidden px-3 py-2 lg:block">
        <div className="eyebrow mb-1.5">Legend</div>
        <div className="flex items-center gap-2 text-[10.5px] text-slate-400">
          Fill
          <span className="h-2 w-28 rounded-full" style={{ background: 'linear-gradient(90deg,#22c55e,#a3e635 50%,#facc15 72%,#f97316 88%,#ef4444)' }} />
          full
        </div>
        <div className="mt-1.5 flex items-center gap-3 text-[10.5px] text-slate-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STREAM_COLORS.wet }} /> Wet bin
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: STREAM_COLORS.dry }} /> Dry bin
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-0.5 w-5 rounded" style={{ background: 'repeating-linear-gradient(90deg,#22d3ee 0 6px,transparent 6px 9px)' }} /> Truck route
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-1 rounded bg-red-500 shadow-[0_0_8px_#ef4444]" /> Overflow
          </span>
        </div>
      </Panel>
    </div>
  );
}
