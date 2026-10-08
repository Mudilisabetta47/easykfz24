// Signierte Admin-Sitzung: "v1.<ablauf>.<nonce>.<hmac>" mit HMAC-SHA256.
// Der Schlüssel enthält einen Fingerabdruck des Admin-Passworts – ein Passwortwechsel beendet alle Sitzungen.

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const SESSION_TTL_SECONDS = 8 * 60 * 60;

function signingKey(secret: string, password: string): Buffer {
  const fingerprint = createHash('sha256').update(password).digest('hex');
  return createHash('sha256').update(`${secret}\u0000${fingerprint}`).digest();
}

function sign(payload: string, secret: string, password: string): string {
  return createHmac('sha256', signingKey(secret, password)).update(payload).digest('base64url');
}

export function createSessionToken(
  secret: string,
  password: string,
  nowMs: number = Date.now(),
  ttlSeconds: number = SESSION_TTL_SECONDS,
): string {
  const expires = Math.floor(nowMs / 1000) + ttlSeconds;
  const payload = `v1.${expires}.${randomBytes(12).toString('base64url')}`;
  return `${payload}.${sign(payload, secret, password)}`;
}

export function verifySessionToken(token: string | undefined, secret: string, password: string, nowMs: number = Date.now()): boolean {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') return false;
  const payload = parts.slice(0, 3).join('.');
  const expected = Buffer.from(sign(payload, secret, password));
  const given = Buffer.from(parts[3]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
  const expires = Number(parts[1]);
  return Number.isFinite(expires) && expires * 1000 > nowMs;
}

/** Vergleich in konstanter Zeit (über SHA-256, damit auch unterschiedliche Längen nichts verraten). */
export function passwordMatches(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function checkAdminConfig(password: string | undefined, secret: string | undefined): string | null {
  if (!password || password.length < 12) return 'ADMIN_PASSWORD fehlt oder ist kürzer als 12 Zeichen.';
  if (!secret || secret.length < 32) return 'SESSION_SECRET fehlt oder ist kürzer als 32 Zeichen.';
  return null;
}
