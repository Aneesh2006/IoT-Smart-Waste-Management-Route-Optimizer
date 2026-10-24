import { POLICY_ORDER, Simulation, type ChaosKind, type Construction, type PolicyId, type SimConfig } from '@binsight/core';
import { create } from 'zustand';

export const SPEEDS = [10, 60, 300, 1200, 3600] as const;

export type CameraFocus = { x: number; z: number; distance?: number } | null;

interface AppState {
  sim: Simulation;
  /** Changes whenever a new Simulation is built, so the scene remounts. */
  simKey: number;
  /** Bumped a few times a second; HUD components subscribe to it to re-read the sim. */
  tick: number;
  speed: number;
  paused: boolean;
  selectedBin: number | null;
  selectedTruck: number | null;
  hoveredBin: number | null;
  followTruck: number | null;
  focus: CameraFocus;
  leftOpen: boolean;
  /** Ghost the buildings so the data layer (bins, routes) stands out. */
  dataView: boolean;
  compareOpen: boolean;
  compareScenario: ChaosKind | 'none';
  labOpen: boolean;
  guideOpen: boolean;
  toast: string | null;

  bump(): void;
  setSpeed(speed: number): void;
  togglePause(): void;
  selectBin(id: number | null, fly?: boolean): void;
  selectTruck(id: number | null): void;
  hoverBin(id: number | null): void;
  setFollow(id: number | null): void;
  clearFocus(): void;
  newCity(seed?: string): void;
  setPolicy(id: PolicyId): void;
  setThreshold(t: number): void;
  setSolver(construction: Construction, improve: boolean): void;
  skipToNextShift(): void;
  setLeftOpen(open: boolean): void;
  toggleDataView(): void;
  setCompareOpen(open: boolean): void;
  setCompareScenario(s: ChaosKind | 'none'): void;
  setLabOpen(open: boolean): void;
  setGuideOpen(open: boolean): void;
  showToast(text: string): void;
  /** Copy a link that rebuilds this exact setup (not how far the run has got). */
  copyShareLink(): Promise<void>;
}

/** Everything a shared link carries. The run's progress is deliberately left out. */
function configFromUrl(): { config: Partial<SimConfig>; speed?: number } {
  const q = new URLSearchParams(window.location.search);
  const num = (k: string) => (q.has(k) && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : undefined);
  const policy = q.get('policy') as PolicyId | null;
  const solver = q.get('solver');
  return {
    config: {
      seed: q.get('seed') ?? undefined,
      policy: policy && POLICY_ORDER.includes(policy) ? policy : undefined,
      threshold: num('threshold'),
      trucks: num('trucks') !== undefined ? Math.min(8, Math.max(1, num('trucks')!)) : undefined,
      bins: num('bins') !== undefined ? Math.min(400, Math.max(20, num('bins')!)) : undefined,
      construction: solver === 'nearest' || solver === 'savings' ? solver : undefined,
      improve: q.has('improve') ? q.get('improve') !== '0' : undefined,
    },
    speed: num('speed'),
  };
}

function shareUrl(config: SimConfig, speed: number) {
  const url = new URL(window.location.origin + window.location.pathname);
  url.searchParams.set('seed', config.seed);
  url.searchParams.set('policy', config.policy);
  url.searchParams.set('threshold', String(config.threshold));
  url.searchParams.set('trucks', String(config.trucks));
  url.searchParams.set('bins', String(config.bins));
  url.searchParams.set('solver', config.construction);
  url.searchParams.set('improve', config.improve ? '1' : '0');
  url.searchParams.set('speed', String(speed));
  return url.toString();
}

const initial = configFromUrl();
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const guideSeen = () => {
  try {
    return window.localStorage.getItem('binsight.guideSeen') === '1';
  } catch {
    return true;
  }
};

const randomSeed = () => {
  const words = ['indira', 'koramangala', 'jayanagar', 'malleshwaram', 'basavanagudi', 'whitefield', 'hebbal', 'banashankari', 'rajajinagar', 'yelahanka'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
};

export const useApp = create<AppState>((set, get) => ({
  sim: new Simulation(initial.config),
  simKey: 0,
  tick: 0,
  speed: SPEEDS.includes(initial.speed as (typeof SPEEDS)[number]) ? initial.speed! : 60,
  paused: false,
  selectedBin: null,
  selectedTruck: null,
  hoveredBin: null,
  followTruck: null,
  focus: null,
  leftOpen: typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  dataView: false,
  compareOpen: false,
  compareScenario: 'none',
  labOpen: false,
  guideOpen: !guideSeen(),
  toast: null,

  bump: () => set((s) => ({ tick: s.tick + 1 })),
  setSpeed: (speed) => set({ speed, paused: false }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  selectBin: (id, fly = false) => {
    const sim = get().sim;
    const site = id === null ? null : sim.city.bins[id];
    set({
      selectedBin: id,
      selectedTruck: null,
      followTruck: null,
      focus: fly && site ? { x: site.x, z: site.z, distance: 260 } : get().focus,
    });
  },
  selectTruck: (id) => set({ selectedTruck: id, selectedBin: null, followTruck: id }),
  hoverBin: (id) => {
    if (get().hoveredBin !== id) set({ hoveredBin: id });
  },
  setFollow: (id) => set({ followTruck: id }),
  clearFocus: () => set({ focus: null }),
  newCity: (seed) => {
    const prev = get().sim.config;
    const next = seed ?? randomSeed();
    const url = new URL(window.location.href);
    url.searchParams.set('seed', next);
    window.history.replaceState(null, '', url);
    set((s) => ({
      sim: new Simulation({ ...prev, seed: next, shifts: prev.shifts.map((x) => ({ ...x })) }),
      simKey: s.simKey + 1,
      selectedBin: null,
      selectedTruck: null,
      followTruck: null,
      hoveredBin: null,
    }));
  },
  setPolicy: (id) => {
    get().sim.setPolicy(id);
    get().bump();
  },
  setThreshold: (t) => {
    get().sim.config.threshold = t;
    get().bump();
  },
  setSolver: (construction, improve) => {
    const cfg = get().sim.config;
    cfg.construction = construction;
    cfg.improve = improve;
    get().bump();
  },
  skipToNextShift: () => {
    const sim = get().sim;
    const target = sim.nextShiftStart() + 1;
    sim.advance(target - sim.time);
    get().bump();
  },
  setLeftOpen: (open) => set({ leftOpen: open }),
  toggleDataView: () => set((s) => ({ dataView: !s.dataView })),
  setCompareOpen: (open) => set({ compareOpen: open, labOpen: false }),
  setLabOpen: (open) => set({ labOpen: open, compareOpen: false }),
  setCompareScenario: (compareScenario) => set({ compareScenario }),
  setGuideOpen: (open) => {
    if (!open) {
      try {
        window.localStorage.setItem('binsight.guideSeen', '1');
      } catch {
        // Private mode or blocked storage: the guide just shows again next time.
      }
    }
    set({ guideOpen: open, compareOpen: false, labOpen: false });
  },
  showToast: (text) => {
    clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  copyShareLink: async () => {
    const { sim, speed, showToast } = get();
    const url = shareUrl(sim.config, speed);
    window.history.replaceState(null, '', url);
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied: it rebuilds this city, policy and solver.');
    } catch {
      showToast('Link is in the address bar; copy it from there.');
    }
  },
}));
