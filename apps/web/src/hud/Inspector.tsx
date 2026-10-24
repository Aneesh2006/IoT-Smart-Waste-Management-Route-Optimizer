import { PROFILES, type Simulation } from '@binsight/core';
import { Battery, Crosshair, Flame, Smartphone, Thermometer, Truck, Wind, X } from 'lucide-react';
import { useState } from 'react';
import { DISTRICT_LABEL, STREAM_COLORS, TRUCK_COLORS, fillCss } from '../lib/colors.ts';
import { fmtAgo, fmtHours, fmtInt, fmtKm, fmtPct } from '../lib/format.ts';
import { useApp } from '../state/store.ts';
import { BinAnatomy, BinMqtt } from './BinInternals.tsx';
import { JoinCard } from './JoinCard.tsx';
import { Sparkline } from './Sparkline.tsx';
import { Bar, IconButton, Panel, Section, Segmented } from './ui.tsx';

const STATUS_LABEL = {
  idle: 'At depot',
  driving: 'En route',
  collecting: 'Collecting',
  unloading: 'Tipping',
  returning: 'Returning',
  broken: 'Broken down',
} as const;

export function Inspector() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const bin = useApp((s) => s.selectedBin);
  const truck = useApp((s) => s.selectedTruck);
  return (
    <Panel className="scroll-thin pointer-events-auto max-h-full w-[320px] overflow-y-auto">
      {bin !== null ? <BinCard sim={sim} id={bin} /> : truck !== null ? <TruckCard sim={sim} id={truck} /> : <Fleet sim={sim} />}
    </Panel>
  );
}

