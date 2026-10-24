import { DAY, HOUR, clockParts } from '@binsight/core';
import { CircleHelp, Cloud, Radar, Dices, FastForward, Layers, Link2, Moon, Pause, PanelLeft, Play, Sun, Sunrise } from 'lucide-react';
import { SPEEDS, useApp } from '../state/store.ts';
import { IconButton, Panel, Segmented } from './ui.tsx';

function Logo() {
  return (
    <svg viewBox="0 0 64 64" className="size-8 drop-shadow-[0_0_10px_rgb(94_234_212/0.6)]">
      <defs>
        <linearGradient id="logo-fill" x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#22c55e" />
          <stop offset="1" stopColor="#5eead4" />
        </linearGradient>
      </defs>
      <path d="M18 22h28l-3 30a4 4 0 0 1-4 3.6H25a4 4 0 0 1-4-3.6z" fill="none" stroke="#5eead4" strokeWidth="3" />
      <path d="M22.5 38h19l-1.4 14H23.9z" fill="url(#logo-fill)" />
      <path d="M14 18h36M27 18v-4h10v4" stroke="#5eead4" strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const speedLabel = (s: number) => (s >= 3600 ? '1h/s' : s >= 60 ? `${s / 60}m/s` : `${s}×`);

export function TopBar() {
  useApp((s) => s.tick);
  const sim = useApp((s) => s.sim);
  const speed = useApp((s) => s.speed);
  const paused = useApp((s) => s.paused);
  const leftOpen = useApp((s) => s.leftOpen);
  const dataView = useApp((s) => s.dataView);
  const mode = useApp((s) => s.mode);
  const liveStatus = useApp((s) => s.liveStatus);
  const liveControl = useApp((s) => s.liveControl);
  const { setSpeed, togglePause, skipToNextShift, newCity, setLeftOpen, toggleDataView, setGuideOpen, copyShareLink, setMode } = useApp.getState();

  const c = clockParts(sim.time);
  const shift = sim.shiftAt();
  const hour = (sim.time % DAY) / HOUR;
  const SkyIcon = hour >= 6.5 && hour < 18 ? Sun : hour >= 5 && hour < 19 ? Sunrise : Moon;
  const shiftLabel = shift === -1 ? 'Between shifts' : shift === 0 ? 'Morning shift' : 'Evening shift';

  return (
    <div className="pointer-events-none absolute inset-x-3 top-3 z-40 flex flex-wrap items-start gap-3">
      <Panel className="pointer-events-auto flex items-center gap-3 px-3 py-2">
        <IconButton onClick={() => setLeftOpen(!leftOpen)} title="Toggle operations panel" active={leftOpen}>
          <PanelLeft size={16} />
        </IconButton>
        <Logo />
        <div className="leading-tight">
          <div className="text-[17px] font-bold tracking-tight">
            Bin<span className="text-neon">Sight</span>
          </div>
          <div className="eyebrow !text-[9px]">Smart waste digital twin</div>
        </div>
      </Panel>

      <Panel className="pointer-events-auto flex items-center gap-3 px-3 py-2">
        <SkyIcon size={18} className="text-amber" />
        <div className="leading-tight">
          <div className="tabular font-mono text-[17px] font-semibold">
            <span className="text-slate-400">D{c.day + 1}</span> {c.weekday.toUpperCase()}{' '}
            {String(c.hour).padStart(2, '0')}:{String(c.minute).padStart(2, '0')}
          </div>
          <div className={`eyebrow !text-[9px] ${shift === -1 ? '' : '!text-neon'}`}>{shiftLabel}</div>
        </div>
        <div className="mx-1 h-8 w-px bg-white/10" />
        {mode === 'live' ? (
          <div className="flex items-center gap-2 rounded-lg bg-white/[0.04] px-2.5 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-white/10" title="The cloud runs the clock in Live mode">
            <Cloud size={13} className="text-neon" />
            {liveControl?.running ? `${liveControl.speed}× · cloud clock` : 'fleet stopped'}
          </div>
        ) : (
          <>
            <IconButton onClick={togglePause} title={paused ? 'Play (Space)' : 'Pause (Space)'} active={!paused}>
              {paused ? <Play size={16} /> : <Pause size={16} />}
            </IconButton>
            <Segmented
              size="sm"
              value={speed}
              onChange={setSpeed}
              options={SPEEDS.map((s, i) => ({ value: s, label: speedLabel(s), title: `${s}× real time (key ${i + 1})` }))}
            />
            <IconButton onClick={skipToNextShift} title="Skip to the next shift (N)">
              <FastForward size={16} />
            </IconButton>
          </>
        )}
        <IconButton onClick={toggleDataView} title="Data view: ghost the buildings (V)" active={dataView}>
          <Layers size={16} />
        </IconButton>
        <IconButton onClick={() => useApp.getState().setXrayOpen(true)} title="Cloud X-Ray: watch readings travel through AWS (X)">
          <Radar size={16} />
        </IconButton>
      </Panel>

      <div className="flex-1" />

      <Panel className="pointer-events-auto flex items-center gap-2 px-3 py-2">
        <Segmented
          size="sm"
          value={mode}
          onChange={(m) => void setMode(m)}
          options={[
            { value: 'sandbox', label: 'Sandbox', title: 'Simulated in this browser: time-warp, deterministic, offline' },
            {
              value: 'live',
              label: (
                <>
                  <span
                    className="size-1.5 rounded-full"
                    style={{ background: liveStatus === 'live' ? '#34d399' : liveStatus === 'connecting' ? '#fbbf24' : liveStatus === 'error' ? '#f87171' : '#64748b' }}
                  />
                  <Cloud size={12} /> Live
                </>
              ),
              title: 'Stream the city from AWS: IoT Core, SQS, Lambda, DynamoDB',
            },
          ]}
        />
        <div className={`${mode === 'live' ? 'hidden' : 'hidden sm:flex'} items-center gap-1.5 rounded-lg bg-white/[0.04] px-2 py-1 font-mono text-[11px] text-slate-300 ring-1 ring-white/10`} title="City seed: the same seed rebuilds the same city">
          <span className="text-slate-500">seed</span> {sim.config.seed}
        </div>
        <IconButton onClick={() => newCity()} title="Generate a new city">
          <Dices size={16} />
        </IconButton>
        <IconButton onClick={() => void copyShareLink()} title="Copy a shareable link to this setup">
          <Link2 size={16} />
        </IconButton>
        <IconButton onClick={() => setGuideOpen(true)} title="Guide (?)">
          <CircleHelp size={16} />
        </IconButton>
      </Panel>
    </div>
  );
}
