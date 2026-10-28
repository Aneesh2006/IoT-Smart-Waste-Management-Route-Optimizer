import { simTimeAt, topics, type Alert, type FleetFrame, type LiveControl, type PhoneCommand, type RoutesFrame, type StateUpdate } from '@binsight/core';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { handle } from '../src/api.ts';
import { db, useMongoClient } from '../src/db.ts';
import { TICK_MS, resetSimCache, simFor, tick } from '../src/fleet.ts';
import { drainInbox, MAX_ATTEMPTS, RETRY_MS } from '../src/ingest.ts';
import { setPublisher } from '../src/realtime.ts';
import { loadControl, saveControl, settled } from '../src/shared.ts';

/**
 * The API handlers and the lazy fleet tick against a real MongoDB
 * (mongodb-memory-server), with Ably replaced by a list of what would be sent.
 */
let mongo: MongoMemoryServer;
let client: MongoClient;
let sent: { topic: string; data: unknown }[] = [];
let failPublish = false;

const CITY = 'test';
const PASSWORD = 'correct horse';

beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  client = new MongoClient(mongo.getUri());
  Object.assign(process.env, { CITY, SESSION_SECRET: 'test-secret', OPERATOR_PASSWORD: PASSWORD });
  delete process.env.MONGODB_URI;
  delete process.env.CRON_SECRET;
  setPublisher({
    mode: 'ably',
    async publish(topic, data) {
      if (failPublish) throw new Error('Ably is down');
      sent.push({ topic, data });
    },
  });
}, 300_000);

beforeEach(async () => {
  await settled();
  await useMongoClient(client, `t${Math.random().toString(36).slice(2, 8)}`);
  resetSimCache();
  sent = [];
  failPublish = false;
});

afterAll(async () => {
  await settled();
  await client?.close();
  await mongo?.stop();
});

const call = (method: string, route: string, init: { body?: unknown; headers?: Record<string, string> } = {}) =>
  handle(
    new Request(`http://localhost/api/${route}`, {
      method,
      headers: { ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init.headers },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    }),
  );

async function signIn() {
  const res = await call('POST', 'login', { body: { password: PASSWORD } });
  expect(res.status).toBe(200);
  const cookie = res.headers.get('set-cookie')!;
  expect(cookie).toMatch(/HttpOnly/);
  expect(cookie).toMatch(/SameSite=Strict/);
  return { cookie: cookie.split(';')[0] };
}

async function newPhone() {
  const res = await call('POST', 'phone');
  return (await res.json()) as { id: string; token: string };
}

const sentTo = <T>(topic: string) => sent.filter((m) => m.topic === topic).map((m) => m.data as T);

describe('configuration', () => {
  it('says plainly when Live mode is not set up', async () => {
    const res = await call('GET', 'live-config');
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toMatch(/MONGODB_URI/);
  });

  it('routes by path or by the ?route= Vercel adds', async () => {
    expect((await handle(new Request('http://localhost/api/[route]?route=time'))).status).toBe(200);
    expect((await call('GET', 'nope')).status).toBe(404);
  });
});

describe('operator auth', () => {
  it('protects control and accepts the signed cookie', async () => {
    expect((await call('POST', 'control', { body: { action: 'start' } })).status).toBe(401);
    expect((await call('POST', 'login', { body: { password: 'guess' } })).status).toBe(401);
    // A forged cookie fails the signature check.
    expect((await call('POST', 'control', { body: { action: 'start' }, headers: { cookie: 'binsight_operator=eyJzdWIiOiJvcGVyYXRvciJ9.AAAA' } })).status).toBe(401);

    const headers = await signIn();
    expect(await (await call('GET', 'session', { headers })).json()).toEqual({ operator: true });
    const res = await call('POST', 'control', { body: { action: 'start' }, headers });
    expect(res.status).toBe(200);
    expect(((await res.json()) as LiveControl).running).toBe(true);
    expect((await call('POST', 'control', { body: { action: 'chaos', kind: 'nope' }, headers })).status).toBe(400);
  });

  it('only takes JSON bodies', async () => {
    const headers = await signIn();
    const res = await handle(new Request('http://localhost/api/control', { method: 'POST', headers: { ...headers, 'content-type': 'text/plain' }, body: '{"action":"stop"}' }));
    expect(res.status).toBe(400);
  });
});

