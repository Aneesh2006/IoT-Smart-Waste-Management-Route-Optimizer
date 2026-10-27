import { CHAOS_ORDER, LIVE_SIM_QUANTUM, LIVE_START_SIM_T, POLICY_ORDER, simTimeAt, worldKey, type ChaosKind, type LiveControl, type PolicyId } from '@binsight/core';
import { OPERATOR_COOKIE, newPhone, operatorCookie, passwordMatches, readCookie, signToken, verifyToken, OPERATOR_TTL_MS } from './auth.ts';
import { db } from './db.ts';
import { tick } from './fleet.ts';
import { BadReading, ingestPhone } from './ingest.ts';
import { bump, series } from './metrics.ts';
import { realtimeMode, tokenRequest } from './realtime.ts';
import { after, env, loadControl, saveControl } from './shared.ts';

/**
 * The HTTP API, framework-free (Web Request → Response) so the same code runs as
 * one Vercel function and under the local dev server: public reads (live config,
 * time, state, metrics), the lazy fleet tick, phone ingest, realtime tokens, and
 * the operator's sign-in and control endpoint.
 */
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });

/** The route is the path after /api/ ("state", "control", …); Vercel's dynamic route also passes it as ?route=. */
export function routeOf(url: URL) {
  return (url.searchParams.get('route') || url.pathname.replace(/^\/api\/?/, '')).replace(/\/+$/, '');
}

export async function handle(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const route = `${request.method} ${routeOf(url)}`;
  try {
    const res = await dispatch(route, request, url);
    if (route !== 'GET time' && res.status !== 503) after(bump({ apiCalls: 1 }));
    return res;
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    console.error(route, e);
    // Missing configuration is the deployer's problem, not a crash: say what to set.
    return json(message.startsWith('Missing environment variable') ? 503 : 500, { error: message });
  }
}

async function dispatch(route: string, request: Request, url: URL): Promise<Response> {
  switch (route) {
    case 'GET time':
      return json(200, { now: Date.now() });
    case 'GET live-config':
      if (!process.env.MONGODB_URI) return json(503, { error: 'Live mode is not set up on this deployment (MONGODB_URI is missing).' });
      return json(200, { city: env.city, realtime: realtimeMode() });
    case 'GET config':
      await tickQuietly();
      return json(200, await loadControl());
    case 'GET state':
      await tickQuietly();
      return json(200, await state());
    case 'GET tick':
    case 'POST tick':
      return json(200, await tick());
    case 'GET cron':
      // Vercel Cron's backup tick (the free plan runs it daily). Also clears out the inbox.
      if (env.cronSecret && request.headers.get('authorization') !== `Bearer ${env.cronSecret}`) return json(401, { error: 'Not the cron' });
      return json(200, await tick({ force: true }));
    case 'GET metrics':
      return json(200, await metrics());
    case 'GET realtime-token':
      return json(200, await tokenRequest());
    case 'POST phone':
      return json(200, newPhone());
    case 'POST ingest':
      return ingest(request);
    case 'GET session':
      return json(200, { operator: Boolean(operator(request)) });
    case 'POST login': {
      const body = await readJson(request);
      if (!env.operatorPassword) return json(503, { error: 'Operator sign-in is off: set OPERATOR_PASSWORD.' });
      if (!body || !passwordMatches(body.password)) return json(401, { error: 'Wrong operator password.' });
      const token = signToken({ sub: 'operator', role: 'operator', exp: Date.now() + OPERATOR_TTL_MS });
      return json(200, { operator: true }, { 'set-cookie': operatorCookie(token, url.protocol === 'https:') });
    }
    case 'POST logout':
      return json(200, { operator: false }, { 'set-cookie': operatorCookie('', url.protocol === 'https:', 0) });
    case 'POST control': {
      if (!operator(request)) return json(401, { error: 'Not signed in as an operator (or the session expired).' });
      const body = await readJson(request);
      if (!body) return json(400, { error: 'Body must be a JSON object' });
      return control(body as ControlBody);
    }
    default:
      return json(404, { error: `No route ${route}` });
  }
}

