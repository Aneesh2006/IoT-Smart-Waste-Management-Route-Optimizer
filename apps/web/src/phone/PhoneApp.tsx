import { PHONE_EMOJI, topics, type PhoneCommand, type Telemetry } from '@binsight/core';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, clockOffset, connectRealtime, isConfig, loadLiveConfig, phoneIdentity, sendReading, type LiveConfig, type PhoneIdentity } from '../live/cloud.ts';

/**
 * /bin: the audience's phone becomes a smart bin in the live city. It POSTs its
 * fill level to the cloud's ingest function and listens on Ably for the truck the
 * cloud dispatches when it gets full.
 */
type Item = { emoji: string; name: string; stream: 'wet' | 'dry' };

const ITEMS: Item[] = [
  { emoji: '🍌', name: 'Banana peel', stream: 'wet' },
  { emoji: '🍎', name: 'Apple core', stream: 'wet' },
  { emoji: '🥚', name: 'Eggshells', stream: 'wet' },
  { emoji: '🍵', name: 'Used tea leaves', stream: 'wet' },
  { emoji: '🌽', name: 'Corn cob', stream: 'wet' },
  { emoji: '🥬', name: 'Vegetable peels', stream: 'wet' },
  { emoji: '🍞', name: 'Stale bread', stream: 'wet' },
  { emoji: '🌸', name: 'Old flowers', stream: 'wet' },
  { emoji: '🧴', name: 'Plastic bottle', stream: 'dry' },
  { emoji: '📰', name: 'Newspaper', stream: 'dry' },
  { emoji: '🥫', name: 'Tin can', stream: 'dry' },
  { emoji: '📦', name: 'Cardboard box', stream: 'dry' },
  { emoji: '🫙', name: 'Glass jar', stream: 'dry' },
  { emoji: '🧃', name: 'Juice carton', stream: 'dry' },
  { emoji: '👕', name: 'Old T-shirt', stream: 'dry' },
  { emoji: '🥤', name: 'Plastic cup', stream: 'dry' },
];

const local = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      window.localStorage.setItem(k, v);
    } catch {
      // fine: the phone just asks for a name again next time
    }
  },
};

const pickItem = (prev?: Item) => {
  let it = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  while (prev && it.name === prev.name) it = ITEMS[Math.floor(Math.random() * ITEMS.length)];
  return it;
};

const buzz = (pattern: number | number[]) => {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // no vibration motor, no problem
  }
};

export function PhoneApp() {
  const [cfg, setCfg] = useState<LiveConfig | { error: string } | undefined>(undefined);
  const [nick, setNick] = useState(local.get('binsight.nick') ?? '');
  const [emoji, setEmoji] = useState(local.get('binsight.emoji') ?? PHONE_EMOJI[Math.floor(Math.random() * PHONE_EMOJI.length)]);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    void loadLiveConfig().then(setCfg);
  }, []);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,#123b3a_0%,#05070d_60%)] text-slate-100">
      <div className="mx-auto flex min-h-full max-w-md flex-col px-4 pb-8 pt-5">
        <header className="mb-4 flex items-center gap-2">
          <span className="text-lg font-bold tracking-tight">
            Bin<span className="text-neon">Sight</span>
          </span>
          <span className="eyebrow !text-[9px]">you are a smart bin</span>
        </header>
        {cfg === undefined ? (
          <p className="text-slate-400">Loading…</p>
        ) : !isConfig(cfg) ? (
          <p className="rounded-xl bg-rose-500/10 p-4 text-[14px] text-rose-200 ring-1 ring-rose-400/30">
            This BinSight isn’t connected to the cloud yet. Open the link from the big screen once it is deployed. ({cfg.error})
          </p>
        ) : !joined ? (
          <Setup
            nick={nick}
            emoji={emoji}
            setNick={setNick}
            setEmoji={setEmoji}
            onJoin={() => {
              local.set('binsight.nick', nick.trim() || 'Guest');
              local.set('binsight.emoji', emoji);
              setJoined(true);
            }}
          />
        ) : (
          <Bin cfg={cfg} nick={nick.trim() || 'Guest'} emoji={emoji} />
        )}
      </div>
    </div>
  );
}

