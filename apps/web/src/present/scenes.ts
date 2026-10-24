import { DAY, HOUR, type Simulation } from '@binsight/core';
import { useApp } from '../state/store.ts';

/**
 * The presentation, scene by scene. Each scene sets up the city, the camera
 * and the panels, then the presenter talks over it. Sandbox-only steps are
 * skipped in Live mode, where the cloud owns the clock.
 */
export interface Scene {
  kicker: string;
  title: string;
  subtitle: string;
  enter(): void;
}

const S = () => useApp.getState();

const sandbox = () => S().mode === 'sandbox';

/** Advance a sandbox sim to the next time the clock reads `hour` (fractional hours). */
function jumpTo(sim: Simulation, hour: number) {
  const day = Math.floor(sim.time / DAY);
  let t = day * DAY + hour * HOUR;
  if (t <= sim.time) t += DAY;
  sim.advance(t - sim.time);
}

function center(distance: number) {
  const { x0, x1, z0, z1 } = S().sim.city.bounds;
  useApp.setState({ focus: { x: (x0 + x1) / 2, z: (z0 + z1) / 2, distance }, followTruck: null, selectedTruck: null, selectedBin: null });
}

function busiestTruck(sim: Simulation) {
  const moving = sim.trucks.filter((t) => t.route);
  return (moving.sort((a, b) => b.binsToday - a.binsToday)[0] ?? sim.trucks[0]).id;
}

function fullestBin(sim: Simulation, district?: string) {
  const pool = sim.bins.filter((b) => !district || sim.city.bins[b.id].district === district);
  return pool.sort((a, b) => b.fill - a.fill)[0]?.id ?? 0;
}

export const SCENES: Scene[] = [
  {
    kicker: 'BCS VII · Cloud Computing',
    title: 'BinSight',
    subtitle: 'A cloud digital twin for smart waste collection',
    enter() {
      S().closeOverlays();
      useApp.setState({ clean: true, orbit: true, dataView: false, heatmap: 'off', replay: null, paused: false });
      if (sandbox()) S().setSpeed(300);
      center(1700);
    },
  },
  {
    kicker: 'The problem',
    title: 'Every bin, every morning',
    subtitle: 'Fixed schedules empty half-empty bins while the busy ones overflow by evening',
    enter() {
      S().closeOverlays();
      useApp.setState({ clean: false, orbit: false, leftOpen: true, dataView: false, heatmap: 'off' });
      const sim = S().sim;
      if (sandbox()) {
        sim.setPolicy('fixed');
        jumpTo(sim, 6.4);
        S().setSpeed(60);
      }
      S().selectTruck(busiestTruck(sim));
    },
  },
  {
    kicker: 'Insight',
    title: 'Full ≠ urgent',
    subtitle: 'A 60% market bin at 5 pm overflows before a 90% bin in a quiet lane',
    enter() {
      S().closeOverlays();
      const sim = S().sim;
      if (sandbox()) {
        jumpTo(sim, 19.5);
        S().setSpeed(60);
      }
      useApp.setState({ dataView: true, heatmap: 'overflow', orbit: false, clean: false });
      S().selectBin(fullestBin(sim, 'market'), true);
    },
  },
  {
    kicker: 'The fix',
    title: 'Same city, different decisions',
    subtitle: 'Every policy replays the same seeded week: litter, wasted trips and cost side by side',
    enter() {
      useApp.setState({ dataView: false, heatmap: 'off', compareScenario: 'none' });
      if (sandbox()) S().sim.setPolicy('predictive');
      S().setCompareOpen(true);
    },
  },
  {
    kicker: 'Operations',
    title: 'Most trucks sit idle',
    subtitle: 'A day of the fleet: under a smart policy most trucks never leave the depot',
    enter() {
      useApp.setState({ impactTab: 'fleet' });
      S().setImpactOpen(true);
    },
  },
  {
    kicker: 'Algorithms',
    title: 'Short ≠ optimal',
    subtitle: 'Route heuristics against the exact Held–Karp optimum, on the real road network',
    enter() {
      S().setLabOpen(true);
    },
  },
  {
    kicker: 'Resilience',
    title: 'Forecast ≠ reality',
    subtitle: 'A festival floods the markets with waste and a monsoon closes a road. Dynamic re-plans every hour',
    enter() {
      S().closeOverlays();
      const sim = S().sim;
      if (sandbox()) {
        sim.setPolicy('dynamic');
        jumpTo(sim, 15.2);
        sim.trigger('festival');
        sim.trigger('flood');
        S().setSpeed(60);
      }
      useApp.setState({ dataView: false, heatmap: 'fill', orbit: false });
      S().selectTruck(busiestTruck(sim));
    },
  },
  {
    kicker: 'On AWS',
    title: 'Real-time ≠ instant',
    subtitle: 'IoT Core → SQS → Lambda → DynamoDB → back to this screen, every hop timed',
    enter() {
      useApp.setState({ heatmap: 'off' });
      S().setXrayOpen(true);
    },
  },
  {
    kicker: 'Your turn',
    title: 'Your phone is a smart bin',
    subtitle: 'Scan the code, fill your bin, sort your trash, and the cloud sends a truck',
    enter() {
      S().closeOverlays();
      useApp.setState({ clean: false, orbit: true, dataView: false, heatmap: 'off', selectedBin: null, selectedTruck: null, followTruck: null });
      center(1300);
    },
  },
  {
    kicker: 'Thank you',
    title: 'BinSight',
    subtitle: 'Questions?',
    enter() {
      S().closeOverlays();
      useApp.setState({ clean: true, orbit: true, dataView: true, heatmap: 'off' });
      center(1900);
    },
  },
];

export function startPresentation(at = 0) {
  useApp.setState({ present: at, guideOpen: false });
  SCENES[at].enter();
}

export function goScene(delta: number) {
  const cur = S().present;
  if (cur === null) return;
  const next = Math.min(SCENES.length - 1, Math.max(0, cur + delta));
  if (next === cur) return;
  useApp.setState({ present: next });
  SCENES[next].enter();
}

export function stopPresentation() {
  S().closeOverlays();
  useApp.setState({ present: null, clean: false, orbit: false, dataView: false, heatmap: 'off' });
}
