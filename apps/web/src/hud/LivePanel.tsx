import { CloudOff, Gauge, LogIn, LogOut, Pause, Play, RotateCcw, Server } from 'lucide-react';
import { useState } from 'react';
import { LiveWorld } from '../live/LiveWorld.ts';
import { control, signIn, signOut } from '../live/session.ts';
import { useApp } from '../state/store.ts';
import { Section, Segmented } from './ui.tsx';

const STATUS = {
  off: { label: 'Offline', color: '#64748b' },
  connecting: { label: 'Connecting…', color: '#fbbf24' },
  live: { label: 'Connected to AWS IoT Core', color: '#34d399' },
  error: { label: 'Connection problem', color: '#f87171' },
} as const;

/** Cloud status and the operator console, shown at the top of the left panel in Live mode. */
export function LivePanel() {
  useApp((s) => s.tick);
  const status = useApp((s) => s.liveStatus);
  const error = useApp((s) => s.liveError);
  const c = useApp((s) => s.liveControl);
  const operator = useApp((s) => s.operator);
  const sim = useApp((s) => s.sim);
  const lat = sim instanceof LiveWorld ? sim.latency() : null;
  const meta = STATUS[status];

  return (
    <Section title="Cloud" right={<span className="font-mono text-[10px] text-slate-500">ap-south-1</span>}>
      <div className="flex items-center gap-2 text-[12px]">
        <span className={`size-2 rounded-full ${status === 'live' ? 'pulse-ring' : ''}`} style={{ background: meta.color }} />
        <span style={{ color: meta.color }}>{meta.label}</span>
      </div>
      {error && <p className="mt-1 text-[11px] text-rose-300">{error}</p>}
      {c && (
        <div className="mt-2 grid grid-cols-3 gap-1 text-center font-mono text-[11px]">
          <div className="rounded-lg bg-white/[0.03] py-1">
            <div className={c.running ? 'text-emerald-300' : 'text-amber'}>{c.running ? 'running' : 'stopped'}</div>
            <div className="text-[9.5px] text-slate-500">fleet</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] py-1">
            <div className="text-slate-200">{c.speed}×</div>
            <div className="text-[9.5px] text-slate-500">sim speed</div>
          </div>
          <div className="rounded-lg bg-white/[0.03] py-1">
            <div className="text-slate-200">{lat ? `${Math.round(lat.total)} ms` : '…'}</div>
            <div className="text-[9.5px] text-slate-500">device→screen</div>
          </div>
        </div>
      )}
      {sim instanceof LiveWorld && (
        <p className="mt-2 text-[10.5px] leading-snug text-slate-500">
          {sim.bins.length} virtual bins publish MQTT readings to IoT Core; {sim.phones.size} phone{sim.phones.size === 1 ? '' : 's'} joined. Every pillar you see has been through
          IoT Core → SQS → Lambda → DynamoDB → back to this browser.
        </p>
      )}
      {operator ? <OperatorControls /> : <SignIn />}
    </Section>
  );
}

function SignIn() {
  const [user, setUser] = useState('operator');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-3 space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        signIn(user, pass)
          .catch((x: Error) => setErr(x.message))
          .finally(() => setBusy(false));
      }}
    >
      <div className="text-[11px] text-slate-400">Operator sign-in (Cognito) to run the fleet:</div>
      <div className="flex gap-1.5">
        <input
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="username"
          className="w-24 rounded-lg bg-black/40 px-2 py-1 text-[12px] ring-1 ring-white/10 outline-none focus:ring-neon/50"
        />
        <input
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="current-password"
          placeholder="password"
          className="min-w-0 flex-1 rounded-lg bg-black/40 px-2 py-1 text-[12px] ring-1 ring-white/10 outline-none focus:ring-neon/50"
        />
        <button disabled={busy || !pass} className="grid size-7 shrink-0 place-items-center rounded-lg bg-neon/90 text-ink disabled:opacity-40" title="Sign in">
          <LogIn size={14} />
        </button>
      </div>
      {err && <p className="text-[11px] text-rose-300">{err}</p>}
    </form>
  );
}

function OperatorControls() {
  const c = useApp((s) => s.liveControl);
  const [seed, setSeed] = useState(c?.seed ?? 'binsight');
  const [bins, setBins] = useState(c?.bins ?? 120);
  const [trucks, setTrucks] = useState(c?.trucks ?? 4);
  if (!c) return null;
  const btn = 'flex items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px] ring-1 transition';
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-emerald-300">Signed in as operator</span>
        <button onClick={signOut} className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200">
          <LogOut size={12} /> sign out
        </button>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => void control({ action: c.running ? 'stop' : 'start' })}
          className={`${btn} ${c.running ? 'bg-amber/10 text-amber ring-amber/30' : 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/30'}`}
        >
          {c.running ? <Pause size={13} /> : <Play size={13} />} {c.running ? 'Stop fleet' : 'Start fleet'}
        </button>
        <button
          onClick={() => void control({ action: 'ingest', paused: !c.ingestPaused })}
          className={`${btn} ${c.ingestPaused ? 'bg-rose-500/15 text-rose-300 ring-rose-400/40' : 'bg-white/[0.04] text-slate-200 ring-white/10'}`}
          title="Chaos: stop the ingest Lambda reading the queue. Readings pile up in SQS, nothing is lost."
        >
          {c.ingestPaused ? <Server size={13} /> : <CloudOff size={13} />} {c.ingestPaused ? 'Resume ingest' : 'Pause ingest'}
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[11px] text-slate-400">
          <Gauge size={12} /> Speed
        </span>
        <Segmented size="sm" value={c.speed} onChange={(v) => void control({ action: 'speed', speed: v })} options={[30, 60, 120, 300].map((v) => ({ value: v, label: `${v}×` }))} />
      </div>
      <div className="rounded-xl bg-white/[0.03] p-2 ring-1 ring-white/5">
        <div className="mb-1.5 text-[11px] text-slate-400">New world</div>
        <div className="flex gap-1.5">
          <input value={seed} onChange={(e) => setSeed(e.target.value)} className="min-w-0 flex-1 rounded-lg bg-black/40 px-2 py-1 font-mono text-[11.5px] ring-1 ring-white/10 outline-none" />
          <select value={bins} onChange={(e) => setBins(+e.target.value)} className="rounded-lg bg-black/40 px-1 text-[11.5px] ring-1 ring-white/10 outline-none" title="Bins (load storm at 1000)">
            {[120, 360, 1000].map((v) => (
              <option key={v} value={v}>
                {v} bins
              </option>
            ))}
          </select>
          <select value={trucks} onChange={(e) => setTrucks(+e.target.value)} className="rounded-lg bg-black/40 px-1 text-[11.5px] ring-1 ring-white/10 outline-none">
            {[2, 4, 6, 8].map((v) => (
              <option key={v} value={v}>
                {v} trucks
              </option>
            ))}
          </select>
        </div>
        <button onClick={() => void control({ action: 'reset', seed, bins, trucks })} className={`${btn} mt-1.5 w-full bg-white/[0.05] text-slate-200 ring-white/10 hover:bg-white/10`}>
          <RotateCcw size={13} /> Reset the cloud city
        </button>
      </div>
    </div>
  );
}
