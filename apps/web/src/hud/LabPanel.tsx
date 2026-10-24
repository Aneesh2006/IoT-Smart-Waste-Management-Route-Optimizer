import {
  EXACT_LIMIT,
  LAB_INFO,
  astar,
  dijkstra,
  makeLabProblem,
  runLab,
  type City,
  type LabAlgorithm,
  type LabFrame,
  type LabProblem,
  type LabRun,
  type Simulation,
} from '@binsight/core';
import { FlaskConical, Pause, Play, RotateCcw, Shuffle, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../state/store.ts';
import { Sparkline } from './Sparkline.tsx';
import { IconButton, Panel, Segmented } from './ui.tsx';

const ORDER: LabAlgorithm[] = ['nearest', 'savings', 'twoopt', 'oropt', 'anneal', 'ants', 'exact'];
const ROUTE_COLORS = ['#5eead4', '#f472b6', '#facc15', '#a78bfa', '#fb923c', '#4ade80', '#60a5fa', '#f87171'];

type Tab = 'tours' | 'paths';

interface Wave {
  order: number[];
  dist: Float64Array;
  target: number;
  astarExpanded: number[];
  astarPath: number[];
  dijkstraToTarget: number;
}

export function LabPanel() {
  const open = useApp((s) => s.labOpen);
  if (!open) return null;
  return <Lab />;
}

function Lab() {
  const sim = useApp((s) => s.sim);
  const { setLabOpen } = useApp.getState();
  const [tab, setTab] = useState<Tab>('tours');
  const [k, setK] = useState(EXACT_LIMIT);
  const [round, setRound] = useState(1);
  const problem = useMemo(() => makeLabProblem(sim.city, sim.table, k, `${sim.config.seed}-${round}`), [sim, k, round]);
  const [runs, setRuns] = useState<Partial<Record<LabAlgorithm, LabRun>>>({});
  const [active, setActive] = useState<LabAlgorithm | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);

  // Shortest-path tab state.
  const wave = useMemo<Wave>(() => {
    const target = problem.nodes[0];
    const dj = dijkstra(sim.city, problem.hubNode, true);
    const a = astar(sim.city, problem.hubNode, target);
    return {
      order: dj.order!,
      dist: dj.dist,
      target,
      astarExpanded: a.expanded,
      astarPath: a.path,
      dijkstraToTarget: dj.order!.indexOf(target) + 1,
    };
  }, [sim, problem]);

  useEffect(() => {
    setRuns({});
    setActive(null);
    setFrame(0);
    setPlaying(false);
  }, [problem]);

  const run = (alg: LabAlgorithm) => {
    const r = runs[alg] ?? runLab(problem, alg, `${sim.config.seed}-${round}`);
    setRuns((prev) => ({ ...prev, [alg]: r }));
    setActive(alg);
    setFrame(0);
    setPlaying(true);
  };

  const runAll = () => {
    const next = { ...runs };
    for (const alg of ORDER) {
      if (alg === 'exact' && problem.k > EXACT_LIMIT) continue;
      next[alg] ??= runLab(problem, alg, `${sim.config.seed}-${round}`);
    }
    setRuns(next);
  };

  const frames = tab === 'paths' ? wave.order.length + 1 : active ? runs[active]!.frames.length : 0;

  // Playback: aim for roughly seven seconds per animation whatever its length.
  useEffect(() => {
    if (!playing || frames === 0) return;
    const perSecond = Math.max(6, frames / 7);
    let last = performance.now();
    let acc = 0;
    let id = 0;
    const loop = (now: number) => {
      acc += ((now - last) / 1000) * perSecond;
      last = now;
      if (acc >= 1) {
        const step = Math.floor(acc);
        acc -= step;
        setFrame((f) => {
          const nf = Math.min(frames - 1, f + step);
          if (nf >= frames - 1) setPlaying(false);
          return nf;
        });
      }
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [playing, frames]);

  const current: LabFrame | null = tab === 'tours' && active ? runs[active]!.frames[Math.min(frame, frames - 1)] : null;
  const exact = runs.exact;
  const bestKnown = Math.min(...Object.values(runs).map((r) => r!.cost));

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onClick={() => setLabOpen(false)}>
      <Panel className="flex h-full max-h-[900px] w-full max-w-[1320px] flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <FlaskConical size={12} /> Algorithm lab
              </div>
              <h2 className="text-lg font-bold">One truck, {problem.k} bins: in what order?</h2>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented<Tab>
                size="sm"
                value={tab}
                onChange={(t) => {
                  setTab(t);
                  setFrame(0);
                  setPlaying(t === 'paths');
                }}
                options={[
                  { value: 'tours', label: 'Tour building' },
                  { value: 'paths', label: 'Shortest paths' },
                ]}
              />
              <label className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1 text-[11px] text-slate-300 ring-1 ring-white/10">
                Bins
                <input type="range" min={5} max={30} value={k} onChange={(e) => setK(+e.target.value)} className="w-24" />
                <span className="w-5 font-mono">{k}</span>
              </label>
              <IconButton onClick={() => setRound((r) => r + 1)} title="New random set of bins">
                <Shuffle size={15} />
              </IconButton>
              <IconButton onClick={() => setLabOpen(false)} title="Close (Esc)">
                <X size={15} />
              </IconButton>
            </div>
          </div>

          <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_380px]">
            <div className="relative min-h-[360px] border-b border-white/5 lg:border-b-0 lg:border-r">
              <LabMap city={sim.city} sim={sim} problem={problem} frame={current} tab={tab} wave={wave} waveCount={frame} />
              <div className="absolute inset-x-3 bottom-3 flex items-center gap-2">
                <IconButton onClick={() => setPlaying((p) => !p)} title={playing ? 'Pause' : 'Play'} active={playing}>
                  {playing ? <Pause size={15} /> : <Play size={15} />}
                </IconButton>
                <IconButton
                  onClick={() => {
                    setFrame(0);
                    setPlaying(true);
                  }}
                  title="Replay"
                >
                  <RotateCcw size={15} />
                </IconButton>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, frames - 1)}
                  value={Math.min(frame, Math.max(0, frames - 1))}
                  onChange={(e) => {
                    setPlaying(false);
                    setFrame(+e.target.value);
                  }}
                  className="flex-1"
                />
                <span className="glass rounded-md px-2 py-1 font-mono text-[11px] text-slate-300">
                  {frames ? Math.min(frame + 1, frames) : 0}/{frames}
                </span>
              </div>
            </div>

            <div className="scroll-thin min-h-0 overflow-y-auto">
              {tab === 'tours' ? (
                <ToursSide
                  problem={problem}
                  runs={runs}
                  active={active}
                  current={current}
                  frame={frame}
                  run={run}
                  runAll={runAll}
                  exactCost={exact?.cost}
                  bestKnown={Number.isFinite(bestKnown) ? bestKnown : undefined}
                />
              ) : (
                <PathsSide wave={wave} frame={frame} />
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}

function ToursSide({
  problem,
  runs,
  active,
  current,
  frame,
  run,
  runAll,
  exactCost,
  bestKnown,
}: {
  problem: LabProblem;
  runs: Partial<Record<LabAlgorithm, LabRun>>;
  active: LabAlgorithm | null;
  current: LabFrame | null;
  frame: number;
  run: (a: LabAlgorithm) => void;
  runAll: () => void;
  exactCost?: number;
  bestKnown?: number;
}) {
  const ref = exactCost ?? bestKnown;
  const activeRun = active ? runs[active] : undefined;
  const series = activeRun?.frames.slice(0, frame + 1).map((f) => f.cost) ?? [];
  const temps = activeRun?.frames.slice(0, frame + 1).map((f) => f.temperature ?? 0) ?? [];
  return (
    <div className="space-y-3 p-4">
      <div className="grid grid-cols-2 gap-1.5">
        {ORDER.map((alg) => {
          const disabled = alg === 'exact' && problem.k > EXACT_LIMIT;
          return (
            <button
              key={alg}
              disabled={disabled}
              onClick={() => run(alg)}
              title={disabled ? `Exact solve is limited to ${EXACT_LIMIT} bins` : LAB_INFO[alg].blurb}
              className={`rounded-xl px-3 py-2 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-35 ${
                active === alg ? 'bg-neon/10 ring-neon/50' : 'bg-white/[0.03] ring-white/5 hover:bg-white/[0.07]'
              }`}
            >
              <div className="text-[9.5px] uppercase tracking-wider text-slate-500">{LAB_INFO[alg].family}</div>
              <div className={`text-[12.5px] font-semibold ${active === alg ? 'text-neon' : 'text-slate-200'}`}>{LAB_INFO[alg].name}</div>
            </button>
          );
        })}
        <button onClick={runAll} className="rounded-xl bg-gradient-to-r from-teal-400 to-lime-400 px-3 py-2 text-[12.5px] font-semibold text-ink">
          Run all
        </button>
      </div>

      {active && current && (
        <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
          <div className="flex items-baseline justify-between">
            <div className="text-[13px] font-semibold">{LAB_INFO[active].name}</div>
            <div className="tabular font-mono text-[15px] font-bold text-neon">{(current.cost / 1000).toFixed(2)} km</div>
          </div>
          <p className="mt-1 text-[11.5px] leading-snug text-slate-400">{LAB_INFO[active].blurb}</p>
          <div className="mt-2 rounded-lg bg-black/30 px-2.5 py-1.5 font-mono text-[11px] text-slate-200">{current.note}</div>
          {series.length > 1 && (
            <div className="mt-2">
              <div className="mb-1 flex justify-between text-[10px] text-slate-500">
                <span>Tour length per step</span>
                {current.temperature !== undefined && <span className="text-amber">T = {current.temperature.toFixed(1)}</span>}
              </div>
              <Sparkline values={series} color="#5eead4" height={44} min={Math.min(...series) * 0.95} />
              {current.temperature !== undefined && <Sparkline values={temps} color="#fbbf24" height={22} />}
            </div>
          )}
        </div>
      )}

      <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
        <div className="eyebrow mb-1.5">Optimality gap</div>
        <p className="mb-2 text-[11px] leading-snug text-slate-500">
          <span className="text-slate-300">Short ≠ optimal.</span> Each tour against {exactCost ? 'the exact optimum (Held–Karp)' : 'the best tour any algorithm found; run Held–Karp (≤12 bins) for the true optimum'}.
        </p>
        <table className="w-full text-[11.5px]">
          <tbody>
            {ORDER.filter((a) => runs[a]).map((a) => {
              const r = runs[a]!;
              const gap = ref ? (r.cost - ref) / ref : 0;
              return (
                <tr key={a} className="border-t border-white/5">
                  <td className="py-1.5">
                    <button onClick={() => run(a)} className={`text-left hover:text-neon ${a === active ? 'text-neon' : 'text-slate-300'}`}>
                      {LAB_INFO[a].name}
                    </button>
                  </td>
                  <td className="tabular py-1.5 text-right font-mono">{(r.cost / 1000).toFixed(2)} km</td>
                  <td className={`tabular w-16 py-1.5 text-right font-mono ${gap < 0.005 ? 'text-lime' : gap < 0.05 ? 'text-amber' : 'text-rose-400'}`}>
                    {gap < 0.0005 ? 'optimal' : `+${(gap * 100).toFixed(1)}%`}
                  </td>
                  <td className="tabular w-14 py-1.5 text-right font-mono text-slate-500">{r.ms < 1 ? '<1' : r.ms.toFixed(0)} ms</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {Object.keys(runs).length === 0 && <p className="text-[11px] text-slate-500">Run an algorithm to start the scoreboard.</p>}
      </div>
    </div>
  );
}

function PathsSide({ wave, frame }: { wave: Wave; frame: number }) {
  const settled = Math.min(frame, wave.order.length);
  const reached = settled >= wave.dijkstraToTarget;
  return (
    <div className="space-y-3 p-4">
      <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
        <div className="text-[13px] font-semibold">Dijkstra’s wavefront</div>
        <p className="mt-1 text-[11.5px] leading-snug text-slate-400">
          From the transfer station, settle the closest unsettled junction, relax its roads, repeat. Every distance on the planner’s matrix comes from one of these
          sweeps; the city needs one per bin.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-black/30 py-2">
            <div className="tabular font-mono text-xl font-bold text-neon">{settled}</div>
            <div className="text-[10px] text-slate-500">nodes settled</div>
          </div>
          <div className="rounded-lg bg-black/30 py-2">
            <div className="tabular font-mono text-xl font-bold text-slate-200">{wave.order.length}</div>
            <div className="text-[10px] text-slate-500">nodes in the city</div>
          </div>
        </div>
      </div>
      <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
        <div className="text-[13px] font-semibold">A* to one bin</div>
        <p className="mt-1 text-[11.5px] leading-snug text-slate-400">
          For a single destination, A* adds the straight-line distance as a guide and stops early. Same answer, a fraction of the work.
        </p>
        <div className="mt-2 grid grid-cols-2 gap-2 text-center">
          <div className="rounded-lg bg-black/30 py-2">
            <div className="tabular font-mono text-xl font-bold text-pink-300">{wave.astarExpanded.length}</div>
            <div className="text-[10px] text-slate-500">A* expanded</div>
          </div>
          <div className="rounded-lg bg-black/30 py-2">
            <div className="tabular font-mono text-xl font-bold text-slate-200">{wave.dijkstraToTarget}</div>
            <div className="text-[10px] text-slate-500">Dijkstra needed</div>
          </div>
        </div>
        <p className="mt-2 text-[11px] text-slate-500">
          {reached ? 'The wave has reached the pink bin; the dashed pink path is A*’s answer.' : 'Watch for the wave reaching the pink bin.'}
        </p>
      </div>
    </div>
  );
}

/** Top-down 2D map: roads, stops, and whatever the current frame says to draw. */
function LabMap({
  city,
  sim,
  problem,
  frame,
  tab,
  wave,
  waveCount,
}: {
  city: City;
  sim: Simulation;
  problem: LabProblem;
  frame: LabFrame | null;
  tab: Tab;
  wave: Wave;
  waveCount: number;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const paths = useMemo(() => new Map<number, number[]>(), [problem]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = size.w * dpr;
    c.height = size.h * dpr;
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    const { x0, x1, z0, z1 } = city.bounds;
    const pad = 36;
    const scale = Math.min((size.w - pad * 2) / (x1 - x0), (size.h - pad * 2 - 40) / (z1 - z0));
    const ox = (size.w - (x1 - x0) * scale) / 2;
    const oz = (size.h - 40 - (z1 - z0) * scale) / 2;
    const px = (x: number) => ox + (x - x0) * scale;
    const pz = (z: number) => oz + (z - z0) * scale;
    const nodeXY = (n: number) => [px(city.nodes[n].x), pz(city.nodes[n].z)] as const;

    // Roads.
    g.lineCap = 'round';
    for (const e of city.edges) {
      const [ax, az] = nodeXY(e.a);
      const [bx, bz] = nodeXY(e.b);
      g.strokeStyle = e.arterial ? 'rgba(148,163,184,0.28)' : 'rgba(148,163,184,0.14)';
      g.lineWidth = e.arterial ? 3 : 1.5;
      g.beginPath();
      g.moveTo(ax, az);
      g.lineTo(bx, bz);
      g.stroke();
    }

    const pointNode = (p: number) => (p === problem.k ? problem.hubNode : problem.nodes[p]);
    const roadPath = (a: number, b: number) => {
      const key = a * (problem.k + 1) + b;
      let p = paths.get(key);
      if (!p) {
        p = sim.table.path(pointNode(a), pointNode(b));
        paths.set(key, p);
      }
      return p;
    };
    const strokeNodes = (nodes: number[], first: boolean) => {
      nodes.forEach((n, i) => {
        const [x, z] = nodeXY(n);
        if (i === 0 && first) g.moveTo(x, z);
        else g.lineTo(x, z);
      });
    };

    if (tab === 'paths') {
      const count = Math.min(waveCount, wave.order.length);
      let maxD = 0;
      for (let i = 0; i < count; i++) maxD = Math.max(maxD, wave.dist[wave.order[i]]);
      for (let i = 0; i < count; i++) {
        const n = wave.order[i];
        const t = maxD ? wave.dist[n] / maxD : 0;
        const [x, z] = nodeXY(n);
        g.fillStyle = `hsla(${190 + t * 110}, 90%, ${i > count - 25 ? 75 : 58}%, ${i > count - 25 ? 1 : 0.85})`;
        g.beginPath();
        g.arc(x, z, i > count - 25 ? 4 : 2.6, 0, Math.PI * 2);
        g.fill();
      }
      for (const n of wave.astarExpanded) {
        const [x, z] = nodeXY(n);
        g.strokeStyle = 'rgba(244,114,182,0.55)';
        g.lineWidth = 1;
        g.beginPath();
        g.arc(x, z, 5.5, 0, Math.PI * 2);
        g.stroke();
      }
      if (count >= wave.dijkstraToTarget) {
        g.setLineDash([6, 5]);
        g.strokeStyle = '#f472b6';
        g.lineWidth = 3;
        g.beginPath();
        strokeNodes(wave.astarPath, true);
        g.stroke();
        g.setLineDash([]);
      }
    }

    if (tab === 'tours' && frame) {
      // Pheromone trails, as the crow flies between stops.
      if (frame.pheromone) {
        const n = problem.k + 1;
        for (let a = 0; a < n; a++) {
          for (let b = a + 1; b < n; b++) {
            const p = frame.pheromone[a * n + b];
            if (p < 0.04) continue;
            const [ax, az] = nodeXY(pointNode(a));
            const [bx, bz] = nodeXY(pointNode(b));
            g.strokeStyle = `rgba(167,139,250,${Math.min(0.85, p * p * 0.9)})`;
            g.lineWidth = 0.5 + p * 4;
            g.beginPath();
            g.moveTo(ax, az);
            g.lineTo(bx, bz);
            g.stroke();
          }
        }
      }
      frame.routes.forEach((route, ri) => {
        const color = frame.routes.length > 1 ? ROUTE_COLORS[ri % ROUTE_COLORS.length] : '#5eead4';
        const seq = [problem.k, ...route, ...(frame.closed ? [problem.k] : [])];
        g.strokeStyle = color;
        g.lineWidth = 3.2;
        g.shadowColor = color;
        g.shadowBlur = 12;
        g.lineJoin = 'round';
        g.beginPath();
        for (let i = 1; i < seq.length; i++) strokeNodes(roadPath(seq[i - 1], seq[i]), i === 1);
        g.stroke();
        g.shadowBlur = 0;
      });
    }

    // Stops (numbered by visiting order when there is a single tour).
    const orderOf = new Map<number, number>();
    if (tab === 'tours' && frame && frame.routes.length === 1) frame.routes[0].forEach((p, i) => orderOf.set(p, i + 1));
    problem.nodes.forEach((n, p) => {
      const [x, z] = nodeXY(n);
      const visited = orderOf.has(p);
      g.fillStyle = '#0b1220';
      g.strokeStyle = visited ? '#5eead4' : '#e2e8f0';
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, z, 9, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      g.fillStyle = visited ? '#5eead4' : '#cbd5e1';
      g.font = '600 9.5px "JetBrains Mono Variable", monospace';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(visited ? String(orderOf.get(p)) : '•', x, z + 0.5);
    });
    const [hx, hz] = nodeXY(problem.hubNode);
    g.fillStyle = '#f59e0b';
    g.shadowColor = '#f59e0b';
    g.shadowBlur = 16;
    g.fillRect(hx - 9, hz - 9, 18, 18);
    g.shadowBlur = 0;
    g.fillStyle = '#0b1220';
    g.font = '700 8.5px "JetBrains Mono Variable", monospace';
    g.fillText('TS', hx, hz + 0.5);

    if (tab === 'paths') {
      const [tx, tz] = nodeXY(wave.target);
      g.fillStyle = '#f472b6';
      g.shadowColor = '#f472b6';
      g.shadowBlur = 16;
      g.beginPath();
      g.arc(tx, tz, 9, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
    }
  }, [size, city, sim, problem, frame, tab, wave, waveCount, paths]);

  return (
    <div ref={box} className="absolute inset-0">
      <canvas ref={canvas} style={{ width: size.w, height: size.h }} />
    </div>
  );
}
