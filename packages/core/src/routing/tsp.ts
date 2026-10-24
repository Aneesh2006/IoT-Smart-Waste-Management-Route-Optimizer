/**
 * Single-vehicle tour tools. A tour is an open path start → seq… → end with
 * both endpoints fixed (for a waste trip, both are the transfer station).
 * Distances are symmetric because every road is two-way.
 */
export type Dist = (a: number, b: number) => number;

export function pathLength(seq: readonly number[], start: number, end: number, d: Dist): number {
  if (seq.length === 0) return d(start, end);
  let total = d(start, seq[0]);
  for (let i = 1; i < seq.length; i++) total += d(seq[i - 1], seq[i]);
  return total + d(seq[seq.length - 1], end);
}

export interface TwoOptMove {
  i: number;
  k: number;
  gain: number;
}

/**
 * 2-opt: reverse any segment whose reversal shortens the tour, until none does.
 * `onMove` sees every accepted move (the Algorithm Lab animates them).
 */
export function twoOpt(
  seq: readonly number[],
  start: number,
  end: number,
  d: Dist,
  onMove?: (tour: number[], move: TwoOptMove) => void,
): number[] {
  const tour = [start, ...seq, end];
  const n = tour.length;
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 1; i < n - 2; i++) {
      for (let k = i + 1; k < n - 1; k++) {
        const delta =
          d(tour[i - 1], tour[k]) + d(tour[i], tour[k + 1]) - d(tour[i - 1], tour[i]) - d(tour[k], tour[k + 1]);
        if (delta < -1e-7) {
          reverse(tour, i, k);
          improved = true;
          onMove?.(tour.slice(1, -1), { i: i - 1, k: k - 1, gain: -delta });
        }
      }
    }
  }
  return tour.slice(1, -1);
}

/** Or-opt: move chains of 1–3 consecutive stops (either way round) to a better slot. */
export function orOpt(
  seq: readonly number[],
  start: number,
  end: number,
  d: Dist,
  onMove?: (tour: number[], gain: number) => void,
): number[] {
  let tour = [...seq];
  let improved = true;
  while (improved) {
    improved = false;
    for (let len = 1; len <= 3 && !improved; len++) {
      for (let i = 0; i + len <= tour.length && !improved; i++) {
        const prev = i === 0 ? start : tour[i - 1];
        const next = i + len === tour.length ? end : tour[i + len];
        const first = tour[i];
        const last = tour[i + len - 1];
        const removeGain = d(prev, first) + d(last, next) - d(prev, next);
        const rest = [...tour.slice(0, i), ...tour.slice(i + len)];
        const chain = tour.slice(i, i + len);
        let best = 1e-7;
        let bestPos = -1;
        let bestReversed = false;
        for (let p = 0; p <= rest.length; p++) {
          if (p === i) continue;
          const a = p === 0 ? start : rest[p - 1];
          const b = p === rest.length ? end : rest[p];
          const base = d(a, b);
          const fwd = removeGain - (d(a, first) + d(last, b) - base);
          const rev = removeGain - (d(a, last) + d(first, b) - base);
          if (fwd > best) {
            best = fwd;
            bestPos = p;
            bestReversed = false;
          }
          if (rev > best) {
            best = rev;
            bestPos = p;
            bestReversed = true;
          }
        }
        if (bestPos >= 0) {
          const ins = bestReversed ? chain.reverse() : chain;
          tour = [...rest.slice(0, bestPos), ...ins, ...rest.slice(bestPos)];
          improved = true;
          onMove?.([...tour], best);
        }
      }
    }
  }
  return tour;
}

/**
 * Held–Karp dynamic programme: the exact shortest order, O(n²·2ⁿ).
 * Used as ground truth for the optimality-gap meter; keep n ≤ 13.
 */
export function heldKarp(seq: readonly number[], start: number, end: number, d: Dist): { order: number[]; length: number } {
  const n = seq.length;
  if (n === 0) return { order: [], length: d(start, end) };
  if (n > 16) throw new Error(`heldKarp: ${n} stops is too many for an exact solve`);
  const full = 1 << n;
  const cost = new Float64Array(full * n).fill(Infinity);
  const parent = new Int8Array(full * n).fill(-1);
  for (let j = 0; j < n; j++) cost[(1 << j) * n + j] = d(start, seq[j]);
  for (let mask = 1; mask < full; mask++) {
    for (let j = 0; j < n; j++) {
      if (!(mask & (1 << j))) continue;
      const here = cost[mask * n + j];
      if (here === Infinity) continue;
      for (let k = 0; k < n; k++) {
        if (mask & (1 << k)) continue;
        const next = mask | (1 << k);
        const c = here + d(seq[j], seq[k]);
        if (c < cost[next * n + k]) {
          cost[next * n + k] = c;
          parent[next * n + k] = j;
        }
      }
    }
  }
  let best = Infinity;
  let last = -1;
  for (let j = 0; j < n; j++) {
    const c = cost[(full - 1) * n + j] + d(seq[j], end);
    if (c < best) {
      best = c;
      last = j;
    }
  }
  const order: number[] = [];
  let mask = full - 1;
  for (let j = last; j !== -1; ) {
    order.push(seq[j]);
    const p = parent[mask * n + j];
    mask ^= 1 << j;
    j = p;
  }
  return { order: order.reverse(), length: best };
}

function reverse(xs: number[], i: number, k: number) {
  while (i < k) {
    [xs[i], xs[k]] = [xs[k], xs[i]];
    i++;
    k--;
  }
}
