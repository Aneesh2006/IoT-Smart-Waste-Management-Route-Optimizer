import { POLICY_ORDER, Simulation, type ChaosKind, type Construction, type LiveControl, type PolicyId, type SimConfig } from '@binsight/core';
import { create } from 'zustand';

export const SPEEDS = [10, 60, 300, 1200, 3600] as const;

export type HeatMode = 'off' | 'fill' | 'overflow' | 'generated';
export const HEAT_MODES: HeatMode[] = ['off', 'fill', 'overflow', 'generated'];

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
  editorOpen: boolean;
  xrayOpen: boolean;
  impactOpen: boolean;
  reportOpen: boolean;
  /** Presentation: slow camera orbit, panels hidden, scene index. */
  orbit: boolean;
  clean: boolean;
  present: number | null;
  quality: 'high' | 'low';
  sound: boolean;
  heatmap: HeatMode;
  /** Time-lapse of the recorded tape; the scene draws the tape frame instead of the live sim. */
  replay: { index: number; playing: boolean } | null;
  toast: string | null;
  mode: 'sandbox' | 'live';
  liveStatus: 'off' | 'connecting' | 'live' | 'error';
  liveError: string | null;
  liveControl: LiveControl | null;
  operator: boolean;
  /** Sandbox city to come back to when leaving Live mode. */
  sandboxConfig: Partial<SimConfig>;

  bump(): void;
  setSpeed(speed: number): void;
  togglePause(): void;
  selectBin(id: number | null, fly?: boolean): void;
  selectTruck(id: number | null): void;
  hoverBin(id: number | null): void;
  setFollow(id: number | null): void;
  clearFocus(): void;
  newCity(seed?: string): void;
  /** Rebuild the sandbox city with some settings changed (fleet size, bins, shifts…). */
  rebuildCity(patch: Partial<SimConfig>): void;
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
  setEditorOpen(open: boolean): void;
  setXrayOpen(open: boolean): void;
  setImpactOpen(open: boolean): void;
  setReportOpen(open: boolean): void;
  closeOverlays(): void;
  toggleSound(): void;
  setQuality(q: 'high' | 'low', auto?: boolean): void;
  cycleHeatmap(): void;
  startReplay(): void;
  setReplay(r: { index: number; playing: boolean }): void;
  exitReplay(): void;
  showToast(text: string): void;
  /** Copy a link that rebuilds this exact setup (not how far the run has got). */
  copyShareLink(): Promise<void>;
  setMode(mode: 'sandbox' | 'live'): Promise<void>;
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
  editorOpen: false,
  xrayOpen: false,
  impactOpen: false,
  reportOpen: false,
  orbit: false,
  clean: false,
  present: null,
  sound: false,
  quality: (() => {
    try {
      return window.localStorage.getItem('binsight.quality') === 'low' ? 'low' : 'high';
    } catch {
      return 'high';
    }
  })(),
  heatmap: 'off',
  replay: null,
  toast: null,
  mode: 'sandbox',
  liveStatus: 'off',
  liveError: null,
  liveControl: null,
  operator: false,
  sandboxConfig: initial.config,

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
    if (get().mode === 'live') return get().showToast('In Live mode, reset the city from the Cloud panel (operators only).');
    get().rebuildCity({ seed: seed ?? randomSeed() });
  },
  rebuildCity: (patch) => {
    if (get().mode === 'live') return get().showToast('In Live mode, reset the city from the Cloud panel (operators only).');
    const prev = get().sim.config;
    const config = { ...prev, ...patch, events: [], policyChanges: [], shifts: (patch.shifts ?? prev.shifts).map((x) => ({ ...x })) };
    const url = new URL(window.location.href);
    url.searchParams.set('seed', config.seed);
    window.history.replaceState(null, '', url);
    set((s) => ({
      sim: new Simulation(config),
      simKey: s.simKey + 1,
      selectedBin: null,
      selectedTruck: null,
      followTruck: null,
      hoveredBin: null,
      replay: null,
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
    if (get().mode === 'live') return get().showToast('The cloud runs the clock in Live mode.');
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
  startReplay: () => {
    const { sim, mode, showToast } = get();
    if (mode === 'live') return showToast('Replay works on the Sandbox city.');
    if (sim.tape.length < 8) return showToast('Run the city for a few hours first: there is nothing to replay yet.');
    set({ replay: { index: Math.max(0, sim.tape.length - 96), playing: true }, paused: true, followTruck: null });
  },
  setReplay: (replay) => set({ replay }),
  exitReplay: () => set({ replay: null, paused: false }),
  cycleHeatmap: () => set((s) => ({ heatmap: HEAT_MODES[(HEAT_MODES.indexOf(s.heatmap) + 1) % HEAT_MODES.length] })),
  setQuality: (quality, auto = false) => {
    // Only a deliberate choice is remembered; an automatic downgrade lasts for this visit.
    if (!auto) {
      try {
        window.localStorage.setItem('binsight.quality', quality);
      } catch {
        // not remembered; fine
      }
    }
    set({ quality });
    if (auto) get().showToast('Switched to performance mode for a smoother frame rate (gauge button to undo).');
  },
  toggleSound: () => {
    const on = !get().sound;
    if (on) void import('../lib/sound.ts').then((m) => m.enableAudio());
    set({ sound: on });
  },
  closeOverlays: () => set({ compareOpen: false, labOpen: false, guideOpen: false, editorOpen: false, xrayOpen: false, impactOpen: false }),
  setReportOpen: (open) => set({ reportOpen: open, compareOpen: false, labOpen: false, guideOpen: false, editorOpen: false, xrayOpen: false, impactOpen: false }),
  setImpactOpen: (open) => set({ impactOpen: open, compareOpen: false, labOpen: false, guideOpen: false, editorOpen: false, xrayOpen: false }),
  setXrayOpen: (open) => set({ xrayOpen: open, compareOpen: false, labOpen: false, guideOpen: false, editorOpen: false }),
  setEditorOpen: (open) => set({ editorOpen: open, compareOpen: false, labOpen: false, guideOpen: false }),
  showToast: (text) => {
    clearTimeout(toastTimer);
    set({ toast: text });
    toastTimer = setTimeout(() => set({ toast: null }), 2600);
  },
  setMode: async (mode) => {
    const s = get();
    if (mode === s.mode && mode === 'sandbox') return;
    const session = await import('../live/session.ts');
    if (mode === 'live') {
      set({ sandboxConfig: { ...s.sim.config, shifts: s.sim.config.shifts.map((x) => ({ ...x })) } });
      await session.startLive().catch(() => undefined);
      return;
    }
    session.stopLive();
    set((st) => ({
      mode: 'sandbox',
      sim: new Simulation(st.sandboxConfig),
      simKey: st.simKey + 1,
      selectedBin: null,
      selectedTruck: null,
      followTruck: null,
      hoveredBin: null,
    }));
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