function BinCard({ sim, id }: { sim: Simulation; id: number }) {
  const site = sim.city.bins[id];
  const st = sim.bins[id];
  const { selectBin } = useApp.getState();
  const [tab, setTab] = useState<'status' | 'inside' | 'wire'>('status');
  const ttf = sim.hoursToFull(id);
  const prior = PROFILES[site.district].hourly;
  const learned = Array.from(st.rate);
  const learnedMax = Math.max(...learned, 1e-6);
  const priorMax = Math.max(...prior);
  const hour = Math.floor((sim.time % 86400) / 3600);
  const assigned = st.assigned >= 0 ? sim.trucks[st.assigned] : null;

  return (
    <>
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div>
          <div className="eyebrow">Smart bin</div>
          <div className="font-mono text-xl font-bold">{site.label}</div>
          <div className="mt-1 flex flex-wrap gap-1.5 text-[10.5px]">
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300 ring-1 ring-white/10">{DISTRICT_LABEL[site.district]}</span>
            <span className="rounded-full px-2 py-0.5 ring-1" style={{ color: STREAM_COLORS[site.stream], background: `${STREAM_COLORS[site.stream]}18`, borderColor: 'transparent' }}>
              {site.stream === 'wet' ? 'Wet waste' : 'Dry waste'}
            </span>
            <span className="rounded-full bg-white/5 px-2 py-0.5 text-slate-300 ring-1 ring-white/10">{site.capacityL} L</span>
            {!st.sensorOk && <span className="rounded-full bg-slate-500/20 px-2 py-0.5 text-slate-300 ring-1 ring-slate-400/30">Sensor offline</span>}
            {sim.fires.has(id) && <span className="pulse-ring rounded-full bg-orange-500/20 px-2 py-0.5 text-orange-300 ring-1 ring-orange-400/50">Fire</span>}
          </div>
        </div>
        <div className="flex gap-1.5">
          <IconButton onClick={() => selectBin(id, true)} title="Fly to bin">
            <Crosshair size={15} />
          </IconButton>
          <IconButton onClick={() => selectBin(null)} title="Close (Esc)">
            <X size={15} />
          </IconButton>
        </div>
      </div>

      <div className="px-4 pt-3">
        <Segmented
          size="sm"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'status', label: 'Status' },
            { value: 'inside', label: 'Inside' },
            { value: 'wire', label: 'MQTT' },
          ]}
        />
      </div>
      {tab === 'inside' && <BinAnatomy site={site} st={st} />}
      {tab === 'wire' && <BinMqtt site={site} st={st} city={useApp.getState().liveControl?.city ?? 'demo'} />}
      {tab === 'status' && (
      <>
      <Section title="Ultrasonic level">
        <div className="flex items-end gap-4">
          <div className="relative h-24 w-14 overflow-hidden rounded-b-xl rounded-t-md bg-white/[0.04] ring-1 ring-white/15">
            <div
              className="absolute inset-x-0 bottom-0 transition-[height] duration-300"
              style={{ height: `${Math.min(100, st.reading * 100)}%`, background: `linear-gradient(to top, ${fillCss(st.reading)}, ${fillCss(st.reading)}aa)`, boxShadow: `0 0 20px ${fillCss(st.reading)}` }}
            />
            <div className="absolute inset-x-0 top-[20%] border-t border-dashed border-red-400/50" />
          </div>
          <div className="flex-1">
            <div className="tabular font-mono text-4xl font-bold leading-none" style={{ color: fillCss(st.reading) }}>
              {fmtPct(st.reading)}
            </div>
            <div className="mt-1 text-[11px] text-slate-400">
              {st.fill >= 1 ? (
                <span className="font-semibold text-red-400">Overflowing now</span>
              ) : (
                <>
                  Full in <span className="font-mono text-slate-200">{fmtHours(ttf)}</span>
                </>
              )}
            </div>
            <div className="text-[11px] text-slate-500">Emptied {fmtAgo(sim.time - st.lastCollectedAt)}</div>
            {assigned && (
              <div className="mt-1 flex items-center gap-1 text-[11px]" style={{ color: TRUCK_COLORS[assigned.id % TRUCK_COLORS.length] }}>
                <Truck size={12} /> {assigned.name} is on its way
              </div>
            )}
          </div>
        </div>
        <div className="mt-3 text-[10.5px] text-slate-400">Readings, last 12 h</div>
        <Sparkline values={st.history.slice(-48)} color={fillCss(st.reading)} height={40} max={1.05} marker={1} />
      </Section>

      <Section title="Sensors">
        <div className="grid grid-cols-3 gap-2 text-center">
          <Sensor icon={<Thermometer size={14} />} label="Temp" value={`${st.temperature.toFixed(1)}°C`} warn={st.temperature > 50} />
          <Sensor icon={<Wind size={14} />} label="Gas" value={`${fmtInt(st.gas)} ppm`} warn={st.gas > 400} />
          <Sensor icon={<Battery size={14} />} label="Battery" value={`${st.battery.toFixed(0)}%`} warn={st.battery < 20} />
        </div>
      </Section>

      <Section title="Learned daily rhythm" hint="What the forecaster has learned about this bin, by hour of day">
        <div className="flex h-16 items-end gap-[2px]">
          {learned.map((v, h) => (
            <div key={h} className="relative flex-1" title={`${h}:00 · ${(v * 100).toFixed(1)}%/h`}>
              <div className="absolute inset-x-0 bottom-0 rounded-t-sm bg-white/10" style={{ height: `${(prior[h] / priorMax) * 100}%` }} />
              <div
                className="relative rounded-t-sm"
                style={{ height: `${(v / learnedMax) * 64}px`, background: h === hour ? '#5eead4' : '#5eead480' }}
              />
            </div>
          ))}
        </div>
        <div className="mt-1 flex justify-between font-mono text-[9px] text-slate-500">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
        <p className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
          Teal bars are learned from this bin’s own readings; grey is the {DISTRICT_LABEL[site.district].toLowerCase()} prior it started from.
        </p>
      </Section>
      </>
      )}
    </>
  );
}

