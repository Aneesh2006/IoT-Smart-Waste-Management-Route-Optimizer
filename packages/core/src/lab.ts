import type { DistanceTable } from './graph.ts';
import { createRng, type Rng } from './rng.ts';
import { heldKarp, orOpt, pathLength, twoOpt } from './routing/tsp.ts';
import type { City } from './types.ts';

/**
 * The Algorithm Lab: one truck, k bins, and every way of choosing the order.
 * Each algorithm returns a list of frames so the UI can replay its thinking.
 *
 * Point space: 0..k-1 are stops, k is the transfer station (the hub).
 */
export type LabAlgorithm = 'nearest' | 'savings' | 'twoopt' | 'oropt' | 'anneal' | 'ants' | 'exact';

export interface LabProblem {
  hubNode: number;
  /** Graph node of each stop. */
  nodes: number[];
  binIds: number[];
  /** (k+1)² road distances in point space, metres. */
  matrix: Float64Array;
  k: number;
}

export interface LabFrame {
  /** One or more open routes hub → … (→ hub when closed). Indices are stop points. */
  routes: number[][];
  closed: boolean;
  cost: number;
  best?: number;
  temperature?: number;
  /** Ant colony only: pheromone on each point pair, normalised to 0–1. */
  pheromone?: Float32Array;
  note: string;
}

export interface LabRun {
  algorithm: LabAlgorithm;
  frames: LabFrame[];
  order: number[];
  cost: number;
  ms: number;
}

export const LAB_INFO: Record<LabAlgorithm, { name: string; family: string; blurb: string }> = {
  nearest: {
    name: 'Nearest neighbour',
    family: 'Construction',
    blurb: 'Always drive to the closest bin not yet visited. Fast and intuitive, but it paints itself into corners and pays for it on the long drive home.',
  },
  savings: {
    name: 'Clarke–Wright savings',
    family: 'Construction',
    blurb: 'Start with a separate round trip to every bin, then keep merging the two trips whose join saves the most driving: d(hub,i) + d(hub,j) − d(i,j).',
  },
  twoopt: {
    name: '2-opt',
    family: 'Local search',
    blurb: 'Take any two road legs that cross, reverse the stretch between them, repeat until no swap helps. Starting here from a random order to show every uncrossing.',
  },
  oropt: {
    name: 'Or-opt',
    family: 'Local search',
    blurb: 'Lift a chain of one to three consecutive bins and drop it, either way round, wherever it shortens the tour.',
  },
  anneal: {
    name: 'Simulated annealing',
    family: 'Metaheuristic',
    blurb: 'Random 2-opt moves, accepting worse tours with probability e^(−Δ/T). Hot early so it can escape local minima, cooling until it settles.',
  },
  ants: {
    name: 'Ant colony',
    family: 'Metaheuristic',
    blurb: 'Virtual ants build tours, preferring short legs and legs with pheromone. Short tours lay more pheromone, pheromone evaporates, and good paths emerge.',
  },
  exact: {
    name: 'Held–Karp (exact)',
    family: 'Exact',
    blurb: 'Dynamic programming over every subset of bins: the true optimum, at O(n²·2ⁿ) cost. Fine for a dozen bins, hopeless for a city.',
  },
};

export const EXACT_LIMIT = 12;

export function makeLabProblem(city: City, table: DistanceTable, k: number, seed: string): LabProblem {
  const rng = createRng(`${seed}/lab`);
  const binIds = rng.shuffle(city.bins.map((b) => b.id)).slice(0, Math.min(k, city.bins.length));
  const nodes = binIds.map((id) => city.bins[id].node);
  const hubNode = city.landfill.node;
  const all = [...nodes, hubNode];
  const n = all.length;
  const matrix = new Float64Array(n * n);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) matrix[i * n + j] = i === j ? 0 : table.distance(all[i], all[j]);
  return { hubNode, nodes, binIds, matrix, k: nodes.length };
}

