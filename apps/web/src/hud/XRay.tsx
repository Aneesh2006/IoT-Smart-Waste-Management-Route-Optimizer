import { Radar, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { PRICES, pipelineCost } from '../lib/pricing.ts';
import { LiveWorld, type HopSample } from '../live/LiveWorld.ts';
import { emitPacket, onPacket, recentPackets, type Packet } from '../live/xrayFeed.ts';
import { useApp } from '../state/store.ts';
import { Sparkline } from './Sparkline.tsx';
import { IconButton, Panel } from './ui.tsx';

type NodeKey = keyof typeof NODES;

const NODES = {
  sched: { x: 95, y: 70, label: 'EventBridge', sub: 'every minute', color: '#f472b6' },
  fleet: { x: 285, y: 70, label: 'λ fleet', sub: 'virtual devices', color: '#fb923c' },
  bins: { x: 95, y: 230, label: 'Smart bins', sub: 'MQTT publish', color: '#5eead4' },
  phones: { x: 95, y: 360, label: 'Phones', sub: '/bin over WSS', color: '#e879f9' },
  iot: { x: 285, y: 295, label: 'IoT Core', sub: 'MQTT broker', color: '#a3e635' },
  rule: { x: 455, y: 295, label: 'IoT Rule', sub: 'SQL → SQS', color: '#a3e635' },
  sqs: { x: 625, y: 295, label: 'SQS', sub: 'buffer queue', color: '#f472b6' },
  dlq: { x: 625, y: 430, label: 'Dead letters', sub: 'after 3 tries', color: '#fb7185' },
  ingest: { x: 795, y: 295, label: 'λ ingest', sub: 'store + fan-out', color: '#fb923c' },
  ddb: { x: 795, y: 130, label: 'DynamoDB', sub: 'Bins · Readings', color: '#818cf8' },
  sns: { x: 965, y: 130, label: 'SNS', sub: 'fire alerts', color: '#f472b6' },
  pub: { x: 965, y: 295, label: 'IoT Core', sub: 'publish', color: '#a3e635' },
  web: { x: 1135, y: 295, label: 'This screen', sub: 'MQTT over WSS', color: '#5eead4' },
  api: { x: 965, y: 455, label: 'API Gateway', sub: 'HTTP API', color: '#f472b6' },
  apiFn: { x: 795, y: 455, label: 'λ api', sub: 'state · metrics', color: '#fb923c' },
  cw: { x: 625, y: 540, label: 'CloudWatch', sub: 'metrics', color: '#c084fc' },
  cognito: { x: 1135, y: 455, label: 'Cognito', sub: 'guests · operators', color: '#f87171' },
} as const;

const EDGES: [NodeKey, NodeKey, boolean?][] = [
  ['sched', 'fleet'],
  ['fleet', 'iot'],
  ['bins', 'iot'],
  ['phones', 'iot'],
  ['iot', 'rule'],
  ['rule', 'sqs'],
  ['sqs', 'dlq', true],
  ['sqs', 'ingest'],
  ['ingest', 'ddb'],
  ['ingest', 'sns', true],
  ['ingest', 'pub'],
  ['pub', 'web'],
  ['pub', 'phones', true],
  ['web', 'api', true],
  ['api', 'apiFn', true],
  ['apiFn', 'ddb', true],
  ['apiFn', 'cw', true],
  ['cognito', 'web', true],
];

const HOPS: { key: string; label: string; color: string; ms: (h: HopSample) => number }[] = [
  { key: 'd', label: 'device → IoT rule', color: '#5eead4', ms: (h) => h.tRule - h.tDevice },
  { key: 'q', label: 'rule → SQS', color: '#a3e635', ms: (h) => h.tQueue - h.tRule },
  { key: 'l', label: 'SQS → Lambda', color: '#f472b6', ms: (h) => h.tLambda - h.tQueue },
  { key: 's', label: 'Lambda → DynamoDB', color: '#818cf8', ms: (h) => h.tStored - h.tLambda },
  { key: 'p', label: 'store → publish', color: '#fb923c', ms: (h) => h.tPublish - h.tStored },
  { key: 'b', label: 'IoT → this screen', color: '#38bdf8', ms: (h) => h.tBrowser - h.tPublish },
];

const SLOW = 4;
const seg = (ms: number) => Math.min(2400, Math.max(200, ms * SLOW));

interface Flight {
  packet: Packet;
  start: number;
  legs: { a: NodeKey; b: NodeKey; dur: number }[];
  total: number;
}

function legsFor(p: Packet): Flight['legs'] {
  const h = p.hops;
  const src: NodeKey = p.kind === 'phone' ? 'phones' : 'bins';
  const store = Math.max(0, h.tStored - h.tLambda) / 2;
  return [
    { a: src, b: 'iot', dur: seg(h.tRule - h.tDevice) },
    { a: 'iot', b: 'rule', dur: 220 },
    { a: 'rule', b: 'sqs', dur: seg(h.tQueue - h.tRule) },
    { a: 'sqs', b: 'ingest', dur: seg(h.tLambda - h.tQueue) },
    { a: 'ingest', b: 'ddb', dur: seg(store) },
    { a: 'ddb', b: 'ingest', dur: seg(store) },
    { a: 'ingest', b: 'pub', dur: seg(h.tPublish - h.tStored) },
    { a: 'pub', b: 'web', dur: seg(h.tBrowser - h.tPublish) },
  ];
}

const gauss = (mean: number, sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Sandbox stand-in: modelled hop timings for the local simulation's sensor batches. */
function syntheticHops(batch: number): HopSample {
  const t0 = Date.now() - 600;
  const tRule = t0 + Math.max(15, gauss(42, 9));
  const tQueue = tRule + Math.max(4, gauss(16, 5));
  const tLambda = tQueue + Math.max(15, gauss(85, 35));
  const tStored = tLambda + Math.max(8, gauss(38, 10));
  const tPublish = tStored + Math.max(5, gauss(22, 6));
  const tBrowser = tPublish + Math.max(20, gauss(70, 25));
  return { tDevice: t0, tRule, tQueue, tLambda, tStored, tPublish, tBrowser, batch };
}

export function XRay() {
  const open = useApp((s) => s.xrayOpen);
  if (!open) return null;
  return <XRayPanel />;
}

function XRayPanel() {
  const mode = useApp((s) => s.mode);
  const sim = useApp((s) => s.sim);
  const [flights, setFlights] = useState<Flight[]>([]);
  const [, force] = useState(0);
  const [picked, setPicked] = useState<Packet | null>(null);
  const [cityBins, setCityBins] = useState(10000);
  const flightsRef = useRef<Flight[]>([]);
  const rate = useRef<{ t: number; n: number }[]>([]);
  const [metrics, setMetrics] = useState<null | { series: Record<string, { t: number[]; v: number[] }>; queue: { visible: number; inFlight: number; dlq: number } }>(null);
  const live = mode === 'live';

  // Packets → flights.
  useEffect(
    () =>
      onPacket((p) => {
        const legs = legsFor(p);
        flightsRef.current = [...flightsRef.current.slice(-24), { packet: p, start: performance.now(), legs, total: legs.reduce((s, l) => s + l.dur, 0) }];
        const n = p.kind === 'fleet' ? Math.max(1, (p.payload as { bins?: unknown[] })?.bins?.length ?? p.hops.batch) : 1;
        rate.current.push({ t: Date.now(), n });
      }),
    [],
  );

  // Sandbox: when the local sensors sample, model every batch of ten readings going through.
  useEffect(() => {
    if (live) return;
    let lastSample = Math.floor(sim.time / 900);
    const queue: number[] = [];
    const id = window.setInterval(() => {
      const sample = Math.floor(sim.time / 900);
      if (sample !== lastSample && queue.length === 0) {
        lastSample = sample;
        const batches = Math.min(12, Math.ceil(sim.bins.length / 10));
        for (let k = 0; k < batches; k++) queue.push(k);
      }
      const k = queue.shift();
      if (k === undefined) return;
      const picks = sim.bins.slice(k * 10, k * 10 + 10);
      if (!picks.length) return;
      emitPacket({
        kind: 'fleet',
        label: `${sim.city.bins[picks[0].id].label} +${picks.length - 1}`,
        payload: { bins: picks.map((b) => ({ id: String(b.id), kind: 'fleet', r: +b.reading.toFixed(3), temp: +b.temperature.toFixed(1), gas: Math.round(b.gas), ok: b.sensorOk })) },
        hops: syntheticHops(picks.length),
        simulated: true,
      });
    }, 140);
    return () => window.clearInterval(id);
  }, [live, sim]);

  // Animation clock.
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const now = performance.now();
      flightsRef.current = flightsRef.current.filter((f) => now - f.start < f.total + 300);
      setFlights([...flightsRef.current]);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    const slow = window.setInterval(() => force((x) => x + 1), 1000);
    return () => {
      cancelAnimationFrame(id);
      window.clearInterval(slow);
    };
  }, []);

  // Live: CloudWatch through the API every 15 s.
  useEffect(() => {
    if (!live) return;
    let alive = true;
    const pull = async () => {
      const [{ liveConfig }, { api }] = await Promise.all([import('../live/session.ts'), import('../live/aws.ts')]);
      const cfg = liveConfig();
      if (!cfg) return;
      const m = await api<NonNullable<typeof metrics>>(cfg, '/metrics').catch(() => null);
      if (alive && m) setMetrics(m);
    };
    void pull();
    const id = window.setInterval(() => void pull(), 15_000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [live]);

  const now = Date.now();
  rate.current = rate.current.filter((r) => now - r.t < 60_000);
  const perMin = rate.current.reduce((s, r) => s + r.n, 0);
  const packets = recentPackets().slice(-9).reverse();
  const hops = packets.map((p) => p.hops);
  const avg = HOPS.map((h) => (hops.length ? hops.reduce((s, x) => s + h.ms(x), 0) / hops.length : 0));
  const total = avg.reduce((a, b) => a + b, 0);
  const scale = Math.max(400, ...hops.map((h) => h.tBrowser - h.tDevice));
  const phones = sim instanceof LiveWorld ? sim.phones.size : 0;
  const demo = pipelineCost(perMin * 60 * 24 * 30);
  const city = pipelineCost(cityBins * 4 * 24 * 30);
  const usd = (v: number) => (v < 0.01 ? `$${v.toFixed(4)}` : v < 10 ? `$${v.toFixed(2)}` : `$${Math.round(v).toLocaleString('en-IN')}`);

  const badge: Partial<Record<NodeKey, string>> = {
    bins: `${sim.bins.length} sensors`,
    phones: `${phones} joined`,
    iot: `${perMin}/min`,
    sqs: metrics ? `depth ${metrics.queue.visible + metrics.queue.inFlight}` : live ? '…' : 'depth 0',
    dlq: metrics ? `${metrics.queue.dlq}` : '0',
    ingest: `${Math.max(1, Math.round(perMin / 10))} runs/min`,
    ddb: `${perMin * 2} writes/min`,
    web: hops.length ? `${Math.round(total)} ms` : '…',
  };

  return (
    <div className="pointer-events-auto fixed inset-0 z-50 grid place-items-center bg-black/60 p-3 backdrop-blur-sm" onClick={() => useApp.getState().setXrayOpen(false)}>
      <Panel className="flex h-full max-h-[920px] w-full max-w-[1400px] flex-col overflow-hidden">
        <div className="flex min-h-0 flex-1 flex-col" onClick={(e) => e.stopPropagation()}>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/5 px-5 py-3">
            <div>
              <div className="eyebrow flex items-center gap-1.5">
                <Radar size={12} /> Cloud X-Ray
              </div>
              <h2 className="text-lg font-bold">Every reading’s trip through AWS</h2>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full px-2.5 py-1 font-mono text-[11px] ring-1 ${live ? 'bg-emerald-400/10 text-emerald-300 ring-emerald-400/40' : 'bg-amber/10 text-amber ring-amber/40'}`}
                title={live ? 'Timestamps stamped by IoT Core, SQS and Lambda' : 'Typical timings, modelled. Switch to Live to measure real ones.'}
              >
                {live ? 'LIVE · measured' : 'SANDBOX · modelled timings'}
              </span>
              <IconButton onClick={() => useApp.getState().setXrayOpen(false)} title="Close (Esc)">
                <X size={15} />
              </IconButton>
            </div>
          </div>

          <div className="scroll-thin grid min-h-0 flex-1 grid-cols-1 overflow-y-auto xl:grid-cols-[1fr_340px]">
            <div className="min-w-0 p-3">
              <svg viewBox="0 0 1230 590" className="w-full">
                <defs>
                  <filter id="xr-glow" x="-50%" y="-50%" width="200%" height="200%">
                    <feGaussianBlur stdDeviation="3" result="b" />
                    <feMerge>
                      <feMergeNode in="b" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>
                </defs>
                {EDGES.map(([a, b, quiet]) => (
                  <line
                    key={`${a}-${b}`}
                    x1={NODES[a].x}
                    y1={NODES[a].y}
                    x2={NODES[b].x}
                    y2={NODES[b].y}
                    stroke={quiet ? 'rgba(148,163,184,0.18)' : 'rgba(94,234,212,0.28)'}
                    strokeWidth={quiet ? 1.5 : 2.5}
                    strokeDasharray={quiet ? '5 6' : undefined}
                  />
                ))}
                {flights.map((f) => {
                  const t = performance.now() - f.start;
                  let acc = 0;
                  for (const leg of f.legs) {
                    if (t < acc + leg.dur) {
                      const k = (t - acc) / leg.dur;
                      const A = NODES[leg.a];
                      const B = NODES[leg.b];
                      const x = A.x + (B.x - A.x) * k;
                      const y = A.y + (B.y - A.y) * k;
                      const color = f.packet.kind === 'phone' ? '#f0abfc' : '#5eead4';
                      return (
                        <g key={f.packet.id} filter="url(#xr-glow)" style={{ cursor: 'pointer' }} onClick={() => setPicked(f.packet)}>
                          <line x1={x - (B.x - A.x) * 0.06} y1={y - (B.y - A.y) * 0.06} x2={x} y2={y} stroke={color} strokeWidth={4} strokeLinecap="round" opacity={0.5} />
                          <circle cx={x} cy={y} r={6} fill={color} />
                        </g>
                      );
                    }
                    acc += leg.dur;
                  }
                  return null;
                })}
                {(Object.keys(NODES) as NodeKey[]).map((k) => {
                  const n = NODES[k];
                  return (
                    <g key={k} transform={`translate(${n.x - 68} ${n.y - 30})`}>
                      <rect width={136} height={60} rx={12} fill="#0b1220" stroke={n.color} strokeOpacity={0.7} strokeWidth={1.5} />
                      <rect width={136} height={60} rx={12} fill={n.color} fillOpacity={0.08} />
                      <text x={68} y={25} textAnchor="middle" className="fill-slate-100 text-[14px] font-semibold">
                        {n.label}
                      </text>
                      <text x={68} y={43} textAnchor="middle" className="fill-slate-400 text-[11px]">
                        {n.sub}
                      </text>
                      {badge[k] && (
                        <g transform="translate(68 -10)">
                          <rect x={-46} y={-9} width={92} height={18} rx={9} fill={n.color} fillOpacity={0.9} />
                          <text y={4} textAnchor="middle" className="fill-[#05070d] font-mono text-[10.5px] font-bold">
                            {badge[k]}
                          </text>
                        </g>
                      )}
                    </g>
                  );
                })}
                <text x={20} y={580} className="fill-slate-500 text-[11px]">
                  Particles are slowed {SLOW}× so you can follow them; the numbers are real milliseconds. Click one to see its payload.
                </text>
              </svg>

              <div className="mt-2 rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="eyebrow">Hop by hop, last {packets.length} batches</div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {HOPS.map((h, i) => (
                      <span key={h.key} className="flex items-center gap-1 text-[10.5px] text-slate-400">
                        <span className="size-2 rounded-sm" style={{ background: h.color }} />
                        {h.label} <span className="font-mono text-slate-300">{Math.round(avg[i])}</span>
                      </span>
                    ))}
                  </div>
                </div>
                <div className="space-y-1">
                  {packets.map((p) => {
                    const t = p.hops.tBrowser - p.hops.tDevice;
                    return (
                      <button key={p.id} onClick={() => setPicked(p)} className="flex w-full items-center gap-2 rounded px-1 text-left hover:bg-white/5">
                        <span className="w-32 truncate text-[11px] text-slate-300">{p.label}</span>
                        <span className="flex h-3 flex-1 overflow-hidden rounded-full bg-white/5">
                          {HOPS.map((h) => (
                            <span key={h.key} style={{ width: `${(Math.max(0, h.ms(p.hops)) / scale) * 100}%`, background: h.color }} />
                          ))}
                        </span>
                        <span className="w-16 text-right font-mono text-[11px] text-slate-200">{Math.round(t)} ms</span>
                      </button>
                    );
                  })}
                  {packets.length === 0 && <p className="text-[11.5px] text-slate-500">{live ? 'Waiting for the next sensor batch…' : 'Press play: batches appear when the sensors sample.'}</p>}
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-white/5 p-4 xl:border-l xl:border-t-0">
              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <div className="eyebrow mb-1">Real-time ≠ instant</div>
                <div className="tabular font-mono text-3xl font-bold text-neon">{hops.length ? `${Math.round(total)} ms` : '—'}</div>
                <p className="text-[11.5px] leading-snug text-slate-400">
                  From a bin’s sensor to this screen, through six AWS hops. SQS → Lambda is usually the biggest slice: the price of a buffer that never loses a reading.
                </p>
              </div>

              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <div className="eyebrow mb-2">CloudWatch</div>
                {live && metrics ? (
                  <div className="space-y-2">
                    {(
                      [
                        ['ruleMatches', 'IoT rule matches /min', '#a3e635'],
                        ['sqsDepth', 'SQS queue depth', '#f472b6'],
                        ['ingestInv', 'Ingest invocations /min', '#fb923c'],
                        ['ingestDur', 'Ingest duration ms', '#fbbf24'],
                        ['ingestConc', 'Ingest concurrency', '#f87171'],
                        ['readingsWcu', 'DynamoDB writes /min', '#818cf8'],
                      ] as const
                    ).map(([id, label, color]) => {
                      const v = metrics.series[id]?.v ?? [];
                      return (
                        <div key={id}>
                          <div className="flex justify-between text-[10.5px] text-slate-400">
                            <span>{label}</span>
                            <span className="font-mono text-slate-200">{v.length ? Math.round(v[v.length - 1]) : '–'}</span>
                          </div>
                          <Sparkline values={v.length > 1 ? v : [0, 0]} color={color} height={22} />
                        </div>
                      );
                    })}
                    <p className="text-[10px] text-slate-500">CloudWatch lags a minute or two; queue depth is read live from SQS.</p>
                  </div>
                ) : (
                  <p className="text-[11.5px] text-slate-500">{live ? 'Loading metrics…' : 'Live mode pulls Lambda, SQS, IoT and DynamoDB metrics here.'}</p>
                )}
              </div>

              <div className="rounded-xl bg-white/[0.03] p-3 ring-1 ring-white/5">
                <div className="eyebrow mb-1">Serverless ≠ free</div>
                <div className="flex items-baseline justify-between text-[12px] text-slate-300">
                  <span>This demo, if it ran all month</span>
                  <span className="font-mono font-semibold text-slate-100">{usd(demo.total)}</span>
                </div>
                <div className="mt-3 text-[12px] text-slate-300">A real city, every bin reporting every 15 min:</div>
                <input type="range" min={2} max={5} step={0.01} value={Math.log10(cityBins)} onChange={(e) => setCityBins(Math.round(10 ** +e.target.value))} className="w-full" />
                <div className="flex items-baseline justify-between">
                  <span className="font-mono text-[12px] text-slate-400">{cityBins.toLocaleString('en-IN')} bins</span>
                  <span className="font-mono text-lg font-bold text-amber">
                    {usd(city.total)}
                    <span className="text-[11px] text-slate-400">/month</span>
                  </span>
                </div>
                <div className="text-right font-mono text-[11px] text-slate-500">≈ ₹{Math.round(city.total * PRICES.usdToInr).toLocaleString('en-IN')}</div>
                <div className="mt-2 grid grid-cols-5 gap-1 text-center text-[9.5px] text-slate-500">
                  {(
                    [
                      ['IoT', city.iot],
                      ['Rules', city.rules],
                      ['SQS', city.sqs],
                      ['λ', city.lambda],
                      ['DDB', city.dynamo],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k} className="rounded bg-black/30 py-1">
                      <div className="font-mono text-[10.5px] text-slate-200">{usd(v)}</div>
                      {k}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[10px] leading-snug text-slate-500">Approximate list prices, three dashboards watching. Check aws.amazon.com/pricing before quoting.</p>
              </div>

              {picked && (
                <div className="rounded-xl bg-black/40 p-3 ring-1 ring-white/10">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="eyebrow">Payload · {picked.label}</span>
                    <button onClick={() => setPicked(null)} className="text-[11px] text-slate-400 hover:text-slate-200">
                      close
                    </button>
                  </div>
                  <pre className="scroll-thin max-h-56 overflow-auto font-mono text-[10.5px] leading-snug text-slate-300">
                    {JSON.stringify({ hops: picked.hops, payload: picked.payload }, null, 2).slice(0, 2400)}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
