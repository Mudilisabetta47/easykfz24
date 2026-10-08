// Admin-Anmeldung: Passwort aus ADMIN_PASSWORD, Sitzung als HMAC-signiertes HttpOnly-Cookie.

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { checkAdminConfig, createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from '../lib/session.ts';

export const SESSION_COOKIE = 'ek_admin';

export function adminConfig(): { ok: true; password: string; secret: string } | { ok: false; problem: string } {
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  const problem = checkAdminConfig(password, secret);
  if (problem) return { ok: false, problem };
  return { ok: true, password: password as string, secret: secret as string };
}

export async function isAdmin(): Promise<boolean> {
  const cfg = adminConfig();
  if (!cfg.ok) return false;
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, cfg.secret, cfg.password);
}

/** In jeder Admin-Seite und jeder Admin-Aktion aufrufen – das Layout allein schützt nicht. */
export async function requireAdmin(): Promise<void> {
  if (!(await isAdmin())) redirect('/admin/login');
}

export async function startSession(): Promise<void> {
  const cfg = adminConfig();
  if (!cfg.ok) throw new Error(cfg.problem);
  (await cookies()).set(SESSION_COOKIE, createSessionToken(cfg.secret, cfg.password), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}