export function runLab(problem: LabProblem, algorithm: LabAlgorithm, seed = 'lab'): LabRun {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const n = problem.k + 1;
  const hub = problem.k;
  const d = (a: number, b: number) => problem.matrix[a * n + b];
  const rng = createRng(`${seed}/${algorithm}`);
  const stops = Array.from({ length: problem.k }, (_, i) => i);
  const frames: LabFrame[] = [];
  const cost = (t: number[]) => pathLength(t, hub, hub, d);
  const push = (routes: number[][], closed: boolean, note: string, extra: Partial<LabFrame> = {}) =>
    frames.push({
      routes: routes.map((r) => [...r]),
      closed,
      cost: closed ? routes.reduce((s, r) => s + cost(r), 0) : routes.reduce((s, r) => s + openLength(r, hub, d), 0),
      note,
      ...extra,
    });

  let order: number[];
  switch (algorithm) {
    case 'nearest': {
      order = [];
      const left = new Set(stops);
      let cur = hub;
      push([order], false, 'Start at the transfer station.');
      while (left.size) {
        let best = -1;
        for (const i of left) if (best < 0 || d(cur, i) < d(cur, best)) best = i;
        left.delete(best);
        order.push(best);
        push([order], false, `Closest unvisited bin is ${(d(cur, best) / 1000).toFixed(2)} km away.`);
        cur = best;
      }
      push([order], true, 'Every bin visited; drive home.');
      break;
    }
    case 'savings': {
      let routes = stops.map((i) => [i]);
      push(routes, true, `${routes.length} separate round trips.`);
      const pairs: [number, number, number][] = [];
      for (let i = 0; i < problem.k; i++) for (let j = i + 1; j < problem.k; j++) pairs.push([i, j, d(hub, i) + d(hub, j) - d(i, j)]);
      pairs.sort((a, b) => b[2] - a[2]);
      for (const [i, j, s] of pairs) {
        if (routes.length === 1) break;
        const ri = routes.find((r) => r.includes(i))!;
        const rj = routes.find((r) => r.includes(j))!;
        if (ri === rj) continue;
        let merged: number[] | null = null;
        if (ri[ri.length - 1] === i && rj[0] === j) merged = [...ri, ...rj];
        else if (rj[rj.length - 1] === j && ri[0] === i) merged = [...rj, ...ri];
        else if (ri[ri.length - 1] === i && rj[rj.length - 1] === j) merged = [...ri, ...[...rj].reverse()];
        else if (ri[0] === i && rj[0] === j) merged = [...[...ri].reverse(), ...rj];
        if (!merged) continue;
        routes = [...routes.filter((r) => r !== ri && r !== rj), merged];
        push(routes, true, `Join two trips, saving ${(s / 1000).toFixed(2)} km.`);
      }
      order = routes[0];
      break;
    }
    case 'twoopt': {
      const start = rng.shuffle([...stops]);
      push([start], true, 'A random order: lots of crossings.');
      order = twoOpt(start, hub, hub, d, (tour, move) => push([tour], true, `Reverse ${move.k - move.i + 1} bins, saving ${(move.gain / 1000).toFixed(2)} km.`));
      push([order], true, 'No reversal helps any more: a 2-opt local optimum.');
      break;
    }
    case 'oropt': {
      const start = rng.shuffle([...stops]);
      push([start], true, 'A random order.');
      order = orOpt(start, hub, hub, d, (tour, gain) => push([tour], true, `Move a chain, saving ${(gain / 1000).toFixed(2)} km.`));
      push([order], true, 'No chain move helps: an Or-opt local optimum.');
      break;
    }
    case 'anneal':
      order = anneal(stops, hub, d, rng, push);
      break;
    case 'ants':
      order = ants(stops, hub, d, rng, push);
      break;
    case 'exact': {
      if (problem.k > EXACT_LIMIT) throw new Error(`Exact solve is limited to ${EXACT_LIMIT} bins`);
      order = heldKarp(stops, hub, hub, d).order;
      push([order], true, `Checked ${(2 ** problem.k * problem.k).toLocaleString('en-IN')} subset states: this is the optimum.`);
      break;
    }
  }
  return { algorithm, frames, order, cost: cost(order), ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0 };
}

function openLength(route: number[], hub: number, d: (a: number, b: number) => number) {
  if (!route.length) return 0;
  let s = d(hub, route[0]);
  for (let i = 1; i < route.length; i++) s += d(route[i - 1], route[i]);
  return s;
}

type Push = (routes: number[][], closed: boolean, note: string, extra?: Partial<LabFrame>) => void;

