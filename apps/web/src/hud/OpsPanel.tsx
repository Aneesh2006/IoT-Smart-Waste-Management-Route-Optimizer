import { CHAOS_INFO, CHAOS_ORDER, COSTS, POLICIES, POLICY_ORDER, type ChaosKind, type Construction } from '@binsight/core';
import { CloudRain, FlaskConical, Flame, PartyPopper, Route, Scale, WifiOff, Wrench, Zap } from 'lucide-react';
import { BAND_META, fillBand, type FillBand } from '../lib/colors.ts';
import { fmtInr, fmtInt, fmtKm, fmtPct } from '../lib/format.ts';
import { useApp } from '../state/store.ts';
import { Sparkline } from './Sparkline.tsx';
import { Bar, Panel, Section, Segmented, Stat } from './ui.tsx';

const CHAOS_ICON: Record<ChaosKind, React.ReactNode> = {
  festival: <PartyPopper size={15} />,
  flood: <CloudRain size={15} />,
  breakdown: <Wrench size={15} />,
  sensors: <WifiOff size={15} />,
  fire: <Flame size={15} />,
};

export function OpsPanel() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const { setPolicy, setThreshold, setSolver } = useApp.getState();
  const m = sim.metrics;
  const cfg = sim.config;

  const bands: Record<FillBand, number> = { ok: 0, filling: 0, critical: 0, overflow: 0 };
  let sum = 0;
  for (const b of sim.bins) {
    bands[fillBand(b.fill)]++;
    sum += Math.min(1, b.fill);
  }
  const total = sim.bins.length;
  const recent = sim.snapshots.slice(-48);
  const wastedShare = m.visits ? m.wastedVisits / m.visits : 0;
  const plan = sim.lastPlan;

  return (
    <Panel className="scroll-thin pointer-events-auto max-h-full w-[330px] overflow-y-auto">
      <Section title="City pulse" right={<span className="tabular font-mono text-[11px] text-slate-400">{total} bins</span>}>
        <div className="mb-2 flex h-2.5 overflow-hidden rounded-full ring-1 ring-white/10">
          {(Object.keys(bands) as FillBand[]).map((k) => (
            <div key={k} style={{ width: `${(bands[k] / total) * 100}%`, background: BAND_META[k].color }} className="transition-[width] duration-500" />
          ))}
        </div>
        <div className="grid grid-cols-4 gap-1 text-center">
          {(Object.keys(bands) as FillBand[]).map((k) => (
            <div key={k} className="rounded-lg bg-white/[0.03] py-1">
              <div className="tabular font-mono text-[15px] font-semibold" style={{ color: BAND_META[k].color }}>
                {bands[k]}
              </div>
              <div className="text-[9.5px] text-slate-400">{BAND_META[k].label}</div>
            </div>
          ))}
        </div>
        <div className="mt-2.5 flex items-center justify-between text-[11px] text-slate-400">
          <span>Overflowing bins, last 48 h</span>
          <span className="font-mono text-slate-300">avg fill {fmtPct(sum / total)}</span>
        </div>
        <Sparkline values={recent.map((s) => s.overflowing)} color="#ef4444" height={34} max={5} />
      </Section>

      <Section title="Insight meters" hint="The numbers a fixed schedule hides">
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Wasted visits"
            value={fmtPct(wastedShare, 1)}
            accent={wastedShare > 0.1 ? '#fbbf24' : '#a3e635'}
            sub={`${fmtInt(m.wastedVisits)} of ${fmtInt(m.visits)} under ${fmtPct(COSTS.wastedBelow)}`}
          />
          <Stat
            label="Overflow events"
            value={fmtInt(m.overflowEvents)}
            accent={m.overflowEvents > 0 ? '#f87171' : '#a3e635'}
            sub={`${m.overflowBinHours.toFixed(0)} bin-hours of litter`}
          />
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
          <span className="text-slate-300">Collected ≠ efficient.</span> A truck that empties a quarter-full bin burned fuel for nothing.{' '}
          <span className="text-slate-300">Full ≠ urgent.</span> A 60% market bin at 5 pm overflows before a 90% bin in a quiet lane.
        </p>
      </Section>

      <Section title="Fleet totals" right={<span className="font-mono text-[10px] text-slate-500">since start</span>}>
        <div className="grid grid-cols-2 gap-2">
          <Stat label="Distance" value={fmtKm(m.distanceM)} />
          <Stat label="Diesel" value={`${m.fuelL.toFixed(1)} L`} />
          <Stat label="CO₂" value={`${m.co2Kg.toFixed(0)} kg`} />
          <Stat label="Cost" value={fmtInr(m.costInr)} sub={`${m.crewHours.toFixed(1)} crew-hours`} />
        </div>
      </Section>

      <Section title="Collection policy" right={<span className="font-mono text-[10px] text-slate-500">next shift</span>}>
        <div className="space-y-1.5">
          {POLICY_ORDER.map((id) => {
            const p = POLICIES[id];
            const active = cfg.policy === id;
            return (
              <button
                key={id}
                onClick={() => setPolicy(id)}
                className={`w-full rounded-xl px-3 py-2 text-left ring-1 transition ${
                  active ? 'bg-neon/10 ring-neon/50' : 'bg-white/[0.02] ring-white/5 hover:bg-white/[0.05]'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[13px] font-semibold ${active ? 'text-neon' : 'text-slate-200'}`}>{p.name}</span>
                  {active && <span className="size-2 rounded-full bg-neon shadow-[0_0_10px_#5eead4]" />}
                </div>
                <div className="mt-0.5 text-[10.5px] leading-snug text-slate-400">{p.description}</div>
              </button>
            );
          })}
        </div>
        {cfg.policy === 'threshold' && (
          <label className="mt-2 flex items-center gap-2 text-[11px] text-slate-400">
            Threshold
            <input type="range" min={0.4} max={0.95} step={0.05} value={cfg.threshold} onChange={(e) => setThreshold(+e.target.value)} className="flex-1" />
            <span className="w-9 text-right font-mono text-slate-200">{fmtPct(cfg.threshold)}</span>
          </label>
        )}
        <button
          onClick={() => {
            sim.planNow();
            useApp.getState().bump();
          }}
          className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-teal-400 to-lime-400 px-3 py-2 text-[13px] font-semibold text-ink shadow-[0_0_24px_rgb(94_234_212/0.35)] transition hover:brightness-110"
        >
          <Zap size={15} /> Plan routes now
        </button>
        <button
          onClick={() => useApp.getState().setCompareOpen(true)}
          className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[12.5px] font-medium text-slate-200 ring-1 ring-white/10 transition hover:bg-white/[0.08]"
          title="Run every policy over the same seeded week (C)"
        >
          <Scale size={14} /> Compare all policies
        </button>
      </Section>

      <Section title="Chaos lab" hint="Break something and watch the city cope">
        <div className="space-y-1">
          {CHAOS_ORDER.map((kind) => (
            <button
              key={kind}
              onClick={() => {
                sim.trigger(kind);
                useApp.getState().bump();
              }}
              className="flex w-full items-center gap-2.5 rounded-xl bg-white/[0.02] px-2.5 py-1.5 text-left ring-1 ring-white/5 transition hover:bg-pink-500/10 hover:ring-pink-400/40"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-pink-500/10 text-pink-300">{CHAOS_ICON[kind]}</span>
              <span className="leading-tight">
                <span className="block text-[12px] font-semibold text-slate-200">{CHAOS_INFO[kind].name}</span>
                <span className="block text-[10.5px] text-slate-500">{CHAOS_INFO[kind].question}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="mt-2 text-[10.5px] leading-snug text-slate-500">Each one also runs under every policy in Compare, scheduled for Wednesday.</p>
      </Section>

      <Section
        title="Route solver"
        right={
          <button onClick={() => useApp.getState().setLabOpen(true)} className="flex items-center gap-1 text-[11px] text-neon hover:underline" title="Watch the algorithms think (L)">
            <FlaskConical size={12} /> Algorithm lab
          </button>
        }
      >
        <div className="flex items-center justify-between gap-2">
          <Segmented<Construction>
            size="sm"
            value={cfg.construction}
            onChange={(v) => setSolver(v, cfg.improve)}
            options={[
              { value: 'nearest', label: 'Nearest', title: 'Greedy nearest-neighbour trips' },
              { value: 'savings', label: 'Savings', title: 'Clarke–Wright savings' },
            ]}
          />
          <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-slate-300" title="Polish every trip with 2-opt and Or-opt">
            <input type="checkbox" checked={cfg.improve} onChange={(e) => setSolver(cfg.construction, e.target.checked)} className="accent-teal-300" />
            2-opt + Or-opt
          </label>
        </div>
        {plan ? (
          <div className="mt-2.5 rounded-xl bg-white/[0.03] p-2.5 ring-1 ring-white/5">
            <div className="flex items-center gap-1.5 text-[11px] text-slate-300">
              <Route size={13} className="text-neon" /> Last plan · {POLICIES[plan.policy].short}
            </div>
            <div className="mt-1.5 grid grid-cols-4 gap-1 text-center font-mono">
              {[
                ['bins', plan.binIds.length],
                ['trips', plan.solution.tripCount],
                ['km', (plan.solution.totalLength / 1000).toFixed(1)],
                ['ms', plan.solution.ms.toFixed(0)],
              ].map(([k, v]) => (
                <div key={k}>
                  <div className="text-[14px] font-semibold text-slate-100">{v}</div>
                  <div className="text-[9.5px] text-slate-500">{k}</div>
                </div>
              ))}
            </div>
            <div className="mt-2 space-y-1">
              {plan.solution.trucks.map((t, i) =>
                t.trips.length ? (
                  <div key={i} className="flex items-center gap-2 text-[10px] text-slate-400">
                    <span className="w-5 font-mono">T{i + 1}</span>
                    <Bar value={t.seconds / (6 * 3600)} color="#5eead4" className="h-1" />
                    <span className="w-14 text-right font-mono">{(t.seconds / 3600).toFixed(1)} h</span>
                  </div>
                ) : null,
              )}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-slate-500">No plan yet. The first shift starts at 06:00, or press “Plan routes now”.</p>
        )}
      </Section>
    </Panel>
  );
}
