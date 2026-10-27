import {
  Simulation,
  buildFleetFrame,
  buildRoutesFrame,
  generateCity,
  topics,
  worldKey,
  type City,
  type FleetFrame,
  type LiveControl,
  type LiveEvent,
  type RouteStopFrame,
  type RoutesFrame,
} from '@binsight/core';
import { Factory, Home, Trash2, Truck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { TRUCK_COLORS } from '../lib/colors.ts';
import { api, connectRealtime, isConfig, keepFleetTicking, loadLiveConfig } from '../live/cloud.ts';

/**
 * /driver: the crew's phone. It follows one truck through the live city over
 * Ably (the same messages the big screen gets): next stop, load, the stops
 * still to do and a small map. `?demo` runs a local simulation instead, for
 * trying it without the cloud.
 */
interface Feed {
  city: City;
  fleet: FleetFrame | null;
  routes: RoutesFrame | null;
  events: LiveEvent[];
  source: 'live' | 'demo';
}

const STATUS: Record<string, string> = {
  idle: 'At the depot',
  driving: 'Driving',
  collecting: 'Emptying a bin',
  unloading: 'Tipping at the transfer station',
  returning: 'Heading home',
  broken: 'Broken down: wait for the tow',
};

function useFeed(): { feed: Feed | null; error: string | null } {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = () => {};
    const demo = new URLSearchParams(window.location.search).has('demo');
    if (demo) {
      // Offline preview: a local city at 60×, shaped exactly like the cloud's messages.
      const sim = new Simulation({ seed: 'binsight', policy: 'fixed' });
      sim.advance(3600 * 1.2);
      const world = 'demo';
      setFeed({ city: sim.city, fleet: buildFleetFrame(sim, world, 60, true), routes: buildRoutesFrame(sim, world), events: [], source: 'demo' });
      let lastEvent = sim.events.at(-1)?.id ?? -1;
      const id = window.setInterval(() => {
        sim.advance(30);
        const fresh = sim.events.filter((e) => e.id > lastEvent);
        if (fresh.length) lastEvent = fresh[fresh.length - 1].id;
        setFeed((f) =>
          f && {
            ...f,
            fleet: buildFleetFrame(sim, world, 60, false),
            routes: f.routes?.routeVersion === sim.routeVersion ? f.routes : buildRoutesFrame(sim, world),
            events: [...f.events, ...fresh].slice(-30),
          },
        );
      }, 500);
      return () => window.clearInterval(id);
    }

    (async () => {
      const cfg = await loadLiveConfig();
      if (!isConfig(cfg)) throw new Error(`This BinSight isn’t connected to the cloud yet (${cfg.error}). Add ?demo to the address to try the crew app offline.`);
      const { control, routes } = await api<{ control: LiveControl; routes: RoutesFrame | null }>('/state');
      const city = generateCity({ seed: control.seed, bins: control.bins });
      const world = worldKey(control);
      setFeed({ city, fleet: null, routes, events: [], source: 'live' });
      const rt = await connectRealtime(cfg, [topics.fleet(cfg.city), topics.routes(cfg.city), topics.events(cfg.city)], (topic, msg) => {
        if (!msg || typeof msg !== 'object') return;
        if (topic === topics.fleet(cfg.city) && (msg as FleetFrame).world === world) setFeed((f) => f && { ...f, fleet: msg as FleetFrame });
        else if (topic === topics.routes(cfg.city) && (msg as RoutesFrame).world === world) setFeed((f) => f && { ...f, routes: msg as RoutesFrame });
        else if (topic === topics.events(cfg.city)) setFeed((f) => f && { ...f, events: [...f.events, ...(msg as LiveEvent[])].slice(-30) });
      });
      // The crew's phone keeps the fleet moving too, even with no big screen open.
      const untick = keepFleetTicking();
      stop = () => {
        untick();
        rt.close();
      };
    })().catch((e: Error) => setError(e.message));
    return () => stop();
  }, []);

  return { feed, error };
}

export function DriverApp() {
  const { feed, error } = useFeed();
  const [truckId, setTruckId] = useState(() => Number(new URLSearchParams(window.location.search).get('truck') ?? 0) || 0);

  return (
    <div className="fixed inset-0 overflow-y-auto bg-[radial-gradient(circle_at_50%_0%,#13253f_0%,#05070d_60%)] text-slate-100">
      <div className="mx-auto max-w-md px-4 pb-8 pt-5">
        <header className="mb-4 flex items-center justify-between">
          <span className="text-lg font-bold tracking-tight">
            Bin<span className="text-neon">Sight</span> <span className="text-[13px] font-medium text-slate-400">crew</span>
          </span>
          {feed && (
            <span className={`rounded-full px-2 py-0.5 font-mono text-[10.5px] ring-1 ${feed.source === 'live' ? 'text-emerald-300 ring-emerald-400/40' : 'text-amber ring-amber/40'}`}>
              {feed.source === 'live' ? 'LIVE · cloud' : 'DEMO · offline'}
            </span>
          )}
        </header>
        {error ? (
          <p className="rounded-xl bg-rose-500/10 p-4 text-[14px] text-rose-200 ring-1 ring-rose-400/30">{error}</p>
        ) : !feed ? (
          <p className="text-slate-400">Connecting…</p>
        ) : (
          <Crew feed={feed} truckId={truckId} setTruckId={setTruckId} />
        )}
      </div>
    </div>
  );
}

