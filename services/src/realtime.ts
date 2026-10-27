import { channelName } from '@binsight/core';
import type * as AblyTypes from 'ably';
import { EventEmitter } from 'node:events';
import { env } from './shared.ts';

/**
 * Pushing to browsers and phones, in place of IoT Core's MQTT broker.
 *
 * - "ably": Ably pub/sub. The server publishes over REST with ABLY_API_KEY; clients
 *   subscribe with short-lived tokens from /api/realtime-token (subscribe-only).
 * - "local": an in-process bus streamed as Server-Sent Events by the dev server, so
 *   the whole live flow runs on a laptop without an Ably account.
 * - "off": nothing configured; publishes are dropped and Live mode says why.
 */
export type RealtimeMode = 'ably' | 'local' | 'off';

export interface Publisher {
  mode: RealtimeMode;
  publish(topic: string, data: unknown): Promise<void>;
}

export const localBus = new EventEmitter().setMaxListeners(0);

let ablyRest: AblyTypes.Rest | undefined;
async function rest() {
  if (!ablyRest) {
    const { default: Ably } = await import('ably');
    ablyRest = new Ably.Rest({ key: env.ablyKey });
  }
  return ablyRest;
}

let override: Publisher | undefined;
/** Tests capture what would have gone out. */
export function setPublisher(p: Publisher | undefined) {
  override = p;
}

export function realtimeMode(): RealtimeMode {
  if (override) return override.mode;
  if (env.ablyKey) return 'ably';
  if (process.env.BINSIGHT_LOCAL_REALTIME === '1') return 'local';
  return 'off';
}

export function publisher(): Publisher {
  if (override) return override;
  const mode = realtimeMode();
  return {
    mode,
    async publish(topic, data) {
      if (mode === 'ably') await (await rest()).channels.get(channelName(topic)).publish('m', data);
      else if (mode === 'local') localBus.emit('message', topic, data);
    },
  };
}

export const publish = (topic: string, data: unknown) => publisher().publish(topic, data);

/** A token request for one browser or phone: subscribe to BinSight's channels, nothing else. */
export async function tokenRequest() {
  if (realtimeMode() !== 'ably') throw new Error('Ably is not configured (set ABLY_API_KEY)');
  return (await rest()).auth.createTokenRequest({
    capability: { 'binsight:*': ['subscribe'] },
    ttl: 60 * 60_000,
  });
}
