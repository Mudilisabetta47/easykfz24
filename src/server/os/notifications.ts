// Benachrichtigungen: gespeichert (os_notifications), je Benutzer gelesen/ungelesen, Einstellungen je Art.
// Entstehen ausschließlich aus Ereignissen (emit) – ein Ereignis ergibt höchstens eine Benachrichtigung.

import { can, type Permission, type Role } from '../../lib/permissions.ts';
import { DEFAULT_PREFS, emailEnabled, NOTIFY_META, type NotifyKind, type NotifyPrefs, type NotifyPriority } from '../../lib/os-notify.ts';
import { DISPLAY, type DisplayStatus } from '../../lib/kfz-status.ts';
import { getDb, runAfter } from '../db.ts';
import { sendMail } from '../mailer.ts';
import { getCompany } from './company.ts';
import type { OsEvent } from './events.ts';

export interface OsNotificationRow {
  id: number;
  at: string;
  kind: NotifyKind;
  priority: NotifyPriority;
  title: string;
  text: string;
  order_id: number | null;
  customer_id: number | null;
  task_id: number | null;
  user_id: number | null;
  read: boolean;
}

interface Draft {
  kind: NotifyKind;
  title: string;
  text: string;
  priority?: NotifyPriority;
  userId?: number | null;
}

async function orderLabel(orderId: number | null): Promise<string> {
  if (!orderId) return '';
  const r = await (await getDb()).first<{ number: string; holder_name: string }>('SELECT number, holder_name FROM orders WHERE id = ?', orderId);
  return r ? `${r.number} · ${r.holder_name}` : '';
}

/** Welche Benachrichtigung ein Ereignis auslöst (oder keine). */
async function draftFor(ev: OsEvent): Promise<Draft | null> {
  const p = ev.payload as Record<string, string | number | boolean | undefined>;
  const label = await orderLabel(ev.order_id);
  switch (ev.type) {
    case 'order.created':
      return { kind: 'auftrag_neu', title: p.source === 'verwaltung' ? 'Auftrag angelegt' : 'Neue Bestellung', text: label };
    case 'customer.returning':
      return { kind: 'bestandskunde', title: 'Bestandskunde bestellt erneut', text: `${label}${p.orders ? ` · ${p.orders}. Auftrag` : ''}` };
    case 'payment.paid':
      return { kind: 'zahlung_ok', title: 'Zahlung eingegangen', text: label };
    case 'payment.failed':
      return { kind: 'zahlung_fehler', title: 'Zahlung fehlgeschlagen', text: `${label}${p.reason ? ` · ${p.reason}` : ''}` };
    case 'order.status':
      // Automatische Schritte nach kfz-api.de-Meldung: dafür gibt es schon die kfz.status-Benachrichtigung
      if (ev.actor === 'kfz-api.de') return null;
      if (p.to === 'unterlagen_fehlen') return { kind: 'unterlagen_fehlen', title: 'Unterlagen fehlen', text: label };
      if (p.to === 'zugelassen') return { kind: 'zulassung_ok', title: 'Zulassung abgeschlossen', text: label };
      return null;
    case 'kfz.status': {
      const d = p.display as DisplayStatus | undefined;
      if (d === 'fehlgeschlagen') return { kind: 'zulassung_abgelehnt', title: `Zulassung fehlgeschlagen (${p.status ?? ''})`, text: label, priority: 'kritisch' };
      if (d === 'angaben_erforderlich') return { kind: 'behoerde_rueckfrage', title: 'Rückfrage der Behörde', text: label };
      if (d === 'abgeschlossen') return { kind: 'kfz_status', title: 'Behörde hat beschieden', text: label };
      return { kind: 'kfz_status', title: `KFZ-API: ${d ? DISPLAY[d].label : p.status ?? 'Status'}`, text: label };
    }
    case 'kfz.problem':
      return {
        kind: 'webhook_fehler',
        title: p.outcome === 'nicht_zugeordnet' ? 'KFZ-API: Meldung nicht zugeordnet' : 'KFZ-API: Verarbeitung fehlgeschlagen',
        text: String(p.error ?? p.externalId ?? ''),
      };
    case 'task.created':
    case 'task.assigned':
      if (p.assigneeId === undefined || p.assigneeId === null || p.assigneeId === p.actorId) return null;
      return { kind: 'aufgabe', title: `Neue Aufgabe: ${p.title ?? ''}`, text: label, userId: Number(p.assigneeId) };
    case 'task.reminder':
      return { kind: 'frist', title: `Erinnerung: ${p.title ?? 'Aufgabe'}`, text: label, userId: p.assigneeId === undefined ? null : Number(p.assigneeId) };
    case 'order.assigned':
      if (p.assigneeId === undefined || p.assigneeId === null) return null;
      return { kind: 'aufgabe', title: 'Auftrag zugewiesen', text: label, userId: Number(p.assigneeId) };
    case 'order.overdue':
      return { kind: 'frist', title: 'Bearbeitungsfrist überschritten', text: label, priority: 'wichtig' };
    case 'order.followup':
      return { kind: 'frist', title: `Wiedervorlage: seit ${p.days ?? '?'} Tagen unverändert`, text: label };
    case 'message.failed':
      return { kind: 'mail_fehler', title: 'E-Mail nicht versendet', text: `${label}${p.error ? ` · ${p.error}` : ''}` };
    case 'message.prepared':
      return { kind: 'nachricht', title: 'Kundennachricht zur Freigabe vorbereitet', text: `${label}${p.subject ? ` · ${p.subject}` : ''}` };
    default:
      return null;
  }
}

