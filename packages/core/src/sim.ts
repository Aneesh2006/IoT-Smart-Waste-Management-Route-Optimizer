import { generateCity } from './city.ts';
import { DistanceTable, edgeBetween, isConnected } from './graph.ts';
import { POLICIES, type PolicyContext, type PolicyId } from './policies.ts';
import { DAY, HOUR, formatClock, profileRate } from './profiles.ts';
import { createRng, type Rng } from './rng.ts';
import { solveVrp, type Construction, type TruckPlan, type VrpSolution, type VrpStop } from './routing/cvrp.ts';
import type { City, DistrictKind } from './types.ts';

export interface ShiftWindow {
  start: number;
  end: number;
}

export interface SimConfig {
  seed: string;
  bins: number;
  trucks: number;
  truckCapacityL: number;
  policy: PolicyId;
  threshold: number;
  shifts: ShiftWindow[];
  construction: Construction;
  improve: boolean;
  /** Hour of Monday the clock starts at. */
  startHour: number;
  /** Disruptions scheduled in advance (Compare uses this to replay a scenario under every policy). */
  events: ChaosEvent[];
  /** Policy switches at sim times (Live mode replays these from scratch). */
  policyChanges: { at: number; policy: PolicyId }[];
  /** Bin capacity upgrades from the capacity planner, litres by bin id. */
  capacityOverrides: Record<number, number>;
}

export type ChaosKind = 'festival' | 'flood' | 'breakdown' | 'sensors' | 'fire';

export interface ChaosEvent {
  /** Sim time, seconds. */
  at: number;
  kind: ChaosKind;
}

export const CHAOS_INFO: Record<ChaosKind, { name: string; question: string }> = {
  festival: { name: 'Festival night', question: 'What happens when the forecast is wrong?' },
  flood: { name: 'Monsoon flooding', question: 'What if a main road goes under water?' },
  breakdown: { name: 'Truck breakdown', question: 'What if a truck dies mid-route?' },
  sensors: { name: 'Sensors go dark', question: 'What does a dead sensor cost?' },
  fire: { name: 'Bin fire', question: 'Can the system react to an emergency?' },
};

export const CHAOS_ORDER: ChaosKind[] = ['festival', 'flood', 'breakdown', 'sensors', 'fire'];

export const DEFAULT_CONFIG: SimConfig = {
  seed: 'binsight',
  bins: 120,
  trucks: 4,
  truckCapacityL: 10000,
  policy: 'predictive',
  threshold: 0.7,
  shifts: [
    { start: 6, end: 12 },
    { start: 15, end: 21 },
  ],
  construction: 'savings',
  improve: true,
  startHour: 5,
  events: [],
  policyChanges: [],
  capacityOverrides: {},
};

/** Assumptions behind every rupee and kilogram on screen; keep them in one place. */
export const COSTS = {
  dieselInrPerL: 92,
  fuelLPerKm: 0.38,
  co2KgPerL: 2.68,
  crewInrPerHour: 450,
  serviceSeconds: 75,
  unloadSeconds: 480,
  /** A pickup below this fill is counted as a wasted visit. */
  wastedBelow: 0.3,
};

/** What happens after the transfer station. Teaching assumptions, not measurements. */
export const PROCESSING = {
  /** Loose household waste, kg per litre. */
  densityKgPerL: 0.25,
  wetToCompost: 0.85,
  dryToRecycling: 0.55,
};

export const SAMPLE_SECONDS = 15 * 60;
const MAX_STEP = 10;
const HISTORY_SAMPLES = 7 * 96;

export interface BinState {
  id: number;
  /** True fill fraction (can pass 1: that is litter on the pavement). */
  fill: number;
  /** What the ultrasonic sensor last reported. */
  reading: number;
  readingAt: number;
  temperature: number;
  gas: number;
  battery: number;
  sensorOk: boolean;
  /** Learned fill rate per hour of day, fraction of capacity per hour. */
  rate: Float32Array;
  /** Sensor readings, one per sample, oldest first. */
  history: number[];
  overflowing: boolean;
  lastCollectedAt: number;
  collections: number;
  /** Truck on its way, or -1. */
  assigned: number;
  noise: number;
  hourStartReading: number;
  collectedThisHour: boolean;
  /** Lifetime totals, for heatmaps. */
  generatedL: number;
  overflowHours: number;
  /** This bin's 3-hour forecast error so far. */
  forecastN: number;
  forecastAbs: number;
}

export type TruckStatus = 'idle' | 'driving' | 'collecting' | 'unloading' | 'returning' | 'broken';

export interface RouteStop {
  /** Distance along the route, metres. */
  at: number;
  kind: 'bin' | 'unload' | 'depot';
  node: number;
  binId?: number;
}

export interface Route {
  /** Graph node at each point, or -1 for a point partway along a road. */
  nodes: number[];
  xs: number[];
  zs: number[];
  cum: number[];
  speeds: number[];
  stops: RouteStop[];
  length: number;
}

export interface TruckState {
  id: number;
  name: string;
  capacity: number;
  load: number;
  x: number;
  z: number;
  heading: number;
  status: TruckStatus;
  route: Route | null;
  /** Distance travelled along the current route. */
  d: number;
  seg: number;
  stopIndex: number;
  serviceLeft: number;
  odometer: number;
  busySeconds: number;
  binsToday: number;
  /** When a broken-down truck is back in service. */
  brokenUntil: number;
  /** Status changes over time, for the fleet timeline. */
  log: { t: number; s: TruckStatus }[];
}

