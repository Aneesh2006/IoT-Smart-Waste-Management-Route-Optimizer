import { topics, type Alert, type IngestMessage, type PhoneCommand, type StateUpdate } from '@binsight/core';
import type { AnyBulkWriteOperation } from 'mongodb';
import { db, isDuplicateKey, type BinDoc, type InboxDoc, type ReadingDoc } from './db.ts';
import {
  DISPATCH_STALE_MS,
  PHONE_DISPATCH_AT,
  latestPerBin,
  latestUpdate,
  oldestHops,
  parseMessage,
  truckFor,
  withStatus,
  type Incoming,
} from './ingest-logic.ts';
import { bump } from './metrics.ts';
import { publish } from './realtime.ts';
import { env, loadControl, pool } from './shared.ts';

/**
 * Every sensor reading in the city passes through here: store the latest state
 * and a history row in MongoDB, raise alerts, dispatch trucks to phone bins, and
 * broadcast the batch to every browser over Ably.
 *
 * Phones POST to /api/ingest and the fleet tick calls ingestBatch() in-process.
 * Readings that can't be ingested right now (ingest paused, or a failed run) wait
 * in the `inbox` collection, which the next fleet tick drains; after three failed
 * tries they move to `deadLetters`. That is the job SQS and its DLQ did on AWS.
 */
const READING_TTL_MS = 3 * 24 * 3600_000;
const PHONE_TTL_MS = 24 * 3600_000;
export const MAX_ATTEMPTS = 3;
export const BATCH = 25;
/** A failed batch waits this long per attempt before the next try (SQS's visibility timeout). */
export const RETRY_MS = 10_000;

/** Store and broadcast one batch. Throws if storing fails, so the caller can queue it for another try. */
export async function ingestBatch(incoming: Incoming[], now = Date.now()) {
  if (!incoming.length) return;
  const col = await db();
  const latest = latestPerBin(incoming);
  const byCity = new Map<string, Incoming[]>();
  for (const it of latest) byCity.set(it.msg.city, [...(byCity.get(it.msg.city) ?? []), it]);
  let writes = 0;

  for (const [city, items] of byCity) {
    const fleet = items.filter((i) => i.msg.kind === 'fleet');
    const phones = items.filter((i) => i.msg.kind === 'phone');
    const expiresAt = new Date(now + READING_TTL_MS);

    // Latest state per fleet bin, newer readings only.
    if (fleet.length) {
      const ops: AnyBulkWriteOperation<BinDoc>[] = fleet.map((i) => {
        const { filter, update } = latestUpdate(binItem(i, now));
        return { updateOne: { filter, update, upsert: true } };
      });
      // A duplicate key means a newer reading is already stored; the rest still apply (unordered).
      await col.bins.bulkWrite(ops, { ordered: false }).catch(ignoreDuplicates);
      writes += ops.length;
    }

    // History rows. Unique (bin, t), so a retried batch doesn't double up.
    const rows: ReadingDoc[] = incoming
      .filter((i) => i.msg.city === city)
      .map((i) => ({ bin: `${city}#${i.msg.id}`, t: i.msg.tDevice, r: i.msg.r, temp: i.msg.temp, gas: i.msg.gas, expiresAt }));
    if (rows.length) {
      await col.readings.insertMany(rows, { ordered: false }).catch(ignoreDuplicates);
      writes += rows.length;
    }

    // Phones are few: update them one by one so we can see what changed.
    const alerts: Alert[] = [];
    await pool(phones, 4, async (i) => alerts.push(...(await handlePhone(city, i, now))));
    writes += phones.length;
    const tStored = Date.now();

    for (const i of items) {
      if (i.msg.ok && i.msg.temp > 60) {
        const fresh = await claimAlert(city, i.msg.id, 'fireAlertAt', 30 * 60_000, now);
        if (fresh) alerts.push({ kind: 'fire', binId: i.msg.id, text: `Fire in bin ${label(i)}: ${Math.round(i.msg.temp)} °C`, wallT: now });
      }
    }

    const update: StateUpdate = {
      bins: items.map((i) => withStatus(i.msg)),
      hops: oldestHops(items, tStored, Date.now()),
      batch: incoming.length,
    };
    await publish(topics.state(city), update);
    for (const a of alerts) await publish(topics.alerts(city), a);
    await notify(alerts.filter((a) => a.kind === 'fire'));
    await bump({ published: 1 + alerts.length }, now, city);
  }
  await bump({ readings: incoming.length, ingestRuns: 1, ingestMs: Date.now() - now, writes }, now);
}