export async function notifyFromEvent(ev: OsEvent): Promise<void> {
  const d = await draftFor(ev);
  if (!d) return;
  await createNotification({ ...d, orderId: ev.order_id, customerId: ev.customer_id, taskId: ev.task_id, dedupeKey: `n:${ev.dedupe_key}`, at: ev.at });
}

export async function createNotification(
  n: Draft & { orderId?: number | null; customerId?: number | null; taskId?: number | null; dedupeKey: string; at?: string },
  opts: { mail?: boolean } = {},
): Promise<void> {
  const meta = NOTIFY_META[n.kind];
  const db = await getDb();
  const row = await db.first<{ id: number }>(
    `INSERT INTO os_notifications (at, kind, priority, title, text, order_id, customer_id, task_id, user_id, permission, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id`,
    n.at ?? new Date().toISOString(),
    n.kind,
    n.priority ?? meta.priority,
    n.title.slice(0, 200),
    n.text.slice(0, 500),
    n.orderId ?? null,
    n.customerId ?? null,
    n.taskId ?? null,
    n.userId ?? null,
    meta.permission,
    n.dedupeKey,
  );
  if (row && opts.mail !== false) runAfter(mailStaff(n.kind, n.title, n.text, n.userId ?? null));
}

/** E-Mail an Mitarbeiter, die diese Art per E-Mail abonniert haben (nur mit hinterlegter Adresse). */
async function mailStaff(kind: NotifyKind, title: string, text: string, onlyUser: number | null): Promise<void> {
  try {
    const db = await getDb();
    const meta = NOTIFY_META[kind];
    const prefs = await db.all<{ user_id: number; prefs_json: string }>('SELECT user_id, prefs_json FROM user_prefs');
    const users = await db.all<{ id: number; email: string; role: Role; active: number }>("SELECT id, email, role, active FROM users WHERE email != ''");
    const company = await getCompany();
    const recipients: string[] = [];
    for (const pr of prefs) {
      if (onlyUser !== null && pr.user_id !== onlyUser) continue;
      const p = parsePrefs(pr.prefs_json);
      if (!emailEnabled(p, kind)) continue;
      if (pr.user_id === 0) {
        if (company.notifyEmail) recipients.push(company.notifyEmail);
        continue;
      }
      const u = users.find((x) => x.id === pr.user_id);
      if (u && u.active && can(u.role, meta.permission)) recipients.push(u.email);
    }
    for (const to of new Set(recipients)) {
      await sendMail({ to, subject: `[EasyKFZ24 OS] ${title}`, text: `${title}\n${text}\n\nÖffnen: ${process.env.PUBLIC_BASE_URL ?? 'https://easykfz24.de'}/admin` });
    }
  } catch (e) {
    console.error('[os] Mitarbeiter-E-Mail fehlgeschlagen:', (e as Error).message);
  }
}

