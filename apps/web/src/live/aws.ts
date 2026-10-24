import { presignIotWebsocket, type AwsCredentials } from '@binsight/core';
import mqtt, { type MqttClient } from 'mqtt';

/**
 * Talking to AWS from the browser without the SDK: Cognito guest credentials,
 * operator sign-in, the HTTP API, and a SigV4-signed MQTT connection to IoT Core.
 */
export interface LiveConfig {
  region: string;
  city: string;
  identityPoolId: string;
  guestRoleArn: string;
  iotEndpoint: string;
  apiUrl: string;
  userPoolClientId: string;
}

let configPromise: Promise<LiveConfig | null> | undefined;

/** The deployed stack writes /live-config.json; without it there is no cloud to talk to. */
export function loadLiveConfig(): Promise<LiveConfig | null> {
  configPromise ??= fetch('/live-config.json', { cache: 'no-store' })
    .then((r) => (r.ok ? (r.json() as Promise<LiveConfig>) : null))
    .then((c) => (c && c.iotEndpoint && c.identityPoolId ? c : null))
    .catch(() => null);
  return configPromise;
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
      // Storage blocked: we just get a new guest identity next time.
    }
  },
};

async function awsJson<T>(url: string, target: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': target },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((data as { message?: string }).message ?? `${target} failed (${res.status})`);
    err.name = ((data as { __type?: string }).__type ?? 'AwsError').split('#').pop()!;
    throw err;
  }
  return data as T;
}

export interface GuestCredentials extends AwsCredentials {
  identityId: string;
  expiration: number;
}

/**
 * Cognito guest identity via the basic flow: GetId → GetOpenIdToken → STS
 * AssumeRoleWithWebIdentity. (The enhanced flow's guest session policy leaves
 * out IoT, so it can't be used for MQTT.)
 */
export async function guestCredentials(cfg: LiveConfig): Promise<GuestCredentials> {
  const cognito = `https://cognito-identity.${cfg.region}.amazonaws.com/`;
  const cacheKey = `binsight.identity.${cfg.identityPoolId}`;
  let identityId = store.get(cacheKey);
  let token: string;
  try {
    if (!identityId) throw new Error('no cached identity');
    ({ Token: token } = await awsJson<{ Token: string }>(cognito, 'AWSCognitoIdentityService.GetOpenIdToken', { IdentityId: identityId }));
  } catch {
    ({ IdentityId: identityId } = await awsJson<{ IdentityId: string }>(cognito, 'AWSCognitoIdentityService.GetId', { IdentityPoolId: cfg.identityPoolId }));
    store.set(cacheKey, identityId);
    ({ Token: token } = await awsJson<{ Token: string }>(cognito, 'AWSCognitoIdentityService.GetOpenIdToken', { IdentityId: identityId }));
  }
  const form = new URLSearchParams({
    Action: 'AssumeRoleWithWebIdentity',
    Version: '2011-06-15',
    RoleArn: cfg.guestRoleArn,
    RoleSessionName: 'binsight-guest',
    WebIdentityToken: token,
    DurationSeconds: '3600',
  });
  const res = await fetch(`https://sts.${cfg.region}.amazonaws.com/`, { method: 'POST', body: form });
  const xml = await res.text();
  const pick = (tag: string) => xml.match(new RegExp(`<${tag}>([^<]+)</${tag}>`))?.[1] ?? '';
  if (!res.ok) throw new Error(`STS: ${pick('Message') || res.status}`);
  return {
    identityId: identityId!,
    accessKeyId: pick('AccessKeyId'),
    secretAccessKey: pick('SecretAccessKey'),
    sessionToken: pick('SessionToken'),
    expiration: Date.parse(pick('Expiration')),
  };
}

/** Operator sign-in against the user pool; the ID token authorises POST /control. */
export async function operatorSignIn(cfg: LiveConfig, username: string, password: string): Promise<{ token: string; expires: number }> {
  const res = await awsJson<{ AuthenticationResult?: { IdToken: string; ExpiresIn: number }; ChallengeName?: string }>(
    `https://cognito-idp.${cfg.region}.amazonaws.com/`,
    'AWSCognitoIdentityProviderService.InitiateAuth',
    { AuthFlow: 'USER_PASSWORD_AUTH', ClientId: cfg.userPoolClientId, AuthParameters: { USERNAME: username, PASSWORD: password } },
  );
  if (!res.AuthenticationResult) {
    throw new Error(
      res.ChallengeName === 'NEW_PASSWORD_REQUIRED'
        ? 'This operator still has a temporary password. Set a permanent one with: aws cognito-idp admin-set-user-password … --permanent'
        : `Sign-in needs ${res.ChallengeName ?? 'another step'}`,
    );
  }
  return { token: res.AuthenticationResult.IdToken, expires: Date.now() + res.AuthenticationResult.ExpiresIn * 1000 };
}

export async function api<T>(cfg: LiveConfig, path: string, init?: { body?: unknown; token?: string }): Promise<T> {
  const res = await fetch(`${cfg.apiUrl.replace(/\/$/, '')}${path}`, {
    method: init?.body !== undefined ? 'POST' : 'GET',
    headers: {
      ...(init?.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(init?.token ? { authorization: init.token } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw new Error('Not signed in as an operator (or the session expired).');
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `API ${path} failed (${res.status})`);
  return data as T;
}

/** Server clock minus ours, from a round trip to GET /time (NTP-style). */
export async function clockOffset(cfg: LiveConfig): Promise<number> {
  const t0 = Date.now();
  const { now } = await api<{ now: number }>(cfg, '/time');
  const t1 = Date.now();
  return now - (t0 + t1) / 2;
}

export interface LiveMqtt {
  client: MqttClient;
  identityId: string;
  close(): void;
}

/**
 * MQTT over WSS to IoT Core, re-signed on every (re)connect and refreshing the
 * guest credentials before they expire.
 */
export async function connectMqtt(
  cfg: LiveConfig,
  opts: { onStatus?: (s: 'connected' | 'reconnecting' | 'offline' | 'error', detail?: string) => void } = {},
): Promise<LiveMqtt> {
  let creds = await guestCredentials(cfg);
  let url = await presignIotWebsocket(cfg.iotEndpoint, cfg.region, creds);
  const clientId = `${creds.identityId}-${Math.random().toString(36).slice(2, 10)}`;

  const refresh = async () => {
    if (creds.expiration - Date.now() < 10 * 60_000) creds = await guestCredentials(cfg);
    url = await presignIotWebsocket(cfg.iotEndpoint, cfg.region, creds);
  };
  // A presigned URL is only good for a few minutes; keep a fresh one ready for reconnects.
  const timer = window.setInterval(() => void refresh().catch(() => undefined), 4 * 60_000);

  const client = mqtt.connect(url, {
    clientId,
    protocolVersion: 4,
    clean: true,
    keepalive: 30,
    reconnectPeriod: 2500,
    connectTimeout: 15_000,
    transformWsUrl: () => url,
  });
  client.on('connect', () => opts.onStatus?.('connected'));
  client.on('reconnect', () => opts.onStatus?.('reconnecting'));
  client.on('offline', () => opts.onStatus?.('offline'));
  client.on('error', (e) => opts.onStatus?.('error', e.message));

  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Timed out connecting to AWS IoT Core')), 20_000);
    client.once('connect', () => {
      window.clearTimeout(t);
      resolve();
    });
    client.once('error', (e) => {
      window.clearTimeout(t);
      reject(e);
    });
  });

  return {
    client,
    identityId: creds.identityId,
    close() {
      window.clearInterval(timer);
      client.end(true);
    },
  };
}