export interface Metrics {
  distanceM: number;
  fuelL: number;
  co2Kg: number;
  costInr: number;
  collectedL: number;
  visits: number;
  wastedVisits: number;
  overflowEvents: number;
  overflowBinHours: number;
  crewHours: number;
  tippedWetL: number;
  tippedDryL: number;
  /** Litres collected per district. */
  collectedByDistrict: Partial<Record<DistrictKind, number>>;
  /** Litres collected per `district:stream`, for the waste-flow diagram. */
  collectedFlows: Record<string, number>;
}

/** A compact recording of the city every sensor sample, for time-lapse replay. */
export interface TapeFrame {
  time: number;
  fills: Float32Array;
  /** x, z, heading per truck. */
  trucks: Float32Array;
  overflowing: number;
}

/** How well the forecaster predicted fill three hours ahead, against the untrained district prior. */
export interface ForecastStats {
  n: number;
  /** Mean absolute error in fill fraction. */
  mae: number;
  priorMae: number;
  byDay: { day: number; n: number; mae: number; priorMae: number }[];
}

export const FORECAST_AHEAD = 3 * 3600;

export interface Snapshot {
  time: number;
  overflowing: number;
  critical: number;
  avgFill: number;
  distanceKm: number;
  wastedVisits: number;
  overflowEvents: number;
}

export type EventKind = 'plan' | 'overflow' | 'unload' | 'return' | 'info' | 'warn' | 'alert';

export interface SimEvent {
  id: number;
  time: number;
  kind: EventKind;
  text: string;
  binId?: number;
  truckId?: number;
}

export interface ShiftPlan {
  time: number;
  shift: number;
  policy: PolicyId;
  binIds: number[];
  solution: VrpSolution;
}

const emptyMetrics = (): Metrics => ({
  distanceM: 0,
  fuelL: 0,
  co2Kg: 0,
  costInr: 0,
  collectedL: 0,
  visits: 0,
  wastedVisits: 0,
  overflowEvents: 0,
  overflowBinHours: 0,
  crewHours: 0,
  tippedWetL: 0,
  tippedDryL: 0,
  collectedByDistrict: {},
  collectedFlows: {},
});

export class Simulation {
  readonly config: SimConfig;
  readonly city: City;
  readonly table: DistanceTable;
  time: number;
  bins: BinState[];
  trucks: TruckState[];
  metrics: Metrics = emptyMetrics();
  snapshots: Snapshot[] = [];
  tape: TapeFrame[] = [];
  /** The latest bin pickups, newest last, for collection effects. */
  pickups: { id: number; binId: number; truckId: number; litres: number; time: number; wasted: boolean }[] = [];
  private pickupId = 0;
  forecastStats: ForecastStats = { n: 0, mae: 0, priorMae: 0, byDay: [] };
  private pendingForecasts: { due: number; binId: number; predicted: number; prior: number; collections: number }[] = [];
  events: SimEvent[] = [];
  lastPlan: ShiftPlan | null = null;
  /** Bumped whenever routes change, so renderers know to rebuild ribbons. */
  routeVersion = 0;
  /** Bumped whenever roads close or reopen. */
  roadVersion = 0;
  /** Burning bins and when they burn out. */
  fires = new Map<number, number>();
  closures: { edges: number[]; until: number; name: string }[] = [];
  /** Sim time a festival ends (0 when none is on), for the renderer. */
  festivalUntil = 0;
  private boosts: { district: DistrictKind; factor: number; until: number }[] = [];
  private sensorRepairs: { bins: number[]; at: number }[] = [];
  private pending: ChaosEvent[];
  private pendingPolicies: { at: number; policy: PolicyId }[];
  private eventId = 0;
  private rFill: Rng;
  private rSensor: Rng;
  private rChaos: Rng;