export function parsePrefs(json: string | undefined): NotifyPrefs {
  try {
    const p = JSON.parse(json || '{}') as Partial<NotifyPrefs>;
    return { toast: p.toast ?? {}, email: p.email ?? {}, browser: !!p.browser };
  } catch {
    return DEFAULT_PREFS;
  }
}

export async function getUserPrefs(userId: number): Promise<{ notify: NotifyPrefs; desktop: Record<string, unknown>; readUntil: string }> {
  const r = await (await getDb()).first<{ prefs_json: string; read_until: string }>('SELECT prefs_json, read_until FROM user_prefs WHERE user_id = ?', userId);
  let desktop: Record<string, unknown> = {};
  try {
    desktop = (JSON.parse(r?.prefs_json || '{}') as { desktop?: Record<string, unknown> }).desktop ?? {};
  } catch {
    /* leer */
  }
  return { notify: parsePrefs(r?.prefs_json), desktop, readUntil: r?.read_until ?? '' };
}

export async function setUserPrefs(userId: number, patch: { notify?: NotifyPrefs; desktop?: Record<string, unknown> }): Promise<void> {
  const db = await getDb();
  const cur = await db.first<{ prefs_json: string }>('SELECT prefs_json FROM user_prefs WHERE user_id = ?', userId);
  let obj: Record<string, unknown> = {};
  try {
    obj = JSON.parse(cur?.prefs_json || '{}') as Record<string, unknown>;
  } catch {
    obj = {};
  }
  if (patch.notify) Object.assign(obj, { toast: patch.notify.toast, email: patch.notify.email, browser: patch.notify.browser });
  if (patch.desktop) obj.desktop = patch.desktop;
  const json = JSON.stringify(obj);
  if (json.length > 64_000) throw new Error('Einstellungen zu groß');
  await db.run(
    "INSERT INTO user_prefs (user_id, prefs_json, read_until, updated_at) VALUES (?, ?, '', ?) ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json, updated_at = excluded.updated_at",
    userId,
    json,
    new Date().toISOString(),
  );
}

function visibility(userId: number, perms: readonly Permission[]): { sql: string; params: (string | number)[] } {
  return {
    sql: `(n.user_id IS NULL OR n.user_id = ?) AND n.permission IN (${perms.map(() => '?').join(',')})`,
    params: [userId, ...perms],
  };
}

