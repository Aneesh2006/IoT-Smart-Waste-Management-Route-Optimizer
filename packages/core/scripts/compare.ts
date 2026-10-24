// Run one seeded week under every policy and print the scorecard.
// Usage: pnpm sim [seed] [days]
import { POLICY_ORDER, Simulation } from '../src/index.ts';

const seed = process.argv[2] ?? 'binsight';
const days = Number(process.argv[3] ?? 7);
const rows = POLICY_ORDER.map((policy) => {
  const t0 = performance.now();
  const sim = new Simulation({ seed, policy });
  sim.advance(days * 86400);
  const m = sim.metrics;
  return {
    policy,
    km: +(m.distanceM / 1000).toFixed(1),
    fuelL: +m.fuelL.toFixed(0),
    co2Kg: +m.co2Kg.toFixed(0),
    costInr: Math.round(m.costInr),
    visits: m.visits,
    wasted: m.wastedVisits,
    wastedPct: +((100 * m.wastedVisits) / Math.max(1, m.visits)).toFixed(1),
    overflows: m.overflowEvents,
    overflowBinH: +m.overflowBinHours.toFixed(0),
    crewH: +m.crewHours.toFixed(0),
    collectedKL: +(m.collectedL / 1000).toFixed(0),
    ms: Math.round(performance.now() - t0),
  };
});
console.table(rows);
