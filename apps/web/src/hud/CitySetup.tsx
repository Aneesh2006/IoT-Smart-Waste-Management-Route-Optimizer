import { ChevronDown, Hammer } from 'lucide-react';
import { useState } from 'react';
import { useApp } from '../state/store.ts';
import { Assumptions } from './Assumptions.tsx';
import { Section, Segmented } from './ui.tsx';

const TWO_SHIFTS = [
  { start: 6, end: 12 },
  { start: 15, end: 21 },
];
const ONE_SHIFT = [{ start: 6, end: 13 }];

/** Sandbox city settings: size, fleet and shifts. Applying rebuilds the city from scratch. */
export function CitySetup() {
  const sim = useApp((s) => s.sim);
  const cfg = sim.config;
  const [open, setOpen] = useState(false);
  const [seed, setSeed] = useState(cfg.seed);
  const [bins, setBins] = useState(cfg.bins);
  const [trucks, setTrucks] = useState(cfg.trucks);
  const [capacity, setCapacity] = useState(cfg.truckCapacityL);
  const [shifts, setShifts] = useState<1 | 2>(cfg.shifts.length === 1 ? 1 : 2);
  const select = 'rounded-lg bg-black/40 px-2 py-1 text-[11.5px] ring-1 ring-white/10 outline-none';
  return (
    <Section
      title="City setup"
      right={
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
          {open ? 'hide' : `${cfg.bins} bins · ${cfg.trucks} trucks`} <ChevronDown size={12} className={open ? 'rotate-180' : ''} />
        </button>
      }
    >
      {open && (
        <div className="space-y-2 text-[11.5px] text-slate-300">
          <label className="flex items-center justify-between gap-2">
            Seed
            <input value={seed} onChange={(e) => setSeed(e.target.value.replace(/[^\w-]/g, '').slice(0, 40))} className={`${select} w-40 font-mono`} />
          </label>
          <label className="flex items-center justify-between gap-2">
            Smart bins
            <select value={bins} onChange={(e) => setBins(+e.target.value)} className={select}>
              {[60, 120, 240, 360, 600, 1000].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Trucks
            <select value={trucks} onChange={(e) => setTrucks(+e.target.value)} className={select}>
              {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center justify-between gap-2">
            Truck capacity
            <select value={capacity} onChange={(e) => setCapacity(+e.target.value)} className={select}>
              {[6000, 8000, 10000, 14000].map((v) => (
                <option key={v} value={v}>
                  {v.toLocaleString('en-IN')} L
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center justify-between gap-2">
            Shifts
            <Segmented<1 | 2>
              size="sm"
              value={shifts}
              onChange={setShifts}
              options={[
                { value: 1, label: 'Morning', title: '06:00–13:00 only' },
                { value: 2, label: 'Morning + evening', title: '06:00–12:00 and 15:00–21:00' },
              ]}
            />
          </div>
          <button
            onClick={() => useApp.getState().rebuildCity({ seed: seed || cfg.seed, bins, trucks, truckCapacityL: capacity, shifts: shifts === 1 ? ONE_SHIFT : TWO_SHIFTS })}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] px-3 py-2 text-[12px] font-medium ring-1 ring-white/10 hover:bg-white/10"
          >
            <Hammer size={13} /> Build this city
          </button>
          <p className="text-[10.5px] text-slate-500">Bigger cities get a bigger street grid. Compare and the Algorithm lab use these settings too.</p>
          <Assumptions />
        </div>
      )}
    </Section>
  );
}
