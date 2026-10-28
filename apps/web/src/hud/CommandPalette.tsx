import { CHAOS_INFO, CHAOS_ORDER, POLICIES, policyOrder } from '@binsight/core';
import { Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DISTRICT_LABEL, TRUCK_COLORS, fillCss } from '../lib/colors.ts';
import { useApp } from '../state/store.ts';

interface Item {
  id: string;
  group: string;
  label: string;
  hint?: string;
  color?: string;
  run(): void;
}

/** Ctrl+K or / : find a bin or truck by name, or run any action, by typing. */
export function CommandPalette() {
  const open = useApp((s) => s.paletteOpen);
  if (!open) return null;
  return <Palette />;
}

function Palette() {
  const sim = useApp((s) => s.sim);
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const close = () => useApp.setState({ paletteOpen: false });

  useEffect(() => input.current?.focus(), []);

  const items = useMemo<Item[]>(() => {
    const s = useApp.getState;
    const actions: Item[] = [
      { id: 'a-compare', group: 'Actions', label: 'Compare all policies', hint: 'C', run: () => s().setCompareOpen(true) },
      { id: 'a-lab', group: 'Actions', label: 'Open the Algorithm lab', hint: 'L', run: () => s().setLabOpen(true) },
      { id: 'a-xray', group: 'Actions', label: 'Cloud X-Ray', hint: 'X', run: () => s().setXrayOpen(true) },
      { id: 'a-impact', group: 'Actions', label: 'Impact: where the waste goes', hint: 'I', run: () => s().setImpactOpen(true) },
      { id: 'a-report', group: 'Actions', label: 'Results report (PDF)', run: () => s().setReportOpen(true) },
      { id: 'a-present', group: 'Actions', label: 'Start the presentation', hint: 'P', run: () => void import('../present/scenes.ts').then((m) => m.startPresentation()) },
      { id: 'a-replay', group: 'Actions', label: 'Replay the last day', hint: 'R', run: () => s().startReplay() },
      { id: 'a-data', group: 'Actions', label: 'Toggle data view', hint: 'V', run: () => s().toggleDataView() },
      { id: 'a-heat', group: 'Actions', label: 'Cycle the heatmap', hint: 'G', run: () => s().cycleHeatmap() },
      { id: 'a-editor', group: 'Actions', label: 'Write a custom policy', run: () => s().setEditorOpen(true) },
      { id: 'a-next', group: 'Actions', label: 'Skip to the next shift', hint: 'N', run: () => s().skipToNextShift() },
      { id: 'a-city', group: 'Actions', label: 'Generate a new city', run: () => s().newCity() },
      { id: 'a-live', group: 'Actions', label: s().mode === 'live' ? 'Back to Sandbox' : 'Go Live in the cloud', run: () => void s().setMode(s().mode === 'live' ? 'sandbox' : 'live') },
      { id: 'a-guide', group: 'Actions', label: 'Guide', hint: '?', run: () => s().setGuideOpen(true) },
      ...policyOrder().map((id) => ({ id: `p-${id}`, group: 'Policy', label: `Switch to ${POLICIES[id].name}`, run: () => s().setPolicy(id) })),
      ...CHAOS_ORDER.map((k) => ({ id: `c-${k}`, group: 'Chaos', label: CHAOS_INFO[k].name, hint: CHAOS_INFO[k].question, run: () => sim.trigger(k) })),
    ];
    const trucks: Item[] = sim.trucks.map((t) => ({
      id: `t-${t.id}`,
      group: 'Trucks',
      label: t.name,
      hint: `follow · ${Math.round((t.load / t.capacity) * 100)}% full`,
      color: TRUCK_COLORS[t.id % TRUCK_COLORS.length],
      run: () => s().selectTruck(t.id),
    }));
    const bins: Item[] = sim.city.bins.map((site) => ({
      id: `b-${site.id}`,
      group: 'Bins',
      label: site.label,
      hint: `${DISTRICT_LABEL[site.district]} · ${Math.round(sim.bins[site.id].reading * 100)}%`,
      color: fillCss(sim.bins[site.id].reading),
      run: () => s().selectBin(site.id, true),
    }));
    return [...actions, ...trucks, ...bins];
  }, [sim]);

  const matches = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = items
      .map((it) => {
        const hay = `${it.label} ${it.hint ?? ''} ${it.group}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const starts = words.length && it.label.toLowerCase().startsWith(words[0]) ? 0 : 1;
        return { it, score: starts };
      })
      .filter((x): x is { it: Item; score: number } => x !== null);
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, q ? 40 : 18).map((x) => x.it);
  }, [items, q]);

  const run = (it: Item | undefined) => {
    if (!it) return;
    close();
    it.run();
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-[65] flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-[2px]" onClick={close}>
      <div className="glass w-full max-w-xl overflow-hidden rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
          <Search size={16} className="text-slate-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setCursor(0);
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(matches.length - 1, c + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(0, c - 1));
              } else if (e.key === 'Enter') run(matches[cursor]);
              else if (e.key === 'Escape') close();
            }}
            placeholder="Bin (MKT-023), truck, policy, chaos, or an action…"
            className="flex-1 bg-transparent text-[15px] text-slate-100 outline-none placeholder:text-slate-500"
          />
          <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] text-slate-400">esc</kbd>
        </div>
        <ul className="scroll-thin max-h-[50vh] overflow-y-auto py-1">
          {matches.map((it, i) => (
            <li key={it.id}>
              <button
                onMouseEnter={() => setCursor(i)}
                onClick={() => run(it)}
                className={`flex w-full items-center gap-3 px-4 py-2 text-left ${i === cursor ? 'bg-neon/10' : ''}`}
              >
                <span className="w-14 shrink-0 text-[10px] uppercase tracking-wider text-slate-500">{it.group}</span>
                {it.color && <span className="size-2 shrink-0 rounded-full" style={{ background: it.color }} />}
                <span className={`truncate text-[13.5px] ${i === cursor ? 'text-neon' : 'text-slate-200'}`}>{it.label}</span>
                {it.hint && <span className="ml-auto truncate pl-3 text-[11px] text-slate-500">{it.hint}</span>}
              </button>
            </li>
          ))}
          {matches.length === 0 && <li className="px-4 py-6 text-center text-[13px] text-slate-500">Nothing matches “{q}”.</li>}
        </ul>
      </div>
    </div>
  );
}
