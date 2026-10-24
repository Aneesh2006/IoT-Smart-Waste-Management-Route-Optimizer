import type { BinState } from './sim.ts';
import type { BinSite } from './types.ts';

export type PolicyId = 'fixed' | 'threshold' | 'predictive';

export interface PolicyContext {
  time: number;
  /** Index into the day's shifts (0 = morning). */
  shift: number;
  /** When the next chance to collect starts, seconds of sim time. */
  nextShiftStart: number;
  shiftHours: number;
  sites: readonly BinSite[];
  bins: readonly BinState[];
  threshold: number;
  /** Forecast fill fraction for a bin at a future time, from its learned pattern. */
  forecast: (binId: number, at: number) => number;
  distance: (binA: number, binB: number) => number;
}

export interface Policy {
  id: PolicyId;
  name: string;
  short: string;
  description: string;
  select(ctx: PolicyContext): number[];
}

const usable = (b: BinState) => b.sensorOk;

export const POLICIES: Record<PolicyId, Policy> = {
  fixed: {
    id: 'fixed',
    name: 'Fixed schedule',
    short: 'Fixed',
    description: 'Today’s status quo: every bin, every morning, whether it needs it or not. No sensors consulted.',
    select: (ctx) => (ctx.shift === 0 ? ctx.bins.map((b) => b.id) : []),
  },
  threshold: {
    id: 'threshold',
    name: 'Threshold',
    short: 'Threshold',
    description: 'Collect every bin whose sensor reads at or above the threshold right now. Simple, and blind to what happens next.',
    select: (ctx) => ctx.bins.filter((b) => !usable(b) || b.reading >= ctx.threshold).map((b) => b.id),
  },
  predictive: {
    id: 'predictive',
    name: 'Predictive',
    short: 'Predictive',
    description:
      'Forecast each bin from its learned daily rhythm; collect it now if it would overflow before the next crew can reach it, and grab half-full neighbours that are on the way.',
    select: (ctx) => {
      // The next crew reaches a bin somewhere inside its shift; plan for halfway.
      const horizon = ctx.nextShiftStart + (ctx.shiftHours * 3600) / 2;
      const must = ctx.bins.filter((b) => !usable(b) || ctx.forecast(b.id, horizon) >= 0.92).map((b) => b.id);
      const chosen = new Set(must);
      for (const b of ctx.bins) {
        if (chosen.has(b.id) || b.reading < 0.5) continue;
        for (const m of must) {
          if (ctx.distance(b.id, m) < 180) {
            chosen.add(b.id);
            break;
          }
        }
      }
      return [...chosen];
    },
  },
};

export const POLICY_ORDER: PolicyId[] = ['fixed', 'threshold', 'predictive'];
