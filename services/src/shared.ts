import { defaultControl, type LiveControl } from '@binsight/core';
import { waitUntil } from '@vercel/functions';
import { db } from './db.ts';

/** Configuration from environment variables. Read lazily so tests can import freely. */
export const env = {
  get city() {
    return process.env.CITY ?? 'demo';
  },
  get mongoUri() {
    return required('MONGODB_URI');
  },
  get mongoDb() {
    return process.env.MONGODB_DB ?? 'binsight';
  },
  get ablyKey() {
    return process.env.ABLY_API_KEY ?? '';
  },
  get operatorPassword() {
    return process.env.OPERATOR_PASSWORD ?? '';
  },
  get sessionSecret() {
    return required('SESSION_SECRET');
  },
  /** Optional: fire alerts are POSTed here (Slack, Discord, Zapier or any email-sending webhook). */
  get alertWebhookUrl() {
    return process.env.ALERT_WEBHOOK_URL ?? '';
  },
  /** Vercel sends it as a bearer token on cron requests when set. */
  get cronSecret() {
    return process.env.CRON_SECRET ?? '';
  },
};

function required(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}`);
  return v;
}

/** Run async jobs with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<unknown>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

/** The control record without Mongo's _id or anything else that isn't part of LiveControl. */
function strip(doc: Record<string, unknown>): LiveControl {
  const base = defaultControl(String(doc.city));
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(base)) out[k] = k in doc ? doc[k] : base[k as keyof LiveControl];
  return out as unknown as LiveControl;
}

export async function loadControl(city = env.city): Promise<LiveControl> {
  const col = await db();
  const doc = await col.control.findOne({ city }, { projection: { _id: 0 } });
  if (doc) return strip(doc as unknown as Record<string, unknown>);
  const fresh = defaultControl(city);
  // Two first requests may race: whoever inserts first wins, the other reads it.
  await col.control.updateOne({ city }, { $setOnInsert: fresh }, { upsert: true });
  return strip((await col.control.findOne({ city }, { projection: { _id: 0 } })) as unknown as Record<string, unknown>);
}

export async function saveControl(control: LiveControl) {
  const col = await db();
  await col.control.updateOne({ city: control.city }, { $set: control }, { upsert: true });
}

const pending = new Set<Promise<unknown>>();

/** Keep work going after the response is sent (Vercel waitUntil; outside Vercel it simply runs on). */
export function after(task: Promise<unknown>) {
  const guarded = task.catch((e) => console.error(e)).finally(() => pending.delete(guarded));
  pending.add(guarded);
  waitUntil(guarded);
}

/** Wait for everything handed to after() (tests). */
export async function settled() {
  while (pending.size) await Promise.all([...pending]);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
