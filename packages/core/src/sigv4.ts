/**
 * AWS Signature Version 4 presigning for MQTT over WebSockets to AWS IoT Core,
 * using only Web Crypto (works in browsers and Node 20+). The session token is
 * appended after signing, as IoT Core requires.
 */
export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

const enc = new TextEncoder();
const hex = (buf: ArrayBuffer | Uint8Array) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(msg: string) {
  return hex(await crypto.subtle.digest('SHA-256', enc.encode(msg)));
}

async function hmac(key: Uint8Array<ArrayBuffer>, msg: string) {
  const k = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(msg)));
}

/** `20261025T101500Z` style timestamp. */
export const amzDate = (d: Date) => d.toISOString().replace(/[:-]|\.\d{3}/g, '');

export async function presignIotWebsocket(endpoint: string, region: string, creds: AwsCredentials, now = new Date(), expiresIn = 3600): Promise<string> {
  const service = 'iotdevicegateway';
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${region}/${service}/aws4_request`;
  const query = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${creds.accessKeyId}/${scope}`],
    ['X-Amz-Date', stamp],
    ['X-Amz-Expires', String(expiresIn)],
    ['X-Amz-SignedHeaders', 'host'],
  ]
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
  const canonical = ['GET', '/mqtt', query, `host:${endpoint}\n`, 'host', await sha256Hex('')].join('\n');
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonical)].join('\n');
  let key = await hmac(enc.encode(`AWS4${creds.secretAccessKey}`), date);
  key = await hmac(key, region);
  key = await hmac(key, service);
  key = await hmac(key, 'aws4_request');
  const signature = hex(await hmac(key, toSign));
  const token = creds.sessionToken ? `&X-Amz-Security-Token=${encodeURIComponent(creds.sessionToken)}` : '';
  return `wss://${endpoint}/mqtt?${query}&X-Amz-Signature=${signature}${token}`;
}