function Sensor({ icon, label, value, warn }: { icon: React.ReactNode; label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl px-1 py-2 ring-1 ${warn ? 'bg-red-500/10 ring-red-400/40' : 'bg-white/[0.03] ring-white/5'}`}>
      <div className={`flex justify-center ${warn ? 'text-red-400' : 'text-slate-400'}`}>{warn ? <Flame size={14} /> : icon}</div>
      <div className="tabular mt-1 font-mono text-[12px] font-semibold">{value}</div>
      <div className="text-[9.5px] text-slate-500">{label}</div>
    </div>
  );
}

function TruckCard({ sim, id }: { sim: Simulation; id: number }) {
  const t = sim.trucks[id];
  const color = TRUCK_COLORS[id % TRUCK_COLORS.length];
  const { selectTruck, setFollow } = useApp.getState();
  const following = useApp((s) => s.followTruck === id);
  const stopsLeft = t.route ? t.route.stops.slice(t.stopIndex).filter((s) => s.kind === 'bin').length : 0;
  const tripsLeft = t.route ? t.route.stops.slice(t.stopIndex).filter((s) => s.kind === 'unload').length : 0;
  const remaining = t.route ? t.route.length - t.d : 0;
  return (
    <>
      <div className="flex items-start justify-between gap-2 px-4 pt-3.5">
        <div>
          <div className="eyebrow">Compactor truck</div>
          <div className="flex items-center gap-2 text-xl font-bold">
            <span className="size-3 rounded-full" style={{ background: color, boxShadow: `0 0 12px ${color}` }} />
            {t.name}
          </div>
          <div className="mt-0.5 text-[12px] text-slate-400">{STATUS_LABEL[t.status]}</div>
        </div>
        <div className="flex gap-1.5">
          <IconButton onClick={() => setFollow(following ? null : id)} title={following ? 'Stop following' : 'Follow with camera'} active={following}>
            <Crosshair size={15} />
          </IconButton>
          <IconButton onClick={() => selectTruck(null)} title="Close (Esc)">
            <X size={15} />
          </IconButton>
        </div>
      </div>
      <Section title="Load">
        <div className="mb-1 flex justify-between font-mono text-[12px]">
          <span>{fmtInt(t.load)} L</span>
          <span className="text-slate-500">of {fmtInt(t.capacity)} L</span>
        </div>
        <Bar value={t.load / t.capacity} color={color} className="h-2.5" />
      </Section>
      <Section title="This run">
        <div className="grid grid-cols-2 gap-2 text-[12px]">
          <KV k="Bins left" v={stopsLeft} />
          <KV k="Tips left" v={tripsLeft} />
          <KV k="Bins emptied" v={t.binsToday} />
          <KV k="Distance left" v={fmtKm(remaining)} />
          <KV k="Odometer" v={fmtKm(t.odometer)} />
          <KV k="Busy" v={`${(t.busySeconds / 3600).toFixed(1)} h`} />
        </div>
        <a
          href={`/driver?truck=${id}${useApp.getState().mode === 'live' ? '' : '&demo'}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 flex items-center justify-center gap-1.5 rounded-xl bg-white/[0.04] px-3 py-2 text-[12px] text-slate-200 ring-1 ring-white/10 hover:bg-white/[0.08]"
        >
          <Smartphone size={13} /> Open the crew app for {t.name}
        </a>
      </Section>
    </>
  );
}

function KV({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2.5 py-1.5 ring-1 ring-white/5">
      <div className="text-[10px] text-slate-500">{k}</div>
      <div className="tabular font-mono font-semibold">{v}</div>
    </div>
  );
}

function Fleet({ sim }: { sim: Simulation }) {
  const { selectTruck } = useApp.getState();
  return (
    <>
      <JoinCard />
      <Section title="Fleet" right={<span className="font-mono text-[10px] text-slate-500">click to follow</span>}>
        <div className="space-y-1.5">
          {sim.trucks.map((t) => {
            const color = TRUCK_COLORS[t.id % TRUCK_COLORS.length];
            return (
              <button key={t.id} onClick={() => selectTruck(t.id)} className="w-full rounded-xl bg-white/[0.03] px-3 py-2 text-left ring-1 ring-white/5 transition hover:bg-white/[0.06]">
                <div className="flex items-center justify-between text-[12.5px]">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="size-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
                    {t.name}
                  </span>
                  <span className="text-[11px] text-slate-400">{STATUS_LABEL[t.status]}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-2">
                  <Bar value={t.load / t.capacity} color={color} />
                  <span className="w-10 text-right font-mono text-[10px] text-slate-400">{fmtPct(t.load / t.capacity)}</span>
                </div>
              </button>
            );
          })}
        </div>
      </Section>
      <Section title="Most urgent bins">
        <UrgentList sim={sim} />
      </Section>
    </>
  );
}

function UrgentList({ sim }: { sim: Simulation }) {
  const { selectBin } = useApp.getState();
  const top = [...sim.bins].sort((a, b) => b.reading - a.reading).slice(0, 6);
  return (
    <div className="space-y-1">
      {top.map((b) => {
        const site = sim.city.bins[b.id];
        return (
          <button key={b.id} onClick={() => selectBin(b.id, true)} className="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left transition hover:bg-white/5">
            <span className="w-16 font-mono text-[11px] text-slate-200">{site.label}</span>
            <Bar value={b.reading} color={fillCss(b.reading)} />
            <span className="w-9 text-right font-mono text-[11px]" style={{ color: fillCss(b.reading) }}>
              {fmtPct(b.reading)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
