import type { BinState } from './sim.ts';
import type { BinSite } from './types.ts';

export type PolicyId = 'fixed' | 'threshold' | 'predictive' | 'dynamic' | 'custom';

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
  custom: {
    id: 'custom',
    name: 'Custom',
    short: 'Custom',
    description: 'Your own select(ctx) function, written in the policy editor.',
    select: () => [],
  },
};

export const POLICY_ORDER: PolicyId[] = ['fixed', 'threshold', 'predictive', 'dynamic'];

let customCode: string | null = null;

/** The built-in policies, plus Custom once one has been installed. */
export function policyOrder(): PolicyId[] {
  return customCode ? [...POLICY_ORDER, 'custom'] : POLICY_ORDER;
}

export function customPolicyCode() {
  return customCode;
}

/**
 * Compile user code into the Custom policy. The code is the body of a function
 * `(ctx) => number[]`. It runs in this page like anything typed into the
 * devtools console, so only paste code you trust.
 */
export function installCustomPolicy(code: string | null): { ok: true } | { ok: false; error: string } {
  if (code === null) {
    customCode = null;
    POLICIES.custom.select = () => [];
    return { ok: true };
  }
  let fn: (ctx: PolicyContext) => unknown;
  try {
    fn = new Function('ctx', `"use strict";\n${code}`) as (ctx: PolicyContext) => unknown;
  } catch (e) {
    return { ok: false, error: `Syntax error: ${(e as Error).message}` };
  }
  POLICIES.custom.select = (ctx) => {
    const out = fn(ctx);
    if (!Array.isArray(out)) throw new Error(`select(ctx) must return an array of bin ids, got ${typeof out}`);
    const valid = new Set(ctx.bins.map((b) => b.id));
    const ids = new Set<number>();
    for (const v of out) {
      if (!Number.isInteger(v)) throw new Error(`Bin ids must be integers, got ${JSON.stringify(v)}`);
      // Bins already on a truck are not in ctx.bins; quietly skip them rather than fail.
      if (valid.has(v)) ids.add(v);
    }
    return [...ids];
  };
  customCode = code;
  return { ok: true };
}