  constructor(config: Partial<SimConfig> = {}, city?: City) {
    const given = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as Partial<SimConfig>;
    this.config = { ...DEFAULT_CONFIG, ...given };
    this.config.shifts = this.config.shifts.map((s) => ({ ...s }));
    this.city = city ?? generateCity({ seed: this.config.seed, bins: this.config.bins });
    this.config.capacityOverrides = { ...this.config.capacityOverrides };
    for (const [id, litres] of Object.entries(this.config.capacityOverrides)) {
      const site = this.city.bins[Number(id)];
      if (site) site.capacityL = litres;
    }
    this.table = new DistanceTable(this.city);
    const rng = createRng(this.config.seed);
    this.rFill = rng.fork('fill');
    this.rSensor = rng.fork('sensor');
    this.rChaos = rng.fork('chaos');
    this.config.events = this.config.events.map((e) => ({ ...e }));
    this.pending = [...this.config.events].sort((a, b) => a.at - b.at);
    this.config.policyChanges = this.config.policyChanges.map((p) => ({ ...p }));
    this.pendingPolicies = [...this.config.policyChanges].sort((a, b) => a.at - b.at);
    const rInit = rng.fork('init');
    this.time = this.config.startHour * HOUR;

    this.bins = this.city.bins.map((site) => {
      const start = Math.min(0.85, Math.max(0.02, rInit.range(0.05, 0.55) * (site.district === 'market' ? 1.4 : 1)));
      const rate = new Float32Array(24);
      for (let h = 0; h < 24; h++) rate[h] = profileRate(site.district, h * HOUR);
      return {
        id: site.id,
        fill: start,
        reading: start,
        readingAt: this.time,
        temperature: 26,
        gas: 20,
        battery: rInit.range(55, 100),
        sensorOk: true,
        rate,
        history: [start],
        overflowing: false,
        lastCollectedAt: this.time - rInit.range(6, 30) * HOUR,
        collections: 0,
        assigned: -1,
        noise: 1,
        hourStartReading: start,
        collectedThisHour: false,
        // Count what was already in the bin, so collected never exceeds generated.
        generatedL: start * site.capacityL,
        overflowHours: 0,
        forecastN: 0,
        forecastAbs: 0,
      };
    });

    const depot = this.city.depot;
    this.trucks = Array.from({ length: this.config.trucks }, (_, id) => ({
      id,
      name: `Truck ${id + 1}`,
      capacity: this.config.truckCapacityL,
      load: 0,
      x: depot.x,
      z: depot.z + (id - (this.config.trucks - 1) / 2) * 14,
      heading: Math.PI / 2,
      status: 'idle' as TruckStatus,
      route: null,
      d: 0,
      seg: 0,
      stopIndex: 0,
      serviceLeft: 0,
      odometer: 0,
      busySeconds: 0,
      binsToday: 0,
      brokenUntil: 0,
      log: [{ t: this.time, s: 'idle' as TruckStatus }],
    }));
    this.snapshot();
    this.log('info', `City "${this.config.seed}" online: ${this.bins.length} smart bins, ${this.trucks.length} trucks.`);
  }

  get policy() {
    return POLICIES[this.config.policy];
  }

  setPolicy(id: PolicyId) {
    this.config.policy = id;
    this.log('info', `Policy switched to ${POLICIES[id].name}. Takes effect at the next shift.`);
  }

  /** Advance the world by `seconds` of simulated time. */
  advance(seconds: number) {
    let left = seconds;
    while (left > 1e-9) {
      const h = Math.min(left, MAX_STEP);
      this.tick(h);
      left -= h;
    }
  }

  /** Seconds until the next shift begins. */
  nextShiftStart(after = this.time): number {
    const day = Math.floor(after / DAY);
    for (let k = 0; k < 3; k++) {
      for (const s of this.config.shifts) {
        const t = (day + k) * DAY + s.start * HOUR;
        if (t > after + 1e-6) return t;
      }
    }
    return after + DAY;
  }

  /** Current shift index, or -1 between shifts. */
  shiftAt(time = this.time) {
    const h = (time % DAY) / HOUR;
    return this.config.shifts.findIndex((s) => h >= s.start && h < s.end);
  }

  /** Learned forecast of a bin's fill fraction at a future time. */
  forecast(binId: number, at: number): number {
    const b = this.bins[binId];
    let f = b.reading;
    let t = b.readingAt;
    while (t < at) {
      const hourEnd = (Math.floor(t / HOUR) + 1) * HOUR;
      const step = Math.min(hourEnd, at) - t;
      f += (b.rate[Math.floor((t % DAY) / HOUR)] * step) / HOUR;
      t += step;
    }
    return f;
  }

  /** Hours until the forecast crosses full, or null if not within three days. */
  hoursToFull(binId: number): number | null {
    const b = this.bins[binId];
    if (b.reading >= 1) return 0;
    let f = b.reading;
    let t = b.readingAt;
    const limit = t + 72 * HOUR;
    while (t < limit) {
      const r = b.rate[Math.floor((t % DAY) / HOUR)];
      const hourEnd = (Math.floor(t / HOUR) + 1) * HOUR;
      const step = hourEnd - t;
      const gain = (r * step) / HOUR;
      if (f + gain >= 1) return Math.max(0, (t + ((1 - f) / Math.max(r, 1e-9)) * HOUR - this.time) / HOUR);
      f += gain;
      t = hourEnd;
    }
    return null;
  }

  /** Plan the next shift right now (the "Plan shift" button). */
  planNow() {
    const shift = Math.max(0, this.shiftAt());
    this.planShift(shift);
  }

  private tick(h: number) {
    const t0 = this.time;
    const t1 = t0 + h;
    this.updateBins(t0, h);
    for (const truck of this.trucks) this.moveTruck(truck, h);
    this.time = t1;
    for (const truck of this.trucks) {
      const last = truck.log[truck.log.length - 1];
      if (last.s !== truck.status) {
        truck.log.push({ t: t1, s: truck.status });
        if (truck.log.length > 3000) truck.log.shift();
      }
    }

    if (Math.floor(t1 / SAMPLE_SECONDS) !== Math.floor(t0 / SAMPLE_SECONDS)) {
      this.sampleSensors();
      this.scoreForecasts();
      this.record();
    }
    for (let k = 0; k < this.config.shifts.length; k++) {
      const start = this.config.shifts[k].start * HOUR;
      const a = t0 % DAY;
      const b = a + h;
      if (a < start && b >= start) this.planShift(k);
    }
    while (this.pendingPolicies.length && this.pendingPolicies[0].at <= t1) this.setPolicy(this.pendingPolicies.shift()!.policy);
    while (this.pending.length && this.pending[0].at <= t1) this.applyChaos(this.pending.shift()!.kind);
    if (Math.floor(t1 / 60) !== Math.floor(t0 / 60)) this.expireChaos();
    if (Math.floor(t1 / HOUR) !== Math.floor(t0 / HOUR)) {
      this.snapshot();
      this.maybeReplan();
    }
  }

