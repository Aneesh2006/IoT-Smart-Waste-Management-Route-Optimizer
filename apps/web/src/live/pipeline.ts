import type { HopSample } from './LiveWorld.ts';
import type { Packet } from './xrayFeed.ts';

/**
 * The cloud pipeline as the Cloud X-Ray draws it: boxes, wires, the timed hops
 * and the metric series. It is data, so a different deployment only changes this
 * file (the AWS layout lives at the aws-version tag).
 *
 *   phones / devices ─HTTPS─▶ ƒ ingest ─▶ MongoDB Atlas ─▶ Ably ─▶ browsers
 *   lazy tick (API requests, daily cron) ─▶ ƒ fleet (virtual bins + trucks) ─▶ ƒ ingest
 */
export interface PipelineNode {
  x: number;
  y: number;
  label: string;
  sub: string;
  color: string;
}

export const NODES = {
  tick: { x: 95, y: 70, label: 'Lazy tick', sub: 'API requests · cron', color: '#f472b6' },
  fleet: { x: 285, y: 70, label: 'ƒ fleet', sub: 'virtual devices', color: '#fb923c' },
  bins: { x: 95, y: 230, label: 'Smart bins', sub: 'HTTPS POST', color: '#5eead4' },
  phones: { x: 95, y: 380, label: 'Phones', sub: '/bin over HTTPS', color: '#e879f9' },
  ingest: { x: 455, y: 295, label: 'ƒ ingest', sub: 'Vercel function', color: '#fb923c' },
  inbox: { x: 455, y: 470, label: 'Inbox', sub: 'retries · pause', color: '#f472b6' },
  dlq: { x: 625, y: 540, label: 'Dead letters', sub: 'after 3 tries', color: '#fb7185' },
  mongo: { x: 625, y: 130, label: 'MongoDB Atlas', sub: 'bins · readings', color: '#4ade80' },
  hook: { x: 795, y: 130, label: 'Webhook', sub: 'fire alerts', color: '#f472b6' },
  ably: { x: 795, y: 295, label: 'Ably', sub: 'pub/sub', color: '#a3e635' },
  web: { x: 1135, y: 295, label: 'This screen', sub: 'Ably over WSS', color: '#5eead4' },
  apiFn: { x: 965, y: 455, label: 'ƒ api', sub: 'state · metrics', color: '#fb923c' },
  auth: { x: 1135, y: 455, label: 'Auth', sub: 'operator · tokens', color: '#f87171' },
} as const satisfies Record<string, PipelineNode>;

export type NodeKey = keyof typeof NODES;

/** Wires between boxes; `true` marks the quiet ones (control paths, failures). */
export const EDGES: [NodeKey, NodeKey, boolean?][] = [
  ['tick', 'fleet'],
  ['fleet', 'ingest'],
  ['bins', 'ingest'],
  ['phones', 'ingest'],
  ['ingest', 'mongo'],
  ['ingest', 'inbox', true],
  ['inbox', 'dlq', true],
  ['ingest', 'hook', true],
  ['ingest', 'ably'],
  ['ably', 'web'],
  ['ably', 'phones', true],
  ['web', 'apiFn', true],
  ['apiFn', 'mongo', true],
  ['auth', 'web', true],
];

/** The measured hops, in order; each is a difference of two timestamps the pipeline stamps on a batch. */
export const HOPS: { key: string; label: string; color: string; ms: (h: HopSample) => number }[] = [
  { key: 'r', label: 'device → ƒ ingest', color: '#5eead4', ms: (h) => h.tReceived - h.tDevice },
  { key: 's', label: 'ƒ ingest → MongoDB', color: '#4ade80', ms: (h) => h.tStored - h.tReceived },
  { key: 'p', label: 'store → Ably', color: '#fb923c', ms: (h) => h.tPublish - h.tStored },
  { key: 'b', label: 'Ably → this screen', color: '#38bdf8', ms: (h) => h.tBrowser - h.tPublish },
];

/** The path a batch's particle flies, leg by leg, each leg as long as its measured hop (slowed down). */
export function legsFor(p: Packet, seg: (ms: number) => number): { a: NodeKey; b: NodeKey; dur: number }[] {
  const h = p.hops;
  const store = Math.max(0, h.tStored - h.tReceived) / 2;
  const legs: { a: NodeKey; b: NodeKey; dur: number }[] = [];
  if (p.kind === 'fleet') legs.push({ a: 'fleet', b: 'ingest', dur: seg(h.tReceived - h.tDevice) });
  else legs.push({ a: 'phones', b: 'ingest', dur: seg(h.tReceived - h.tDevice) });
  legs.push(
    { a: 'ingest', b: 'mongo', dur: seg(store) },
    { a: 'mongo', b: 'ingest', dur: seg(store) },
    { a: 'ingest', b: 'ably', dur: seg(h.tPublish - h.tStored) },
    { a: 'ably', b: 'web', dur: seg(h.tBrowser - h.tPublish) },
  );
  return legs;
}

const gauss = (mean: number, sd: number) => {
  const u = 1 - Math.random();
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

/** Sandbox stand-in: typical hop timings (a phone's HTTPS POST, an Atlas write, Ably fan-out), modelled. */
export function syntheticHops(batch: number): HopSample {
  const t0 = Date.now() - 500;
  const tReceived = t0 + Math.max(25, gauss(70, 20));
  const tStored = tReceived + Math.max(8, gauss(35, 10));
  const tPublish = tStored + Math.max(10, gauss(40, 12));
  const tBrowser = tPublish + Math.max(20, gauss(60, 20));
  return { tDevice: t0, tReceived, tStored, tPublish, tBrowser, batch };
}

/** Counter series from /api/metrics shown as sparklines. */
export const METRIC_SERIES = [
  ['readings', 'Readings ingested /min', '#5eead4'],
  ['ingestRuns', 'Ingest runs /min', '#fb923c'],
  ['ingestAvgMs', 'Ingest duration ms', '#fbbf24'],
  ['writes', 'MongoDB writes /min', '#4ade80'],
  ['published', 'Ably publishes /min', '#a3e635'],
  ['ticks', 'Fleet ticks /min', '#f472b6'],
] as const;

export const PIPELINE_TEXT = {
  title: 'Every reading’s trip through the cloud',
  measuredTitle: 'Timestamps stamped by the device, the ingest function, MongoDB and Ably',
  hops: 'four cloud hops',
  biggest: 'The Atlas write and the Ably fan-out are the usual big slices; a phone’s first HTTPS request also pays for a cold function.',
  metricsEyebrow: 'Pipeline counters',
  metricsNote: 'Per-minute counters kept in MongoDB; inbox depth is read live.',
  metricsSandbox: 'Live mode pulls ingest, MongoDB, Ably and tick counters here.',
};
