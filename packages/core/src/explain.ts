import { POLICIES } from './policies.ts';
import { DAY, HOUR, formatClock } from './profiles.ts';
import type { Simulation } from './sim.ts';

export interface BinVerdict {
  verdict: 'collect' | 'skip' | 'enroute' | 'unknown';
  headline: string;
  detail: string;
  /** What the policy compares (reading or forecast) and the line it must cross, when there is one. */
  value?: number;
  limit?: number;
}

/**
 * In plain words: will the current policy send a truck to this bin at the next
 * shift, and why? Mirrors the policies' own rules (see policies.ts).
 */
export function explainBin(sim: Simulation, binId: number): BinVerdict {
  const b = sim.bins[binId];
  const site = sim.city.bins[binId];
  if (!b || !site) return { verdict: 'unknown', headline: 'Unknown bin', detail: '' };
  if (b.assigned >= 0) {
    return { verdict: 'enroute', headline: `${sim.trucks[b.assigned]?.name ?? 'A truck'} is already on its way`, detail: 'It was in the plan for the current shift.' };
  }
  const next = sim.nextShiftStart();
  const shift = sim.config.shifts.findIndex((s) => Math.abs(((next % DAY) / HOUR) - s.start) < 1e-6);
  const window = sim.config.shifts[Math.max(0, shift)];
  const when = formatClock(next);
  const policy = POLICIES[sim.config.policy];
  const pct = (f: number) => `${Math.round(f * 100)}%`;

  if (!b.sensorOk) {
    return {
      verdict: sim.config.policy === 'fixed' && shift !== 0 ? 'skip' : 'collect',
      headline: sim.config.policy === 'fixed' ? `Collected on the morning round` : `Collected blind at ${when}`,
      detail: 'Its sensor is offline, so every sensor-based policy has to assume the worst and send a truck.',
    };
  }

  switch (sim.config.policy) {
    case 'fixed':
      return shift === 0
        ? { verdict: 'collect', headline: `Collected at ${when}`, detail: `Fixed schedule: every bin, every morning, at ${pct(b.reading)} or not.` }
        : { verdict: 'skip', headline: `Not until the morning round`, detail: 'Fixed schedule only runs in the morning, whatever the sensor says.' };
    case 'threshold': {
      const t = sim.config.threshold;
      return b.reading >= t
        ? { verdict: 'collect', headline: `Collected at ${when}`, detail: `Reads ${pct(b.reading)}, at or above the ${pct(t)} threshold.`, value: b.reading, limit: t }
        : { verdict: 'skip', headline: `Skipped at ${when} (for now)`, detail: `Reads ${pct(b.reading)}, under the ${pct(t)} threshold. Threshold ignores what comes next.`, value: b.reading, limit: t };
    }
    case 'predictive':
    case 'dynamic': {
      const after = sim.nextShiftStart(next);
      const horizon = after + ((window.end - window.start) * HOUR) / 2;
      const f = sim.forecast(binId, horizon);
      const base: BinVerdict =
        f >= 0.92
          ? { verdict: 'collect' as const, headline: `Collected at ${when}`, detail: `Forecast ${pct(f)} by ${formatClock(horizon)}, when the crew after that would reach it. Over 92%, so it can't wait.` }
          : {
              verdict: 'skip' as const,
              headline: `Skipped at ${when}`,
              detail: `Forecast only ${pct(f)} by ${formatClock(horizon)}${b.reading >= 0.5 ? ', unless a truck passes within 180 m for a neighbour (then it is grabbed on the way)' : ''}.`,
            };
      base.value = f;
      base.limit = 0.92;
      if (sim.config.policy === 'dynamic' && base.verdict === 'skip') {
        base.detail += ' Dynamic re-checks every hour and will dispatch an idle truck if that changes.';
      }
      return base;
    }
    default:
      return { verdict: 'unknown', headline: `Decided by ${policy.name}`, detail: 'Your custom select(ctx) decides at each shift.' };
  }
}
