import { channelName } from '@binsight/core';

/**
 * Talking to the cloud from the browser: the HTTP API on this origin (Vercel
 * functions), operator sign-in, phone identities, and realtime messages over
 * Ably (or the dev server's local bus).
 */
export interface LiveConfig {
  city: string;
  /** How the cloud pushes messages: Ably, the dev server's local bus, or not configured. */
  realtime: 'ably' | 'local' | 'off';
}

let configPromise: Promise<LiveConfig | { error: string }> | undefined;

/** What this deployment offers; an error says what's missing (no database, no API at all). */
export function loadLiveConfig(): Promise<LiveConfig | { error: string }> {
  configPromise ??= fetch('/api/live-config', { cache: 'no-store' })
    .then(async (r) => {
      const data = (await r.json().catch(() => null)) as (LiveConfig & { error?: string }) | null;
      if (!data) return { error: 'This BinSight has no cloud API (run `pnpm dev:live`, or deploy to Vercel).' };
      if (!r.ok || data.error) return { error: data.error ?? `The cloud API answered ${r.status}` };
      if (data.realtime === 'off') return { error: 'The cloud has no realtime channel yet: set ABLY_API_KEY on the deployment.' };
      return data;
    })
    .catch(() => ({ error: 'This BinSight has no cloud API (run `pnpm dev:live`, or deploy to Vercel).' }));
  return configPromise;
}

export const isConfig = (c: LiveConfig | { error: string } | null | undefined): c is LiveConfig => Boolean(c && 'city' in c);

export async function api<T>(path: string, init?: { body?: unknown; headers?: Record<string, string>; method?: string }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}), ...init?.headers },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: 'no-store',
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && path === '/control') throw new Error('Not signed in as an operator (or the session expired).');
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `API ${path} failed (${res.status})`, res.status);
  return data as T;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** Server clock minus ours, from a round trip to GET /api/time (NTP-style). */
export async function clockOffset(): Promise<number> {
  const t0 = Date.now();
  const { now } = await api<{ now: number }>('/time');
  const t1 = Date.now();
  return now - (t0 + t1) / 2;
}

/** Operator sign-in: the API sets an HttpOnly session cookie, so nothing secret lives in this page. */
export async function operatorSignIn(password: string) {
  await api('/login', { body: { password } });
}

export async function operatorSignOut() {
  await api('/logout', { body: {} }).catch(() => undefined);
}

export async function operatorSession() {
  return (await api<{ operator: boolean }>('/session').catch(() => ({ operator: false }))).operator;
}

/**
 * Ask the cloud to advance the virtual fleet. The fleet ticks lazily on requests,
 * so every open dashboard calls this about once a second; the server's lease
 * makes the city move once however many ask. Paused while the tab is hidden.
 */
export function keepFleetTicking(everyMs = 1000) {
  const id = window.setInterval(() => {
    if (document.visibilityState === 'visible') void fetch('/api/tick', { method: 'POST', cache: 'no-store' }).catch(() => undefined);
  }, everyMs);
  return () => window.clearInterval(id);
}

export type RealtimeStatus = 'connected' | 'reconnecting' | 'offline' | 'error';

export interface Realtime {
  close(): void;
}

/**
 * Subscribe to topics. Ably authenticates with short-lived subscribe-only tokens
 * from /api/realtime-token (the API key never reaches the browser) and reconnects
 * by itself; the local bus is a Server-Sent Events stream from the dev server.
 */
export async function connectRealtime(
  cfg: LiveConfig,
  subs: string[],
  onMessage: (topic: string, data: unknown) => void,
  opts: { onStatus?: (s: RealtimeStatus, detail?: string) => void } = {},
): Promise<Realtime> {
  if (cfg.realtime === 'local') return connectLocal(subs, onMessage, opts);

  const { Realtime } = await import('ably');
  const client = new Realtime({ authUrl: '/api/realtime-token', autoConnect: true, echoMessages: false, closeOnUnload: true });
  client.connection.on((change) => {
    const s = change.current;
    if (s === 'connected') opts.onStatus?.('connected');
    else if (s === 'connecting' || s === 'disconnected') opts.onStatus?.('reconnecting', change.reason?.message);
    else if (s === 'suspended' || s === 'closed') opts.onStatus?.('offline', change.reason?.message);
    else if (s === 'failed') opts.onStatus?.('error', change.reason?.message);
  });
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Timed out connecting to Ably')), 20_000);
    client.connection.once('connected', () => {
      window.clearTimeout(t);
      resolve();
    });
    client.connection.once('failed', (change) => {
      window.clearTimeout(t);
      reject(new Error(change.reason?.message ?? 'Could not connect to Ably'));
    });
  });
  for (const topic of subs) {
    void client.channels.get(channelName(topic)).subscribe((m) => onMessage(topic, m.data));
  }
  return { close: () => client.close() };
}

function connectLocal(subs: string[], onMessage: (topic: string, data: unknown) => void, opts: { onStatus?: (s: RealtimeStatus, detail?: string) => void }): Promise<Realtime> {
  const source = new EventSource(`/api/realtime-local?topics=${encodeURIComponent(subs.join(','))}`);
  source.onmessage = (e) => {
    try {
      const { topic, data } = JSON.parse(e.data as string) as { topic: string; data: unknown };
      onMessage(topic, data);
    } catch {
      // ignore malformed frames
    }
  };
  // EventSource reconnects by itself.
  source.onerror = () => opts.onStatus?.(source.readyState === EventSource.CLOSED ? 'offline' : 'reconnecting');
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Timed out connecting to the local realtime bus')), 10_000);
    source.onopen = () => {
      window.clearTimeout(t);
      opts.onStatus?.('connected');
      resolve({ close: () => source.close() });
    };
  });
}

const store = {
  get(k: string) {
    try {
      return window.localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string | null) {
    try {
      if (v === null) window.localStorage.removeItem(k);
      else window.localStorage.setItem(k, v);
    } catch {
      // Storage blocked: we just get a new phone id next time.
    }
  },
};

export interface PhoneIdentity {
  id: string;
  token: string;
}

const PHONE_KEY = 'binsight.phone';

/** This phone's signed id, kept across visits so the same bin comes back. */
export async function phoneIdentity(renew = false): Promise<PhoneIdentity> {
  const cached = store.get(PHONE_KEY);
  if (cached && !renew) {
    try {
      return JSON.parse(cached) as PhoneIdentity;
    } catch {
      // fall through to a new one
    }
  }
  const fresh = await api<PhoneIdentity>('/phone', { body: {} });
  store.set(PHONE_KEY, JSON.stringify(fresh));
  return fresh;
}

/** POST one reading. Resolves to whether the cloud stored it now or queued it; throws if it didn't take it. */
export async function sendReading(phone: PhoneIdentity, reading: Record<string, unknown>) {
  return (await api<{ status: 'stored' | 'queued' }>('/ingest', { body: reading, headers: { authorization: `Bearer ${phone.token}` } })).status;
}