  /** Mid-shift re-planning for policies that support it (Dynamic). */
  private maybeReplan() {
    const policy = this.policy;
    const shift = this.shiftAt();
    if (!policy.replan || shift === -1) return;
    // The shift-start plan has just been made; don't second-guess it in the same hour.
    if ((this.time % DAY) / HOUR - this.config.shifts[shift].start < 0.5) return;
    if (!this.trucks.some((t) => t.status === 'idle')) return;
    const ids = policy.replan(this.policyContext(shift));
    if (ids.length === 0) return;
    this.plan(shift, ids, 'Re-plan');
  }

  private policyContext(shift: number): PolicyContext {
    const window = this.config.shifts[shift];
    return {
      time: this.time,
      shift,
      nextShiftStart: this.nextShiftStart(),
      shiftHours: window.end - window.start,
      sites: this.city.bins,
      bins: this.bins.filter((b) => b.assigned === -1),
      threshold: this.config.threshold,
      forecast: (id, at) => this.forecast(id, at),
      distance: (a, b) => this.table.distance(this.city.bins[a].node, this.city.bins[b].node),
    };
  }

  private updateBins(t0: number, h: number) {
    const sites = this.city.bins;
    for (const b of this.bins) {
      const site = sites[b.id];
      let rate = profileRate(site.district, t0) * site.busyness * b.noise;
      for (const boost of this.boosts) if (boost.district === site.district) rate *= boost.factor;
      b.fill += (rate * h) / HOUR;
      b.generatedL += ((rate * h) / HOUR) * site.capacityL;
      if (b.fill >= 1) {
        if (!b.overflowing) {
          b.overflowing = true;
          this.metrics.overflowEvents++;
          this.log('overflow', `${site.label} is overflowing.`, { binId: b.id });
        }
        this.metrics.overflowBinHours += h / HOUR;
        b.overflowHours += h / HOUR;
      }
    }
  }

  private sampleSensors() {
    const hourBoundary = this.time % HOUR < SAMPLE_SECONDS / 2 || HOUR - (this.time % HOUR) < 1e-6;
    const hourOfDay = Math.floor((this.time % DAY) / HOUR);
    const ambient = 27 + 5 * Math.sin((2 * Math.PI * (hourOfDay - 9)) / 24);
    for (const b of this.bins) {
      const site = this.city.bins[b.id];
      b.noise = Math.exp(this.rFill.normal(0, 0.22));
      b.battery = Math.max(0, b.battery - 0.004);
      if (!b.sensorOk) continue;
      const reading = Math.min(1.3, Math.max(0, b.fill + this.rSensor.normal(0, 0.012)));
      b.reading = reading;
      b.readingAt = this.time;
      b.history.push(reading);
      if (b.history.length > HISTORY_SAMPLES) b.history.shift();
      const ageH = (this.time - b.lastCollectedAt) / HOUR;
      const wet = site.stream === 'wet';
      b.temperature = ambient + (wet ? 7 : 2) * Math.min(1, b.fill) + this.rSensor.normal(0, 0.4);
      b.gas = (wet ? 30 + 520 * Math.min(1, b.fill) * Math.min(1, ageH / 36) : 12 + 40 * Math.min(1, b.fill)) + this.rSensor.normal(0, 3);
      if (this.fires.has(b.id)) {
        b.temperature = 78 + this.rSensor.range(0, 25);
        b.gas = 900 + this.rSensor.range(0, 400);
      }

      if (hourBoundary) {
        // Learn the bin's rhythm from the last hour, unless a truck emptied it meanwhile.
        if (!b.collectedThisHour) {
          const prevHour = (hourOfDay + 23) % 24;
          const observed = Math.max(0, reading - b.hourStartReading);
          b.rate[prevHour] = b.rate[prevHour] * 0.65 + observed * 0.35;
        }
        b.hourStartReading = reading;
        b.collectedThisHour = false;
      }
    }
  }

  private planShift(shift: number) {
    if (!this.trucks.some((t) => t.status === 'idle')) {
      this.log('warn', 'Shift start: every truck is still out, nothing planned.');
      return;
    }
    this.plan(shift, this.policy.select(this.policyContext(shift)), 'shift');
  }

