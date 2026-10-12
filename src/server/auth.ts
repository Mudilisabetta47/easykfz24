// Verwaltungs-Anmeldung: Benutzer (Inhaber über ADMIN_PASSWORD, weitere in D1) mit Rollen.
// Sitzung als HMAC-signiertes HttpOnly-Cookie (v2), Ablauf nach Inaktivität (Einstellung „Sperren nach“),
// absolute Höchstdauer 12 Stunden. Rolle und Status werden bei jeder Anfrage frisch geladen.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { can, type Permission } from '../lib/permissions.ts';
import { checkAdminConfig, createUserSession, newSessionId, verifyUserSession } from '../lib/session.ts';
import { headers } from 'next/headers';
import { getDb } from './db.ts';
import { ipFrom } from './limits.ts';
import { getSettings } from './settings.ts';
import { loadUser, type AdminUser } from './users.ts';

export type { AdminUser } from './users.ts';

export const SESSION_COOKIE = 'ek_admin';

export function adminConfig(): { ok: true; password: string; secret: string } | { ok: false; problem: string } {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  const problem = checkAdminConfig(password, secret);
  if (problem) return { ok: false, problem };
  return { ok: true, password: password as string, secret: secret as string };
}

export interface Session {
  user: AdminUser;
  pwv: string;
  iat: number;
  exp: number;
  sid: string;
}

/** Aktuelle Sitzung oder null (abgelaufen, manipuliert, Benutzer deaktiviert oder Passwort geändert). */
export async function currentSession(): Promise<Session | null> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) return null;
  const claims = verifyUserSession((await cookies()).get(SESSION_COOKIE)?.value, secret);
  if (!claims) return null;
  const loaded = await loadUser(claims.uid);
  if (!loaded || loaded.pwv !== claims.pwv) return null;
  // Sitzungsregister: nur registrierte, nicht widerrufene Sitzungen gelten (einzeln abmeldbar)
  const reg = await (await getDb()).first<{ revoked_at: string; user_id: number }>('SELECT revoked_at, user_id FROM sessions WHERE id = ?', claims.sid);
  if (!reg || reg.revoked_at || reg.user_id !== claims.uid) return null;
  return { user: loaded.user, pwv: loaded.pwv, iat: claims.iat, exp: claims.exp, sid: claims.sid };
}

export async function isAdmin(): Promise<boolean> {
  return (await currentSession()) !== null;
}

/** Für Seiten und Server-Aktionen: ohne Sitzung zur Anmeldung. Gibt den Benutzer zurück. */
export async function requireAdmin(): Promise<AdminUser> {
  const s = await currentSession();
  if (!s) redirect('/admin/login');
  return s.user;
}

/** Wie requireAdmin, zusätzlich mit Berechtigung – ohne Recht zurück zum Desktop. */
export async function requirePermission(permission: Permission): Promise<AdminUser> {
  const user = await requireAdmin();
  if (!can(user.role, permission)) redirect('/admin');
  return user;
}

async function writeCookie(token: string, maxAge: number): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge,
  });
}

export async function startSession(user: AdminUser, pwv: string): Promise<string> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET fehlt oder ist zu kurz');
  const idle = (await getSettings()).lockMinutes * 60;
  const sid = newSessionId();
  let ip = '';
  let ua = '';
  try {
    const h = await headers();
    ip = ipFrom(h);
    ua = (h.get('user-agent') ?? '').slice(0, 300);
  } catch {
    /* außerhalb einer Anfrage */
  }
  const now = new Date().toISOString();
  const db = await getDb();
  // Alte, längst abgelaufene Einträge aufräumen (Register bleibt klein)
  await db.run("DELETE FROM sessions WHERE last_seen_at < ?", new Date(Date.now() - 30 * 86_400_000).toISOString());
  await db.run('INSERT INTO sessions (id, user_id, created_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', sid, user.id, now, now, ip, ua);
  await writeCookie(createUserSession({ uid: user.id, pwv, sid }, secret, idle), idle);
  return sid;
}

/** Verlängert die Sitzung bei Aktivität (gleicher Anmeldezeitpunkt, neuer Ablauf). Nur in Route-Handlern/Aktionen. */
export async function touchSession(s: Session): Promise<void> {
  const secret = process.env.SESSION_SECRET as string;
  const idle = (await getSettings()).lockMinutes * 60;
  await writeCookie(createUserSession({ uid: s.user.id, pwv: s.pwv, iat: s.iat, sid: s.sid }, secret, idle), idle);
  // „Zuletzt aktiv“ höchstens einmal pro Minute schreiben
  await (await getDb()).run('UPDATE sessions SET last_seen_at = ? WHERE id = ? AND last_seen_at < ?', new Date().toISOString(), s.sid, new Date(Date.now() - 60_000).toISOString());
}

export async function endSession(): Promise<void> {
  const secret = process.env.SESSION_SECRET;
  const jar = await cookies();
  const claims = secret ? verifyUserSession(jar.get(SESSION_COOKIE)?.value, secret) : null;
  if (claims) await (await getDb()).run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at = ''", new Date().toISOString(), claims.sid).catch(() => undefined);
  jar.delete(SESSION_COOKIE);
}

/** Sitzungen widerrufen: einzelne, alle außer der aktuellen, oder alle eines Benutzers. */
export async function revokeSessions(userId: number, opts: { sid?: string; exceptSid?: string } = {}): Promise<number> {
  const db = await getDb();
  const now = new Date().toISOString();
  if (opts.sid) return (await db.run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at = ''", now, opts.sid, userId)).changes;
  if (opts.exceptSid) return (await db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at = ''", now, userId, opts.exceptSid)).changes;
  return (await db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at = ''", now, userId)).changes;
}
