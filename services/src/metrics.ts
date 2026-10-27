import { db } from './db.ts';
import { env } from './shared.ts';

/**
 * Per-minute counters in MongoDB, standing in for CloudWatch: the X-Ray reads
 * them back through /api/metrics. Increments are upserts on one document per
 * city per minute, expired after a day.
 */
export type Counter = 'readings' | 'ingestRuns' | 'ingestMs' | 'ingestErrors' | 'writes' | 'published' | 'ticks' | 'apiCalls' | 'deadLetters';

export const SERIES: Counter[] = ['readings', 'ingestRuns', 'ingestMs', 'ingestErrors', 'writes', 'published', 'ticks', 'apiCalls', 'deadLetters'];

export async function bump(counts: Partial<Record<Counter, number>>, now = Date.now(), city = env.city) {
  const inc = Object.fromEntries(Object.entries(counts).filter(([, v]) => v));
  if (!Object.keys(inc).length) return;
  const minute = Math.floor(now / 60_000) * 60_000;
  const col = await db();
  await col.metrics.updateOne({ city, minute }, { $inc: inc as Record<string, number>, $setOnInsert: { expiresAt: new Date(minute + 24 * 3600_000) } } as never, { upsert: true });
}

/** The last `minutes` minutes as series, oldest first, zero-filled like CloudWatch's per-minute sums. */
export async function series(now = Date.now(), minutes = 20, city = env.city) {
  const col = await db();
  const end = Math.floor(now / 60_000) * 60_000;
  const start = end - (minutes - 1) * 60_000;
  const docs = await col.metrics.find({ city, minute: { $gte: start } }, { projection: { _id: 0 } }).toArray();
  const byMinute = new Map(docs.map((d) => [d.minute, d]));
  const t: number[] = [];
  for (let m = start; m <= end; m += 60_000) t.push(m);
  const out: Record<string, { t: number[]; v: number[] }> = {};
  for (const name of SERIES) out[name] = { t, v: t.map((m) => Number(byMinute.get(m)?.[name] ?? 0)) };
  // Average ingest duration per run, like the Lambda Duration metric.
  out.ingestAvgMs = { t, v: t.map((_, k) => (out.ingestRuns.v[k] ? out.ingestMs.v[k] / out.ingestRuns.v[k] : 0)) };
  return out;
}
