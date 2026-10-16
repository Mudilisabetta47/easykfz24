// Schnittstelle für EasyKFZ24 OS. Jede Anfrage: Sitzung prüfen → Route finden → Berechtigung prüfen →
// bei Änderungen zusätzlich Same-Origin und JSON (bzw. multipart beim Upload) → Fachmodul → Protokoll.
// Hintergrundabfragen (Header x-os-background: 1) verlängern die Sitzung nicht – sonst griffe die Inaktivitäts-Sperre nie.

import { NextResponse } from 'next/server';
import { audit, LOGIN_FAILURE_LIMITS, recentLoginFailures } from '../../../../../server/audit.ts';
import { currentSession, startSession, touchSession } from '../../../../../server/auth.ts';
import { clientIp, limits } from '../../../../../server/limits.ts';
import { authenticate } from '../../../../../server/users.ts';
import { checkCode, twoFactorRequired } from '../../../../../server/os/twofactor.ts';
import { can, type Permission } from '../../../../../lib/permissions.ts';
import { checkPerm, HttpError, matchRoute, str, type Ctx, type Json, type Route } from '../../../../../server/os/http.ts';
import { orderRoutes } from '../../../../../server/os/routes/orders.ts';
import { customerRoutes } from '../../../../../server/os/routes/customers.ts';
import { documentRoutes } from '../../../../../server/os/routes/documents.ts';
import { kennzeichenRoutes } from '../../../../../server/os/routes/kennzeichen.ts';
import { kfzRoutes } from '../../../../../server/os/routes/kfz.ts';
import { financeRoutes } from '../../../../../server/os/routes/finance.ts';
import { teamRoutes } from '../../../../../server/os/routes/team.ts';
import { sessionPayload, systemRoutes } from '../../../../../server/os/routes/system.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type Params = { params: Promise<{ path: string[] }> };

const ROUTES: Route[] = [...systemRoutes, ...orderRoutes, ...customerRoutes, ...documentRoutes, ...kfzRoutes, ...kennzeichenRoutes, ...financeRoutes, ...teamRoutes];

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Änderungen nur von der eigenen Seite (Schutz gegen Cross-Site-Anfragen zusätzlich zu SameSite=Strict). */
function assertSameOrigin(req: Request, allowMultipart = false): void {
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') throw new HttpError(403, 'Anfrage nicht von dieser Seite');
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
    if (!host || new URL(origin).host !== host) throw new HttpError(403, 'Anfrage nicht von dieser Seite');
  }
  const type = req.headers.get('content-type') ?? '';
  if (!(type.includes('application/json') || (allowMultipart && type.includes('multipart/form-data')))) throw new HttpError(415, 'JSON erwartet');
}

async function run(req: Request, { params }: Params, method: 'GET' | 'POST'): Promise<Response> {
  const { path } = await params;
  try {
    // Entsperren = erneute Anmeldung (ohne bestehende Sitzung)
    if (method === 'POST' && path.length === 1 && path[0] === 'unlock') {
      assertSameOrigin(req);
      const ip = await clientIp();
      const l = limits();
      if (!l.loginPerIp.check(ip).allowed || !l.loginGlobal.check('alle').allowed) throw new HttpError(429, 'Zu viele Fehlversuche – bitte später erneut versuchen');
      const persisted = await recentLoginFailures(ip);
      if (persisted.ip >= LOGIN_FAILURE_LIMITS.perIp || persisted.all >= LOGIN_FAILURE_LIMITS.global) throw new HttpError(429, 'Zu viele Fehlversuche – bitte in 15 Minuten erneut versuchen');
      const body = (await req.json()) as Json;
      const result = await authenticate(str(body.username, 40), str(body.password, 200));
      if (!result) {
        l.loginPerIp.hit(ip);
        l.loginGlobal.hit('alle');
        await audit({ id: null, username: str(body.username, 40) || 'inhaber' }, 'entsperren.fehlgeschlagen');
        await new Promise((r) => setTimeout(r, 400));
        throw new HttpError(401, 'Benutzername oder Passwort ist nicht korrekt');
      }
      if (await twoFactorRequired(result.user.id)) {
        const code = str(body.code, 8);
        if (!code) return json({ error: 'Code aus der Authenticator-App eingeben', needCode: true }, 401);
        if (!(await checkCode(result.user.id, code))) {
          l.loginPerIp.hit(ip);
          await audit({ id: result.user.id, username: result.user.username }, 'entsperren.2fa_fehlgeschlagen');
          throw new HttpError(401, 'Der Code ist nicht korrekt');
        }
      }
      l.loginPerIp.reset(ip);
      const sid = await startSession(result.user, result.pwv);
      await audit({ id: result.user.id, username: result.user.username }, 'sitzung.entsperrt');
      const now = Math.floor(Date.now() / 1000);
      return json(await sessionPayload({ s: { user: result.user, pwv: result.pwv, iat: now, exp: now, sid } }));
    }

    const session = await currentSession();
    if (!session) return json({ error: 'Sitzung abgelaufen – bitte entsperren', locked: true }, 401);

    const found = matchRoute(ROUTES, method, path);
    if (!found) throw new HttpError(404, 'Unbekannte Schnittstelle');
    const { route, params: routeParams } = found;
    checkPerm(session, route.perm);

    let body: Json = {};
    if (method === 'POST') {
      assertSameOrigin(req, !!route.raw);
      if (!route.raw) body = ((await req.json().catch(() => ({}))) ?? {}) as Json;
    }
    const ctx: Ctx = {
      s: session,
      actor: { id: session.user.id, name: session.user.displayName },
      audit: { id: session.user.id, username: session.user.username },
      params: routeParams,
      url: new URL(req.url),
      body,
      req,
      can: (p: Permission) => can(session.user.role, p),
      need: (p: Permission) => checkPerm(session, p),
      sessionReplaced: false,
    };
    const result = await route.handler(ctx);
    // Nicht verlängern, wenn der Handler die Sitzung ersetzt hat (sonst überschriebe das alte Cookie das neue)
    if (req.headers.get('x-os-background') !== '1' && path[0] !== 'lock' && !ctx.sessionReplaced) await touchSession(session);
    if (result instanceof Response) return result;
    return json(result);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error('[os] Fehler:', (e as Error).stack ?? (e as Error).message);
    return json({ error: 'Interner Fehler – bitte erneut versuchen' }, 500);
  }
}

export const GET = (req: Request, ctx: Params) => run(req, ctx, 'GET');
export const POST = (req: Request, ctx: Params) => run(req, ctx, 'POST');
