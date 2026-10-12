// Signierte Admin-Sitzungen mit HMAC-SHA256.
//   v2.<benutzer>.<passwortversion>.<ausgestellt>.<ablauf>.<nonce>.<hmac>
// Ablauf = letzte Aktivität + Leerlaufzeit (wird bei jeder Anfrage verlängert); zusätzlich gilt eine absolute
// Höchstdauer ab Anmeldung. Die Passwortversion beendet alle Sitzungen eines Benutzers nach einem Passwortwechsel.

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

/* ---------- Sitzung v2 (Benutzer) ---------- */

export const SESSION_ABSOLUTE_MAX_SECONDS = 12 * 60 * 60;

export interface SessionClaims {
  uid: number;
  pwv: string;
  iat: number;
  exp: number;
  /** Sitzungskennung (Register in der Datenbank) */
  sid: string;
}

function signV2(payload: string, secret: string): string {
  return createHmac('sha256', createHash('sha256').update(`v2\u0000${secret}`).digest()).update(payload).digest('base64url');
}

export function createUserSession(
  claims: { uid: number; pwv: string; iat?: number; sid?: string },
  secret: string,
  idleSeconds: number,
  nowMs: number = Date.now(),
): string {
  const now = Math.floor(nowMs / 1000);
  const iat = claims.iat ?? now;
  const exp = Math.min(now + idleSeconds, iat + SESSION_ABSOLUTE_MAX_SECONDS);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(claims.pwv)) throw new Error('Ungültige Passwortversion');
  const sid = claims.sid ?? newSessionId();
  if (!/^[A-Za-z0-9_-]{8,32}$/.test(sid)) throw new Error('Ungültige Sitzungskennung');
  const payload = `v2.${claims.uid}.${claims.pwv}.${iat}.${exp}.${sid}`;
  return `${payload}.${signV2(payload, secret)}`;
}

export function verifyUserSession(token: string | undefined, secret: string, nowMs: number = Date.now()): SessionClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 7 || parts[0] !== 'v2') return null;
  const payload = parts.slice(0, 6).join('.');
  const expected = Buffer.from(signV2(payload, secret));
  const given = Buffer.from(parts[6]);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const uid = Number(parts[1]);
  const iat = Number(parts[3]);
  const exp = Number(parts[4]);
  const now = nowMs / 1000;
  if (!Number.isInteger(uid) || uid < 0 || !Number.isFinite(iat) || !Number.isFinite(exp)) return null;
  if (exp <= now || iat + SESSION_ABSOLUTE_MAX_SECONDS <= now || iat > now + 60) return null;
  return { uid, pwv: parts[2], iat, exp, sid: parts[5] };
}

/** Kennung einer Sitzung (steht im Cookie, wird serverseitig registriert und kann widerrufen werden). */
export function newSessionId(): string {
  return randomBytes(12).toString('base64url');
}

/** Kurzer Fingerabdruck eines Geheimnisses – ändert sich das Geheimnis, werden alte Sitzungen ungültig. */
export function fingerprint(value: string): string {
  return createHash('sha256').update(value).digest('base64url').slice(0, 12);
}
