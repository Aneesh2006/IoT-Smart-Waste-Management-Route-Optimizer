import { COSTS, type Costs } from '@binsight/core';
import { RotateCcw } from 'lucide-react';
import { useApp } from '../state/store.ts';

const FIELDS: { key: keyof Costs; label: string; unit: string; step: number; scale?: number }[] = [
  { key: 'dieselInrPerL', label: 'Diesel price', unit: '₹/L', step: 1 },
  { key: 'fuelLPerKm', label: 'Fuel use', unit: 'L/km', step: 0.01 },
  { key: 'co2KgPerL', label: 'CO₂ per litre', unit: 'kg', step: 0.01 },
  { key: 'crewInrPerHour', label: 'Crew cost', unit: '₹/h', step: 10 },
  { key: 'serviceSeconds', label: 'Empty one bin', unit: 's', step: 5 },
  { key: 'unloadSeconds', label: 'Tip at transfer', unit: 'min', step: 1, scale: 60 },
  { key: 'wastedBelow', label: 'Wasted below', unit: '%', step: 5, scale: 0.01 },
];

/** Edit the prices and timings the sim charges; takes effect immediately and in Compare. */
export function Assumptions() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const costs = sim.config.costs;
  const set = (key: keyof Costs, value: number) => {
    if (!Number.isFinite(value) || value < 0) return;
    sim.config.costs = { ...costs, [key]: value };
    useApp.getState().bump();
  };
  const changed = FIELDS.some((f) => costs[f.key] !== COSTS[f.key]);
  return (
    <div className="mt-3 border-t border-white/5 pt-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="eyebrow">Prices &amp; timings</span>
        {changed && (
          <button onClick={() => ((sim.config.costs = { ...COSTS }), useApp.getState().bump())} className="flex items-center gap-1 text-[10.5px] text-slate-400 hover:text-slate-200">
            <RotateCcw size={11} /> defaults
          </button>
        )}
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {FIELDS.map((f) => {
          const scale = f.scale ?? 1;
          const shown = +(costs[f.key] / scale).toFixed(3);
          return (
            <label key={f.key} className="rounded-lg bg-black/30 px-2 py-1 ring-1 ring-white/5">
              <span className="block text-[9.5px] text-slate-500">{f.label}</span>
              <span className="flex items-baseline gap-1">
                <input
                  type="number"
                  step={f.step}
                  min={0}
                  value={shown}
                  onChange={(e) => set(f.key, Number(e.target.value) * scale)}
                  className={`w-full bg-transparent font-mono text-[12px] outline-none ${costs[f.key] !== COSTS[f.key] ? 'text-amber' : 'text-slate-200'}`}
                />
                <span className="text-[9.5px] text-slate-500">{f.unit}</span>
              </span>
            </label>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] text-slate-500">Applies from now on, and to Compare, Impact and the report.</p>
    </div>
  );
}
