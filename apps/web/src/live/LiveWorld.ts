import {
  HOUR,
  Simulation,
  binStatus,
  edgeBetween,
  phonePlacement,
  worldKey,
  type Alert,
  type BinStatus,
  type ChaosKind,
  type FleetFrame,
  type Hops,
  type LiveControl,
  type LiveEvent,
  type PolicyId,
  type Route,
  type RoutesFrame,
  type StateUpdate,
  type Telemetry,
  type TruckFrame,
} from '@binsight/core';
import { emitPacket } from './xrayFeed.ts';

export interface PhoneBin {
  id: string;
  nick: string;
  emoji: string;
  r: number;
  status: BinStatus;
  x: number;
  z: number;
  lastSeen: number;
  score: number;
  dispatched: boolean;
}

/** One message's trip through AWS, with the browser's arrival stamped on (server clock). */
export interface HopSample extends Hops {
  tBrowser: number;
  batch: number;
}

export interface LiveController {
  control(body: Record<string, unknown>): Promise<void>;
  notify(text: string): void;
}

const FRAME_MS = 500;

/**
 * The browser's view of the cloud city. It is a Simulation so every panel and
 * renderer works unchanged, but nothing is simulated here: bins, trucks, clock,
 * metrics and events are all copied in from MQTT messages.
 */
export class LiveWorld extends Simulation {
  readonly live = true;
  control: LiveControl;
  phones = new Map<string, PhoneBin>();
  hops: HopSample[] = [];
  /** Bumped whenever phones join, leave or change, for renderers. */
  phoneVersion = 0;
  private frameAt = 0;
  private frameSimT: number;
  private speed = 0;
  private prev: TruckFrame[] = [];
  private next: TruckFrame[] = [];
  private closedKey = '';
  private lastSnapshotHour = -1;
  private nextEventId = 1_000_000;
  private controller: LiveController;
  private clockOffset: number;

  constructor(control: LiveControl, controller: LiveController, clockOffset: number) {
    super({ seed: control.seed, bins: control.bins, trucks: control.trucks, policy: control.policy });
    this.control = control;
    this.controller = controller;
    this.clockOffset = clockOffset;
    this.frameSimT = control.anchorSimT;
    this.time = control.anchorSimT;
    this.events = [];
    this.snapshots = [];
    this.pushEvent('info', `Live: streaming "${control.seed}" from AWS IoT Core (${control.bins} bins, ${control.trucks} trucks).`);
  }

  get world() {
    return worldKey(this.control);
  }

  /** Called every animation frame. Interpolates between the cloud's twice-a-second frames. */
  override advance() {
    if (!this.frameAt) return;
    const now = performance.now();
    this.time = this.frameSimT + Math.min(1.5, (now - this.frameAt) / 1000) * this.speed;
    const a = Math.min(1, (now - this.frameAt) / FRAME_MS);
    for (const n of this.next) {
      const t = this.trucks[n.id];
      if (!t) continue;
      const p = this.prev.find((x) => x.id === n.id) ?? n;
      t.x = p.x + (n.x - p.x) * a;
      t.z = p.z + (n.z - p.z) * a;
      t.heading = n.h;
    }
  }

  // ---- operator actions go to the cloud instead of the local sim
  override setPolicy(id: PolicyId) {
    void this.controller.control({ action: 'policy', policy: id });
  }

  override trigger(kind: ChaosKind) {
    void this.controller.control({ action: 'chaos', kind });
  }

  override planNow() {
    this.controller.notify('In Live mode the cloud plans each shift itself.');
  }

  // ---- inbound messages

  /** Initial snapshot from GET /state. */
  applySnapshot(items: Record<string, unknown>[]) {
    for (const it of items) {
      const t = it as unknown as Telemetry & { lastSeen?: number; dispatchAt?: number };
      if (t.kind === 'phone') this.upsertPhone(t, Number(t.lastSeen) || Date.now(), Boolean(t.dispatchAt));
      else this.applyBin(t);
    }
  }

  applyState(update: StateUpdate) {
    for (const b of update.bins) {
      if (b.kind === 'phone') this.upsertPhone(b, Date.now() + this.clockOffset);
      else if (!b.world || b.world === this.world) this.applyBin(b);
    }
    const sample = { ...update.hops, tBrowser: Date.now() + this.clockOffset, batch: update.batch };
    this.hops.push(sample);
    if (this.hops.length > 120) this.hops.shift();
    const first = update.bins[0];
    if (first) {
      const label = first.kind === 'phone' ? `${first.emoji ?? ''} ${first.nick ?? 'phone'}`.trim() : (this.city.bins[Number(first.id)]?.label ?? `#${first.id}`);
      emitPacket({ kind: first.kind, label: update.bins.length > 1 ? `${label} +${update.bins.length - 1}` : label, payload: update, hops: sample, simulated: false });
    }
  }