  private plan(shift: number, binIds: number[], label: string) {
    const idle = this.trucks.filter((t) => t.status === 'idle');
    const policy = this.policy;
    const stops: VrpStop[] = binIds.map((id) => {
      const site = this.city.bins[id];
      const expected = policy.id === 'fixed' ? 0.6 : Math.min(1.2, Math.max(this.bins[id].reading, this.forecast(id, this.time + 2 * HOUR)));
      return { node: site.node, demand: expected * site.capacityL, ref: id };
    });
    const solution = solveVrp(
      {
        depot: this.city.depot.node,
        hub: this.city.landfill.node,
        stops,
        capacity: this.config.truckCapacityL,
        trucks: idle.length,
        dist: (a, b) => this.table.distance(a, b),
        serviceSeconds: COSTS.serviceSeconds,
        unloadSeconds: COSTS.unloadSeconds,
        avgSpeed: 8,
      },
      { construction: this.config.construction, improve: this.config.improve },
    );
    solution.trucks.forEach((plan, k) => {
      if (plan.trips.length === 0) return;
      this.dispatch(idle[k], plan, stops);
    });
    this.lastPlan = { time: this.time, shift, policy: policy.id, binIds, solution };
    this.routeVersion++;
    const used = solution.trucks.filter((t) => t.trips.length > 0).length;
    const when = `${formatClock(this.time)} ${label}`;
    this.log(
      'plan',
      binIds.length === 0
        ? `${when}: ${policy.short} policy found nothing worth collecting.`
        : `${when}: ${policy.short} picked ${binIds.length} bins → ${used} trucks, ${solution.tripCount} trips, ${(solution.totalLength / 1000).toFixed(1)} km planned in ${solution.ms.toFixed(0)} ms.`,
    );
  }

  private dispatch(truck: TruckState, plan: TruckPlan, stops: VrpStop[]) {
    const seq: { node: number; kind: RouteStop['kind']; binId?: number }[] = [];
    for (const trip of plan.trips) {
      for (const i of trip.stops) seq.push({ node: stops[i].node, kind: 'bin', binId: stops[i].ref });
      seq.push({ node: this.city.landfill.node, kind: 'unload' });
    }
    seq.push({ node: this.city.depot.node, kind: 'depot' });

    const depot = this.city.nodes[this.city.depot.node];
    const route = this.buildRoute(truck, depot.x, depot.z, this.city.depot.node, seq);
    truck.route = route;
    truck.d = 0;
    truck.seg = 0;
    truck.stopIndex = 0;
    truck.serviceLeft = 0;
    truck.binsToday = 0;
    truck.status = 'driving';
    truck.x = route.xs[0];
    truck.z = route.zs[0];
  }

  /**
   * Road route from a point (on node `startNode`, or partway along a road toward
   * it) through a sequence of stops. Unreachable stops are skipped and logged.
   */
  private buildRoute(
    truck: TruckState,
    x: number,
    z: number,
    startNode: number,
    seq: { node: number; kind: RouteStop['kind']; binId?: number }[],
  ): Route {
    const nodes = this.city.nodes;
    const route: Route = { nodes: [startNode], xs: [x], zs: [z], cum: [0], speeds: [], stops: [], length: 0 };
    const lead = Math.hypot(nodes[startNode].x - x, nodes[startNode].z - z);
    if (lead > 1e-6) {
      // Partway along a road: finish it first.
      route.nodes[0] = -1;
      route.length += lead;
      route.nodes.push(startNode);
      route.xs.push(nodes[startNode].x);
      route.zs.push(nodes[startNode].z);
      route.cum.push(route.length);
      route.speeds.push(7);
    }
    let cur = startNode;
    for (const s of seq) {
      const path = this.table.path(cur, s.node);
      if (path.length === 0) {
        this.log('warn', `${truck.name} cannot reach a stop: the road is cut.`, { truckId: truck.id });
        if (s.binId !== undefined) this.bins[s.binId].assigned = -1;
        continue;
      }
      for (let k = 1; k < path.length; k++) {
        const edge = edgeBetween(this.city, path[k - 1], path[k])!;
        route.length += edge.length;
        route.nodes.push(path[k]);
        route.xs.push(nodes[path[k]].x);
        route.zs.push(nodes[path[k]].z);
        route.cum.push(route.length);
        route.speeds.push(edge.speed);
      }
      route.stops.push({ at: route.length, kind: s.kind, node: s.node, binId: s.binId });
      if (s.binId !== undefined) this.bins[s.binId].assigned = truck.id;
      cur = s.node;
    }
    return route;
  }

  private moveTruck(t: TruckState, h: number) {
    const route = t.route;
    if (!route || t.status === 'broken') return;
    let time = h;
    const startOdo = t.odometer;
    while (time > 1e-9 && t.route) {
      if (t.serviceLeft > 0) {
        const used = Math.min(time, t.serviceLeft);
        t.serviceLeft -= used;
        time -= used;
        t.busySeconds += used;
        if (t.serviceLeft <= 1e-9) t.status = this.nextStop(t)?.kind === 'depot' ? 'returning' : 'driving';
        continue;
      }
      const stop = route.stops[t.stopIndex];
      if (!stop) {
        t.route = null;
        t.status = 'idle';
        break;
      }
      if (t.d >= stop.at - 1e-6) {
        this.arrive(t, stop);
        t.stopIndex++;
        continue;
      }
      const segEnd = route.cum[t.seg + 1];
      const target = Math.min(segEnd, stop.at);
      const speed = route.speeds[t.seg] ?? 8;
      const need = (target - t.d) / speed;
      if (need <= time) {
        t.odometer += target - t.d;
        t.d = target;
        time -= need;
        t.busySeconds += need;
      } else {
        t.d += speed * time;
        t.odometer += speed * time;
        t.busySeconds += time;
        time = 0;
      }
      while (t.seg < route.speeds.length - 1 && t.d >= route.cum[t.seg + 1] - 1e-9) t.seg++;
    }
    this.placeTruck(t, route);
    const driven = t.odometer - startOdo;
    if (driven > 0) {
      const fuel = (driven / 1000) * COSTS.fuelLPerKm;
      this.metrics.distanceM += driven;
      this.metrics.fuelL += fuel;
      this.metrics.co2Kg += fuel * COSTS.co2KgPerL;
      this.metrics.costInr += fuel * COSTS.dieselInrPerL;
    }
    const crewH = h / HOUR;
    this.metrics.crewHours += crewH;
    this.metrics.costInr += crewH * COSTS.crewInrPerHour;
  }