describe('lazy fleet tick', () => {
  async function running(now: number) {
    const c = await loadControl();
    await saveControl({ ...c, running: true, anchorWall: now });
    return loadControl();
  }

  it('publishes a new world in full, then only what changed', async () => {
    const now = Date.now();
    const c = await running(now);
    const first = await tick({ now });
    expect(first).toMatchObject({ ticked: true, running: true, readings: c.bins });

    const frames = sentTo<FleetFrame>(topics.fleet(CITY));
    expect(frames).toHaveLength(1);
    expect(frames[0].trucks).toHaveLength(c.trucks);
    expect(sentTo<RoutesFrame>(topics.routes(CITY))).toHaveLength(1);
    const states = sentTo<StateUpdate>(topics.state(CITY));
    expect(states.reduce((n, s) => n + s.bins.length, 0)).toBe(c.bins);
    for (const s of states) expect(s.hops.tStored).toBeGreaterThanOrEqual(s.hops.tReceived);
    const col = await db();
    expect(await col.bins.countDocuments({ city: CITY, kind: 'fleet' })).toBe(c.bins);
    expect(await col.readings.countDocuments()).toBe(c.bins);

    // Not due yet: however many browsers ask, the city moves once a second.
    expect(await tick({ now: now + TICK_MS / 2 })).toEqual({ ticked: false });

    sent = [];
    const second = await tick({ now: now + 5000 });
    expect(second.ticked).toBe(true);
    expect(second.readings).toBeLessThan(c.bins);
    expect(sentTo(topics.fleet(CITY))).toHaveLength(1);
    expect(sentTo(topics.routes(CITY))).toHaveLength(0);
  });

  it('lets exactly one of many simultaneous ticks through', async () => {
    const now = Date.now();
    await running(now);
    const results = await Promise.all(Array.from({ length: 8 }, () => tick({ now })));
    expect(results.filter((r) => r.ticked)).toHaveLength(1);
  });

  it('replays to the same city cold as warm', async () => {
    const now = Date.now();
    const c = { ...(await running(now - 30 * 60_000)), anchorSimT: 6 * 3600 };
    const warm = simFor(c, now - 10 * 60_000);
    simFor(c, now);
    resetSimCache();
    const cold = simFor(c, now);
    expect(warm).not.toBe(cold);
    expect(cold.time).toBe(simTimeAt(c, now));
    expect(warm.time).toBe(cold.time);
    expect(warm.trucks.map((t) => [t.x, t.z, t.status])).toEqual(cold.trucks.map((t) => [t.x, t.z, t.status]));
    expect(warm.bins.map((b) => b.reading)).toEqual(cold.bins.map((b) => b.reading));
  });

  it('serves state (with routes) after advancing the fleet', async () => {
    await running(Date.now() - 2000);
    const res = await call('GET', 'state');
    const body = (await res.json()) as { control: LiveControl; bins: unknown[]; routes: RoutesFrame | null };
    expect(body.control.running).toBe(true);
    expect(body.bins).toHaveLength(body.control.bins);
    expect(body.routes?.world).toBe(`${body.control.seed}:${body.control.bins}:${body.control.trucks}:${body.control.epoch}`);
  });

  it('does nothing but drain the inbox while stopped', async () => {
    const r = await tick();
    expect(r).toMatchObject({ ticked: true, running: false, readings: 0 });
    expect(sent).toHaveLength(0);
  });

  it('cron needs the secret when one is set', async () => {
    process.env.CRON_SECRET = 'cron';
    try {
      expect((await call('GET', 'cron')).status).toBe(401);
      expect((await call('GET', 'cron', { headers: { authorization: 'Bearer cron' } })).status).toBe(200);
    } finally {
      delete process.env.CRON_SECRET;
    }
  });
});

