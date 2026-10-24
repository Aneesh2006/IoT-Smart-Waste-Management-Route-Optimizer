import { formatClock } from '@binsight/core';
import { History, Pause, Play, X } from 'lucide-react';
import { useEffect } from 'react';
import { useApp } from '../state/store.ts';
import { Panel } from './ui.tsx';

/**
 * Time-lapse of the recorded past: the scene shows the tape instead of the live
 * simulation, a frame per sensor sample, eight frames (two sim-hours) a second.
 */
export function ReplayBar() {
  const replay = useApp((s) => s.replay);
  const sim = useApp((s) => s.sim);
  const { setReplay, exitReplay } = useApp.getState();

  useEffect(() => {
    if (!replay?.playing) return;
    const id = window.setInterval(() => {
      const r = useApp.getState().replay;
      if (!r) return;
      const next = r.index + 1;
      if (next >= sim.tape.length) setReplay({ index: sim.tape.length - 1, playing: false });
      else setReplay({ ...r, index: next });
    }, 125);
    return () => window.clearInterval(id);
  }, [replay?.playing, sim, setReplay]);

  if (!replay) return null;
  const frames = sim.tape;
  const frame = frames[replay.index];
  if (!frame) return null;
  const max = Math.max(1, ...frames.map((f) => f.overflowing));
  const W = 600;
  const H = 34;
  const x = (i: number) => (i / Math.max(1, frames.length - 1)) * W;
  const area = frames.map((f, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${(H - (f.overflowing / max) * (H - 4)).toFixed(1)}`).join('') + `L${W},${H}L0,${H}Z`;

  return (
    <Panel className="pointer-events-auto w-full max-w-[640px] px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="flex items-center gap-1.5 rounded-full bg-fuchsia-500/15 px-2 py-0.5 font-mono text-[10.5px] font-bold text-fuchsia-300 ring-1 ring-fuchsia-400/40">
          <History size={12} /> REPLAY
        </span>
        <span className="font-mono text-[12px] text-slate-200">
          D{Math.floor(frame.time / 86400) + 1} {formatClock(frame.time)}
        </span>
        <span className="text-[11px] text-slate-500">{frame.overflowing} overflowing</span>
        <div className="flex-1" />
        <button
          onClick={() => setReplay({ index: replay.index >= frames.length - 1 ? 0 : replay.index, playing: !replay.playing })}
          className="grid size-7 place-items-center rounded-lg bg-white/[0.06] ring-1 ring-white/10 hover:bg-white/10"
          title={replay.playing ? 'Pause' : 'Play the time-lapse'}
        >
          {replay.playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button onClick={exitReplay} className="flex items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] ring-1 ring-white/10 hover:bg-white/10" title="Back to now (Esc)">
          <X size={12} /> Back to now
        </button>
      </div>
      <div className="relative mt-1.5">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full">
          <path d={area} fill="rgba(239,68,68,0.25)" stroke="rgba(239,68,68,0.7)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          <line x1={x(replay.index)} x2={x(replay.index)} y1={0} y2={H} stroke="#f0abfc" strokeWidth={2} vectorEffect="non-scaling-stroke" />
        </svg>
        <input
          type="range"
          min={0}
          max={frames.length - 1}
          value={replay.index}
          onChange={(e) => setReplay({ index: +e.target.value, playing: false })}
          className="absolute inset-0 h-8 w-full cursor-pointer opacity-0"
          aria-label="Replay position"
        />
      </div>
    </Panel>
  );
}