  private nextStop(t: TruckState) {
    return t.route?.stops[t.stopIndex];
  }

  private placeTruck(t: TruckState, route: Route) {
    const s = Math.min(t.seg, Math.max(0, route.xs.length - 2));
    const a = route.cum[s];
    const b = route.cum[s + 1] ?? a;
    const f = b > a ? Math.min(1, Math.max(0, (t.d - a) / (b - a))) : 1;
    const dx = (route.xs[s + 1] ?? route.xs[s]) - route.xs[s];
    const dz = (route.zs[s + 1] ?? route.zs[s]) - route.zs[s];
    t.x = route.xs[s] + dx * f;
    t.z = route.zs[s] + dz * f;
    if (dx !== 0 || dz !== 0) t.heading = Math.atan2(dx, dz);
  }

  private arrive(t: TruckState, stop: RouteStop) {
    if (stop.kind === 'bin' && stop.binId !== undefined) {
      const b = this.bins[stop.binId];
      const site = this.city.bins[stop.binId];
      const litres = Math.min(b.fill * site.capacityL, t.capacity - t.load);
      if (b.fill < COSTS.wastedBelow) this.metrics.wastedVisits++;
      this.pickups.push({ id: this.pickupId++, binId: b.id, truckId: t.id, litres, time: this.time, wasted: b.fill < COSTS.wastedBelow });
      if (this.pickups.length > 40) this.pickups.shift();
      this.metrics.visits++;
      this.metrics.collectedL += litres;
      this.metrics.collectedByDistrict[site.district] = (this.metrics.collectedByDistrict[site.district] ?? 0) + litres;
      const flow = `${site.district}:${site.stream}`;
      this.metrics.collectedFlows[flow] = (this.metrics.collectedFlows[flow] ?? 0) + litres;
      t.load += litres;
      b.fill -= litres / site.capacityL;
      if (b.fill < 1) b.overflowing = false;
      b.lastCollectedAt = this.time;
      b.collections++;
      b.assigned = -1;
      b.collectedThisHour = true;
      if (this.fires.delete(b.id)) this.log('info', `${site.label}: fire put out by ${t.name}'s crew.`, { binId: b.id });
      t.binsToday++;
      t.serviceLeft = COSTS.serviceSeconds;
      t.status = 'collecting';
    } else if (stop.kind === 'unload') {
      const wetShare = this.estimateWetShare(t);
      this.metrics.tippedWetL += t.load * wetShare;
      this.metrics.tippedDryL += t.load * (1 - wetShare);
      this.log('unload', `${t.name} tipped ${Math.round(t.load).toLocaleString('en-IN')} L at the transfer station.`, { truckId: t.id });
      t.load = 0;
      t.serviceLeft = COSTS.unloadSeconds;
      t.status = 'unloading';
    } else {
      t.route = null;
      t.status = 'idle';
      this.log('return', `${t.name} back at depot after ${t.binsToday} bins.`, { truckId: t.id });
    }
  }

  private estimateWetShare(t: TruckState) {
    const route = t.route;
    if (!route) return 0.5;
    let wet = 0;
    let all = 0;
    for (let i = t.stopIndex - 1; i >= 0; i--) {
      const s = route.stops[i];
      if (s.kind === 'unload') break;
      if (s.binId === undefined) continue;
      all++;
      if (this.city.bins[s.binId].stream === 'wet') wet++;
    }
    return all ? wet / all : 0.5;
  }

  /** Trigger a disruption right now (the Chaos buttons). */
  trigger(kind: ChaosKind) {
    this.applyChaos(kind);
  }