function Crew({ feed, truckId, setTruckId }: { feed: Feed; truckId: number; setTruckId: (n: number) => void }) {
  const trucks = feed.fleet?.trucks ?? [];
  const t = trucks.find((x) => x.id === truckId);
  const route = feed.routes?.trucks.find((x) => x.id === truckId);
  const color = TRUCK_COLORS[truckId % TRUCK_COLORS.length];
  const stops: RouteStopFrame[] = route?.stops ?? [];
  const si = t?.si ?? 0;
  const next = t && t.st !== 'idle' ? stops[si] : undefined;
  const nextNode = next ? feed.city.nodes[next.node] : undefined;
  const dist = t && nextNode ? Math.hypot(nextNode.x - t.x, nextNode.z - t.z) : null;
  const capacity = 10000;
  const binsLeft = stops.slice(si).filter((s) => s.kind === 'bin').length;
  const label = (s: RouteStopFrame) =>
    s.kind === 'bin' ? (s.binId !== undefined ? (feed.city.bins[s.binId]?.label ?? `Bin ${s.binId}`) : 'Bin') : s.kind === 'unload' ? 'Transfer station' : 'Depot';
  const mine = feed.events.filter((e) => e.truckId === truckId || e.kind === 'alert').slice(-4).reverse();

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {(trucks.length ? trucks : [{ id: 0 }]).map((x) => (
          <button
            key={x.id}
            onClick={() => setTruckId(x.id)}
            className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold ring-1 ${x.id === truckId ? 'bg-white/10 ring-white/40' : 'ring-white/10'}`}
          >
            <span className="size-2.5 rounded-full" style={{ background: TRUCK_COLORS[x.id % TRUCK_COLORS.length] }} /> Truck {x.id + 1}
          </button>
        ))}
      </div>

      <div className="rounded-2xl bg-white/[0.05] p-4 ring-1 ring-white/10">
        <div className="flex items-center gap-2 text-[13px] text-slate-400">
          <Truck size={15} style={{ color }} /> {t ? STATUS[t.st] : 'Waiting for the fleet…'}
        </div>
        <div className="mt-2 text-[12px] uppercase tracking-wider text-slate-500">Next stop</div>
        <div className="text-3xl font-bold">{next ? label(next) : t?.st === 'idle' ? 'No run assigned' : '—'}</div>
        {dist !== null && <div className="font-mono text-[15px] text-neon">{dist < 1000 ? `${Math.round(dist)} m` : `${(dist / 1000).toFixed(1)} km`} away</div>}
        <div className="mt-3 flex items-center justify-between text-[12px] text-slate-400">
          <span>Load</span>
          <span className="font-mono">{t ? Math.round(t.load).toLocaleString('en-IN') : 0} L</span>
        </div>
        <div className="mt-1 h-3 overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${Math.min(100, ((t?.load ?? 0) / capacity) * 100)}%`, background: color }} />
        </div>
        <div className="mt-2 text-[12px] text-slate-400">{binsLeft} bins left on this run</div>
      </div>

      <MiniMap city={feed.city} route={route} truck={t} color={color} />

      <div className="rounded-2xl bg-white/[0.04] p-3 ring-1 ring-white/10">
        <div className="mb-2 text-[12px] uppercase tracking-wider text-slate-500">Run sheet</div>
        <ol className="space-y-1">
          {stops.slice(Math.max(0, si - 2), si + 10).map((s, k) => {
            const idx = Math.max(0, si - 2) + k;
            const done = idx < si;
            const Icon = s.kind === 'bin' ? Trash2 : s.kind === 'unload' ? Factory : Home;
            return (
              <li key={idx} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 text-[14px] ${idx === si ? 'bg-white/10 font-semibold' : ''} ${done ? 'text-slate-500 line-through' : ''}`}>
                <Icon size={14} className={s.kind === 'unload' ? 'text-amber' : s.kind === 'depot' ? 'text-sky-300' : 'text-emerald-300'} />
                {label(s)}
              </li>
            );
          })}
          {stops.length === 0 && <li className="text-[13px] text-slate-500">No stops yet. The next shift plan will appear here.</li>}
        </ol>
      </div>

      {mine.length > 0 && (
        <div className="space-y-1 text-[12px] text-slate-400">
          {mine.map((e, i) => (
            <div key={i} className={e.kind === 'alert' ? 'text-pink-300' : ''}>
              • {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MiniMap({ city, route, truck, color }: { city: City; route?: RoutesFrame['trucks'][number]; truck?: FleetFrame['trucks'][number]; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const roads = useMemo(() => city.edges.map((e) => [city.nodes[e.a], city.nodes[e.b], e.arterial] as const), [city]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const size = c.clientWidth;
    const dpr = window.devicePixelRatio || 1;
    c.width = size * dpr;
    c.height = size * 0.75 * dpr;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    const { x0, x1, z0, z1 } = city.bounds;
    const s = Math.min((size - 16) / (x1 - x0), (size * 0.75 - 16) / (z1 - z0));
    const px = (x: number) => 8 + (x - x0) * s;
    const pz = (z: number) => 8 + (z - z0) * s;
    g.strokeStyle = 'rgba(148,163,184,0.25)';
    for (const [a, b, art] of roads) {
      g.lineWidth = art ? 1.6 : 0.8;
      g.beginPath();
      g.moveTo(px(a.x), pz(a.z));
      g.lineTo(px(b.x), pz(b.z));
      g.stroke();
    }
    if (route) {
      g.strokeStyle = color;
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(px(route.start[0]), pz(route.start[1]));
      for (const n of route.nodes) g.lineTo(px(city.nodes[n].x), pz(city.nodes[n].z));
      g.stroke();
    }
    if (truck) {
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(px(truck.x), pz(truck.z), 6, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = color;
      g.beginPath();
      g.arc(px(truck.x), pz(truck.z), 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [city, roads, route, truck, color]);
  return <canvas ref={ref} className="aspect-[4/3] w-full rounded-2xl bg-black/40 ring-1 ring-white/10" />;
}
