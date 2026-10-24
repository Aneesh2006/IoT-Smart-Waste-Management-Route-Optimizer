import type { BinState } from './sim.ts';
import type { BinSite } from './types.ts';

export type PolicyId = 'fixed' | 'threshold' | 'predictive' | 'dynamic';

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
  /** Called every hour inside a shift; bins it returns go to whichever trucks are idle. */
  replan?(ctx: PolicyContext): number[];
}

const usable = (b: BinState) => b.sensorOk;

/** Bins that would overflow by `horizon`, plus half-full neighbours of those that are on the way. */
function forecastSelect(ctx: PolicyContext, horizon: number, level: number): number[] {
  const must = ctx.bins.filter((b) => !usable(b) || ctx.forecast(b.id, horizon) >= level).map((b) => b.id);
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
}

// The next crew reaches a bin somewhere inside its shift; plan for halfway.
const nextCrewArrives = (ctx: PolicyContext) => ctx.nextShiftStart + (ctx.shiftHours * 3600) / 2;

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
    select: (ctx) => forecastSelect(ctx, nextCrewArrives(ctx), 0.92),
  },
  dynamic: {
    id: 'dynamic',
    name: 'Dynamic',
    short: 'Dynamic',
    description:
      'Predictive at the start of each shift, then re-plans every hour: any bin now forecast to overflow within three hours gets an idle truck.',
    select: (ctx) => forecastSelect(ctx, nextCrewArrives(ctx), 0.92),
    replan: (ctx) => {
      const soon = ctx.bins.filter((b) => b.overflowing || ctx.forecast(b.id, ctx.time + 3 * 3600) >= 0.97);
      // A truck for a single bin is rarely worth it unless that bin is already spilling.
      if (soon.length < 3 && !soon.some((b) => b.overflowing)) return [];
      return forecastSelect(ctx, ctx.time + 3 * 3600, 0.97);
    },
  },
};

export const POLICY_ORDER: PolicyId[] = ['fixed', 'threshold', 'predictive', 'dynamic'];