describe('phone ingest', () => {
  const reading = (o: Record<string, unknown> = {}) => ({ r: 0.4, ok: true, temp: 29, gas: 40, bat: 100, tDevice: Date.now(), nick: 'Priya', emoji: '🐯', ...o });

  it('needs a signed phone id and ignores the id in the body', async () => {
    expect((await call('POST', 'ingest', { body: reading() })).status).toBe(401);
    const phone = await newPhone();
    const auth = { authorization: `Bearer ${phone.token}` };
    const res = await call('POST', 'ingest', { body: reading({ binId: '7', id: '7', city: 'elsewhere' }), headers: auth });
    expect(res.status).toBe(200);
    const col = await db();
    expect(await col.bins.findOne({ city: CITY, bin: phone.id })).toMatchObject({ kind: 'phone', nick: 'Priya' });
    expect(await col.bins.countDocuments({ bin: '7' })).toBe(0);
    expect(sentTo<Alert>(topics.alerts(CITY)).map((a) => a.kind)).toEqual(['joined']);
    expect((await call('POST', 'ingest', { body: 'nope', headers: auth })).status).toBe(400);
  });

  it('dispatches a truck once when the phone passes 80%, and never lets an old reading win', async () => {
    const phone = await newPhone();
    const auth = { authorization: `Bearer ${phone.token}` };
    const t = Date.now();
    await call('POST', 'ingest', { body: reading({ r: 0.85, tDevice: t }), headers: auth });
    await call('POST', 'ingest', { body: reading({ r: 0.9, tDevice: t + 1 }), headers: auth });
    const cmds = sentTo<PhoneCommand>(topics.phoneCmd(CITY, phone.id));
    expect(cmds).toHaveLength(1);
    expect(cmds[0]).toMatchObject({ type: 'dispatch', eta: 20 });

    await call('POST', 'ingest', { body: reading({ r: 0.1, tDevice: t - 5000 }), headers: auth });
    const col = await db();
    expect((await col.bins.findOne({ bin: phone.id }))!.r).toBe(0.9);

    await call('POST', 'ingest', { body: reading({ r: 0, event: 'collected', tDevice: t + 2 }), headers: auth });
    expect((await col.bins.findOne({ bin: phone.id }))!.dispatchAt).toBeUndefined();
    expect(sentTo<Alert>(topics.alerts(CITY)).map((a) => a.kind)).toEqual(['joined', 'dispatch', 'collected']);
  });

  it('queues readings while ingest is paused and loses none on resume', async () => {
    const headers = await signIn();
    await call('POST', 'control', { body: { action: 'ingest', paused: true }, headers });
    const phone = await newPhone();
    const res = await call('POST', 'ingest', { body: reading(), headers: { authorization: `Bearer ${phone.token}` } });
    expect(res.status).toBe(202);
    const col = await db();
    expect(await col.inbox.countDocuments()).toBe(1);
    expect(await col.bins.countDocuments({ bin: phone.id })).toBe(0);
    expect(((await (await call('GET', 'metrics')).json()) as { queue: { visible: number } }).queue.visible).toBe(1);

    await call('POST', 'control', { body: { action: 'ingest', paused: false }, headers });
    await settled();
    expect(await col.inbox.countDocuments()).toBe(0);
    expect(await col.bins.countDocuments({ bin: phone.id })).toBe(1);
  });

  it('retries a failed reading from the inbox and parks it after three tries', async () => {
    const phone = await newPhone();
    failPublish = true;
    const res = await call('POST', 'ingest', { body: reading(), headers: { authorization: `Bearer ${phone.token}` } });
    expect(res.status).toBe(202);
    await settled();
    const col = await db();
    expect(await col.inbox.findOne()).toMatchObject({ attempts: 1 });
    // Not retried before its backoff is up.
    expect(await drainInbox(CITY, 200, Date.now())).toBe(0);
    let t = Date.now();
    for (let k = 1; k < MAX_ATTEMPTS; k++) {
      t += RETRY_MS * k + 1;
      await drainInbox(CITY, 200, t);
    }
    expect(await col.inbox.countDocuments()).toBe(0);
    expect(await col.deadLetters.countDocuments()).toBe(1);

    // Fixed: a fresh reading goes straight through.
    failPublish = false;
    expect((await call('POST', 'ingest', { body: reading(), headers: { authorization: `Bearer ${phone.token}` } })).status).toBe(200);
  });

  it('counts what went through for the X-Ray', async () => {
    const phone = await newPhone();
    await call('POST', 'ingest', { body: reading(), headers: { authorization: `Bearer ${phone.token}` } });
    await settled();
    const m = (await (await call('GET', 'metrics')).json()) as { series: Record<string, { v: number[] }> };
    expect(m.series.readings.v.at(-1)).toBeGreaterThanOrEqual(1);
    expect(m.series.ingestRuns.v.at(-1)).toBeGreaterThanOrEqual(1);
    expect(m.series.readings.v).toHaveLength(20);
  });
});
