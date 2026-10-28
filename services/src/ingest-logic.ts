import { binStatus, type BinStatus, type Hops, type IngestMessage, type Telemetry } from '@binsight/core';

/**
 * Pure parts of the ingest pipeline, kept free of MongoDB and Ably so they can be unit tested.
 */
export interface Incoming {
  msg: IngestMessage;
}

const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(hi, Math.max(lo, n));
};

/** Validate and normalise one reading. Anything a phone sends is untrusted. */
export function parseMessage(body: string | Record<string, unknown>): IngestMessage | null {
  let raw: Record<string, unknown>;
  try {
    raw = typeof body === 'string' ? JSON.parse(body) : body;
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const id = typeof raw.binId === 'string' ? raw.binId : typeof raw.id === 'string' ? raw.id : null;
  const city = typeof raw.city === 'string' ? raw.city : null;
  if (!id || !city || id.length > 80 || city.length > 40) return null;
  const kind = id.startsWith('p-') ? 'phone' : 'fleet';
  const now = Date.now();
  const msg: IngestMessage = {
    id,
    city,
    kind,
    r: clamp(raw.r, 0, 1.3, 0),
    ok: raw.ok !== false,
    temp: clamp(raw.temp, -20, 150, 28),
    gas: clamp(raw.gas, 0, 5000, 20),
    bat: clamp(raw.bat, 0, 100, 100),
    tDevice: clamp(raw.tDevice, now - 3600_000, now + 60_000, now),
    tReceived: clamp(raw.tReceived, 0, now + 60_000, now),
  };
  if (typeof raw.simT === 'number') msg.simT = raw.simT;
  if (kind === 'fleet' && typeof raw.world === 'string') msg.world = raw.world.slice(0, 80);
  if (kind === 'phone') {
    if (typeof raw.nick === 'string') msg.nick = raw.nick.replace(/[<>]/g, '').slice(0, 20);
    if (typeof raw.emoji === 'string') msg.emoji = [...raw.emoji].slice(0, 2).join('');
    if (raw.event === 'collected') msg.event = 'collected';
    if (typeof raw.score === 'number') msg.score = clamp(raw.score, 0, 1e6, 0);
  }
  return msg;
}

/** Keep the newest reading per bin; batches often carry several from one device. */
export function latestPerBin(items: Incoming[]): Incoming[] {
  const best = new Map<string, Incoming>();
  for (const it of items) {
    const key = `${it.msg.city}/${it.msg.id}`;
    const prev = best.get(key);
    if (!prev || prev.msg.tDevice <= it.msg.tDevice) best.set(key, it);
  }
  return [...best.values()];
}

/**
 * MongoDB upsert that sets every field of `item` except the keys, but only if it
 * is newer than what is stored (two ingest runs can deliver out of order). When a
 * newer reading is already there the filter misses, the upsert tries to insert a
 * second row and the unique (city, bin) index rejects it: callers treat that
 * duplicate-key error as "keep what's stored". `$set`, not a replace, so fields
 * like fireAlertAt survive.
 */
export function latestUpdate(item: Record<string, unknown> & { city: string; bin: string; tDevice: number }) {
  const set: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item)) if (k !== 'city' && k !== 'bin' && v !== undefined) set[k] = v;
  return {
    filter: { city: item.city, bin: item.bin, $or: [{ tDevice: { $exists: false } }, { tDevice: { $lte: item.tDevice } }] },
    update: { $set: set },
  };
}

export function withStatus(t: Telemetry): Telemetry & { status: BinStatus } {
  return { ...t, status: binStatus(t) };
}

/** Hops of the oldest message in the batch: the worst case the X-Ray shows. */
export function oldestHops(items: Incoming[], tStored: number, tPublish: number): Hops {
  const oldest = items.reduce((a, b) => (b.msg.tDevice < a.msg.tDevice ? b : a));
  return {
    tDevice: oldest.msg.tDevice,
    tReceived: oldest.msg.tReceived,
    tStored,
    tPublish,
  };
}

/** A phone bin asks for a truck at 80%, and again only if the last dispatch went stale. */
export const PHONE_DISPATCH_AT = 0.8;
export const DISPATCH_STALE_MS = 3 * 60_000;

export function truckFor(id: string, trucks = 4) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Truck ${(h % trucks) + 1}`;
}
