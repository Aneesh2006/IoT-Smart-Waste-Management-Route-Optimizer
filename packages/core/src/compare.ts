import { customPolicyCode, installCustomPolicy, type PolicyId } from './policies.ts';
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

export interface ValidationReport {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** Custom vs Predictive on the hidden test city, when it ran. */
  custom?: CompareRow;
  baseline?: CompareRow;
}

/**
 * Compile a custom policy and drive it for three days on a small hidden city.
 * Errors block activation; warnings don't (a bad policy is a fine thing to study).
 */
export function validateCustomPolicy(code: string): ValidationReport {
  const previous = customPolicyCode();
  const compiled = installCustomPolicy(code);
  if (!compiled.ok) {
    installCustomPolicy(previous);
    return { ok: false, errors: [compiled.error], warnings: [] };
  }
  const config = { seed: 'policy-check', bins: 48, trucks: 2 };
  let custom: CompareRow;
  try {
    custom = runPolicy(config, 'custom', 3);
  } catch (e) {
    installCustomPolicy(previous);
    return { ok: false, errors: [`Crashed during the test run: ${(e as Error).message}`], warnings: [] };
  }
  const baseline = runPolicy(config, 'predictive', 3);
  const warnings: string[] = [];
  if (custom.metrics.visits === 0) warnings.push('It never collected a single bin in three days.');
  if (custom.metrics.overflowBinHours > baseline.metrics.overflowBinHours * 3 + 20)
    warnings.push('It leaves far more litter than Predictive on the test city.');
  if (custom.metrics.visits && custom.metrics.wastedVisits / custom.metrics.visits > 0.3)
    warnings.push('Over 30% of its pickups are near-empty bins.');
  return { ok: true, errors: [], warnings, custom, baseline };
}