function ignoreDuplicates(e: unknown) {
  const errors = (e as { writeErrors?: { code?: number }[] | { code?: number } }).writeErrors;
  const list = Array.isArray(errors) ? errors : errors ? [errors] : [];
  if (isDuplicateKey(e) || (list.length && list.every((w) => w.code === 11000))) return;
  throw e;
}

function binItem(i: Incoming, now: number) {
  const m = withStatus(i.msg);
  return { ...m, city: i.msg.city, bin: i.msg.id, lastSeen: now };
}

const label = (i: Incoming) => (i.msg.kind === 'phone' ? `${i.msg.emoji ?? ''} ${i.msg.nick ?? 'phone'}`.trim() : `#${i.msg.id}`);

async function handlePhone(city: string, i: Incoming, now: number): Promise<Alert[]> {
  const col = await db();
  let old: Pick<BinDoc, 'dispatchAt'> | null;
  try {
    old = await col.bins.findOneAndUpdate(
      // Newer readings only; a phone that leaves is deleted by the TTL index a day later.
      { city, bin: i.msg.id, $or: [{ tDevice: { $exists: false } }, { tDevice: { $lte: i.msg.tDevice } }] },
      {
        $set: {
          id: i.msg.id,
          kind: 'phone',
          r: i.msg.r,
          ok: i.msg.ok,
          temp: i.msg.temp,
          gas: i.msg.gas,
          bat: i.msg.bat,
          tDevice: i.msg.tDevice,
          tReceived: i.msg.tReceived,
          lastSeen: now,
          nick: i.msg.nick ?? 'Guest',
          emoji: i.msg.emoji ?? '🗑️',
          status: withStatus(i.msg).status,
          score: i.msg.score ?? 0,
          expiresAt: new Date(now + PHONE_TTL_MS),
        } as Partial<BinDoc>,
      },
      { upsert: true, returnDocument: 'before', projection: { _id: 0, dispatchAt: 1 } },
    );
  } catch (e) {
    // A newer reading from this phone is already stored.
    if (isDuplicateKey(e)) return [];
    throw e;
  }
  const alerts: Alert[] = [];
  const who = label(i);
  if (!old) alerts.push({ kind: 'joined', binId: i.msg.id, text: `${who} joined the city as a smart bin`, wallT: now });

  if (i.msg.event === 'collected') {
    await col.bins.updateOne({ city, bin: i.msg.id }, { $unset: { dispatchAt: '' } });
    alerts.push({ kind: 'collected', binId: i.msg.id, text: `${who}'s bin emptied`, wallT: now });
  } else if (i.msg.r >= PHONE_DISPATCH_AT && (!old?.dispatchAt || now - old.dispatchAt > DISPATCH_STALE_MS)) {
    const claimed = await claimAlert(city, i.msg.id, 'dispatchAt', DISPATCH_STALE_MS, now);
    if (claimed) {
      const truck = truckFor(i.msg.id);
      const cmd: PhoneCommand = { type: 'dispatch', truck, eta: 20, text: `${truck} is on its way` };
      await publish(topics.phoneCmd(city, i.msg.id), cmd);
      alerts.push({ kind: 'dispatch', binId: i.msg.id, text: `${truck} dispatched to ${who} (${Math.round(i.msg.r * 100)}% full)`, wallT: now });
    }
  }
  return alerts;
}

/** Set `field` = now unless it was set within `windowMs`; true if we won. Dedupes alerts across retries. */
async function claimAlert(city: string, bin: string, field: 'fireAlertAt' | 'dispatchAt', windowMs: number, now: number) {
  const col = await db();
  const res = await col.bins.updateOne(
    { city, bin, $or: [{ [field]: { $exists: false } }, { [field]: { $lt: now - windowMs } }] },
    { $set: { [field]: now } },
  );
  return res.modifiedCount === 1;
}

