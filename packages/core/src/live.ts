/**
 * The contract between the cloud (Vercel functions) and the browser in Live mode:
 * pub/sub topics, message shapes, and the deterministic wall-clock → sim-clock map.
 */
import { hashString } from './rng.ts';
import type { PolicyId } from './policies.ts';
import type { ChaosEvent, Metrics, Simulation, TruckStatus } from './sim.ts';
import type { City } from './types.ts';

export const topics = {
  /** A device's readings (devices POST them to /api/ingest; the topic names the bin in docs and the inspector). */
  telemetry: (city: string, binId: string) => `binsight/${city}/bins/${binId}/telemetry`,
  /** Ingest → browsers: bin readings after they have been through the pipeline. */
  state: (city: string) => `binsight/${city}/state`,
  /** Virtual fleet → browsers: sim clock, trucks, chaos state (every fleet tick). */
  fleet: (city: string) => `binsight/${city}/fleet`,
  /** Virtual fleet → browsers: route polylines (late joiners get them from /api/state). */
  routes: (city: string) => `binsight/${city}/routes`,
  /** Virtual fleet → browsers: narrated simulation events. */
  events: (city: string) => `binsight/${city}/events`,
  /** Ingest → browsers: fires, overflows, phone dispatches. */
  alerts: (city: string) => `binsight/${city}/alerts`,
  /** Cloud → one phone. */
  phoneCmd: (city: string, phoneId: string) => `binsight/${city}/phones/${phoneId}/cmd`,
};

/**
 * The Ably channel for a topic. Same logical name, with the "binsight" prefix as
 * an Ably namespace so a token can grant `binsight:*` (Ably wildcards only work
 * after a namespace).
 */
