import { formatClock, type EventKind } from '@binsight/core';
import { AlertTriangle, ArrowDownToLine, Home, Info, Route, Siren, Zap } from 'lucide-react';
import { HEAT_LABEL } from '../scene/Heatmap.tsx';
import { Minimap } from './Minimap.tsx';
import { ReplayBar } from './ReplayBar.tsx';
import { useApp } from '../state/store.ts';
import { Panel } from './ui.tsx';

const KIND: Record<EventKind, { icon: React.ReactNode; color: string }> = {
  plan: { icon: <Route size={12} />, color: '#5eead4' },
  overflow: { icon: <Siren size={12} />, color: '#f87171' },
  unload: { icon: <ArrowDownToLine size={12} />, color: '#fbbf24' },
  return: { icon: <Home size={12} />, color: '#94a3b8' },
  info: { icon: <Info size={12} />, color: '#94a3b8' },
  warn: { icon: <AlertTriangle size={12} />, color: '#fb923c' },
  alert: { icon: <Zap size={12} />, color: '#f472b6' },
};

export function BottomBar() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const { selectBin, selectTruck } = useApp.getState();
  const events = sim.events.slice(-5).reverse();
  const heatmap = useApp((s) => s.heatmap);
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
      <div className="flex flex-1 flex-col items-center gap-2">
        <ReplayBar />
        {heatmap !== 'off' && (
          <Panel className="pointer-events-auto flex items-center gap-2 px-3 py-1.5 text-[11px] text-slate-300">
            <span className="h-2 w-24 rounded-full" style={{ background: 'linear-gradient(90deg,#4338ca,#14b8a6,#facc15,#ef4444)' }} />
            {HEAT_LABEL[heatmap]}
          </Panel>
        )}
      </div>
      <Minimap />
    </div>
  );
}