  private applyChaos(kind: ChaosKind) {
    const r = this.rChaos;
    switch (kind) {
      case 'festival': {
        this.boosts.push({ district: 'market', factor: 3.2, until: this.time + 10 * HOUR });
        this.festivalUntil = this.time + 10 * HOUR;
        this.boosts.push({ district: 'park', factor: 2, until: this.time + 10 * HOUR });
        this.log('alert', 'Festival night: market waste ×3 and parks ×2 for 10 hours. The forecaster has never seen this.');
        break;
      }
      case 'flood': {
        const closed = this.closeArterial(r);
        if (!closed) {
          this.log('warn', 'Flood: no main road could close without cutting the city in two.');
          break;
        }
        this.closures.push({ ...closed, until: this.time + 12 * HOUR });
        this.roadVersion++;
        this.table.invalidate();
        const rerouted = this.rerouteAll();
        const metres = closed.edges.reduce((s, e) => s + this.city.edges[e].length, 0);
        this.log('alert', `Monsoon flooding closes ${Math.round(metres)} m of ${closed.name} for 12 h. ${rerouted} truck${rerouted === 1 ? '' : 's'} re-routed.`);
        break;
      }
      case 'breakdown': {
        const busy = this.trucks.filter((t) => t.route && t.status !== 'broken' && t.status !== 'returning');
        const t = busy.length ? r.pick(busy) : null;
        if (!t) {
          this.log('warn', 'Breakdown: every truck is parked, nothing to break.');
          break;
        }
        let released = 0;
        for (const s of t.route!.stops.slice(t.stopIndex)) {
          if (s.binId !== undefined && this.bins[s.binId].assigned === t.id) {
            this.bins[s.binId].assigned = -1;
            released++;
          }
        }
        t.status = 'broken';
        t.brokenUntil = this.time + 4 * HOUR;
        this.routeVersion++;
        this.log('alert', `${t.name} broke down with ${released} bins still to collect. Towing in 4 h.`, { truckId: t.id });
        break;
      }
      case 'sensors': {
        const live = this.bins.filter((b) => b.sensorOk);
        const dead = r.shuffle(live).slice(0, Math.min(8, live.length));
        for (const b of dead) {
          b.sensorOk = false;
          b.battery = 0;
        }
        this.sensorRepairs.push({ bins: dead.map((b) => b.id), at: this.time + 24 * HOUR });
        this.log('alert', `${dead.length} bin sensors went dark. Their last reading is all the planner has until the technician's round tomorrow.`);
        break;
      }
      case 'fire': {
        const candidates = this.bins.filter((b) => !this.fires.has(b.id) && b.fill > 0.4 && this.city.bins[b.id].stream === 'wet');
        const b = candidates.length ? r.pick(candidates) : r.pick(this.bins);
        this.fires.set(b.id, this.time + 3 * HOUR);
        const site = this.city.bins[b.id];
        b.temperature = 85;
        b.gas = 1100;
        this.log('alert', `Fire in ${site.label}: 85 °C and smoke on the gas sensor.`, { binId: b.id });
        if (b.assigned === -1) {
          if (this.trucks.some((t) => t.status === 'idle')) this.plan(Math.max(0, this.shiftAt()), [b.id], 'Emergency');
          else this.log('warn', `No truck free for ${site.label}; it waits for the next one back.`, { binId: b.id });
        }
        break;
      }
    }
  }

  /** Called once a sim-minute: lift disruptions whose time is up. */
  private expireChaos() {
    const now = this.time;
    this.boosts = this.boosts.filter((b) => b.until > now);
    for (const [id, until] of this.fires) {
      if (until > now) continue;
      this.fires.delete(id);
      this.bins[id].fill *= 0.6;
      this.log('info', `${this.city.bins[id].label}: fire burnt itself out.`, { binId: id });
    }
    const open = this.closures.filter((c) => c.until <= now);
    if (open.length) {
      for (const c of open) for (const e of c.edges) this.city.edges[e].closed = false;
      this.closures = this.closures.filter((c) => c.until > now);
      this.roadVersion++;
      this.table.invalidate();
      this.log('info', `Flood water receded; ${open.map((c) => c.name).join(', ')} open again.`);
    }
    for (const rep of this.sensorRepairs.filter((x) => x.at <= now)) {
      for (const id of rep.bins) {
        this.bins[id].sensorOk = true;
        this.bins[id].battery = 100;
      }
      this.log('info', `Technician replaced ${rep.bins.length} dead sensors.`);
    }
    this.sensorRepairs = this.sensorRepairs.filter((x) => x.at > now);
    for (const t of this.trucks) {
      if (t.status !== 'broken' || t.brokenUntil > now) continue;
      t.status = 'idle';
      t.route = null;
      t.load = 0;
      t.x = this.city.depot.x;
      t.z = this.city.depot.z;
      this.routeVersion++;
      this.log('info', `${t.name} towed back and repaired.`, { truckId: t.id });
    }
    // An unattended fire gets the next idle truck.
    for (const id of this.fires.keys()) {
      if (this.bins[id].assigned !== -1 || !this.trucks.some((t) => t.status === 'idle')) continue;
      this.plan(Math.max(0, this.shiftAt()), [id], 'Emergency');
    }
  }

