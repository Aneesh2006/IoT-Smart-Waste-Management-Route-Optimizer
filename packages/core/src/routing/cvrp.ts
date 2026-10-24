import { orOpt, pathLength, twoOpt } from './tsp.ts';

/**
 * Multi-trip capacitated vehicle routing, the way a municipal fleet works:
 * trucks leave the depot, fill up on a trip of bins, tip at the transfer
 * station, go again, and finally drive home. Trips are built and polished
 * around the transfer station (the hub), then shared out between trucks.
 */
export interface VrpStop {
  node: number;
  /** Litres expected at pickup. */
  demand: number;
  /** Caller's id for the stop (bin id). */
  ref: number;
}

export interface VrpProblem {
  depot: number;
  hub: number;
  stops: VrpStop[];
  capacity: number;
  trucks: number;
  /** Shortest road distance between two graph nodes, metres. */
  dist: (a: number, b: number) => number;
  serviceSeconds: number;
  unloadSeconds: number;
  avgSpeed: number;
}

export type Construction = 'nearest' | 'savings';

export interface VrpOptions {
  construction?: Construction;
  improve?: boolean;
}

export interface Trip {
  /** Indices into problem.stops, in visiting order. */
  stops: number[];
  load: number;
}

export interface TruckPlan {
  trips: Trip[];
  /** Depot → trips (tipping at the hub after each) → depot, metres. */
  length: number;
  seconds: number;
}

export interface VrpSolution {
  trucks: TruckPlan[];
  totalLength: number;
  /** Longest single truck's working time: when the shift actually ends. */
  makespan: number;
  tripCount: number;
  construction: Construction;
  improved: boolean;
  ms: number;
}

export function solveVrp(problem: VrpProblem, options: VrpOptions = {}): VrpSolution {
  const t0 = now();
  const construction = options.construction ?? 'savings';
  const improve = options.improve ?? true;
  const n = problem.stops.length;
  // Point space: 0..n-1 stops, n = hub, n+1 = depot. Pre-compute the matrix once.
  const HUB = n;
  const DEPOT = n + 1;
  const nodeOf = (p: number) => (p === HUB ? problem.hub : p === DEPOT ? problem.depot : problem.stops[p].node);
  const size = n + 2;
  const matrix = new Float64Array(size * size);
  for (let i = 0; i < size; i++) {
    for (let j = i + 1; j < size; j++) {
      const v = problem.dist(nodeOf(i), nodeOf(j));
      matrix[i * size + j] = v;
      matrix[j * size + i] = v;
    }
  }
  const d = (a: number, b: number) => matrix[a * size + b];
  const demand = (i: number) => Math.min(problem.stops[i].demand, problem.capacity);

  let trips: Trip[] = construction === 'nearest' ? nearestTrips(n, HUB, d, demand, problem.capacity) : savingsTrips(n, HUB, d, demand, problem.capacity);

  if (improve) {
    trips = trips.map((t) => {
      let s = twoOpt(t.stops, HUB, HUB, d);
      s = orOpt(s, HUB, HUB, d);
      s = twoOpt(s, HUB, HUB, d);
      return { ...t, stops: s };
    });
  }

  const trucks = assignTrips(trips, problem, HUB, DEPOT, d, improve);
  const totalLength = trucks.reduce((s, t) => s + t.length, 0);
  return {
    trucks,
    totalLength,
    makespan: Math.max(0, ...trucks.map((t) => t.seconds)),
    tripCount: trips.length,
    construction,
    improved: improve,
    ms: now() - t0,
  };
}

function nearestTrips(n: number, hub: number, d: (a: number, b: number) => number, demand: (i: number) => number, cap: number): Trip[] {
  const left = new Set<number>(Array.from({ length: n }, (_, i) => i));
  const trips: Trip[] = [];
  while (left.size > 0) {
    const trip: Trip = { stops: [], load: 0 };
    let cur = hub;
    for (;;) {
      let best = -1;
      let bestD = Infinity;
      for (const i of left) {
        if (trip.load + demand(i) > cap) continue;
        const v = d(cur, i);
        if (v < bestD) {
          bestD = v;
          best = i;
        }
      }
      if (best < 0) break;
      left.delete(best);
      trip.stops.push(best);
      trip.load += demand(best);
      cur = best;
    }
    trips.push(trip);
  }
  return trips;
}

