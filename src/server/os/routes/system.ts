// Endpunkte: Sitzung, Suche, Kontrollzentrum, Benachrichtigungen, Papierkorb, Benutzer, Einstellungen,
// Unternehmen, Automatisierung, Systemdiagnose.

import { PERMISSION_LABEL, PERMISSIONS, ROLE_LABEL, ROLE_PERMISSIONS, ROLES } from '../../../lib/permissions.ts';
import { NOTIFY_KINDS, NOTIFY_META } from '../../../lib/os-notify.ts';
import { audit, listAudit, LOGIN_FAILURE_LIMITS, recentLoginFailures } from '../../audit.ts';
import { clientIp } from '../../limits.ts';
import { endSession, revokeSessions, startSession } from '../../auth.ts';
import { storageInfo, getBlob, putBlob, deleteBlobs } from '../../blobs.ts';
import { cloudflareEnv, getDb, schemaVersion, SCHEMA_VERSION } from '../../db.ts';
import { kfzApiConfigured, kfzWebhookConfigured } from '../../kfz-api.ts';
import { mailConfigured } from '../../mailer.ts';
import { listTrash, purgeTrash, restoreNote } from '../../orders.ts';
import { paymentsEnabled } from '../../payments.ts';
import { getSettings, LOCK_MINUTES_RANGE, setSettings } from '../../settings.ts';
import { authenticate, createUser, listUsers, loadUser, updateUser } from '../../users.ts';
import { disableTwoFactor, enableTwoFactor, setupTwoFactor, twoFactorStatus } from '../twofactor.ts';
import { listRules, listRuns, runScheduledRules, saveRule } from '../automation.ts';
import { companyWarnings, getCompany, invoiceReadiness, setCompany } from '../company.ts';
import { dashboardData } from '../dashboard.ts';
import { listDocs } from '../documents.ts';
import { HttpError, int, ok, str, type Ctx, type Route } from '../http.ts';
import { getUserPrefs, listNotifications, markAllRead, markRead, setUserPrefs } from '../notifications.ts';
import { queryOrders } from '../order-query.ts';
import { listCustomers } from '../customers.ts';
import { runAfter } from '../../db.ts';
import { getPlateOffer } from '../../plates.ts';
import { getExpressOffer } from '../../express.ts';

export async function sessionPayload(c: Pick<Ctx, 's'>) {
  const settings = await getSettings();
  const prefs = await getUserPrefs(c.s.user.id);
  return {
    user: { ...c.s.user, roleLabel: ROLE_LABEL[c.s.user.role] },
    permissions: [...ROLE_PERMISSIONS[c.s.user.role]],
    lockMinutes: settings.lockMinutes,
    prefs,
  };
}