  /** Close a run of arterial road near the centre, keeping the city connected. */
  private closeArterial(r: Rng): { edges: number[]; name: string } | null {
    const { x0, x1, z0, z1 } = this.city.bounds;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const nodes = this.city.nodes;
    const arterials = this.city.edges.filter((e) => e.arterial && !e.closed && nodes[e.a].kind !== 'depot' && nodes[e.b].kind !== 'depot' && nodes[e.a].kind !== 'landfill' && nodes[e.b].kind !== 'landfill' && nodes[e.a].kind !== 'recycling' && nodes[e.b].kind !== 'recycling');
    const central = arterials
      .map((e) => ({ e, d: Math.hypot((nodes[e.a].x + nodes[e.b].x) / 2 - cx, (nodes[e.a].z + nodes[e.b].z) / 2 - cz) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 12);
    if (!central.length) return null;
    const seed = r.pick(central).e;
    const horizontal = Math.abs(nodes[seed.a].z - nodes[seed.b].z) < 1;
    const along = horizontal ? nodes[seed.a].z : nodes[seed.a].x;
    // Grow along the same straight road to about 350 m.
    const chain = new Set([seed.id]);
    let total = seed.length;
    let grew = true;
    while (grew && total < 350) {
      grew = false;
      for (const e of arterials) {
        if (chain.has(e.id)) continue;
        const sameLine = horizontal
          ? Math.abs(nodes[e.a].z - along) < 1 && Math.abs(nodes[e.b].z - along) < 1
          : Math.abs(nodes[e.a].x - along) < 1 && Math.abs(nodes[e.b].x - along) < 1;
        if (!sameLine) continue;
        const touches = [...chain].some((c) => {
          const ce = this.city.edges[c];
          return ce.a === e.a || ce.a === e.b || ce.b === e.a || ce.b === e.b;
        });
        if (!touches) continue;
        chain.add(e.id);
        total += e.length;
        grew = true;
        break;
      }
    }
    const closedIds: number[] = [];
    for (const id of chain) {
      this.city.edges[id].closed = true;
      if (isConnected(this.city)) closedIds.push(id);
      else this.city.edges[id].closed = false;
    }
    if (!closedIds.length) return null;
    return { edges: closedIds, name: horizontal ? 'an east–west avenue' : 'a north–south avenue' };
  }

  /** Re-plan the remaining stops of every moving truck on the current road network. */
  private rerouteAll(): number {
    let count = 0;
    for (const t of this.trucks) {
      const route = t.route;
      if (!route || t.status === 'broken') continue;
      const next = route.nodes.slice(t.seg + 1).find((n) => n >= 0);
      if (next === undefined) continue;
      const seq = route.stops.slice(t.stopIndex).map((s) => ({ node: s.node, kind: s.kind, binId: s.binId }));
      for (const s of seq) if (s.binId !== undefined) this.bins[s.binId].assigned = -1;
      const fresh = this.buildRoute(t, t.x, t.z, next, seq);
      t.route = fresh;
      t.d = 0;
      t.seg = 0;
      t.stopIndex = 0;
      count++;
    }
    if (count) this.routeVersion++;
    return count;
  }

  /**
   * Score forecasts that have come due, then make new ones. A forecast is only
   * scored if no truck emptied the bin in between (that is a plan, not a miss).
   */
  private scoreForecasts() {
    const now = this.time;
    const s = this.forecastStats;
    const day = Math.floor(now / DAY);
    while (this.pendingForecasts.length && this.pendingForecasts[0].due <= now + 1e-6) {
      const f = this.pendingForecasts.shift()!;
      const b = this.bins[f.binId];
      if (!b.sensorOk || b.collections !== f.collections) continue;
      const err = Math.abs(b.reading - f.predicted);
      const priorErr = Math.abs(b.reading - f.prior);
      s.mae = (s.mae * s.n + err) / (s.n + 1);
      s.priorMae = (s.priorMae * s.n + priorErr) / (s.n + 1);
      s.n++;
      let d = s.byDay[s.byDay.length - 1];
      if (!d || d.day !== day) {
        d = { day, n: 0, mae: 0, priorMae: 0 };
        s.byDay.push(d);
        if (s.byDay.length > 14) s.byDay.shift();
      }
      d.mae = (d.mae * d.n + err) / (d.n + 1);
      d.priorMae = (d.priorMae * d.n + priorErr) / (d.n + 1);
      d.n++;
      b.forecastAbs += err;
      b.forecastN++;
    }
    const due = now + FORECAST_AHEAD;
    for (const b of this.bins) {
      if (!b.sensorOk) continue;
      const site = this.city.bins[b.id];
      let prior = b.reading;
      for (let t = now; t < due; t += HOUR) prior += profileRate(site.district, t) * Math.min(1, (due - t) / HOUR);
      this.pendingForecasts.push({ due, binId: b.id, predicted: this.forecast(b.id, due), prior, collections: b.collections });
    }
  }

  private record() {
    const fills = new Float32Array(this.bins.length);
    let overflowing = 0;
    this.bins.forEach((b, i) => {
      fills[i] = b.fill;
      if (b.fill >= 1) overflowing++;
    });
    const trucks = new Float32Array(this.trucks.length * 3);
    this.trucks.forEach((t, i) => trucks.set([t.x, t.z, t.heading], i * 3));
    this.tape.push({ time: this.time, fills, trucks, overflowing });
    if (this.tape.length > 14 * 96) this.tape.shift();
  }

  private snapshot() {
    let overflowing = 0;
    let critical = 0;
    let sum = 0;
    for (const b of this.bins) {
      if (b.fill >= 1) overflowing++;
      else if (b.fill >= 0.8) critical++;
      sum += Math.min(1, b.fill);
    }
    this.snapshots.push({
      time: this.time,
      overflowing,
      critical,
      avgFill: sum / this.bins.length,
      distanceKm: this.metrics.distanceM / 1000,
      wastedVisits: this.metrics.wastedVisits,
      overflowEvents: this.metrics.overflowEvents,
    });
    if (this.snapshots.length > 24 * 14) this.snapshots.shift();
  }

  log(kind: EventKind, text: string, extra: { binId?: number; truckId?: number } = {}) {
    this.events.push({ id: this.eventId++, time: this.time, kind, text, ...extra });
    if (this.events.length > 300) this.events.shift();
  }
}
