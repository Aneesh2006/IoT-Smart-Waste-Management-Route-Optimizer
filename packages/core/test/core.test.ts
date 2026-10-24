import { describe, expect, it } from 'vitest';
import {
  buildAdjacency,
  createRng,
  dijkstra,
  generateCity,
  heldKarp,
  isConnected,
  orOpt,
  pathLength,
  Simulation,
  solveVrp,
  twoOpt,
  type Graph,
  type RoadEdge,
} from '../src/index.ts';

function randomGraph(seed: string, n: number, extra: number): Graph {
  const rng = createRng(seed);
  const nodes = Array.from({ length: n }, (_, id) => ({ id, x: rng.range(0, 1000), z: rng.range(0, 1000), kind: 'junction' as const }));
  const edges: RoadEdge[] = [];
  const add = (a: number, b: number) =>
    edges.push({ id: edges.length, a, b, length: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z), arterial: false, speed: 7, closed: false });
  for (let i = 1; i < n; i++) add(i, rng.int(0, i - 1));
  for (let k = 0; k < extra; k++) {
    const a = rng.int(0, n - 1);
    const b = rng.int(0, n - 1);
    if (a !== b) add(a, b);
  }
  return { nodes, edges, adjacency: buildAdjacency(n, edges) };
}

/** Bellman–Ford as an independent reference for Dijkstra. */
function bellmanFord(g: Graph, s: number) {
  const dist = new Array(g.nodes.length).fill(Infinity);
  dist[s] = 0;
  for (let k = 0; k < g.nodes.length; k++) {
    for (const e of g.edges) {
      if (dist[e.a] + e.length < dist[e.b]) dist[e.b] = dist[e.a] + e.length;
      if (dist[e.b] + e.length < dist[e.a]) dist[e.a] = dist[e.b] + e.length;
    }
  }
  return dist;
}

function permutations<T>(xs: T[]): T[][] {
  if (xs.length <= 1) return [xs];
  return xs.flatMap((x, i) => permutations([...xs.slice(0, i), ...xs.slice(i + 1)]).map((p) => [x, ...p]));
}

describe('graph', () => {
  it('Dijkstra agrees with Bellman–Ford on random graphs', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const g = randomGraph(seed, 60, 80);
      const ref = bellmanFord(g, 0);
      const got = dijkstra(g, 0).dist;
      ref.forEach((v, i) => expect(got[i]).toBeCloseTo(v, 6));
    }
  });
});

describe('city', () => {
  it('is deterministic for a seed and different across seeds', () => {
    const a = generateCity({ seed: 'x' });
    const b = generateCity({ seed: 'x' });
    const c = generateCity({ seed: 'y' });
    expect(JSON.stringify(a.bins)).toBe(JSON.stringify(b.bins));
    expect(JSON.stringify(a.bins)).not.toBe(JSON.stringify(c.bins));
  });

  it('is connected and every bin sits on its own graph node', () => {
    for (const seed of ['one', 'two', 'three']) {
      const city = generateCity({ seed, bins: 150 });
      expect(isConnected(city)).toBe(true);
      expect(city.bins).toHaveLength(150);
      const nodes = new Set(city.bins.map((b) => b.node));
      expect(nodes.size).toBe(150);
      for (const b of city.bins) expect(city.nodes[b.node].kind).toBe('bin');
    }
  });
});

describe('tours', () => {
  const pts = (seed: string, n: number) => {
    const r = createRng(seed);
    return Array.from({ length: n }, () => [r.range(0, 100), r.range(0, 100)] as const);
  };

  it('Held–Karp equals brute force, and no heuristic beats it', () => {
    for (const seed of ['p', 'q', 'r', 's', 't']) {
      const P = pts(seed, 9); // 0 = start/end, 1..8 = stops
      const d = (a: number, b: number) => Math.hypot(P[a][0] - P[b][0], P[a][1] - P[b][1]);
      const seq = [1, 2, 3, 4, 5, 6, 7, 8];
      const brute = Math.min(...permutations(seq).map((p) => pathLength(p, 0, 0, d)));
      const exact = heldKarp(seq, 0, 0, d);
      expect(exact.length).toBeCloseTo(brute, 9);
      expect(pathLength(exact.order, 0, 0, d)).toBeCloseTo(brute, 9);
      const improved = orOpt(twoOpt(seq, 0, 0, d), 0, 0, d);
      expect(pathLength(improved, 0, 0, d)).toBeGreaterThanOrEqual(brute - 1e-9);
      expect([...improved].sort()).toEqual([...seq].sort());
    }
  });
});