export async function listNotifications(userId: number, perms: readonly Permission[], opts: { limit?: number; unreadOnly?: boolean } = {}): Promise<{ items: OsNotificationRow[]; unread: number }> {
  const db = await getDb();
  await backfillOnce();
  const prefs = await db.first<{ read_until: string }>('SELECT read_until FROM user_prefs WHERE user_id = ?', userId);
  const until = prefs?.read_until ?? '';
  const v = visibility(userId, perms);
  const rows = await db.all<Omit<OsNotificationRow, 'read'> & { read_at: string | null }>(
    `SELECT n.id, n.at, n.kind, n.priority, n.title, n.text, n.order_id, n.customer_id, n.task_id, n.user_id, r.at AS read_at
     FROM os_notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
     WHERE ${v.sql} ORDER BY n.at DESC, n.id DESC LIMIT ?`,
    userId,
    ...v.params,
    Math.min(opts.limit ?? 100, 500),
  );
  const items = rows.map(({ read_at, ...r }) => ({ ...r, read: !!read_at || (until !== '' && r.at <= until) }));
  const unreadRow = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM os_notifications n LEFT JOIN notification_reads r ON r.notification_id = n.id AND r.user_id = ?
     WHERE ${v.sql} AND r.at IS NULL AND n.at > ?`,
    userId,
    ...v.params,
    until,
  );
  return { items: opts.unreadOnly ? items.filter((i) => !i.read) : items, unread: unreadRow?.n ?? 0 };
}

export async function markRead(userId: number, ids: number[]): Promise<void> {
  if (!ids.length) return;
  const at = new Date().toISOString();
  await (await getDb()).batch(
    ids.slice(0, 500).map((id) => ({ sql: 'INSERT INTO notification_reads (user_id, notification_id, at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', params: [userId, id, at] })),
  );
}

export async function markAllRead(userId: number): Promise<void> {
  const at = new Date().toISOString();
  await (await getDb()).run(
    "INSERT INTO user_prefs (user_id, prefs_json, read_until, updated_at) VALUES (?, '{}', ?, ?) ON CONFLICT(user_id) DO UPDATE SET read_until = excluded.read_until, updated_at = excluded.updated_at",
    userId,
    at,
    at,
  );
}

/* ---------- Übernahme der bisherigen Historie (einmalig) ---------- */

const g = globalThis as unknown as { __ekNotifBackfill?: boolean };

/**
 * Jüngste bisherige Ereignisse (vor Einführung des Ereignisprotokolls) einmalig als Benachrichtigungen übernehmen –
 * bewusst begrenzt (D1-Abfragegrenze je Aufruf); die vollständige Historie steht weiter im Auftragsverlauf.
 */
async function backfillOnce(): Promise<void> {
  if (g.__ekNotifBackfill) return;
  const db = await getDb();
  const done = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'backfill_notifications_v6'");
  if (done) {
    g.__ekNotifBackfill = true;
    return;
  }
  // Nur, was vor dem Ereignisprotokoll lag – alles danach hat bereits eine Benachrichtigung über os_events
  const cutoff = (await db.first<{ at: string | null }>('SELECT MIN(at) AS at FROM os_events'))?.at || '9999';
  const events = await db.all<{ id: number; at: string; type: string; to_status: string | null; order_id: number; number: string; holder_name: string }>(
    `SELECT e.id, e.at, e.type, e.to_status, e.order_id, o.number, o.holder_name FROM events e JOIN orders o ON o.id = e.order_id
     WHERE e.at < ? AND (e.type = 'created' OR (e.type = 'status' AND e.to_status IN ('unterlagen_fehlen', 'zugelassen'))) ORDER BY e.id DESC LIMIT 15`,
    cutoff,
  );
  const hooks = await db.all<{ event_id: string; received_at: string; outcome: string; status: string; error: string; order_id: number | null; external_id: string }>(
    "SELECT event_id, received_at, outcome, status, error, order_id, external_id FROM kfz_webhook_events WHERE received_at < ? AND outcome IN ('fehler', 'nicht_zugeordnet') ORDER BY received_at DESC LIMIT 10",
    cutoff,
  );
  const mails = await db.all<{ id: number; at: string; subject: string; error: string; order_id: number }>(
    "SELECT id, at, subject, error, order_id FROM notifications WHERE at < ? AND state = 'fehler' ORDER BY at DESC LIMIT 5",
    cutoff,
  );
  for (const e of events) {
    const label = `${e.number} · ${e.holder_name}`;
    if (e.type === 'created') await createNotification({ kind: 'auftrag_neu', title: 'Neue Bestellung', text: label, orderId: e.order_id, dedupeKey: `legacy:e${e.id}`, at: e.at }, { mail: false });
    else if (e.to_status === 'unterlagen_fehlen') await createNotification({ kind: 'unterlagen_fehlen', title: 'Unterlagen fehlen', text: label, orderId: e.order_id, dedupeKey: `legacy:e${e.id}`, at: e.at }, { mail: false });
    else await createNotification({ kind: 'zulassung_ok', title: 'Zulassung abgeschlossen', text: label, orderId: e.order_id, dedupeKey: `legacy:e${e.id}`, at: e.at }, { mail: false });
  }
  for (const h of hooks) {
    await createNotification({
      kind: 'webhook_fehler',
      title: h.outcome === 'fehler' ? 'KFZ-API: Verarbeitung fehlgeschlagen' : 'KFZ-API: Meldung nicht zugeordnet',
      text: h.error || `${h.status} ${h.external_id}`.trim(),
      orderId: h.order_id,
      dedupeKey: `legacy:k${h.event_id}`,
      at: h.received_at,
    }, { mail: false });
  }
  for (const m of mails) {
    await createNotification({ kind: 'mail_fehler', title: 'E-Mail nicht versendet', text: `${m.subject} – ${m.error}`, orderId: m.order_id, dedupeKey: `legacy:m${m.id}`, at: m.at }, { mail: false });
  }
  await db.run(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('backfill_notifications_v6', ?, ?, 'system') ON CONFLICT(key) DO NOTHING",
    String(events.length + hooks.length + mails.length),
    new Date().toISOString(),
  );
  g.__ekNotifBackfill = true;
}
