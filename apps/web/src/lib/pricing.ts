/**
 * Approximate list prices (USD) used for the cost meter: Vercel functions, Ably
 * messages and a MongoDB Atlas cluster sized for the write rate. They are teaching
 * numbers, close to published rates, but check vercel.com/pricing, ably.com/pricing
 * and mongodb.com/pricing before quoting them.
 */
export const PRICES = {
  /** Vercel Pro, per million function invocations. */
  fnInvocationPerMillion: 0.6,
  /** Vercel Fluid compute: active CPU per hour, and memory per GB-hour while a request is open. */
  fnCpuPerHour: 0.128,
  fnMemoryGbHour: 0.0106,
  /** Ably, per million messages (each publish and each delivery counts). */
  ablyPerMillion: 2.5,
  /** Atlas tiers by sustained operations per second, monthly. */
  atlas: [
    { name: 'M0 (free)', opsPerSec: 100, monthly: 0 },
    { name: 'Flex', opsPerSec: 500, monthly: 30 },
    { name: 'M10', opsPerSec: 1500, monthly: 57 },
    { name: 'M30', opsPerSec: 6000, monthly: 390 },
    { name: 'M50', opsPerSec: Infinity, monthly: 1450 },
  ],
  usdToInr: 84,
};

export interface CostBreakdown {
  /** Vercel: the ingest function's invocations, CPU and memory. */
  fn: number;
  /** Ably: one publish per batch plus a delivery to every dashboard. */
  realtime: number;
  /** MongoDB Atlas: the cluster tier the write rate needs. */
  db: number;
  dbTier: string;
  total: number;
}

const MONTH_S = 30 * 24 * 3600;

/**
 * Cost of `readings` sensor readings a month flowing through the pipeline, with
 * `dashboards` browsers watching. Each device POSTs its own reading (one
 * invocation), the function writes the latest state plus a history row, and
 * publishes batches of `batch` readings to Ably.
 */
export function pipelineCost(readings: number, dashboards = 3, batch = 25): CostBreakdown {
  const m = readings / 1e6;
  const cpuS = 0.015;
  const wallS = 0.12;
  const fn = m * PRICES.fnInvocationPerMillion + (readings * cpuS * PRICES.fnCpuPerHour) / 3600 + (readings * wallS * 1 * PRICES.fnMemoryGbHour) / 3600;
  const realtime = (readings / batch / 1e6) * (1 + dashboards) * PRICES.ablyPerMillion;
  const opsPerSec = (readings * 2) / MONTH_S;
  const tier = PRICES.atlas.find((t) => opsPerSec <= t.opsPerSec)!;
  return { fn, realtime, db: tier.monthly, dbTier: tier.name, total: fn + realtime + tier.monthly };
}