describe('vehicle routing', () => {
  it('respects capacity and visits every stop exactly once', () => {
    const sim = new Simulation({ seed: 'vrp' });
    const city = sim.city;
    const rng = createRng('demand');
    const stops = city.bins.map((b) => ({ node: b.node, demand: rng.range(100, 1100), ref: b.id }));
    for (const construction of ['nearest', 'savings'] as const) {
      const sol = solveVrp(
        {
          depot: city.depot.node,
          hub: city.landfill.node,
          stops,
          capacity: 6000,
          trucks: 3,
          dist: (a, b) => sim.table.distance(a, b),
          serviceSeconds: 60,
          unloadSeconds: 300,
          avgSpeed: 8,
        },
        { construction },
      );
      const seen: number[] = [];
      for (const t of sol.trucks) {
        for (const trip of t.trips) {
          const load = trip.stops.reduce((s, i) => s + stops[i].demand, 0);
          expect(load).toBeLessThanOrEqual(6000 + 1e-6);
          seen.push(...trip.stops);
        }
      }
      expect(seen.sort((a, b) => a - b)).toEqual(stops.map((_, i) => i));
    }
  });
});

describe('simulation', () => {
  it('replays identically from the same seed', () => {
    const run = () => {
      const sim = new Simulation({ seed: 'replay', policy: 'predictive' });
      sim.advance(2 * 86400);
      return JSON.stringify({ m: sim.metrics, fills: sim.bins.map((b) => b.fill.toFixed(6)) });
    };
    expect(run()).toBe(run());
  });

  it('trucks never carry more than their capacity', () => {
    const sim = new Simulation({ seed: 'cap', policy: 'fixed' });
    for (let k = 0; k < 24 * 60; k++) {
      sim.advance(60);
      for (const t of sim.trucks) expect(t.load).toBeLessThanOrEqual(t.capacity + 1e-6);
    }
  });
});

describe('algorithm lab', () => {
  it('every algorithm returns a permutation and none beats the exact optimum', async () => {
    const { makeLabProblem, runLab } = await import('../src/lab.ts');
    const sim = new Simulation({ seed: 'lab' });
    const problem = makeLabProblem(sim.city, sim.table, 10, 'lab');
    const exact = runLab(problem, 'exact');
    for (const alg of ['nearest', 'savings', 'twoopt', 'oropt', 'anneal', 'ants'] as const) {
      const run = runLab(problem, alg);
      expect([...run.order].sort((a, b) => a - b)).toEqual(Array.from({ length: 10 }, (_, i) => i));
      expect(run.cost).toBeGreaterThanOrEqual(exact.cost - 1e-6);
      expect(run.frames.length).toBeGreaterThan(0);
    }
  });
});

describe('custom policy', () => {
  it('rejects syntax errors and bad return values, accepts a working policy', async () => {
    const { validateCustomPolicy, installCustomPolicy, policyOrder } = await import('../src/index.ts');
    expect(validateCustomPolicy('return ctx.bins.map(b => b.id').ok).toBe(false);
    expect(validateCustomPolicy('return 42;').ok).toBe(false);
    const good = validateCustomPolicy('return ctx.bins.filter(b => b.reading > 0.8).map(b => b.id);');
    expect(good.ok).toBe(true);
    expect(good.custom!.metrics.visits).toBeGreaterThan(0);
    expect(policyOrder()).toContain('custom');
    installCustomPolicy(null);
    expect(policyOrder()).not.toContain('custom');
  });
});

describe('sigv4 presign for IoT websockets', () => {
  it('produces exactly the AWS SDK signature', async () => {
    const { presignIotWebsocket } = await import('../src/sigv4.ts');
    const { SignatureV4 } = await import('@smithy/signature-v4');
    const { Sha256 } = await import('@aws-crypto/sha256-js');
    const creds = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
    const now = new Date('2026-10-25T10:15:00Z');
    const endpoint = 'abc123-ats.iot.ap-south-1.amazonaws.com';
    const ours = new URL((await presignIotWebsocket(endpoint, 'ap-south-1', { ...creds, sessionToken: 'TOKEN/+=' }, now, 3600)).replace('wss:', 'https:'));
    const ref = await new SignatureV4({ credentials: creds, region: 'ap-south-1', service: 'iotdevicegateway', sha256: Sha256 }).presign(
      { method: 'GET', protocol: 'https:', hostname: endpoint, path: '/mqtt', headers: { host: endpoint }, query: {} },
      { signingDate: now, expiresIn: 3600 },
    );
    for (const k of ['X-Amz-Algorithm', 'X-Amz-Credential', 'X-Amz-Date', 'X-Amz-Expires', 'X-Amz-SignedHeaders', 'X-Amz-Signature']) {
      expect(ours.searchParams.get(k), k).toBe(ref.query![k]);
    }
    // The session token rides along unsigned, after the signature.
    expect(ours.searchParams.get('X-Amz-Security-Token')).toBe('TOKEN/+=');
    expect(ours.search.indexOf('X-Amz-Security-Token')).toBeGreaterThan(ours.search.indexOf('X-Amz-Signature'));
  });
});
