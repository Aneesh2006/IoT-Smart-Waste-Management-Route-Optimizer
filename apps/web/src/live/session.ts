import { topics, type Alert, type FleetFrame, type LiveControl, type LiveEvent, type RoutesFrame, type StateUpdate } from '@binsight/core';
import { useApp } from '../state/store.ts';
import { api, clockOffset, connectMqtt, loadLiveConfig, operatorSignIn, type LiveConfig, type LiveMqtt } from './aws.ts';
import { LiveWorld } from './LiveWorld.ts';

/**
 * Live mode's lifecycle: fetch the cloud's state, build a LiveWorld, subscribe to
 * the city's topics and route every message into it.
 */
let mqtt: LiveMqtt | null = null;
let cfg: LiveConfig | null = null;
let offset = 0;
let rebuilding = false;
const decoder = new TextDecoder();

const TOKEN_KEY = 'binsight.operator';

export function operatorToken(): string | null {
  try {
    const raw = window.sessionStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const { token, expires } = JSON.parse(raw) as { token: string; expires: number };
    return expires > Date.now() + 30_000 ? token : null;
  } catch {
    return null;
  }
}

export async function signIn(username: string, password: string) {
  if (!cfg) throw new Error('Not connected');
  const session = await operatorSignIn(cfg, username, password);
  try {
    window.sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  } catch {
    // Without storage the token simply lasts for this page.
  }
  memoryToken = session;
  useApp.setState({ operator: true });
}

let memoryToken: { token: string; expires: number } | null = null;

export function signOut() {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // nothing stored
  }
  memoryToken = null;
  useApp.setState({ operator: false });
}

const token = () => operatorToken() ?? (memoryToken && memoryToken.expires > Date.now() ? memoryToken.token : null);

export async function control(body: Record<string, unknown>) {
  const t = token();
  if (!cfg) return;
  if (!t) {
    useApp.getState().showToast('Sign in as an operator to change the live city.');
    return;
  }
  try {
    const c = await api<LiveControl>(cfg, '/control', { body, token: t });
    const world = useApp.getState().sim;
    if (world instanceof LiveWorld) world.control = c;
    useApp.setState({ liveControl: c });
    if (c.epoch !== (world instanceof LiveWorld ? Number(world.world.split(':').pop()) : -1)) void rebuild();
  } catch (e) {
    useApp.getState().showToast((e as Error).message);
  }
}

export async function startLive() {
  const set = useApp.setState;
  set({ liveStatus: 'connecting', liveError: null });
  try {
    cfg = await loadLiveConfig();
    if (!cfg) throw new Error('No cloud deployment found (live-config.json is missing). Deploy the AWS stack first.');
    offset = await clockOffset(cfg);
    await rebuild();
    mqtt = await connectMqtt(cfg, {
      onStatus: (s, detail) => set({ liveStatus: s === 'connected' ? 'live' : s === 'error' ? 'error' : 'connecting', liveError: detail ?? null }),
    });
    const city = cfg.city;
    mqtt.client.on('message', (topic, payload) => route(city, topic, payload));
    mqtt.client.subscribe([topics.state(city), topics.fleet(city), topics.routes(city), topics.events(city), topics.alerts(city)], { qos: 0 });
    set({ liveStatus: 'live', operator: Boolean(token()) });
  } catch (e) {
    stopLive();
    set({ liveStatus: 'error', liveError: (e as Error).message });
    useApp.getState().showToast((e as Error).message);
    throw e;
  }
}

/** (Re)build the world from GET /state, e.g. after an operator reset. */
async function rebuild() {
  if (!cfg || rebuilding) return;
  rebuilding = true;
  try {
    const { control: c, bins } = await api<{ control: LiveControl; bins: Record<string, unknown>[] }>(cfg, '/state');
    const world = new LiveWorld(c, { control, notify: (t) => useApp.getState().showToast(t) }, offset);
    world.applySnapshot(bins);
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

function route(city: string, topic: string, payload: Uint8Array) {
  const world = useApp.getState().sim;
  if (!(world instanceof LiveWorld)) return;
  let msg: unknown;
  try {
    msg = JSON.parse(decoder.decode(payload));
  } catch {
    return;
  }
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
  mqtt?.close();
  mqtt = null;
  useApp.setState({ liveStatus: 'off', liveError: null });
}

export function liveConfig() {
  return cfg;
}
