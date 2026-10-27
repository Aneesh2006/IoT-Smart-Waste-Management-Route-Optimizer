import { topics, type Alert, type FleetFrame, type LiveControl, type LiveEvent, type RoutesFrame, type StateUpdate } from '@binsight/core';
import { useApp } from '../state/store.ts';
import { api, clockOffset, connectRealtime, isConfig, keepFleetTicking, loadLiveConfig, operatorSession, operatorSignIn, operatorSignOut, type LiveConfig, type Realtime } from './cloud.ts';
import { LiveWorld } from './LiveWorld.ts';

/**
 * Live mode's lifecycle: fetch the cloud's state, build a LiveWorld, subscribe to
 * the city's channels, route every message into it, and keep the lazy fleet ticking.
 */
let realtime: Realtime | null = null;
let stopTicking: (() => void) | null = null;
let cfg: LiveConfig | null = null;
let offset = 0;
let rebuilding = false;

export async function signIn(password: string) {
  if (!cfg) throw new Error('Not connected');
  await operatorSignIn(password);
  useApp.setState({ operator: true });
}

export function signOut() {
  void operatorSignOut();
  useApp.setState({ operator: false });
}

export async function control(body: Record<string, unknown>) {
  if (!cfg) return;
  if (!useApp.getState().operator) {
    useApp.getState().showToast('Sign in as an operator to change the live city.');
    return;
  }
  try {
    const c = await api<LiveControl>('/control', { body });
    const world = useApp.getState().sim;
    if (world instanceof LiveWorld) world.control = c;
    useApp.setState({ liveControl: c });
    if (c.epoch !== (world instanceof LiveWorld ? Number(world.world.split(':').pop()) : -1)) void rebuild();
  } catch (e) {
    const message = (e as Error).message;
    // The session cookie expired: show the sign-in form again.
    if (/operator/.test(message)) useApp.setState({ operator: false });
    useApp.getState().showToast(message);
  }
}

export async function startLive() {
  const set = useApp.setState;
  set({ liveStatus: 'connecting', liveError: null });
  try {
    const loaded = await loadLiveConfig();
    if (!isConfig(loaded)) throw new Error(loaded.error);
    cfg = loaded;
    offset = await clockOffset();
    await rebuild();
    const city = cfg.city;
    realtime = await connectRealtime(cfg, [topics.state(city), topics.fleet(city), topics.routes(city), topics.events(city), topics.alerts(city)], (topic, msg) => route(city, topic, msg), {
      onStatus: (s, detail) => set({ liveStatus: s === 'connected' ? 'live' : s === 'error' ? 'error' : 'connecting', liveError: detail ?? null }),
    });
    stopTicking = keepFleetTicking();
    set({ liveStatus: 'live', operator: await operatorSession() });
  } catch (e) {
    stopLive();
    set({ liveStatus: 'error', liveError: (e as Error).message });
    useApp.getState().showToast((e as Error).message);
    throw e;
  }
}

/** (Re)build the world from GET /api/state, e.g. after an operator reset. */
async function rebuild() {
  if (!cfg || rebuilding) return;
  rebuilding = true;
  try {
    const { control: c, bins, routes } = await api<{ control: LiveControl; bins: Record<string, unknown>[]; routes: RoutesFrame | null }>('/state');
    const world = new LiveWorld(c, { control, notify: (t) => useApp.getState().showToast(t) }, offset);
    world.applySnapshot(bins);
    if (routes) world.applyRoutes(routes);
    useApp.setState((s) => ({
      sim: world,
      simKey: s.simKey + 1,
      mode: 'live',
      liveControl: c,
      selectedBin: null,
      selectedTruck: null,
      followTruck: null,
      hoveredBin: null,
    }));
  } finally {
    rebuilding = false;
  }
}

function route(city: string, topic: string, msg: unknown) {
  const world = useApp.getState().sim;
  if (!(world instanceof LiveWorld) || !msg || typeof msg !== 'object') return;
  if (topic === topics.state(city)) world.applyState(msg as StateUpdate);
  else if (topic === topics.fleet(city)) {
    if (!world.applyFleet(msg as FleetFrame)) void rebuild();
  } else if (topic === topics.routes(city)) world.applyRoutes(msg as RoutesFrame);
  else if (topic === topics.events(city)) world.applyEvents(msg as LiveEvent[]);
  else if (topic === topics.alerts(city)) {
    const a = msg as Alert;
    world.applyAlert(a);
    if (a.kind === 'fire' || a.kind === 'joined') useApp.getState().showToast(a.text);
  }
}

export function stopLive() {
  realtime?.close();
  realtime = null;
  stopTicking?.();
  stopTicking = null;
  useApp.setState({ liveStatus: 'off', liveError: null });
}

export function liveConfig() {
  return cfg;
}
