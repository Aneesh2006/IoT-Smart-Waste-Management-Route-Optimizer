import type { PolicyId } from './policies.ts';
import { Simulation, type Metrics, type SimConfig } from './sim.ts';

export interface CompareRow {
  policy: PolicyId;
  days: number;
  metrics: Metrics;
  /** Hourly samples across the run. */
  overflowing: number[];
  distanceKm: number[];
  ms: number;
}

/**
 * Run one policy from cold for `days` on a fresh copy of the city described by
 * `config`. Every policy sees the same seed, so the same waste falls in the same
 * bins: the only thing that differs is the decisions.
 */
export function runPolicy(config: Partial<SimConfig>, policy: PolicyId, days: number): CompareRow {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const sim = new Simulation({ ...config, policy });
  sim.advance(days * 86400);
  const snaps = sim.snapshots.slice(-days * 24);
  return {
    policy,
    days,
    metrics: { ...sim.metrics },
    overflowing: snaps.map((s) => s.overflowing),
    distanceKm: snaps.map((s) => s.distanceKm),
    ms: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0,
  };
}
