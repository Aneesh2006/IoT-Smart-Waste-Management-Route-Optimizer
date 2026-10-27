import {
  DAY,
  LIVE_START_SIM_T,
  Simulation,
  buildFleetFrame,
  buildRoutesFrame,
  simTimeAt,
  topics,
  worldKey,
  type IngestMessage,
  type LiveControl,
  type LiveEvent,
} from '@binsight/core';
import { randomUUID } from 'node:crypto';
import { db, isDuplicateKey, type FleetDoc } from './db.ts';
import { BATCH, drainInbox, enqueue, ingestBatch } from './ingest.ts';
import { bump } from './metrics.ts';
import { publish } from './realtime.ts';
import { env, loadControl, pool, saveControl } from './shared.ts';

/**
 * The virtual fleet: 120+ smart bins and their trucks, run as a deterministic
 * simulation. On AWS a Lambda woke every minute and looped; Vercel has no
 * long-running process (and the free plan's cron is daily), so the fleet ticks
 * lazily instead: every API request (and the browsers' once-a-second /api/tick)
 * may advance it to "now".
 *
 * A tick is idempotent and guarded in MongoDB: it needs the fleet lease and at
 * least TICK_MS since the last tick, so however many browsers ask, the city moves
 * once. It rebuilds the world from the control record and replays it to now (the
 * replay is deterministic, so a crash or a cold start never loses anything); a
 * warm instance keeps the simulation in memory and only advances it.
 *
 * Each tick ingests the bin readings sampled since the last tick, publishes one
 * fleet frame, new routes and new events, and drains the inbox.
 */
export const TICK_MS = 1000;
const LEASE_MS = 15_000;
const MAX_SIM_DAYS = 14;

const signature = (c: LiveControl) => JSON.stringify([c.seed, c.bins, c.trucks, c.epoch, c.startPolicy, c.policyChanges, c.events]);

let cached: { sig: string; sim: Simulation } | null = null;

/** The simulation at `now`: the warm one advanced if it's the same world, else a fresh replay. */
export function simFor(c: LiveControl, now: number) {
  const sig = signature(c);
  const target = simTimeAt(c, now);
  if (!cached || cached.sig !== sig || cached.sim.time > target + 3600) {
    cached = { sig, sim: new Simulation({ seed: c.seed, bins: c.bins, trucks: c.trucks, policy: c.startPolicy, events: c.events, policyChanges: c.policyChanges }) };
  }
  if (target > cached.sim.time) cached.sim.advance(target - cached.sim.time);
  return cached.sim;
}

/** Forget the warm simulation (tests). */
export function resetSimCache() {
  cached = null;
}

/** Take the lease if the fleet is due a tick; returns the previous fleet state, or null if someone else has it. */
async function claim(city: string, owner: string, now: number, force: boolean): Promise<FleetDoc | null> {
  const col = await db();
  const due = force ? {} : { $or: [{ wall: { $exists: false } }, { wall: { $lte: now - TICK_MS } }] };
  const free = { $or: [{ leaseUntil: { $exists: false } }, { leaseUntil: { $lt: now } }] };
  try {
    const before = await col.fleet.findOneAndUpdate(
      { city, $and: [due, free] },
      { $set: { leaseOwner: owner, leaseUntil: now + LEASE_MS } },
      { upsert: true, returnDocument: 'before', projection: { _id: 0 } },
    );
    return before ?? { city };
  } catch (e) {
    // The fleet row exists but isn't due or is leased: the upsert's insert collides.
    if (isDuplicateKey(e)) return null;
    throw e;
  }
}

export interface TickResult {
  ticked: boolean;
  running?: boolean;
  readings?: number;
  drained?: number;
  simT?: number;
}

export async function tick(opts: { now?: number; force?: boolean } = {}): Promise<TickResult> {
  const now = opts.now ?? Date.now();
  const city = env.city;
  const owner = randomUUID();
  const prev = await claim(city, owner, now, Boolean(opts.force));
  if (!prev) return { ticked: false };

  const col = await db();
  const next: Partial<FleetDoc> = {};
  let control = await loadControl(city);
  let readings = 0;
  let drained = 0;
  let published = 0;
  try {
    if (control.running) {
      // Worlds don't run forever: after two sim-weeks, start a fresh one.
      if (simTimeAt(control, now) - LIVE_START_SIM_T > MAX_SIM_DAYS * DAY) {
        control = {
          ...control,
          anchorWall: now,
          anchorSimT: LIVE_START_SIM_T,
          epoch: control.epoch + 1,
          policyChanges: [],
          events: [],
          startPolicy: control.policy,
        };
        await saveControl(control);
      }

      const sim = simFor(control, now);
      const world = worldKey(control);
      const fresh = prev.world !== world;
      const jobs: Promise<unknown>[] = [];

      jobs.push(publish(topics.fleet(city), buildFleetFrame(sim, world, control.speed, true)));
      published++;

      const routes = fresh || sim.routeVersion !== prev.routeVersion ? buildRoutesFrame(sim, world) : undefined;
      if (routes) {
        jobs.push(publish(topics.routes(city), routes));
        published++;
      }

      // A new world starts its narration now rather than replaying every event so far.
      let lastEvent = fresh ? (sim.events.at(-1)?.id ?? -1) : (prev.lastEvent ?? -1);
      const newEvents = sim.events.filter((e) => e.id > lastEvent);
      if (newEvents.length) {
        lastEvent = newEvents[newEvents.length - 1].id;
        const events: LiveEvent[] = newEvents.map(({ time, kind, text, binId, truckId }) => ({ time, kind, text, binId, truckId }));
        jobs.push(publish(topics.events(city), events));
        published++;
      }

      // Every bin that sampled since the last tick reports, like hardware would. A new world reports them all.
      const since = fresh ? -Infinity : (prev.simT ?? -Infinity);
      const msgs: IngestMessage[] = [];
      for (const b of sim.bins) {
        if (b.readingAt <= since) continue;
        msgs.push({
          id: String(b.id),
          city,
          kind: 'fleet',
          r: Math.round(b.reading * 1000) / 1000,
          ok: b.sensorOk,
          temp: Math.round(b.temperature * 10) / 10,
          gas: Math.round(b.gas),
          bat: Math.round(b.battery),
          tDevice: now,
          tReceived: now,
          simT: b.readingAt,
          world,
        });
      }
      readings = msgs.length;
      if (control.ingestPaused) jobs.push(enqueue(msgs, now));
      else {
        const chunks: IngestMessage[][] = [];
        for (let k = 0; k < msgs.length; k += BATCH) chunks.push(msgs.slice(k, k + BATCH));
        jobs.push(
          pool(chunks, 4, (chunk) =>
            ingestBatch(
              chunk.map((msg) => ({ msg })),
              now,
            ).catch(async (e) => {
              console.error('Fleet batch failed, queueing it', e);
              await enqueue(chunk, now, e);
            }),
          ),
        );
      }
      await Promise.all(jobs);
      // Only now is it all out: a tick that throws leaves the old marks, and the next one redoes it.
      Object.assign(next, { simT: sim.time, world, lastEvent, ...(routes ? { routes, routeVersion: sim.routeVersion } : {}) });
    }
    if (!control.ingestPaused) drained = await drainInbox(city, 200, now);
  } finally {
    const done = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined));
    await col.fleet.updateOne({ city, leaseOwner: owner }, { $set: { ...done, wall: now, leaseUntil: 0 } });
  }
  await bump({ ticks: 1, published }, now, city);
  return { ticked: true, running: control.running, readings, drained, simT: next.simT };
}