function anneal(stops: number[], hub: number, d: (a: number, b: number) => number, rng: Rng, push: Push): number[] {
  const tour = rng.shuffle([...stops]);
  const n = tour.length;
  if (n < 3) return tour;
  const full = () => pathLength(tour, hub, hub, d);
  let cur = full();
  let best = cur;
  let bestTour = [...tour];
  const iterations = 6000 * n;
  const t0 = (cur / n) * 0.6;
  const cooling = Math.pow(1e-4, 1 / iterations);
  let temp = t0;
  const every = Math.max(1, Math.floor(iterations / 220));
  push([tour], true, 'Random start, temperature high.', { best, temperature: temp });
  const at = (i: number) => (i < 0 || i >= n ? hub : tour[i]);
  for (let it = 0; it < iterations; it++) {
    let i = Math.floor(rng.next() * n);
    let k = Math.floor(rng.next() * n);
    if (i === k) continue;
    if (i > k) [i, k] = [k, i];
    const delta = d(at(i - 1), at(k)) + d(at(i), at(k + 1)) - d(at(i - 1), at(i)) - d(at(k), at(k + 1));
    if (delta < 0 || rng.next() < Math.exp(-delta / temp)) {
      for (let a = i, b = k; a < b; a++, b--) [tour[a], tour[b]] = [tour[b], tour[a]];
      cur += delta;
      if (cur < best - 1e-9) {
        best = cur;
        bestTour = [...tour];
      }
    }
    temp *= cooling;
    if (it % every === 0) push([tour], true, temp > t0 * 0.05 ? 'Hot: happily accepting worse tours to explore.' : 'Cooling: only small uphill steps get through.', { best, temperature: temp });
  }
  push([bestTour], true, 'Frozen. Best tour seen during the walk.', { best, temperature: temp });
  return bestTour;
}

function ants(stops: number[], hub: number, d: (a: number, b: number) => number, rng: Rng, push: Push): number[] {
  // Point ids are 0..k-1 for stops and k for the hub, so they index the matrix directly.
  const n = stops.length + 1;
  const idx = (a: number, b: number) => a * n + b;
  // Nearest-neighbour length seeds the initial pheromone level.
  let nn = 0;
  {
    const left = new Set(stops);
    let cur = hub;
    while (left.size) {
      let best = -1;
      for (const i of left) if (best < 0 || d(cur, i) < d(cur, best)) best = i;
      nn += d(cur, best);
      left.delete(best);
      cur = best;
    }
    nn += d(cur, hub);
  }
  const tau = new Float64Array(n * n).fill(1 / (n * nn));
  const alpha = 1;
  const beta = 3;
  const rho = 0.18;
  const antCount = Math.max(8, stops.length);
  const iterations = 70;
  let bestTour: number[] = [...stops];
  let best = Infinity;
  for (let it = 0; it < iterations; it++) {
    const tours: { t: number[]; len: number }[] = [];
    for (let a = 0; a < antCount; a++) {
      const left = new Set(stops);
      const t: number[] = [];
      let cur = hub;
      while (left.size) {
        let total = 0;
        const weights: [number, number][] = [];
        for (const j of left) {
          const w = Math.pow(tau[idx(cur, j)], alpha) * Math.pow(1 / Math.max(1, d(cur, j)), beta);
          weights.push([j, w]);
          total += w;
        }
        let r = rng.next() * total;
        let pick = weights[weights.length - 1][0];
        for (const [j, w] of weights) {
          r -= w;
          if (r <= 0) {
            pick = j;
            break;
          }
        }
        t.push(pick);
        left.delete(pick);
        cur = pick;
      }
      const len = pathLength(t, hub, hub, d);
      tours.push({ t, len });
      if (len < best) {
        best = len;
        bestTour = t;
      }
    }
    for (let i = 0; i < tau.length; i++) tau[i] *= 1 - rho;
    const deposit = (t: number[], amount: number) => {
      const seq = [hub, ...t, hub];
      for (let s = 1; s < seq.length; s++) {
        tau[idx(seq[s - 1], seq[s])] += amount;
        tau[idx(seq[s], seq[s - 1])] += amount;
      }
    };
    for (const { t, len } of tours) deposit(t, 1 / len);
    deposit(bestTour, 2 / best); // the elitist ant
    let max = 0;
    for (const v of tau) max = Math.max(max, v);
    const pheromone = new Float32Array(n * n);
    for (let i = 0; i < tau.length; i++) pheromone[i] = tau[i] / max;
    push([bestTour], true, `Generation ${it + 1}: ${antCount} ants, best ${(best / 1000).toFixed(2)} km.`, { best, pheromone });
  }
  return bestTour;
}
