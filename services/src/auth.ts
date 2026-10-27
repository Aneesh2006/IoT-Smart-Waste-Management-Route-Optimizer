import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { env } from './shared.ts';

/**
 * Replaces Cognito. Operators sign in with one shared password (OPERATOR_PASSWORD)
 * and get a signed HttpOnly session cookie; phones get a signed id so nobody can
 * report readings as another phone (what the IAM topic restriction did on AWS).
 *
 * Tokens are `base64url(json).base64url(hmac-sha256)`, signed with SESSION_SECRET.
 */
export interface TokenClaims {
  sub: string;
  role: 'operator' | 'phone';
  /** Expiry, epoch ms. */
  exp: number;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const mac = (body: string, secret: string) => createHmac('sha256', secret).update(body).digest();

export function signToken(claims: TokenClaims, secret = env.sessionSecret) {
  const body = b64(JSON.stringify(claims));
  return `${body}.${b64(mac(body, secret))}`;
}

export function verifyToken(token: string | null | undefined, role: TokenClaims['role'], secret = env.sessionSecret, now = Date.now()): TokenClaims | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = mac(body, secret);
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenClaims;
    return claims.role === role && typeof claims.sub === 'string' && claims.exp > now ? claims : null;
  } catch {
    return null;
  }
}

/** Constant-time password check; an unset OPERATOR_PASSWORD never matches. */
export function passwordMatches(given: unknown, expected = env.operatorPassword) {
  if (!expected || typeof given !== 'string') return false;
  const a = mac(given, 'pw');
  const b = mac(expected, 'pw');
  return timingSafeEqual(a, b);
}

export const OPERATOR_COOKIE = 'binsight_operator';
export const OPERATOR_TTL_MS = 8 * 3600_000;
export const PHONE_TTL_MS = 30 * 24 * 3600_000;

export function operatorCookie(token: string, secure: boolean, maxAgeMs = OPERATOR_TTL_MS) {
  return [`${OPERATOR_COOKIE}=${token}`, 'Path=/api', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`, ...(secure ? ['Secure'] : [])].join('; ');
}

export function readCookie(header: string | null, name: string) {
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function newPhone(now = Date.now()) {
  const id = `p-${randomUUID()}`;
  return { id, token: signToken({ sub: id, role: 'phone', exp: now + PHONE_TTL_MS }) };
}