/** Reads advance the fleet first, but a failed tick mustn't fail the read. */
async function tickQuietly() {
  try {
    await tick();
  } catch (e) {
    console.error('tick', e);
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  // JSON only: a cross-site form can't send it without a CORS preflight, which this API never answers.
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return null;
  try {
    const body = await request.json();
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function operator(request: Request) {
  return verifyToken(readCookie(request.headers.get('cookie'), OPERATOR_COOKIE), 'operator');
}

async function state() {
  const c = await loadControl();
  const world = worldKey(c);
  const col = await db();
  const now = Date.now();
  const [bins, fleet] = await Promise.all([
    col.bins
      .find({ city: c.city, $or: [{ kind: 'phone', lastSeen: { $gt: now - 2 * 3600_000 } }, { kind: 'fleet', world }] }, { projection: { _id: 0, expiresAt: 0 } })
      .toArray(),
    col.fleet.findOne({ city: c.city }, { projection: { _id: 0, routes: 1 } }),
  ]);
  return { control: c, bins, routes: fleet?.routes?.world === world ? fleet.routes : null };
}

/** At most 10 readings a second per phone, per function instance. Enough for the tap game, not for a flood. */
const phoneRate = new Map<string, { at: number; n: number }>();
function allowPhone(id: string, now: number) {
  const w = phoneRate.get(id);
  if (!w || now - w.at >= 1000) {
    if (phoneRate.size > 5000) phoneRate.clear();
    phoneRate.set(id, { at: now, n: 1 });
    return true;
  }
  return ++w.n <= 10;
}

async function ingest(request: Request) {
  const now = Date.now();
  const bearer = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const phone = verifyToken(bearer, 'phone');
  if (!phone) return json(401, { error: 'Unknown phone: ask /api/phone for an id first.' });
  if (!allowPhone(phone.sub, now)) return json(429, { error: 'Too many readings' });
  const body = await readJson(request);
  if (!body) return json(400, { error: 'Body must be a JSON object' });
  try {
    const status = await ingestPhone(body, phone.sub, now);
    // The phone has its answer; keep the city moving after the response.
    after(tick());
    return json(status === 'stored' ? 200 : 202, { status });
  } catch (e) {
    if (e instanceof BadReading) return json(400, { error: e.message });
    throw e;
  }
}

type ControlBody =
  | { action: 'start' }
  | { action: 'stop' }
  | { action: 'speed'; speed: number }
  | { action: 'policy'; policy: PolicyId }
  | { action: 'chaos'; kind: ChaosKind }
  | { action: 'reset'; seed?: string; bins?: number; trucks?: number; policy?: PolicyId }
  | { action: 'ingest'; paused: boolean };

async function control(body: ControlBody) {
  const c = await loadControl();
  const now = Date.now();
  const reanchor = () => {
    c.anchorSimT = simTimeAt(c, now);
    c.anchorWall = now;
  };
  // Changes land a couple of ticks in the future so every replay applies them at the same sim time.
  const soon = () => simTimeAt(c, now) + 2 * LIVE_SIM_QUANTUM;
  let kick = false;

  switch (body.action) {
    case 'start':
      if (!c.running) {
        c.anchorWall = now;
        c.running = true;
        kick = true;
      }
      break;
    case 'stop':
      reanchor();
      c.running = false;
      break;
    case 'speed':
      reanchor();
      c.speed = clampInt(body.speed, 5, 600);
      break;
    case 'policy':
      if (!POLICY_ORDER.includes(body.policy)) return json(400, { error: 'Unknown policy' });
      c.policyChanges = [...c.policyChanges, { at: soon(), policy: body.policy }];
      c.policy = body.policy;
      break;
    case 'chaos':
      if (!CHAOS_ORDER.includes(body.kind)) return json(400, { error: 'Unknown chaos kind' });
      c.events = [...c.events, { at: soon(), kind: body.kind }];
      break;
    case 'reset': {
      const policy = body.policy && POLICY_ORDER.includes(body.policy) ? body.policy : c.policy;
      c.seed = typeof body.seed === 'string' && body.seed.trim() ? body.seed.trim().replace(/[^\w-]/g, '').slice(0, 40) || c.seed : c.seed;
      c.bins = body.bins ? clampInt(body.bins, 20, 1000) : c.bins;
      c.trucks = body.trucks ? clampInt(body.trucks, 1, 8) : c.trucks;
      c.policy = policy;
      c.startPolicy = policy;
      c.policyChanges = [];
      c.events = [];
      c.anchorSimT = LIVE_START_SIM_T;
      c.anchorWall = now;
      c.epoch += 1;
      c.running = true;
      kick = true;
      break;
    }
    case 'ingest':
      // Paused, readings wait in the inbox; resumed, the next tick drains it. Nothing is lost.
      c.ingestPaused = Boolean(body.paused);
      kick = !c.ingestPaused;
      break;
    default:
      return json(400, { error: 'Unknown action' });
  }
  await saveControl(c);
  // Don't make the room wait for the next browser tick.
  if (kick) after(tick({ force: true }));
  return json(200, c satisfies LiveControl);
}

const clampInt = (v: unknown, lo: number, hi: number) => Math.min(hi, Math.max(lo, Math.round(Number(v) || lo)));

/** Counter series for the Cloud X-Ray, plus the inbox and dead-letter depth read live. */
async function metrics() {
  const col = await db();
  const now = Date.now();
  const [s, inbox, dead] = await Promise.all([series(now), col.inbox.countDocuments({ city: env.city }), col.deadLetters.countDocuments({ city: env.city })]);
  return { now, series: s, queue: { visible: inbox, inFlight: 0, dlq: dead } };
}