/** Clarke–Wright savings: start with one trip per stop, merge ends while it saves distance. */
function savingsTrips(n: number, hub: number, d: (a: number, b: number) => number, demand: (i: number) => number, cap: number): Trip[] {
  const routes: (number[] | null)[] = Array.from({ length: n }, (_, i) => [i]);
  const load = Array.from({ length: n }, (_, i) => demand(i));
  const routeOf = Array.from({ length: n }, (_, i) => i);
  const pairs: { i: number; j: number; s: number }[] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const s = d(hub, i) + d(hub, j) - d(i, j);
      if (s > 0) pairs.push({ i, j, s });
    }
  }
  pairs.sort((a, b) => b.s - a.s);
  for (const { i, j } of pairs) {
    const ri = routeOf[i];
    const rj = routeOf[j];
    if (ri === rj) continue;
    const A = routes[ri]!;
    const B = routes[rj]!;
    if (load[ri] + load[rj] > cap) continue;
    const iFirst = A[0] === i;
    const iLast = A[A.length - 1] === i;
    const jFirst = B[0] === j;
    const jLast = B[B.length - 1] === j;
    let merged: number[] | null = null;
    if (iLast && jFirst) merged = [...A, ...B];
    else if (jLast && iFirst) merged = [...B, ...A];
    else if (iLast && jLast) merged = [...A, ...[...B].reverse()];
    else if (iFirst && jFirst) merged = [...[...A].reverse(), ...B];
    if (!merged) continue;
    routes[ri] = merged;
    routes[rj] = null;
    load[ri] += load[rj];
    for (const v of B) routeOf[v] = ri;
  }
  const trips: Trip[] = [];
  routes.forEach((r, k) => {
    if (r) trips.push({ stops: r, load: load[k] });
  });
  return trips;
}

function assignTrips(
  trips: Trip[],
  problem: VrpProblem,
  HUB: number,
  DEPOT: number,
  d: (a: number, b: number) => number,
  improve: boolean,
): TruckPlan[] {
  const tripSeconds = (t: Trip) =>
    pathLength(t.stops, HUB, HUB, d) / problem.avgSpeed + t.stops.length * problem.serviceSeconds + problem.unloadSeconds;
  const sorted = [...trips].sort((a, b) => tripSeconds(b) - tripSeconds(a));
  const buckets: Trip[][] = Array.from({ length: Math.max(1, problem.trucks) }, () => []);
  const busy = buckets.map(() => 0);
  for (const t of sorted) {
    let k = 0;
    for (let i = 1; i < busy.length; i++) if (busy[i] < busy[k]) k = i;
    buckets[k].push(t);
    busy[k] += tripSeconds(t);
  }

  return buckets.map((bucket) => {
    if (bucket.length === 0) return { trips: [], length: 0, seconds: 0 };
    // Lead with the trip that is cheapest to reach from the depot, entered from its nearer end.
    let lead = 0;
    let leadCost = Infinity;
    let flip = false;
    bucket.forEach((t, k) => {
      const first = t.stops[0];
      const last = t.stops[t.stops.length - 1];
      const fwd = d(DEPOT, first) - d(HUB, first);
      const rev = d(DEPOT, last) - d(HUB, last);
      if (fwd < leadCost) {
        leadCost = fwd;
        lead = k;
        flip = false;
      }
      if (rev < leadCost) {
        leadCost = rev;
        lead = k;
        flip = true;
      }
    });
    const ordered = [bucket[lead], ...bucket.filter((_, k) => k !== lead)].map((t, k) =>
      k === 0 && flip ? { ...t, stops: [...t.stops].reverse() } : t,
    );
    // The first trip really starts at the depot, not the hub it was polished around.
    if (improve && ordered[0].stops.length > 2) {
      let s = twoOpt(ordered[0].stops, DEPOT, HUB, d);
      s = orOpt(s, DEPOT, HUB, d);
      ordered[0] = { ...ordered[0], stops: s };
    }
    let length = 0;
    let stopCount = 0;
    ordered.forEach((t, k) => {
      length += pathLength(t.stops, k === 0 ? DEPOT : HUB, HUB, d);
      stopCount += t.stops.length;
    });
    length += d(HUB, DEPOT);
    const seconds = length / problem.avgSpeed + stopCount * problem.serviceSeconds + ordered.length * problem.unloadSeconds;
    return { trips: ordered, length, seconds };
  });
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