export const channelName = (topic: string) => topic.replace(/^binsight\//, 'binsight:');

/** One sensor reading, as a device publishes it. */
export interface Telemetry {
  /** Fleet bins are their numeric id as a string; phones are "p-" + the id the server signed for them. */
  id: string;
  kind: 'fleet' | 'phone';
  /** Fill fraction 0–1.3. */
  r: number;
  ok: boolean;
  temp: number;
  gas: number;
  bat: number;
  /** Device clock, epoch ms. */
  tDevice: number;
  simT?: number;
  /** Fleet bins: which world (seed/size/epoch) produced the reading. */
  world?: string;
  nick?: string;
  emoji?: string;
  /** Phones say when a truck has just emptied them. */
  event?: 'collected';
  /** Phones: correctly sorted items in the segregation game. */
  score?: number;
}

/** A reading as the ingest function sees it: which city, and when the function received it. */
export interface IngestMessage extends Telemetry {
  city: string;
  tReceived: number;
}

export type BinStatus = 'ok' | 'filling' | 'critical' | 'overflow' | 'fire' | 'offline';

export function binStatus(t: Pick<Telemetry, 'r' | 'ok' | 'temp'>): BinStatus {
  if (!t.ok) return 'offline';
  if (t.temp > 60) return 'fire';
  if (t.r >= 1) return 'overflow';
  if (t.r >= 0.8) return 'critical';
  if (t.r >= 0.5) return 'filling';
  return 'ok';
}

/** Timestamps (epoch ms, server clock) of one message at each hop through the pipeline. */
export interface Hops {
  /** The device stamped the reading. */
  tDevice: number;
  /** The ingest function received it. */
  tReceived: number;
  /** MongoDB acknowledged the writes. */
  tStored: number;
  /** Handed to Ably for the browsers. */
  tPublish: number;
}

export interface StateUpdate {
  bins: (Telemetry & { status: BinStatus })[];
  /** Hops of the oldest message in the batch (the worst case the browser shows). */
  hops: Hops;
  batch: number;
}

export interface TruckFrame {
  id: number;
  x: number;
  z: number;
  h: number;
  st: TruckStatus;
  load: number;
  /** Index of the next stop in this truck's route. */
  si?: number;
}

export interface RouteStopFrame {
  kind: 'bin' | 'unload' | 'depot';
  node: number;
  binId?: number;
}

export interface FleetFrame {
  /** Identifies the world: when it changes, browsers rebuild their city. */
  world: string;
  simT: number;
  wallT: number;
  speed: number;
  policy: PolicyId;
  trucks: TruckFrame[];
  fires: number[];
  closed: number[];
  festival?: boolean;
  routeVersion: number;
  metrics?: Metrics;
}

export interface RoutesFrame {
  world: string;
  routeVersion: number;
  /** Each route as its start point plus the graph nodes it drives through. */
  trucks: { id: number; start: [number, number]; nodes: number[]; stops?: RouteStopFrame[] }[];
  plan?: { policy: PolicyId; bins: number; trips: number; km: number; ms: number; time: number };
}

export interface LiveEvent {
  time: number;
  kind: string;
  text: string;
  binId?: number;
  truckId?: number;
}

export interface Alert {
  kind: 'fire' | 'overflow' | 'dispatch' | 'collected' | 'joined';
  binId: string;
  text: string;
  wallT: number;
}

export interface PhoneCommand {
  type: 'dispatch' | 'collected' | 'message';
  truck?: string;
  /** Seconds until the truck arrives. */
  eta?: number;
  text?: string;
}

/** The single control record per city, in MongoDB. */
export interface LiveControl {
  city: string;
  seed: string;
  bins: number;
  trucks: number;
  speed: number;
  /** The policy now in force (for display); startPolicy plus policyChanges replays it. */
  policy: PolicyId;
  startPolicy: PolicyId;
  running: boolean;
  /** Wall clock (epoch ms) and sim time at the last anchor; sim time runs at `speed` from there. */
  anchorWall: number;
  anchorSimT: number;
  /** Bumped by every reset so browsers know to rebuild. */
  epoch: number;
  /** Policy switches, at sim times, so a from-scratch replay reproduces them. */
  policyChanges: { at: number; policy: PolicyId }[];
  events: ChaosEvent[];
  ingestPaused: boolean;
}

export const LIVE_SIM_QUANTUM = 10;
export const LIVE_START_SIM_T = 5 * 3600;

export function worldKey(c: Pick<LiveControl, 'seed' | 'bins' | 'trucks' | 'epoch'>) {
  return `${c.seed}:${c.bins}:${c.trucks}:${c.epoch}`;
}

/**
 * Sim time for a wall-clock instant, rounded down to the simulator's 10 s tick
 * so that every replay from scratch steps through exactly the same ticks.
 */
export function simTimeAt(c: Pick<LiveControl, 'running' | 'anchorWall' | 'anchorSimT' | 'speed'>, wallMs: number): number {
  const t = c.running ? c.anchorSimT + ((wallMs - c.anchorWall) / 1000) * c.speed : c.anchorSimT;
  return Math.floor(t / LIVE_SIM_QUANTUM) * LIVE_SIM_QUANTUM;
}

export function defaultControl(city: string): LiveControl {
  return {
    city,
    seed: 'binsight',
    bins: 120,
    trucks: 4,
    speed: 60,
    policy: 'dynamic',
    startPolicy: 'dynamic',
    running: false,
    anchorWall: Date.now(),
    anchorSimT: LIVE_START_SIM_T,
    epoch: 1,
    policyChanges: [],
    events: [],
    ingestPaused: false,
  };
}

/** Where a phone's bin appears in the city: a stable spot derived from its id. */
export function phonePlacement(city: City, id: string): { x: number; z: number } {
  const junctions = city.nodes.filter((n) => n.kind === 'junction');
  const h = hashString(id);
  const n = junctions[h % junctions.length];
  const angle = ((h >>> 8) % 360) * (Math.PI / 180);
  return { x: n.x + Math.cos(angle) * 14, z: n.z + Math.sin(angle) * 14 };
}

export const PHONE_EMOJI = ['🐯', '🦊', '🐼', '🐸', '🦁', '🐵', '🐙', '🦄', '🐝', '🐳', '🦖', '🐧'];

const round1 = (v: number) => Math.round(v * 10) / 10;

/** The twice-a-second fleet message, built from a simulation. */
export function buildFleetFrame(sim: Simulation, world: string, speed: number, withMetrics: boolean): FleetFrame {
  return {
    world,
    simT: sim.time,
    wallT: Date.now(),
    speed,
    policy: sim.config.policy,
    trucks: sim.trucks.map((t) => ({ id: t.id, x: round1(t.x), z: round1(t.z), h: Math.round(t.heading * 100) / 100, st: t.status, load: Math.round(t.load), si: t.stopIndex })),
    fires: [...sim.fires.keys()],
    closed: sim.closures.flatMap((c) => c.edges),
    festival: sim.festivalUntil > sim.time,
    routeVersion: sim.routeVersion,
    metrics: withMetrics ? sim.metrics : undefined,
  };
}

/** The retained routes message, built from a simulation. */
export function buildRoutesFrame(sim: Simulation, world: string): RoutesFrame {
  const plan = sim.lastPlan;
  return {
    world,
    routeVersion: sim.routeVersion,
    trucks: sim.trucks
      .filter((t) => t.route && t.status !== 'broken')
      .map((t) => ({
        id: t.id,
        start: [round1(t.route!.xs[0]), round1(t.route!.zs[0])] as [number, number],
        nodes: t.route!.nodes.slice(1),
        stops: t.route!.stops.map((s) => ({ kind: s.kind, node: s.node, binId: s.binId })),
      })),
    plan: plan
      ? { policy: plan.policy, bins: plan.binIds.length, trips: plan.solution.tripCount, km: Math.round(plan.solution.totalLength) / 1000, ms: Math.round(plan.solution.ms), time: plan.time }
      : undefined,
  };
}
