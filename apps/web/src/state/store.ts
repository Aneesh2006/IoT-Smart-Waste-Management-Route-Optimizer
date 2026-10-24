import { Simulation, type Construction, type PolicyId } from '@binsight/core';
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
}

const seedFromUrl = () => new URLSearchParams(window.location.search).get('seed') ?? 'binsight';

const randomSeed = () => {
  const words = ['indira', 'koramangala', 'jayanagar', 'malleshwaram', 'basavanagudi', 'whitefield', 'hebbal', 'banashankari', 'rajajinagar', 'yelahanka'];
  return `${words[Math.floor(Math.random() * words.length)]}-${Math.floor(Math.random() * 900 + 100)}`;
};

export const useApp = create<AppState>((set, get) => ({
  sim: new Simulation({ seed: seedFromUrl() }),
  simKey: 0,
  tick: 0,
  speed: 60,
  paused: false,
  selectedBin: null,
  selectedTruck: null,
  hoveredBin: null,
  followTruck: null,
  focus: null,
  leftOpen: typeof window !== 'undefined' ? window.innerWidth >= 900 : true,
  dataView: false,
  compareOpen: false,

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
  setCompareOpen: (open) => set({ compareOpen: open }),
}));
