'use server';

import { redirect } from 'next/navigation';
import { formatRetryAfter } from '../../lib/rate-limit.ts';
import { audit, LOGIN_FAILURE_LIMITS, recentLoginFailures } from '../../server/audit.ts';
import { adminConfig, currentSession, endSession, startSession } from '../../server/auth.ts';
import { clientIp, limits } from '../../server/limits.ts';
import { authenticate } from '../../server/users.ts';
import { checkCode, twoFactorRequired } from '../../server/os/twofactor.ts';

export type LoginState = { error?: string; username?: string; needCode?: boolean };

export async function loginAction(_prev: LoginState, form: FormData): Promise<LoginState> {
  const cfg = adminConfig();
  if (!cfg.ok) return { error: `Anmeldung nicht konfiguriert: ${cfg.problem}` };
  const username = String(form.get('username') ?? '').slice(0, 40);
  const ip = await clientIp();
  const l = limits();
  const perIp = l.loginPerIp.check(ip);
  const global = l.loginGlobal.check('alle');
  if (!perIp.allowed || !global.allowed) {
    const wait = Math.max(perIp.retryAfterMs, global.retryAfterMs);
    return { username, error: `Zu viele Fehlversuche. Bitte in ${formatRetryAfter(wait)} erneut versuchen.` };
  }
  // Dauerhafte Sperre über das Protokoll (gilt instanzübergreifend, auch auf Cloudflare)
  const persisted = await recentLoginFailures(ip);
  if (persisted.ip >= LOGIN_FAILURE_LIMITS.perIp || persisted.all >= LOGIN_FAILURE_LIMITS.global) {
    return { username, error: 'Zu viele Fehlversuche. Bitte in 15 Minuten erneut versuchen.' };
  }
  const password = String(form.get('password') ?? '').slice(0, 200);
  const result = await authenticate(username, password);
  if (!result) {
    l.loginPerIp.hit(ip);
    l.loginGlobal.hit('alle');
    await audit({ id: null, username: username.trim().toLowerCase() || 'inhaber' }, 'anmeldung.fehlgeschlagen');
    // Kleine Verzögerung bremst automatisiertes Raten zusätzlich.
    await new Promise((r) => setTimeout(r, 400));
    return { username, error: 'Benutzername oder Passwort ist nicht korrekt.' };
  }
  // Zweiter Faktor: Code aus der Authenticator-App (nur wenn für diesen Benutzer aktiviert)
  if (await twoFactorRequired(result.user.id)) {
    const code = String(form.get('code') ?? '').replace(/\s/g, '').slice(0, 8);
    if (!code) return { username, needCode: true };
    if (!(await checkCode(result.user.id, code))) {
      l.loginPerIp.hit(ip);
      l.loginGlobal.hit('alle');
      await audit({ id: result.user.id, username: result.user.username }, 'anmeldung.2fa_fehlgeschlagen');
      await new Promise((r) => setTimeout(r, 400));
      return { username, needCode: true, error: 'Der Code ist nicht korrekt.' };
    }
  }
  l.loginPerIp.reset(ip);
  await startSession(result.user, result.pwv);
  await audit({ id: result.user.id, username: result.user.username }, 'anmeldung');
  redirect('/admin');
}

export async function logoutAction(): Promise<void> {
  const s = await currentSession();
  if (s) await audit({ id: s.user.id, username: s.user.username }, 'abmeldung');
  await endSession();
  redirect('/admin/login');
}
