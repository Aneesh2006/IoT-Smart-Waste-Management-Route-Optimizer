import { generateCity } from './city.ts';
import { DistanceTable, edgeBetween } from './graph.ts';
import { POLICIES, type PolicyContext, type PolicyId } from './policies.ts';
import { DAY, HOUR, formatClock, profileRate } from './profiles.ts';
import { createRng, type Rng } from './rng.ts';
import { solveVrp, type Construction, type TruckPlan, type VrpSolution, type VrpStop } from './routing/cvrp.ts';
import type { City } from './types.ts';

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
}

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
}

export type TruckStatus = 'idle' | 'driving' | 'collecting' | 'unloading' | 'returning';

export interface RouteStop {
  /** Distance along the route, metres. */
  at: number;
  kind: 'bin' | 'unload' | 'depot';
  node: number;
  binId?: number;
}

export interface Route {
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
}

export interface Snapshot {
  time: number;
  overflowing: number;
  critical: number;
  avgFill: number;
  distanceKm: number;
  wastedVisits: number;
  overflowEvents: number;
}

export type EventKind = 'plan' | 'overflow' | 'unload' | 'return' | 'info' | 'warn';

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
  events: SimEvent[] = [];
  lastPlan: ShiftPlan | null = null;
  /** Bumped whenever routes change, so renderers know to rebuild ribbons. */
  routeVersion = 0;
  private eventId = 0;
  private rFill: Rng;
  private rSensor: Rng;

  constructor(config: Partial<SimConfig> = {}, city?: City) {
    const given = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)) as Partial<SimConfig>;
    this.config = { ...DEFAULT_CONFIG, ...given };
    this.config.shifts = this.config.shifts.map((s) => ({ ...s }));
    this.city = city ?? generateCity({ seed: this.config.seed, bins: this.config.bins });
    this.table = new DistanceTable(this.city);
    const rng = createRng(this.config.seed);
    this.rFill = rng.fork('fill');
    this.rSensor = rng.fork('sensor');
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

    if (Math.floor(t1 / SAMPLE_SECONDS) !== Math.floor(t0 / SAMPLE_SECONDS)) this.sampleSensors();
    for (let k = 0; k < this.config.shifts.length; k++) {
      const start = this.config.shifts[k].start * HOUR;
      const a = t0 % DAY;
      const b = a + h;
      if (a < start && b >= start) this.planShift(k);
    }
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
      const rate = profileRate(site.district, t0) * site.busyness * b.noise;
      b.fill += (rate * h) / HOUR;
      if (b.fill >= 1) {
        if (!b.overflowing) {
          b.overflowing = true;
          this.metrics.overflowEvents++;
          this.log('overflow', `${site.label} is overflowing.`, { binId: b.id });
        }
        this.metrics.overflowBinHours += h / HOUR;
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

    const nodes = this.city.nodes;
    const route: Route = { xs: [], zs: [], cum: [], speeds: [], stops: [], length: 0 };
    let cur = this.city.depot.node;
    route.xs.push(nodes[cur].x);
    route.zs.push(nodes[cur].z);
    route.cum.push(0);
    for (const s of seq) {
      const path = this.table.path(cur, s.node);
      if (path.length === 0) {
        this.log('warn', `${truck.name} cannot reach a stop: the road is cut.`, { truckId: truck.id });
        continue;
      }
      for (let k = 1; k < path.length; k++) {
        const edge = edgeBetween(this.city, path[k - 1], path[k])!;
        route.length += edge.length;
        route.xs.push(nodes[path[k]].x);
        route.zs.push(nodes[path[k]].z);
        route.cum.push(route.length);
        route.speeds.push(edge.speed);
      }
      route.stops.push({ at: route.length, kind: s.kind, node: s.node, binId: s.binId });
      if (s.binId !== undefined) this.bins[s.binId].assigned = truck.id;
      cur = s.node;
    }
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

  private moveTruck(t: TruckState, h: number) {
    const route = t.route;
    if (!route) return;
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
      this.metrics.visits++;
      this.metrics.collectedL += litres;
      t.load += litres;
      b.fill -= litres / site.capacityL;
      if (b.fill < 1) b.overflowing = false;
      b.lastCollectedAt = this.time;
      b.collections++;
      b.assigned = -1;
      b.collectedThisHour = true;
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