/** Fire alerts by webhook (SNS email on AWS). Without ALERT_WEBHOOK_URL they only reach the browsers. */
async function notify(alerts: Alert[]) {
  const url = env.alertWebhookUrl;
  if (!alerts.length || !url) return;
  for (const a of alerts) {
    const text = `BinSight alert: ${a.text} (${new Date(a.wallT).toISOString()})`;
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, content: text, kind: a.kind, binId: a.binId, at: a.wallT }) });
      if (!res.ok) console.error(`Alert webhook answered ${res.status}`);
    } catch (e) {
      // The alert is already claimed and on every screen; a dead webhook mustn't fail the batch.
      console.error('Alert webhook failed', e);
    }
  }
}

/** Park readings in the inbox for the next tick to ingest. */
export async function enqueue(msgs: IngestMessage[], now = Date.now(), error?: unknown) {
  if (!msgs.length) return;
  const col = await db();
  const lastError = error ? String((error as Error).message ?? error) : undefined;
  await col.inbox.insertMany(msgs.map((msg) => ({ city: msg.city, msg, tQueued: now, attempts: error ? 1 : 0, ...(lastError ? { lastError, retryAt: now + RETRY_MS } : {}) })));
}

export class BadReading extends Error {}

/**
 * One reading from a phone. The id comes from the phone's signed token, never the
 * body, and the city is the deployment's. Returns whether it was stored now or
 * queued (ingest paused, or storing failed and the tick will retry it).
 */
export async function ingestPhone(raw: Record<string, unknown>, phoneId: string, now = Date.now()): Promise<'stored' | 'queued'> {
  const msg = parseMessage({ ...raw, id: phoneId, binId: phoneId, city: env.city, tReceived: now });
  if (!msg || msg.kind !== 'phone') throw new BadReading('Not a valid reading');
  const control = await loadControl();
  if (control.ingestPaused) {
    await enqueue([msg], now);
    return 'queued';
  }
  try {
    await ingestBatch([{ msg }], now);
    return 'stored';
  } catch (e) {
    console.error('Ingest failed, queueing the reading', e);
    await bump({ ingestErrors: 1 }, now);
    await enqueue([msg], now, e);
    return 'queued';
  }
}

/**
 * Ingest what's waiting in the inbox, oldest first, a batch at a time. A batch
 * that fails stays queued with its attempt count raised; at MAX_ATTEMPTS it moves
 * to deadLetters. Only the fleet tick calls this, under its lease, so there is a
 * single drainer.
 */
export async function drainInbox(city = env.city, limit = 200, now = Date.now()) {
  const col = await db();
  const docs = await col.inbox
    .find({ city, $or: [{ retryAt: { $exists: false } }, { retryAt: { $lte: now } }] })
    .sort({ tQueued: 1 })
    .limit(limit)
    .toArray();
  let done = 0;
  for (let k = 0; k < docs.length; k += BATCH) {
    const chunk = docs.slice(k, k + BATCH);
    const ids = chunk.map((d) => d._id);
    try {
      await ingestBatch(chunk.map((d) => ({ msg: d.msg })), now);
      await col.inbox.deleteMany({ _id: { $in: ids } });
      done += chunk.length;
    } catch (e) {
      console.error('Inbox batch failed', e);
      const attempts = Math.max(...chunk.map((d) => d.attempts)) + 1;
      await col.inbox.updateMany({ _id: { $in: ids } }, { $inc: { attempts: 1 }, $set: { lastError: String((e as Error).message ?? e), retryAt: now + RETRY_MS * attempts } });
      const dead = await col.inbox.find({ _id: { $in: ids }, attempts: { $gte: MAX_ATTEMPTS } }).toArray();
      if (dead.length) {
        await col.deadLetters.insertMany(dead.map(({ _id, ...d }: InboxDoc & { _id: unknown }) => ({ ...d, failedAt: now })));
        await col.inbox.deleteMany({ _id: { $in: dead.map((d) => d._id) } });
      }
      await bump({ ingestErrors: 1, deadLetters: dead.length }, now, city);
      break;
    }
  }
  return done;
}
