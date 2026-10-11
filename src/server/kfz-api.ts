// kfz-api.de: Webhook-Verarbeitung, Zuordnung zum Auftrag, Statusübernahme, Benachrichtigung, lesende API-Aufrufe.
//
// Umgebung:
//   KFZ_API_WEBHOOK_SECRET  Signaturschlüssel des Webhooks (Dashboard → Webhooks) – Pflicht für den Empfang
//   KFZ_API_BASE_URL        Basisadresse aus dem Dashboard („API & Umgebungen“) – nur für lesende Aufrufe/Belege
//   KFZ_API_LOGIN           API-Benutzer (HTTP Basic) – nur für lesende Aufrufe/Belege
//   KFZ_API_PASSWORD        Passwort des API-Benutzers
//
// Es werden hier keine Anträge an kfz-api.de gesendet: Es gibt laut Anbieter keine Testumgebung, jeder gültige
// Antrag geht produktiv an das KBA. Anträge werden erst nach ausdrücklicher Freigabe angebunden.

import { addEvent, touch } from './orders.ts';
import { getDb, transaction } from './db.ts';
import { sendMail } from './mailer.ts';
import { publicBaseUrl } from './payments.ts';
import {
  BUSINESS_TRANSACTIONS,
  DISPLAY,
  displayFor,
  KFZ_STATUS_TEXT,
  normalizeKfzPlate,
  NOTIFY_ON,
  parseKfzEvent,
  sha256Hex,
  verifyKfzSignature,
  type DisplayStatus,
  type KfzEvent,
  type KfzFile,
  type KfzMessage,
} from '../lib/kfz-api.ts';
import { buildStatusMail } from '../lib/notification-mail.ts';
import { nextStatuses, STATUSES, type StatusId } from '../lib/status.ts';
import type { ServiceId } from '../lib/services.ts';

const MAX_BODY = 1024 * 1024;
const now = () => new Date().toISOString();

export function kfzWebhookConfigured(): boolean {
  return !!process.env.KFZ_API_WEBHOOK_SECRET;
}

export function kfzApiConfigured(): boolean {
  return !!process.env.KFZ_API_BASE_URL && !!process.env.KFZ_API_LOGIN && !!process.env.KFZ_API_PASSWORD;
}

export function kfzWebhookUrl(): string {
  return `${publicBaseUrl()}/api/webhooks/kfz-api`;
}

export type WebhookOutcome = 'verarbeitet' | 'ping' | 'nicht_zugeordnet' | 'fehler';

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

/** Nur dokumentierte Felder speichern – nichts Unbekanntes, keine Rohdaten. */
function eventJson(ev: KfzEvent): string {
  return JSON.stringify({
    order: { id: ev.orderId, externalId: ev.externalId },
    businessTransaction: ev.businessTransaction,
    status: ev.rawStatus,
    derivedStatus: ev.derivedStatus,
    licensePlate: ev.licensePlate,
    files: ev.files,
    messages: ev.messages,
    retryable: ev.retryable,
    hasOrder: ev.hasOrder,
  });
}

