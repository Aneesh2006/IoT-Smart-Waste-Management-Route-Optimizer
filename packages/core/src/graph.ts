import type { Arc, Graph, RoadEdge, RoadNode } from './types.ts';

/** Min-heap keyed by number, storing node ids. */
class MinHeap {
  private keys: number[] = [];
  private vals: number[] = [];

  get size() {
    return this.vals.length;
  }

  push(key: number, val: number) {
    const keys = this.keys;
    const vals = this.vals;
    keys.push(key);
    vals.push(val);
    let i = vals.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      keys[i] = keys[p];
      vals[i] = vals[p];
      i = p;
    }
    keys[i] = key;
    vals[i] = val;
  }

  /** Returns [key, val]; caller must check size first. */
  pop(): [number, number] {
    const keys = this.keys;
    const vals = this.vals;
    const topKey = keys[0];
    const topVal = vals[0];
    const lastKey = keys.pop()!;
    const lastVal = vals.pop()!;
    const n = vals.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        if (l >= n) break;
        const r = l + 1;
        const c = r < n && keys[r] < keys[l] ? r : l;
        if (keys[c] >= lastKey) break;
        keys[i] = keys[c];
        vals[i] = vals[c];
        i = c;
      }
      keys[i] = lastKey;
      vals[i] = lastVal;
    }
    return [topKey, topVal];
  }
}

export function buildAdjacency(nodeCount: number, edges: RoadEdge[]): Arc[][] {
  const adjacency: Arc[][] = Array.from({ length: nodeCount }, () => []);
  for (const e of edges) {
    adjacency[e.a].push({ to: e.b, edge: e.id });
    adjacency[e.b].push({ to: e.a, edge: e.id });
  }
  return adjacency;
}

export interface ShortestPaths {
  source: number;
  dist: Float64Array;
  /** Predecessor node on the shortest path, -1 at the source or if unreachable. */
  prev: Int32Array;
  /** Nodes in the order they were settled: the Dijkstra wavefront. */
  order?: number[];
}

/** Dijkstra by road length. Closed edges are impassable. */
export function dijkstra(graph: Graph, source: number, recordOrder = false): ShortestPaths {
  const n = graph.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const order: number[] | undefined = recordOrder ? [] : undefined;
  const heap = new MinHeap();
  dist[source] = 0;
  heap.push(0, source);
  while (heap.size > 0) {
    const [d, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    order?.push(u);
    for (const arc of graph.adjacency[u]) {
      const edge = graph.edges[arc.edge];
      if (edge.closed) continue;
      const nd = d + edge.length;
      if (nd < dist[arc.to]) {
        dist[arc.to] = nd;
        prev[arc.to] = u;
        heap.push(nd, arc.to);
      }
    }
  }
  return { source, dist, prev, order };
}

/** Node sequence from the source to `target`, inclusive; empty if unreachable. */
export function pathTo(paths: ShortestPaths, target: number): number[] {
  if (target === paths.source) return [target];
  if (paths.prev[target] === -1) return [];
  const out: number[] = [];
  for (let v = target; v !== -1; v = paths.prev[v]) out.push(v);
  return out.reverse();
}

export function nodeDistance(a: RoadNode, b: RoadNode) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** A* with a straight-line heuristic; returns the path and every node it expanded. */
export function astar(graph: Graph, source: number, target: number) {
  const n = graph.nodes.length;
  const g = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const expanded: number[] = [];
  const heap = new MinHeap();
  const goal = graph.nodes[target];
  g[source] = 0;
  heap.push(nodeDistance(graph.nodes[source], goal), source);
  while (heap.size > 0) {
    const [, u] = heap.pop();
    if (done[u]) continue;
    done[u] = 1;
    expanded.push(u);
    if (u === target) break;
    for (const arc of graph.adjacency[u]) {
      const edge = graph.edges[arc.edge];
      if (edge.closed) continue;
      const ng = g[u] + edge.length;
      if (ng < g[arc.to]) {
        g[arc.to] = ng;
        prev[arc.to] = u;
        heap.push(ng + nodeDistance(graph.nodes[arc.to], goal), arc.to);
      }
    }
  }
  const path = pathTo({ source, dist: g, prev }, target);
  return { path, length: g[target], expanded };
}

/**
 * Shortest road distances between a fixed set of "interesting" nodes (depot,
 * transfer station, every bin). One Dijkstra per source, computed lazily.
 */
export class DistanceTable {
  private rows = new Map<number, ShortestPaths>();
  private graph: Graph;
  constructor(graph: Graph) {
    this.graph = graph;
  }

  private row(source: number) {
    let r = this.rows.get(source);
    if (!r) {
      r = dijkstra(this.graph, source);
      this.rows.set(source, r);
    }
    return r;
  }

  distance(a: number, b: number) {
    return this.row(a).dist[b];
  }

  path(a: number, b: number) {
    return pathTo(this.row(a), b);
  }

  /** Forget everything, e.g. after a road closes. */
  invalidate() {
    this.rows.clear();
  }
}

/** Is every node reachable from node 0 over open edges? */
export function isConnected(graph: Graph): boolean {
  const n = graph.nodes.length;
  if (n === 0) return true;
  const seen = new Uint8Array(n);
  const stack = [0];
  seen[0] = 1;
  let count = 1;
  while (stack.length) {
    const u = stack.pop()!;
    for (const arc of graph.adjacency[u]) {
      if (graph.edges[arc.edge].closed || seen[arc.to]) continue;
      seen[arc.to] = 1;
      count++;
      stack.push(arc.to);
    }
  }
  return count === n;
}

/** Edge joining two adjacent nodes, if any. */
export function edgeBetween(graph: Graph, a: number, b: number): RoadEdge | undefined {
  const arc = graph.adjacency[a].find((x) => x.to === b);
  return arc ? graph.edges[arc.edge] : undefined;
}