  /** Returns false when the frame belongs to a different world (the caller rebuilds). */
  applyFleet(f: FleetFrame): boolean {
    if (f.world !== this.world) return false;
    this.prev = this.trucks.map((t) => ({ id: t.id, x: t.x, z: t.z, h: t.heading, st: t.status, load: t.load }));
    this.next = f.trucks;
    for (const n of f.trucks) {
      const t = this.trucks[n.id];
      if (!t) continue;
      if (t.status !== n.st) {
        t.log.push({ t: f.simT, s: n.st });
        if (t.log.length > 3000) t.log.shift();
      }
      t.status = n.st;
      t.load = n.load;
      if (n.si !== undefined) t.stopIndex = n.si;
      if (!this.frameAt) {
        t.x = n.x;
        t.z = n.z;
      }
    }
    this.frameAt = performance.now();
    this.frameSimT = f.simT;
    this.speed = f.speed;
    this.time = f.simT;
    this.config.policy = f.policy;
    if (f.metrics) this.metrics = f.metrics;
    this.fires = new Map(f.fires.map((id) => [id, Infinity]));
    this.festivalUntil = f.festival ? f.simT + 3600 : 0;

    const key = f.closed.join(',');
    if (key !== this.closedKey) {
      this.closedKey = key;
      for (const e of this.city.edges) e.closed = false;
      for (const id of f.closed) if (this.city.edges[id]) this.city.edges[id].closed = true;
      this.closures = f.closed.length ? [{ edges: f.closed, until: Infinity, name: 'flooded road' }] : [];
      this.roadVersion++;
    }

    const hour = Math.floor(f.simT / HOUR);
    if (hour !== this.lastSnapshotHour) {
      this.lastSnapshotHour = hour;
      this.takeSnapshot();
    }
    return true;
  }

  applyRoutes(r: RoutesFrame) {
    if (r.world !== this.world) return;
    const byTruck = new Map(r.trucks.map((t) => [t.id, t]));
    for (const truck of this.trucks) {
      const t = byTruck.get(truck.id);
      truck.route = t ? this.routeFrom(t.start, t.nodes) : null;
      if (truck.route && t?.stops) truck.route.stops = t.stops.map((s) => ({ ...s, at: 0 }));
    }
    if (r.plan) {
      this.lastPlan = {
        time: r.plan.time,
        shift: Math.max(0, this.shiftAt(r.plan.time)),
        policy: r.plan.policy,
        binIds: Array.from({ length: r.plan.bins }, (_, i) => i),
        solution: { trucks: [], totalLength: r.plan.km * 1000, makespan: 0, tripCount: r.plan.trips, construction: 'savings', improved: true, ms: r.plan.ms },
      };
    }
    this.routeVersion = r.routeVersion + 1;
  }

  applyEvents(events: LiveEvent[]) {
    for (const e of events) this.pushEvent(e.kind as never, e.text, e.binId, e.truckId, e.time);
  }

  applyAlert(a: Alert) {
    this.pushEvent('alert', a.text);
    const phone = this.phones.get(a.binId);
    if (phone && (a.kind === 'dispatch' || a.kind === 'collected')) {
      phone.dispatched = a.kind === 'dispatch';
      this.phoneVersion++;
    }
  }

  /** Mean latency per hop over the recent samples, milliseconds. */
  latency() {
    const recent = this.hops.slice(-30);
    if (!recent.length) return null;
    const avg = (f: (h: HopSample) => number) => recent.reduce((s, h) => s + f(h), 0) / recent.length;
    return {
      deviceToRule: avg((h) => h.tRule - h.tDevice),
      ruleToQueue: avg((h) => h.tQueue - h.tRule),
      queueToLambda: avg((h) => h.tLambda - h.tQueue),
      lambdaToStored: avg((h) => h.tStored - h.tLambda),
      storedToPublish: avg((h) => h.tPublish - h.tStored),
      publishToBrowser: avg((h) => h.tBrowser - h.tPublish),
      total: avg((h) => h.tBrowser - h.tDevice),
      samples: recent.length,
    };
  }

  // ---- helpers

  private applyBin(t: Telemetry) {
    const i = Number(t.id);
    const b = this.bins[i];
    if (!b) return;
    b.reading = t.r;
    b.fill = t.r;
    b.readingAt = t.simT ?? this.time;
    b.temperature = t.temp;
    b.gas = t.gas;
    b.battery = t.bat;
    b.sensorOk = t.ok;
    b.overflowing = t.r >= 1;
    b.history.push(t.r);
    if (b.history.length > 7 * 96) b.history.shift();
  }

  private upsertPhone(t: Telemetry & { status?: BinStatus }, seen: number, dispatched?: boolean) {
    const prev = this.phones.get(t.id);
    const at = prev ?? phonePlacement(this.city, t.id);
    this.phones.set(t.id, {
      id: t.id,
      nick: t.nick ?? prev?.nick ?? 'Guest',
      emoji: t.emoji ?? prev?.emoji ?? '🗑️',
      r: t.r,
      status: t.status ?? binStatus(t),
      x: at.x,
      z: at.z,
      lastSeen: seen,
      score: t.score ?? prev?.score ?? 0,
      dispatched: t.event === 'collected' ? false : (dispatched ?? prev?.dispatched ?? false),
    });
    this.phoneVersion++;
  }

  private routeFrom(start: [number, number], nodes: number[]): Route {
    const route: Route = { nodes: [-1, ...nodes], xs: [start[0]], zs: [start[1]], cum: [0], speeds: [], stops: [], length: 0 };
    let px = start[0];
    let pz = start[1];
    nodes.forEach((n, k) => {
      const node = this.city.nodes[n];
      if (!node) return;
      route.length += Math.hypot(node.x - px, node.z - pz);
      route.xs.push(node.x);
      route.zs.push(node.z);
      route.cum.push(route.length);
      const prev = k === 0 ? undefined : nodes[k - 1];
      route.speeds.push(prev !== undefined ? (edgeBetween(this.city, prev, n)?.speed ?? 8) : 8);
      px = node.x;
      pz = node.z;
    });
    return route;
  }

  private takeSnapshot() {
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

  private pushEvent(kind: Parameters<Simulation['log']>[0], text: string, binId?: number, truckId?: number, time = this.time) {
    this.events.push({ id: this.nextEventId++, time, kind, text, binId, truckId });
    if (this.events.length > 300) this.events.shift();
  }
}