function Setup(p: { nick: string; emoji: string; setNick: (s: string) => void; setEmoji: (s: string) => void; onJoin: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-3xl font-bold leading-tight">Turn this phone into a smart bin</h1>
        <p className="mt-2 text-[15px] text-slate-400">It appears in the city on the big screen. Fill it with trash, sort it right, and the cloud will send a truck when you’re full.</p>
      </div>
      <div>
        <div className="eyebrow mb-2">Pick your mascot</div>
        <div className="grid grid-cols-6 gap-2">
          {PHONE_EMOJI.map((e) => (
            <button
              key={e}
              onClick={() => p.setEmoji(e)}
              className={`aspect-square rounded-xl text-2xl ring-1 transition ${p.emoji === e ? 'bg-neon/20 ring-neon' : 'bg-white/5 ring-white/10'}`}
            >
              {e}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div className="eyebrow mb-2">Your name on the screen</div>
        <input
          value={p.nick}
          onChange={(e) => p.setNick(e.target.value.slice(0, 20))}
          placeholder="e.g. Priya"
          className="w-full rounded-xl bg-white/5 px-4 py-3 text-[17px] ring-1 ring-white/10 outline-none focus:ring-neon/60"
        />
      </div>
      <button onClick={p.onJoin} className="w-full rounded-2xl bg-gradient-to-r from-teal-400 to-lime-400 py-4 text-[17px] font-bold text-ink shadow-[0_0_30px_rgb(94_234_212/0.4)]">
        Join the city {p.emoji}
      </button>
    </div>
  );
}

type Status = 'connecting' | 'live' | 'offline' | 'error';

function Bin({ cfg, nick, emoji }: { cfg: LiveConfig; nick: string; emoji: string }) {
  const [status, setStatus] = useState<Status>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [fill, setFill] = useState(0);
  const [score, setScore] = useState(Number(local.get('binsight.score') ?? 0) || 0);
  const [item, setItem] = useState<Item>(() => pickItem());
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [truck, setTruck] = useState<{ name: string; eta: number } | null>(null);
  const [collected, setCollected] = useState(false);
  const phoneRef = useRef<PhoneIdentity | null>(null);
  const offsetRef = useRef(0);
  const state = useRef({ fill: 0, score: 0 });
  state.current = { fill, score };
  const lastSent = useRef(0);
  const pending = useRef<number | undefined>(undefined);
  /** What the cloud hasn't acknowledged yet; resent until it is. A "collected" sticks until delivered. */
  const unsent = useRef<Partial<Telemetry> | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<number | undefined>(undefined);

  const flush = useCallback(async () => {
    const phone = phoneRef.current;
    if (!phone || !unsent.current || inFlight.current) return;
    const extra = unsent.current;
    unsent.current = null;
    inFlight.current = true;
    window.clearTimeout(retry.current);
    retry.current = undefined;
    const t: Telemetry = {
      id: phone.id,
      kind: 'phone',
      r: Math.round(state.current.fill * 1000) / 1000,
      ok: true,
      temp: 29,
      gas: Math.round(20 + state.current.fill * 180),
      bat: 100,
      tDevice: Date.now() + offsetRef.current,
      nick,
      emoji,
      score: state.current.score,
      ...extra,
    };
    try {
      await sendReading(phone, t as unknown as Record<string, unknown>);
      setStatus('live');
      lastSent.current = Date.now();
    } catch (e) {
      // Keep it for the next try (merged under anything newer that is already waiting).
      unsent.current = { ...extra, ...(unsent.current ?? {}) };
      if (e instanceof ApiError && e.status === 401) phoneRef.current = await phoneIdentity(true).catch(() => phone);
      setStatus('offline');
      setError((e as Error).message);
      retry.current = window.setTimeout(() => void flush(), 2500);
    } finally {
      inFlight.current = false;
    }
    // Something newer arrived while this one was on its way.
    if (unsent.current && retry.current === undefined) void flush();
  }, [nick, emoji]);

  const send = useCallback(
    (extra: Partial<Telemetry> = {}) => {
      // A pending "collected" must not be overwritten by the next plain reading.
      unsent.current = unsent.current?.event === 'collected' ? { ...extra, event: 'collected' } : extra;
      void flush();
    },
    [flush],
  );

  /** Coalesce bursts of taps into a few messages a second. */
  const sendSoon = useCallback(() => {
    if (pending.current) return;
    const wait = Math.max(0, 350 - (Date.now() - lastSent.current));
    pending.current = window.setTimeout(() => {
      pending.current = undefined;
      send();
    }, wait);
  }, [send]);

  useEffect(() => {
    let alive = true;
    let close = () => {};
    (async () => {
      const [phone, offset] = await Promise.all([phoneIdentity(), clockOffset().catch(() => 0)]);
      if (!alive) return;
      phoneRef.current = phone;
      offsetRef.current = offset;
      const rt = await connectRealtime(
        cfg,
        [topics.phoneCmd(cfg.city, phone.id)],
        (_topic, data) => {
          const cmd = data as PhoneCommand;
          if (cmd?.type === 'dispatch') {
            buzz([200, 100, 200]);
            setTruck({ name: cmd.truck ?? 'A truck', eta: cmd.eta ?? 20 });
          }
        },
        { onStatus: (s, d) => alive && s !== 'connected' && (setStatus(s === 'reconnecting' ? 'connecting' : s), d && setError(d)) },
      );
      if (!alive) return rt.close();
      close = () => rt.close();
      setStatus('live');
      send();
    })().catch((e: Error) => {
      setStatus('error');
      setError(e.message);
    });
    const heartbeat = window.setInterval(() => send(), 20_000);
    return () => {
      alive = false;
      window.clearInterval(heartbeat);
      window.clearTimeout(retry.current);
      close();
    };
  }, [cfg, send]);

  // Truck countdown, then the bin is emptied.
  useEffect(() => {
    if (!truck) return;
    if (truck.eta <= 0) {
      setTruck(null);
      setFill(0);
      setCollected(true);
      buzz(400);
      const s = state.current.score + 20;
      setScore(s);
      local.set('binsight.score', String(s));
      state.current = { fill: 0, score: s };
      send({ r: 0, event: 'collected', score: s });
      window.setTimeout(() => setCollected(false), 3500);
      return;
    }
    const t = window.setTimeout(() => setTruck((x) => (x ? { ...x, eta: x.eta - 1 } : x)), 1000);
    return () => window.clearTimeout(t);
  }, [truck, send]);

  const addTrash = (amount: number) => {
    setFill((f) => {
      const next = Math.min(1.25, f + amount);
      state.current.fill = next;
      return next;
    });
    sendSoon();
  };

  const sort = (stream: 'wet' | 'dry') => {
    const ok = item.stream === stream;
    const s = Math.max(0, score + (ok ? 10 : -5));
    setScore(s);
    state.current.score = s;
    local.set('binsight.score', String(s));
    setFeedback({ ok, text: ok ? `Right, ${item.name.toLowerCase()} is ${stream} waste. +10` : `Oops, ${item.name.toLowerCase()} is ${item.stream} waste. −5` });
    buzz(ok ? 30 : [60, 40, 60]);
    if (ok) addTrash(0.05);
    else sendSoon();
    setItem((prev) => pickItem(prev));
    window.setTimeout(() => setFeedback(null), 1600);
  };

  // Shake to throw (asks for motion permission on iOS).
  const [shake, setShake] = useState(false);
  const enableShake = async () => {
    const DM = DeviceMotionEvent as unknown as { requestPermission?: () => Promise<string> };
    if (DM.requestPermission) {
      const r = await DM.requestPermission().catch(() => 'denied');
      if (r !== 'granted') return;
    }
    setShake(true);
  };
  useEffect(() => {
    if (!shake) return;
    let last = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a) return;
      const g = Math.hypot(a.x ?? 0, a.y ?? 0, a.z ?? 0);
      if (g > 22 && Date.now() - last > 350) {
        last = Date.now();
        addTrash(0.04);
        buzz(20);
      }
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
    // addTrash only depends on state setters and sendSoon.
  }, [shake, sendSoon]);

  const pct = Math.round(fill * 100);
  const color = fill >= 1 ? '#ef4444' : fill >= 0.8 ? '#f97316' : fill >= 0.5 ? '#facc15' : '#22c55e';

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-[15px] font-semibold">
          <span className="text-2xl">{emoji}</span> {nick}
        </div>
        <div className="flex items-center gap-1.5 text-[12px]">
          <span className="size-2 rounded-full" style={{ background: status === 'live' ? '#34d399' : status === 'connecting' ? '#fbbf24' : '#f87171' }} />
          {status === 'live' ? 'in the cloud' : status}
        </div>
      </div>
      {error && status !== 'live' && <p className="text-[12px] text-rose-300">{error}</p>}

      <div className="relative mx-auto h-64 w-48">
        <svg viewBox="0 0 120 160" className="absolute inset-0 h-full w-full">
          <defs>
            <clipPath id="can">
              <path d="M18 30h84l-8 118a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z" />
            </clipPath>
          </defs>
          <path d="M18 30h84l-8 118a8 8 0 0 1-8 7H34a8 8 0 0 1-8-7z" fill="rgba(255,255,255,0.05)" stroke="rgba(226,232,240,0.5)" strokeWidth="2" />
          <g clipPath="url(#can)">
            <rect x="0" y={155 - Math.min(1, fill) * 125} width="120" height="160" fill={color} opacity="0.85" style={{ transition: 'y 400ms ease, fill 400ms' }} />
          </g>
          <path d="M10 24h100" stroke="rgba(226,232,240,0.7)" strokeWidth="4" strokeLinecap="round" />
          <path d="M48 24v-8h24v8" stroke="rgba(226,232,240,0.7)" strokeWidth="4" fill="none" strokeLinecap="round" />
        </svg>
        <div className="absolute inset-x-0 top-[45%] text-center">
          <div className="font-mono text-5xl font-bold drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)]">{pct}%</div>
          {fill >= 1 && <div className="text-[13px] font-semibold text-rose-200">overflowing!</div>}
        </div>
      </div>

      {truck && (
        <div className="rounded-2xl bg-fuchsia-500/15 p-3 text-center ring-1 ring-fuchsia-400/40">
          <div className="text-2xl">🚛</div>
          <div className="font-semibold">{truck.name} is on its way</div>
          <div className="font-mono text-3xl font-bold text-fuchsia-200">{truck.eta}s</div>
          <div className="text-[12px] text-fuchsia-200/80">Dispatched by the cloud when your bin crossed 80%</div>
        </div>
      )}
      {collected && <div className="rounded-2xl bg-emerald-500/15 p-3 text-center text-[16px] font-semibold text-emerald-200 ring-1 ring-emerald-400/40">Collected ✓ +20 points</div>}

      <button
        onClick={() => {
          addTrash(0.07);
          buzz(15);
        }}
        className="w-full rounded-2xl bg-white/10 py-4 text-[17px] font-bold ring-1 ring-white/15 active:scale-[0.98]"
      >
        🗑️ Throw trash
      </button>

      <div className="rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <div className="eyebrow">Sort it right</div>
          <div className="font-mono text-[13px] text-neon">{score} pts</div>
        </div>
        <div className="my-3 text-center">
          <div className="text-6xl">{item.emoji}</div>
          <div className="mt-1 text-[16px] font-semibold">{item.name}</div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <button onClick={() => sort('wet')} className="rounded-xl bg-emerald-500/20 py-3 text-[16px] font-bold text-emerald-200 ring-1 ring-emerald-400/40 active:scale-[0.97]">
            Wet 🟢
          </button>
          <button onClick={() => sort('dry')} className="rounded-xl bg-sky-500/20 py-3 text-[16px] font-bold text-sky-200 ring-1 ring-sky-400/40 active:scale-[0.97]">
            Dry 🔵
          </button>
        </div>
        {feedback && <div className={`mt-2 text-center text-[13px] ${feedback.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{feedback.text}</div>}
      </div>

      {!shake && typeof DeviceMotionEvent !== 'undefined' && (
        <button onClick={() => void enableShake()} className="w-full rounded-xl bg-white/5 py-2.5 text-[14px] text-slate-300 ring-1 ring-white/10">
          📳 Enable shake-to-throw
        </button>
      )}
      <p className="text-center text-[11px] text-slate-500">Your bin reports over HTTPS to a Vercel function; trucks reach you over Ably. Find {emoji} {nick} on the big screen.</p>
    </div>
  );
}
