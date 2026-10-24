import {
  DAY,
  LIVE_START_SIM_T,
  Simulation,
  buildFleetFrame,
  buildRoutesFrame,
  simTimeAt,
  topics,
  worldKey,
  type LiveControl,
  type LiveEvent,
  type Telemetry,
} from '@binsight/core';
import type { Context } from 'aws-lambda';
import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, env, loadControl, pool, publish, saveControl, sleep } from './shared.ts';

/**
 * The virtual fleet: 120+ smart bins and their trucks, run as a deterministic
 * simulation inside one Lambda that wakes every minute. Bins publish their
 * readings over MQTT to AWS IoT Core exactly as hardware would; trucks publish
 * their positions twice a second.
 *
 * The function keeps no state between runs. It rebuilds the world from the
 * control record and replays it up to "now" (the replay is deterministic), so a
 * crash or a cold start never loses anything.
 */
const FRAME_MS = 500;
const MAX_SIM_DAYS = 14;

const signature = (c: LiveControl) => JSON.stringify([c.seed, c.bins, c.trucks, c.epoch, c.startPolicy, c.policyChanges, c.events]);

function build(c: LiveControl, now: number) {
  const sim = new Simulation({ seed: c.seed, bins: c.bins, trucks: c.trucks, policy: c.startPolicy, events: c.events, policyChanges: c.policyChanges });
  const target = simTimeAt(c, now);
  if (target > sim.time) sim.advance(target - sim.time);
  return sim;
}

/**
 * Only one run may drive the fleet at a time (the minute schedule and an operator's
 * "start" can overlap). A run holds a lease until the end of the wall-clock minute,
 * then the next scheduled run takes over.
 */
async function claimLease(owner: string, until: number) {
  try {
    await ddb().send(
      new UpdateCommand({
        TableName: env.controlTable,
        Key: { city: env.city },
        UpdateExpression: 'SET leaseOwner = :me, leaseUntil = :until',
        ConditionExpression: 'attribute_not_exists(leaseUntil) OR leaseUntil < :now OR leaseOwner = :me',
        ExpressionAttributeValues: { ':me': owner, ':until': until, ':now': Date.now() },
      }),
    );
    return true;
  } catch (e) {
    if ((e as Error).name === 'ConditionalCheckFailedException') return false;
    throw e;
  }
}

export const handler = async (_event: unknown, context: Context) => {
  let control = await loadControl();
  if (!control.running) return { skipped: 'stopped' };
  const stopAt = Math.ceil((Date.now() + 1000) / 60_000) * 60_000 - 700;
  if (!(await claimLease(context.awsRequestId, stopAt + 500))) return { skipped: 'another run holds the fleet' };

  // Worlds don't run forever: after two sim-weeks, start a fresh one.
  if (simTimeAt(control, Date.now()) - LIVE_START_SIM_T > MAX_SIM_DAYS * DAY) {
    control = {
      ...control,
      anchorWall: Date.now(),
      anchorSimT: LIVE_START_SIM_T,
      epoch: control.epoch + 1,
      policyChanges: [],
      events: [],
      startPolicy: control.policy,
    };
    await saveControl(control);
  }

  let sim = build(control, Date.now());
  let sig = signature(control);
  let world = worldKey(control);
  let published = sim.bins.map((b) => b.readingAt);
  let lastEvent = sim.events.at(-1)?.id ?? -1;
  let routeVersion = -1;
  let frame = 0;
  let checkedAt = Date.now();
  let frames = 0;
  let messages = 0;

  while (context.getRemainingTimeInMillis() > 2500 && Date.now() < stopAt) {
    const now = Date.now();

    // Pick up operator changes (stop, speed, policy, chaos, reset) every few seconds.
    if (now - checkedAt > 4000) {
      checkedAt = now;
      const fresh = await loadControl();
      if (!fresh.running) break;
      if (signature(fresh) !== sig) {
        sim = build(fresh, now);
        sig = signature(fresh);
        world = worldKey(fresh);
        published = sim.bins.map((b) => b.readingAt);
        lastEvent = sim.events.at(-1)?.id ?? -1;
        routeVersion = -1;
      }
      control = fresh;
    }

    const target = simTimeAt(control, now);
    if (target > sim.time) sim.advance(target - sim.time);

    const jobs: Promise<unknown>[] = [];
    const fleet = buildFleetFrame(sim, world, control.running ? control.speed : 0, frame % 4 === 0);
    jobs.push(publish(topics.fleet(control.city), fleet));

    if (sim.routeVersion !== routeVersion) {
      routeVersion = sim.routeVersion;
      const routes = buildRoutesFrame(sim, world);
      // Retained, so a browser that connects later still gets the current routes.
      jobs.push(publish(topics.routes(control.city), routes, true));
    }

    const fresh = sim.events.filter((e) => e.id > lastEvent);
    if (fresh.length) {
      lastEvent = fresh[fresh.length - 1].id;
      const events: LiveEvent[] = fresh.map(({ time, kind, text, binId, truckId }) => ({ time, kind, text, binId, truckId }));
      jobs.push(publish(topics.events(control.city), events));
    }

    // Each bin publishes when its sensor samples: one MQTT message per reading, like real hardware.
    const readings: Telemetry[] = [];
    sim.bins.forEach((b, i) => {
      if (b.readingAt <= published[i]) return;
      published[i] = b.readingAt;
      readings.push({
        id: String(b.id),
        kind: 'fleet',
        r: Math.round(b.reading * 1000) / 1000,
        ok: b.sensorOk,
        temp: Math.round(b.temperature * 10) / 10,
        gas: Math.round(b.gas),
        bat: Math.round(b.battery),
        tDevice: Date.now(),
        simT: b.readingAt,
        world,
      });
    });
    jobs.push(pool(readings, 25, (t) => publish(topics.telemetry(control.city, t.id), t)));
    messages += readings.length + 1;

    await Promise.all(jobs);
    frame++;
    frames++;
    await sleep(Math.max(0, FRAME_MS - (Date.now() - now)));
  }
  return { frames, messages, simT: sim.time };
};