export const systemRoutes: Route[] = [
  { method: 'GET', path: 'session', handler: async (c) => sessionPayload(c) },
  {
    method: 'POST',
    path: 'lock',
    handler: async (c) => {
      await audit(c.audit, 'sitzung.gesperrt');
      await endSession();
      return { ok: true };
    },
  },
  { method: 'GET', path: 'prefs', handler: async (c) => getUserPrefs(c.actor.id) },
  {
    method: 'POST',
    path: 'prefs',
    handler: async (c) => {
      const b = c.body as { notify?: { toast?: Record<string, boolean>; email?: Record<string, boolean>; browser?: boolean }; desktop?: Record<string, unknown> };
      const clean = (o: unknown) =>
        Object.fromEntries(Object.entries((o ?? {}) as Record<string, unknown>).filter(([k, v]) => (NOTIFY_KINDS as readonly string[]).includes(k) && typeof v === 'boolean')) as Record<string, boolean>;
      if (JSON.stringify(b).length > 60_000) throw new HttpError(413, 'Einstellungen zu groß');
      await setUserPrefs(c.actor.id, {
        notify: b.notify ? { toast: clean(b.notify.toast), email: clean(b.notify.email), browser: b.notify.browser === true } : undefined,
        desktop: b.desktop && typeof b.desktop === 'object' ? b.desktop : undefined,
      });
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: 'staff',
    perm: 'orders.read',
    handler: async () => {
      const users = await listUsers();
      return [{ id: 0, name: 'Inhaber', role: 'inhaber', active: true }, ...users.map((u) => ({ id: u.id, name: u.display_name, role: u.role, active: !!u.active }))];
    },
  },
  {
    method: 'GET',
    path: 'search',
    perm: 'orders.read',
    handler: async (c) => {
      const q = str(c.url.searchParams.get('q'), 100).trim();
      if (q.length < 2) return { orders: [], customers: [], documents: [] };
      const [orders, customers, documents] = await Promise.all([
        queryOrders({ q, limit: 8 }, c.actor.id),
        c.can('customers.read') ? listCustomers({ q, limit: 5 }) : [],
        c.can('docs.read') ? listDocs({ q, limit: 5 }) : [],
      ]);
      return {
        orders: orders.map((o) => ({ id: o.id, number: o.number, holder_name: o.holder_name, status: o.status, assigned_plate: o.assigned_plate, stage: o.stage })),
        customers: customers.map((x) => ({ id: x.id, number: x.number, name: x.name, email: x.email, orders: x.orders })),
        documents: documents.map((d) => ({ id: d.id, label: d.label, order_id: d.order_id, number: d.number })),
      };
    },
  },
  {
    method: 'GET',
    path: 'dashboard',
    perm: 'orders.read',
    handler: async (c) => dashboardData(c.actor.id, Number(c.url.searchParams.get('range')) || 30),
  },

  /* ---------- Benachrichtigungen ---------- */
  {
    method: 'GET',
    path: 'notifications',
    handler: async (c) => {
      // Zeitgesteuerte Regeln (Wiedervorlage, Fristen, Erinnerungen) mitlaufen lassen – höchstens alle 5 Minuten
      runAfter(runScheduledRules().catch(() => undefined));
      const perms = ROLE_PERMISSIONS[c.s.user.role];
      const r = await listNotifications(c.actor.id, perms, { limit: Number(c.url.searchParams.get('limit')) || 100, unreadOnly: c.url.searchParams.get('unread') === '1' });
      return { ...r, kinds: Object.fromEntries(NOTIFY_KINDS.map((k) => [k, NOTIFY_META[k]])) };
    },
  },
  {
    method: 'POST',
    path: 'notifications/read',
    handler: async (c) => {
      const ids = Array.isArray(c.body.ids) ? c.body.ids.map((x) => int(x)) : [];
      await markRead(c.actor.id, ids);
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: 'notifications/read-all',
    handler: async (c) => {
      await markAllRead(c.actor.id);
      return { ok: true };
    },
  },

  /* ---------- Papierkorb ---------- */
  {
    method: 'GET',
    path: 'trash',
    perm: 'orders.read',
    handler: async (c) => ({
      notes: await listTrash(),
      documents: c.can('docs.read') ? await listDocs({ view: 'papierkorb' }) : [],
      canRestore: c.can('orders.write'),
      canRestoreDocs: c.can('docs.write'),
      canPurge: c.can('settings.manage'),
    }),
  },
  {
    method: 'POST',
    path: 'trash/empty',
    perm: 'settings.manage',
    handler: async (c) => {
      const r = await purgeTrash('alle');
      await audit(c.audit, 'papierkorb.geleert', '', `${r.count} Notizen`);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'trash/:id/restore',
    perm: 'orders.write',
    handler: async (c) => {
      const r = ok(await restoreNote(int(c.params.id, 'Eintrags-ID'), c.actor.name));
      await audit(c.audit, 'notiz.wiederhergestellt', r.orderNumber ?? '', c.params.id);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'trash/:id/purge',
    perm: 'settings.manage',
    handler: async (c) => {
      const r = await purgeTrash(int(c.params.id, 'Eintrags-ID'));
      if (!r.count) throw new HttpError(404, 'Eintrag nicht im Papierkorb');
      await audit(c.audit, 'notiz.endgueltig_geloescht', '', c.params.id);
      return r;
    },
  },

  /* ---------- Eigenes Konto: Sicherheit ---------- */
  {
    method: 'GET',
    path: 'security',
    handler: async (c) => {
      const sessions = await (await getDb()).all<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }>(
        "SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE user_id = ? AND revoked_at = '' AND last_seen_at > ? ORDER BY last_seen_at DESC LIMIT 50",
        c.actor.id,
        new Date(Date.now() - 12 * 3_600_000).toISOString(),
      );
      return {
        twoFactor: await twoFactorStatus(c.actor.id),
        sessions: sessions.map((x) => ({ ...x, current: x.id === c.s.sid, id: x.id })),
        canChangePassword: c.actor.id !== 0,
      };
    },
  },
  {
    method: 'POST',
    path: 'security/2fa/setup',
    handler: async (c) => {
      const r = await setupTwoFactor(c.actor.id, c.s.user.username);
      if ('error' in r) throw new HttpError(422, r.error);
      await audit(c.audit, '2fa.eingerichtet');
      return r;
    },
  },
  {
    method: 'POST',
    path: 'security/2fa/enable',
    handler: async (c) => {
      const ip = await clientIp();
      if ((await recentLoginFailures(ip)).ip >= LOGIN_FAILURE_LIMITS.perIp) throw new HttpError(429, 'Zu viele Fehlversuche – bitte später erneut versuchen');
      const res = await enableTwoFactor(c.actor.id, str(c.body.code, 8));
      if (!res.ok) await audit(c.audit, 'konto.2fa_fehlgeschlagen');
      const r = ok(res);
      await audit(c.audit, '2fa.aktiviert');
      return r;
    },
  },
  {
    method: 'POST',
    path: 'security/2fa/disable',
    handler: async (c) => {
      const ip = await clientIp();
      if ((await recentLoginFailures(ip)).ip >= LOGIN_FAILURE_LIMITS.perIp) throw new HttpError(429, 'Zu viele Fehlversuche – bitte später erneut versuchen');
      const res = await disableTwoFactor(c.actor.id, str(c.body.code, 8));
      if (!res.ok) await audit(c.audit, 'konto.2fa_fehlgeschlagen');
      const r = ok(res);
      await audit(c.audit, '2fa.deaktiviert');
      return r;
    },
  },
  {
    method: 'POST',
    path: 'security/sessions/revoke-others',
    handler: async (c) => {
      const n = await revokeSessions(c.actor.id, { exceptSid: c.s.sid });
      await audit(c.audit, 'sitzungen.beendet', '', `${n} andere`);
      return { ok: true, count: n };
    },
  },
  {
    method: 'POST',
    path: 'security/sessions/:id/revoke',
    handler: async (c) => {
      if (c.params.id === c.s.sid) throw new HttpError(400, 'Die aktuelle Sitzung über „Abmelden“ beenden');
      const n = await revokeSessions(c.actor.id, { sid: c.params.id });
      if (!n) throw new HttpError(404, 'Sitzung nicht gefunden');
      await audit(c.audit, 'sitzung.beendet');
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: 'security/password',
    handler: async (c) => {
      if (c.actor.id === 0) throw new HttpError(400, 'Das Inhaber-Passwort wird als Server-Geheimnis geändert');
      if ((await recentLoginFailures(await clientIp())).ip >= LOGIN_FAILURE_LIMITS.perIp) throw new HttpError(429, 'Zu viele Fehlversuche – bitte später erneut versuchen');
      const check = await authenticate(c.s.user.username, str(c.body.current, 200));
      if (!check) {
        await audit(c.audit, 'passwort.aenderung_fehlgeschlagen');
        throw new HttpError(422, 'Aktuelles Passwort ist nicht korrekt');
      }
      ok(await updateUser(c.actor.id, { password: str(c.body.next, 200) }));
      // Neue Passwortversion: alle Sitzungen ungültig – diese hier sofort neu starten
      await revokeSessions(c.actor.id);
      const fresh = await loadUser(c.actor.id);
      if (fresh) {
        await startSession(fresh.user, fresh.pwv);
        c.sessionReplaced = true;
      }
      await audit(c.audit, 'passwort.geaendert');
      return { ok: true };
    },
  },

  /* ---------- Benutzer ---------- */
  {
    method: 'GET',
    path: 'users',
    perm: 'users.manage',
    handler: async () => {
      const db = await getDb();
      const sessions = await db.all<{ user_id: number; n: number; last: string }>(
        "SELECT user_id, COUNT(*) AS n, MAX(last_seen_at) AS last FROM sessions WHERE revoked_at = '' GROUP BY user_id",
      );
      const users = await listUsers();
      const extra = await db.all<{ id: number; email: string; totp_enabled_at: string }>('SELECT id, email, totp_enabled_at FROM users');
      return {
        users: users.map((u) => ({ ...u, email: extra.find((e) => e.id === u.id)?.email ?? '', twoFactor: !!extra.find((e) => e.id === u.id)?.totp_enabled_at, sessions: sessions.find((s) => s.user_id === u.id) ?? null })),
        roles: ROLES.map((r) => ({ id: r, label: ROLE_LABEL[r], permissions: ROLE_PERMISSIONS[r] })),
        permissions: PERMISSIONS.map((p) => ({ id: p, label: PERMISSION_LABEL[p] })),
      };
    },
  },
  {
    method: 'POST',
    path: 'users',
    perm: 'users.manage',
    handler: async (c) => {
      const r = ok(await createUser({ username: str(c.body.username, 40), displayName: str(c.body.displayName, 80), role: str(c.body.role, 30), password: str(c.body.password, 200) }));
      if (typeof c.body.email === 'string' && c.body.email) {
        await (await getDb()).run('UPDATE users SET email = ? WHERE username = ?', str(c.body.email, 160).trim(), str(c.body.username, 40).trim().toLowerCase());
      }
      await audit(c.audit, 'benutzer.angelegt', str(c.body.username, 40), str(c.body.role, 30));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'users/:id',
    perm: 'users.manage',
    handler: async (c) => {
      const id = int(c.params.id, 'Benutzer-ID');
      const b = c.body;
      const patch: { displayName?: string; role?: string; active?: boolean; password?: string } = {};
      if (typeof b.displayName === 'string') patch.displayName = str(b.displayName, 80);
      if (typeof b.role === 'string') patch.role = str(b.role, 30);
      if (typeof b.active === 'boolean') patch.active = b.active;
      if (typeof b.password === 'string') patch.password = str(b.password, 200);
      if (Object.keys(patch).length) ok(await updateUser(id, patch));
      if (typeof b.email === 'string') {
        const email = str(b.email, 160).trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(422, 'E-Mail-Adresse ungültig');
        await (await getDb()).run('UPDATE users SET email = ? WHERE id = ?', email, id);
      }
      if (b.revokeSessions === true) await revokeSessions(id);
      if (b.resetTwoFactor === true) {
        // Verlorenes Gerät: Zwei-Faktor zurücksetzen und alle Sitzungen beenden
        await (await getDb()).run("UPDATE users SET totp_secret = '', totp_enabled_at = '' WHERE id = ?", id);
        await revokeSessions(id);
      }
      await audit(c.audit, 'benutzer.geaendert', String(id), [...Object.keys(patch), ...(typeof b.email === 'string' ? ['email'] : []), ...(b.revokeSessions ? ['sitzungen beendet'] : []), ...(b.resetTwoFactor ? ['2fa zurückgesetzt'] : [])].join(', '));
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: 'audit',
    perm: 'audit.read',
    handler: async (c) => {
      const user = str(c.url.searchParams.get('user'), 40);
      const rows = await listAudit(1000);
      return user ? rows.filter((r) => r.username === user) : rows.slice(0, 500);
    },
  },

  /* ---------- Einstellungen ---------- */
  {
    method: 'GET',
    path: 'settings',
    handler: async (c) => {
      const settings = await getSettings(true);
      const storage = storageInfo();
      return {
        lockMinutes: settings.lockMinutes,
        // Verkaufspreise der Schilder (für Auftragsformular); Einkaufspreise nur im Finanzcenter
        plateOffer: await getPlateOffer(),
        expressOffer: await getExpressOffer(),
        lockRange: LOCK_MINUTES_RANGE,
        canManage: c.can('settings.manage'),
        // Nur ob etwas eingerichtet ist – niemals Werte von Geheimnissen.
        system: {
          platform: storage.platform === 'cloudflare' ? 'Cloudflare Workers' : 'Node.js (lokal)',
          database: storage.db ? (storage.platform === 'cloudflare' ? 'Cloudflare D1 verbunden' : 'SQLite-Datei (lokal)') : 'nicht verbunden',
          uploads: storage.uploads ? (storage.platform === 'cloudflare' ? 'Cloudflare R2 (privat) verbunden' : 'lokaler Ordner (privat)') : 'nicht verbunden',
          publicUrl: process.env.PUBLIC_BASE_URL ?? '',
          kfzWebhook: kfzWebhookConfigured(),
          kfzApi: kfzApiConfigured(),
          mail: mailConfigured(),
          payments: paymentsEnabled(),
          stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET,
          plateAvailability: !!process.env.PLATE_AVAILABILITY_URL,
        },
      };
    },
  },
  {
    method: 'POST',
    path: 'settings',
    perm: 'settings.manage',
    handler: async (c) => {
      const lock = Math.round(Number(c.body.lockMinutes));
      if (!Number.isInteger(lock) || lock < LOCK_MINUTES_RANGE.min || lock > LOCK_MINUTES_RANGE.max) {
        throw new HttpError(422, `Sperre nach ${LOCK_MINUTES_RANGE.min}–${LOCK_MINUTES_RANGE.max} Minuten`);
      }
      await setSettings({ lock_minutes: String(lock) }, c.actor.name);
      await audit(c.audit, 'einstellungen.sperrzeit', '', `${lock} min`);
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: 'company',
    perm: ['settings.manage', 'finance.read'],
    handler: async (c) => {
      const company = await getCompany(true);
      return { company, missing: invoiceReadiness(company), warnings: companyWarnings(company), canManage: c.can('settings.manage') };
    },
  },
  {
    method: 'POST',
    path: 'company',
    perm: 'settings.manage',
    handler: async (c) => {
      const r = ok(await setCompany(c.body, c.actor.name));
      await audit(c.audit, 'einstellungen.unternehmen');
      return r;
    },
  },

  /* ---------- Automatisierung ---------- */
  { method: 'GET', path: 'automation', perm: ['automation.manage', 'orders.read'], handler: async (c) => ({ rules: await listRules(), canManage: c.can('automation.manage') }) },
  { method: 'GET', path: 'automation/runs', perm: ['automation.manage', 'orders.read'], handler: async () => listRuns(300) },
  {
    method: 'POST',
    path: 'automation/scan',
    perm: 'automation.manage',
    handler: async () => runScheduledRules(true),
  },
  {
    method: 'POST',
    path: 'automation/:id',
    perm: 'automation.manage',
    handler: async (c) => {
      const r = ok(await saveRule(str(c.params.id, 60), c.body.enabled === true, (c.body.values ?? {}) as Record<string, unknown>, c.actor.name));
      await audit(c.audit, 'automatisierung.geaendert', c.params.id, c.body.enabled === true ? 'an' : 'aus');
      return r;
    },
  },

  /* ---------- Systemdiagnose ---------- */
  {
    method: 'GET',
    path: 'system/diagnose',
    perm: 'settings.manage',
    handler: async () => {
      const t0 = Date.now();
      const db = await getDb();
      const counts = await db.first<{ orders: number; customers: number; documents: number; tasks: number; events: number; notifications: number }>(
        'SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM documents) AS documents, (SELECT COUNT(*) FROM tasks) AS tasks, (SELECT COUNT(*) FROM os_events) AS events, (SELECT COUNT(*) FROM os_notifications) AS notifications',
      );
      const dbMs = Date.now() - t0;
      // Speicher: kleine Testdatei schreiben, lesen, löschen (privat, ohne Kundendaten)
      const hex = (n: number) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => b.toString(16).padStart(2, '0')).join('');
      const key = `${hex(12)}/${hex(16)}.txt`;
      const t1 = Date.now();
      let storage: { ok: boolean; ms: number; error?: string };
      try {
        await putBlob(key, new TextEncoder().encode('ok'), 'text/plain');
        const back = await getBlob(key);
        await deleteBlobs([key]);
        storage = { ok: !!back && new TextDecoder().decode(back) === 'ok', ms: Date.now() - t1 };
      } catch (e) {
        storage = { ok: false, ms: Date.now() - t1, error: (e as Error).message.slice(0, 200) };
      }
      const env = cloudflareEnv();
      return {
        database: { ok: true, ms: dbMs, schema: await schemaVersion(), expected: SCHEMA_VERSION, counts },
        storage,
        cloudflare: { worker: !!env, d1Binding: !!env?.DB, r2Binding: !!env?.UPLOADS },
        integrations: { kfzWebhook: kfzWebhookConfigured(), kfzApi: kfzApiConfigured(), mail: mailConfigured(), payments: paymentsEnabled(), stripeWebhook: !!process.env.STRIPE_WEBHOOK_SECRET },
        runtime: { node: typeof process !== 'undefined' ? process.version ?? '' : '', at: new Date().toISOString() },
        build: { commit: process.env.EK_BUILD_COMMIT ?? '', builtAt: process.env.EK_BUILD_AT ?? '' },
      };
    },
  },
];