function recordEvent(
  eventId: string,
  outcome: WebhookOutcome,
  bodyHash: string,
  ev: KfzEvent | null,
  orderId: number | null,
  error = '',
  /** false bei manueller Nachbearbeitung – zählt nicht als erneute Zustellung */
  delivery = true,
): void {
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO kfz_webhook_events (event_id, received_at, last_seen_at, deliveries, outcome, order_id, kfz_order_id, external_id,
         business_transaction, status, derived_status, error, body_sha256, event_json)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(event_id) DO UPDATE SET last_seen_at = CASE WHEN ? THEN excluded.last_seen_at ELSE last_seen_at END, deliveries = deliveries + ?,
         outcome = excluded.outcome, order_id = excluded.order_id, error = excluded.error, event_json = excluded.event_json`,
    )
    .run(
      eventId,
      t,
      t,
      outcome,
      orderId,
      ev?.orderId ?? '',
      ev?.externalId ?? '',
      ev?.businessTransaction ?? '',
      ev?.rawStatus ?? '',
      ev?.derivedStatus ?? '',
      error.slice(0, 500),
      bodyHash,
      ev ? eventJson(ev) : '{}',
      delivery ? 1 : 0,
      delivery ? 1 : 0,
    );
}

function findOrder(ev: KfzEvent): number | null {
  const db = getDb();
  if (ev.externalId) {
    const r = db.prepare('SELECT id FROM orders WHERE number = ?').get(ev.externalId) as { id: number } | undefined;
    if (r) return r.id;
  }
  if (ev.orderId) {
    const r = db.prepare("SELECT id FROM orders WHERE kfz_order_id = ? AND kfz_order_id != ''").get(ev.orderId) as { id: number } | undefined;
    if (r) return r.id;
  }
  return null;
}

/** Protokolliert ohne Risiko: Ein Fehler beim Speichern darf die Antwort an kfz-api.de nicht verhindern. */
function tryRecord(eventId: string, outcome: WebhookOutcome, bodyHash: string, ev: KfzEvent | null, error = ''): void {
  try {
    recordEvent(eventId, outcome, bodyHash, ev, null, error);
  } catch (e) {
    console.error(`[kfz-api] Protokoll (${outcome}) konnte nicht gespeichert werden:`, (e as Error).message);
  }
}

/** Kürzester erlaubter Weg im Auftrags-Workflow (ohne Storno), höchstens drei Schritte. */
function workflowPath(from: StatusId, to: StatusId): StatusId[] | null {
  if (from === to) return [];
  const queue: { s: StatusId; path: StatusId[] }[] = [{ s: from, path: [] }];
  const seen = new Set<StatusId>([from]);
  while (queue.length) {
    const { s, path } = queue.shift()!;
    if (path.length >= 3) continue;
    for (const n of nextStatuses(s)) {
      if (n === 'storniert' || seen.has(n)) continue;
      const p = [...path, n];
      if (n === to) return p;
      seen.add(n);
      queue.push({ s: n, path: p });
    }
  }
  return null;
}

const WORKFLOW_TARGET: Partial<Record<DisplayStatus, StatusId>> = {
  in_bearbeitung: 'bei_zulassungsstelle',
  angaben_erforderlich: 'unterlagen_fehlen',
  abgeschlossen: 'zugelassen',
};

interface Applied {
  display: DisplayStatus | null;
  previousDisplay: string;
}

/** Übernimmt ein Ereignis in den Auftrag (innerhalb einer Transaktion aufrufen). */
function applyEvent(orderId: number, ev: KfzEvent): Applied {
  const db = getDb();
  const order = db
    .prepare('SELECT status, service, assigned_plate, previous_plate, kfz_display, kfz_files_json, kfz_order_id FROM orders WHERE id = ?')
    .get(orderId) as {
    status: StatusId;
    service: ServiceId;
    assigned_plate: string;
    previous_plate: string;
    kfz_display: string;
    kfz_files_json: string;
    kfz_order_id: string;
  };
  let display = displayFor(ev.status, ev.derivedStatus, ev.retryable);
  // Verspätete Meldungen dürfen einen abgeschlossenen Vorgang nicht zurückstufen.
  const stale = order.kfz_display === 'abgeschlossen' && display === 'in_bearbeitung';
  if (stale) display = 'abgeschlossen';

  const files: KfzFile[] = JSON.parse(order.kfz_files_json || '[]');
  for (const f of ev.files) if (!files.some((x) => x.fileAccessKey === f.fileAccessKey)) files.push(f);
  const stamp = now();
  db.prepare(
    `UPDATE orders SET kfz_order_id = ?, kfz_transaction = COALESCE(NULLIF(?, ''), kfz_transaction), kfz_status = COALESCE(?, kfz_status),
       kfz_display = COALESCE(?, kfz_display), kfz_updated_at = ?, kfz_files_json = ?,
       kfz_messages_json = CASE WHEN ? != '[]' THEN ? ELSE kfz_messages_json END, updated_at = ? WHERE id = ?`,
  ).run(
    ev.orderId ?? order.kfz_order_id,
    ev.businessTransaction ?? '',
    stale ? null : (ev.rawStatus ?? ev.derivedStatus ?? ''),
    display,
    stamp,
    JSON.stringify(files),
    JSON.stringify(ev.messages),
    JSON.stringify(ev.messages),
    stamp,
    orderId,
  );

  const statusText = ev.status ? KFZ_STATUS_TEXT[ev.status] : ev.rawStatus ? `Status ${ev.rawStatus}` : `Gesamtstand ${ev.derivedStatus ?? 'unbekannt'}`;
  const msgText = ev.messages.map((m) => [m.code, m.text].filter(Boolean).join(': ')).join(' · ');
  addEvent(orderId, {
    type: 'kfz',
    message: `kfz-api.de${ev.orderId ? ` (Vorgang ${ev.orderId})` : ''}: ${ev.rawStatus ?? ev.derivedStatus ?? '–'} – ${statusText}${stale ? ' (verspätete Meldung, Stand bleibt „abgeschlossen“)' : ''}${msgText ? ` Meldungen: ${msgText}` : ''}${ev.files.length ? ` · ${ev.files.length} Beleg(e)` : ''}`,
    publicMessage: display && !stale ? DISPLAY[display].label : '',
    actor: 'kfz-api.de',
  });

  // Zugeteiltes Kennzeichen übernehmen
  let plate = order.assigned_plate;
  const kfzPlate = normalizeKfzPlate(ev.licensePlate);
  if (kfzPlate && kfzPlate !== plate) {
    db.prepare('UPDATE orders SET assigned_plate = ? WHERE id = ?').run(kfzPlate, orderId);
    addEvent(orderId, { type: 'plate', message: `Kennzeichen ${kfzPlate} laut Bescheid übernommen`, actor: 'kfz-api.de' });
    plate = kfzPlate;
  }

  // Auftrags-Workflow nachziehen, soweit der Weg erlaubt ist
  const target = display ? WORKFLOW_TARGET[display] : undefined;
  if (target) {
    if (target === 'zugelassen' && order.service !== 'abmeldung' && !plate && order.previous_plate) {
      db.prepare('UPDATE orders SET assigned_plate = ? WHERE id = ?').run(order.previous_plate, orderId);
      plate = order.previous_plate;
    }
    const path = workflowPath(order.status, target);
    if (path && path.length && (target !== 'zugelassen' || order.service === 'abmeldung' || plate)) {
      let from = order.status;
      for (const to of path) {
        db.prepare('UPDATE orders SET status = ? WHERE id = ?').run(to, orderId);
        addEvent(orderId, { type: 'status', from, to, publicMessage: STATUSES[to].publicText, message: 'Automatisch nach Meldung von kfz-api.de', actor: 'kfz-api.de' });
        from = to;
      }
    } else if (path === null && order.status !== target) {
      addEvent(orderId, {
        type: 'note',
        message: `Status „${STATUSES[target].label}“ laut kfz-api.de nicht automatisch gesetzt (aktuell „${STATUSES[order.status].label}“) – bitte prüfen.`,
        actor: 'kfz-api.de',
      });
    }
  }
  touch(orderId);
  return { display, previousDisplay: order.kfz_display };
}

/** Kunden-E-Mail bei einem Wechsel in eine benachrichtigungswürdige Anzeige (einmal je Wechsel). */
export async function notifyCustomer(orderId: number, display: DisplayStatus): Promise<void> {
  const row = getDb().prepare('SELECT number, email FROM orders WHERE id = ?').get(orderId) as { number: string; email: string } | undefined;
  if (!row) return;
  const mail = buildStatusMail({
    number: row.number,
    display,
    statusUrl: `${publicBaseUrl()}/status?nr=${encodeURIComponent(row.number)}`,
  });
  const res = await sendMail({ to: row.email, ...mail });
  getDb()
    .prepare('INSERT INTO notifications (order_id, at, topic, subject, state, error) VALUES (?, ?, ?, ?, ?, ?)')
    .run(orderId, now(), `kfz:${display}`, mail.subject, res.state, res.state === 'fehler' ? res.error : '');
}

function scheduleNotify(orderId: number, applied: Applied): void {
  const d = applied.display;
  if (!d || d === applied.previousDisplay || !NOTIFY_ON.includes(d)) return;
  // Nicht auf den Versand warten: kfz-api.de soll schnell eine Antwort bekommen.
  void notifyCustomer(orderId, d).catch((e) => console.error('[kfz-api] Benachrichtigung fehlgeschlagen:', (e as Error).message));
}

/**
 * Verarbeitet einen eingehenden Webhook. Reihenfolge: Größe → Signatur → JSON → Doppelt? → PING → Zuordnung → Übernahme.
 * Antworten: 2xx = angenommen (auch doppelt, PING, nicht zugeordnet); 401 = Signatur ungültig; 5xx = bitte erneut senden.
 */
export function handleKfzWebhook(raw: string, headers: Headers): { result: WebhookResult; after?: () => void } {
  const secret = process.env.KFZ_API_WEBHOOK_SECRET;
  if (!secret) return { result: { status: 503, body: { error: 'Webhook nicht konfiguriert' } } };
  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY) return { result: { status: 413, body: { error: 'Zu groß' } } };

  const signature = headers.get('x-signature');
  if (!verifyKfzSignature(raw, signature, secret)) {
    // Protokoll ohne Inhalt: keine Kundendaten in Logs
    console.warn(`[kfz-api] Webhook abgewiesen: ${signature ? 'Signatur ungültig' : 'Signatur fehlt'} (Event-Id ${headers.get('x-event-id') ?? '–'})`);
    return { result: { status: 401, body: { error: 'Ungültige Signatur' } } };
  }

  const bodyHash = sha256Hex(raw);
  const eventId = (headers.get('x-event-id') ?? '').trim().slice(0, 200) || `sha256:${bodyHash}`;

  let json: unknown;
  try {
    json = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    tryRecord(eventId, 'fehler', bodyHash, null, 'Rumpf ist kein gültiges JSON');
    return { result: { status: 400, body: { error: 'Ungültiges JSON' } } };
  }

  const ev = parseKfzEvent(json);

  // PING / Test ohne Vorgang: immer bestätigen – auch wenn das Protokoll gerade nicht geschrieben werden kann.
  if (!ev.hasOrder) {
    tryRecord(eventId, 'ping', bodyHash, ev);
    return { result: { status: 200, body: { received: true, ping: true } } };
  }

  // Ab hier wird gespeichert. Ist der Speicher nicht erreichbar: 503, damit kfz-api.de später erneut zustellt.
  let db: ReturnType<typeof getDb>;
  try {
    db = getDb();
  } catch (e) {
    console.error('[kfz-api] Datenbank nicht verfügbar – Meldung wird nicht verarbeitet:', (e as Error).message);
    return { result: { status: 503, body: { error: 'Speicher vorübergehend nicht verfügbar' } } };
  }
  const seen = db.prepare('SELECT outcome FROM kfz_webhook_events WHERE event_id = ?').get(eventId) as { outcome: WebhookOutcome } | undefined;
  if (seen && seen.outcome !== 'fehler') {
    db.prepare('UPDATE kfz_webhook_events SET last_seen_at = ?, deliveries = deliveries + 1 WHERE event_id = ?').run(now(), eventId);
    return { result: { status: 200, body: { received: true, duplicate: true } } };
  }

  try {
    const orderId = findOrder(ev);
    if (!orderId) {
      recordEvent(eventId, 'nicht_zugeordnet', bodyHash, ev, null, 'Kein Auftrag zu externalId/order.id gefunden');
      return { result: { status: 200, body: { received: true, matched: false } } };
    }
    const applied = transaction(() => {
      const a = applyEvent(orderId, ev);
      recordEvent(eventId, 'verarbeitet', bodyHash, ev, orderId);
      return a;
    });
    return { result: { status: 200, body: { received: true } }, after: () => scheduleNotify(orderId, applied) };
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[kfz-api] Verarbeitung fehlgeschlagen:', msg);
    try {
      recordEvent(eventId, 'fehler', bodyHash, ev, null, msg);
    } catch {
      /* Protokoll darf die Antwort nicht verhindern */
    }
    return { result: { status: 500, body: { error: 'Verarbeitung fehlgeschlagen' } } };
  }
}

/* ---------- Admin ---------- */

export interface KfzEventRow {
  event_id: string;
  received_at: string;
  last_seen_at: string;
  deliveries: number;
  outcome: WebhookOutcome;
  order_id: number | null;
  order_number: string | null;
  kfz_order_id: string;
  external_id: string;
  business_transaction: string;
  status: string;
  derived_status: string;
  error: string;
}

export function listKfzEvents(limit = 50): KfzEventRow[] {
  return getDb()
    .prepare(
      `SELECT e.event_id, e.received_at, e.last_seen_at, e.deliveries, e.outcome, e.order_id, o.number AS order_number, e.kfz_order_id,
         e.external_id, e.business_transaction, e.status, e.derived_status, e.error
       FROM kfz_webhook_events e LEFT JOIN orders o ON o.id = e.order_id ORDER BY e.received_at DESC LIMIT ?`,
    )
    .all(limit) as unknown as KfzEventRow[];
}

export function kfzEventStats(): { total: number; problems: number; lastAt: string | null } {
  const r = getDb()
    .prepare("SELECT COUNT(*) AS total, SUM(outcome IN ('fehler','nicht_zugeordnet')) AS problems, MAX(received_at) AS lastAt FROM kfz_webhook_events")
    .get() as { total: number; problems: number | null; lastAt: string | null };
  return { total: r.total, problems: r.problems ?? 0, lastAt: r.lastAt };
}

/** Nicht zugeordnetes oder fehlerhaftes Ereignis einem Auftrag zuweisen und verarbeiten. */
export function assignKfzEvent(eventId: string, orderNumber: string): { ok: true } | { ok: false; error: string } {
  const db = getDb();
  const row = db.prepare('SELECT event_json, outcome, body_sha256 FROM kfz_webhook_events WHERE event_id = ?').get(eventId) as
    | { event_json: string; outcome: WebhookOutcome; body_sha256: string }
    | undefined;
  if (!row) return { ok: false, error: 'Ereignis nicht gefunden' };
  if (row.outcome === 'verarbeitet' || row.outcome === 'ping') return { ok: false, error: 'Ereignis ist bereits verarbeitet' };
  const order = db.prepare('SELECT id FROM orders WHERE number = ?').get(orderNumber.trim().toUpperCase()) as { id: number } | undefined;
  if (!order) return { ok: false, error: 'Auftragsnummer nicht gefunden' };
  const stored = JSON.parse(row.event_json || '{}');
  const ev = parseKfzEvent(stored);
  if (!ev.hasOrder) return { ok: false, error: 'Ereignis enthält keinen Vorgang' };
  const applied = transaction(() => {
    const a = applyEvent(order.id, ev);
    recordEvent(eventId, 'verarbeitet', row.body_sha256, ev, order.id, '', false);
    return a;
  });
  scheduleNotify(order.id, applied);
  return { ok: true };
}

/** Vorgangsnummer von kfz-api.de von Hand mit einem Auftrag verknüpfen (z. B. bei Erfassung im Dashboard). */
export function linkKfzOrder(orderId: number, kfzOrderId: string): { ok: true } | { ok: false; error: string } {
  const id = kfzOrderId.trim();
  if (id && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, error: 'Ungültige Vorgangsnummer' };
  const db = getDb();
  if (id) {
    const other = db.prepare('SELECT number FROM orders WHERE kfz_order_id = ? AND id != ?').get(id, orderId) as { number: string } | undefined;
    if (other) return { ok: false, error: `Vorgang ist bereits mit ${other.number} verknüpft` };
  }
  db.prepare('UPDATE orders SET kfz_order_id = ? WHERE id = ?').run(id, orderId);
  addEvent(orderId, { type: 'kfz', message: id ? `Mit kfz-api.de-Vorgang ${id} verknüpft` : 'Verknüpfung mit kfz-api.de gelöst', actor: 'Admin' });
  touch(orderId);
  return { ok: true };
}

export interface KfzOrderInfo {
  kfzOrderId: string;
  transaction: string;
  status: string;
  display: DisplayStatus | '';
  updatedAt: string;
  files: KfzFile[];
  messages: KfzMessage[];
  notifications: { at: string; subject: string; state: string; error: string }[];
}

export function getKfzOrderInfo(orderId: number): KfzOrderInfo | null {
  const db = getDb();
  const r = db
    .prepare('SELECT kfz_order_id, kfz_transaction, kfz_status, kfz_display, kfz_updated_at, kfz_files_json, kfz_messages_json FROM orders WHERE id = ?')
    .get(orderId) as
    | {
        kfz_order_id: string;
        kfz_transaction: string;
        kfz_status: string;
        kfz_display: DisplayStatus | '';
        kfz_updated_at: string;
        kfz_files_json: string;
        kfz_messages_json: string;
      }
    | undefined;
  if (!r) return null;
  const notifications = db
    .prepare('SELECT at, subject, state, error FROM notifications WHERE order_id = ? ORDER BY at DESC')
    .all(orderId) as { at: string; subject: string; state: string; error: string }[];
  return {
    kfzOrderId: r.kfz_order_id,
    transaction: r.kfz_transaction,
    status: r.kfz_status,
    display: r.kfz_display,
    updatedAt: r.kfz_updated_at,
    files: JSON.parse(r.kfz_files_json || '[]'),
    messages: JSON.parse(r.kfz_messages_json || '[]'),
    notifications,
  };
}

/* ---------- Lesende API-Aufrufe ---------- */

function apiAuth(): { base: string; header: string } | null {
  if (!kfzApiConfigured()) return null;
  const base = (process.env.KFZ_API_BASE_URL as string).replace(/\/$/, '');
  const header = `Basic ${Buffer.from(`${process.env.KFZ_API_LOGIN}:${process.env.KFZ_API_PASSWORD}`).toString('base64')}`;
  return { base, header };
}

/**
 * Verbindungstest laut Dokumentation: GET /vehicleDeregistrations/orders?limit=1 prüft Adresse und Anmeldung,
 * ohne etwas anzulegen. Gibt nur Statuscode und Trace-Id zurück, keine Auftragsdaten.
 */
export async function checkKfzConnection(): Promise<{ ok: boolean; status: number | null; message: string; traceId: string | null }> {
  const auth = apiAuth();
  if (!auth) return { ok: false, status: null, message: 'API-Zugang nicht konfiguriert (KFZ_API_BASE_URL, KFZ_API_LOGIN, KFZ_API_PASSWORD)', traceId: null };
  try {
    const res = await fetch(`${auth.base}/vehicleDeregistrations/orders?limit=1`, {
      headers: { Authorization: auth.header, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    });
    const traceId = res.headers.get('x-trace-id');
    const message =
      res.status === 200 ? 'Verbindung und Anmeldung in Ordnung' : res.status === 401 || res.status === 403 ? 'Anmeldung abgelehnt – API-Benutzer prüfen' : `Antwort ${res.status}`;
    return { ok: res.status === 200, status: res.status, message, traceId };
  } catch (e) {
    return { ok: false, status: null, message: `Nicht erreichbar: ${(e as Error).message}`, traceId: null };
  }
}

/** Beleg über GET /{prefix}/files/content/{fileAccessKey} abrufen (nur für eingeloggte Admins durchgereicht). */
export async function fetchKfzFile(transactionCode: string, fileAccessKey: string): Promise<Response | null> {
  const auth = apiAuth();
  const bt = BUSINESS_TRANSACTIONS[transactionCode as keyof typeof BUSINESS_TRANSACTIONS];
  if (!auth || !bt || !/^\S{1,1024}$/.test(fileAccessKey)) return null;
  return fetch(`${auth.base}/${bt.prefix}/files/content/${encodeURIComponent(fileAccessKey)}`, {
    headers: { Authorization: auth.header },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
}
