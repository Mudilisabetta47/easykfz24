// kfz-api.de: Webhook-Verarbeitung, Zuordnung zum Auftrag, Statusübernahme, Benachrichtigung, lesende API-Aufrufe.
//
// Umgebung:
//   KFZ_API_WEBHOOK_SECRET  Signaturschlüssel des Webhooks (Dashboard → Webhooks) – Pflicht für den Empfang
//   KFZ_API_BASE_URL        Basisadresse aus dem Dashboard („API & Umgebungen“) – nur für lesende Aufrufe/Belege
//   KFZ_API_LOGIN           API-Benutzer (HTTP Basic) – nur für lesende Aufrufe/Belege
//   KFZ_API_PASSWORD        Passwort des API-Benutzers
//
// Hier werden keine Anträge gesendet. Die automatische Übermittlung (zuerst Außerbetriebsetzung) liegt getrennt in
// kfz-submission.ts – standardmäßig aus (KFZ_UEBERMITTLUNG). Jeder gültige Antrag über die produktiven Zugangsdaten geht
// an das KBA; die Sandbox des Partners ist ein separater Zugang mit eigenen Zugangsdaten (siehe kfz-submission.ts).

import { eventStmt, getOrder, touchStmt } from './orders.ts';
import { submissionState } from './os/submission.ts';
import { earlyStartWait, waitMessage } from '../lib/withdrawal-period.ts';
import { emitSafe } from './os/events.ts';
import { getDb, q, type Stmt } from './db.ts';
import { publicBaseUrl } from './payments.ts';
import {
  BUSINESS_TRANSACTIONS,
  DERIVED_TEXT,
  STAFF_ONLY_DERIVED,
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
    attemptOf: ev.attemptOf,
    attempt: ev.attempt,
    applicationId: ev.applicationId,
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

function recordStmt(
  eventId: string,
  outcome: WebhookOutcome,
  bodyHash: string,
  ev: KfzEvent | null,
  orderId: number | null,
  error = '',
  /** false bei manueller Nachbearbeitung – zählt nicht als erneute Zustellung */
  delivery = true,
): Stmt {
  const t = now();
  return q(
    `INSERT INTO kfz_webhook_events (event_id, received_at, last_seen_at, deliveries, outcome, order_id, kfz_order_id, external_id,
       business_transaction, status, derived_status, error, body_sha256, event_json)
     VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id) DO UPDATE SET last_seen_at = CASE WHEN ? THEN excluded.last_seen_at ELSE last_seen_at END, deliveries = deliveries + ?,
       outcome = excluded.outcome, order_id = excluded.order_id, error = excluded.error, event_json = excluded.event_json`,
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

/**
 * Zuordnung laut Spezifikation: zuerst die eigene Referenz einer automatischen Übermittlung (externalOrderId), dann der
 * Auftrag über attemptOf (nicht order.id – ein Korrekturversuch trägt eine eigene Id), zuletzt die Auftragsnummer
 * (manuell im Dashboard gestellte Anträge mit der Auftragsnummer als Referenz).
 */
async function findOrder(ev: KfzEvent): Promise<number | null> {
  const db = await getDb();
  if (ev.externalId) {
    const s = await db.first<{ order_id: number }>('SELECT order_id FROM kfz_submissions WHERE external_order_id = ?', ev.externalId);
    if (s) return s.order_id;
  }
  for (const id of [...new Set([ev.attemptOf, ev.orderId].filter((x): x is string => !!x))]) {
    const s = await db.first<{ order_id: number }>("SELECT order_id FROM kfz_submissions WHERE kfz_order_id = ? AND kfz_order_id != ''", id);
    if (s) return s.order_id;
    const r = await db.first<{ id: number }>("SELECT id FROM orders WHERE kfz_order_id = ? AND kfz_order_id != ''", id);
    if (r) return r.id;
  }
  if (ev.externalId) {
    const r = await db.first<{ id: number }>('SELECT id FROM orders WHERE number = ?', ev.externalId);
    if (r) return r.id;
  }
  return null;
}

/** Protokolliert ohne Risiko: Ein Fehler beim Speichern darf die Antwort an kfz-api.de nicht verhindern. */
async function tryRecord(eventId: string, outcome: WebhookOutcome, bodyHash: string, ev: KfzEvent | null, error = ''): Promise<void> {
  try {
    await (await getDb()).batch([recordStmt(eventId, outcome, bodyHash, ev, null, error)]);
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
  /** Übermittlung ohne interne Freigabe, ohne bestätigte QES oder als Testauftrag (externer Stand wird trotzdem protokolliert) */
  problems: string[];
  /** Automatisch gesetzte Status-Schritte des Auftrags (für Automatisierungen und Benachrichtigungen) */
  transitions: { from: StatusId; to: StatusId }[];
  /** false = keine automatische Kundenmail (intern zu klärende Ablehnungsart) */
  mail: boolean;
}

/** Liest den Auftrag und liefert alle Änderungen für ein Ereignis als Befehle (werden atomar geschrieben). */
async function planEvent(orderId: number, ev: KfzEvent): Promise<{ stmts: Stmt[]; applied: Applied } | null> {
  const db = await getDb();
  const order = await db.first<{
    status: StatusId;
    service: ServiceId;
    assigned_plate: string;
    previous_plate: string;
    kfz_display: string;
    kfz_files_json: string;
    kfz_order_id: string;
  }>('SELECT status, service, assigned_plate, previous_plate, kfz_display, kfz_files_json, kfz_order_id FROM orders WHERE id = ?', orderId);
  if (!order) return null;
  const stmts: Stmt[] = [];
  const transitions: Applied['transitions'] = [];
  // Ereignis eines älteren Versuchs (Zustellung ohne garantierte Reihenfolge, Webhooks 3.1.0): Der Stand des jüngeren
  // Versuchs (Korrektur) bleibt – sonst meldete ein verspätetes FAILED des ersten Versuchs eine laufende Korrektur als gescheitert.
  const newest = ev.attempt
    ? ((
        await db.first<{ a: number | null }>(
          "SELECT MAX(CAST(json_extract(event_json, '$.attempt') AS INTEGER)) AS a FROM kfz_webhook_events WHERE order_id = ? AND outcome = 'verarbeitet'",
          orderId,
        )
      )?.a ?? null)
    : null;
  const superseded = !!ev.attempt && !!newest && ev.attempt < newest;
  let display = superseded ? null : displayFor(ev.status, ev.derivedStatus, ev.retryable);
  // Verspätete Meldungen dürfen einen abgeschlossenen Vorgang nicht zurückstufen.
  const stale = order.kfz_display === 'abgeschlossen' && display === 'in_bearbeitung';
  if (stale) display = 'abgeschlossen';
  const mail = !(ev.derivedStatus && STAFF_ONLY_DERIVED.includes(ev.derivedStatus));

  const files: KfzFile[] = JSON.parse(order.kfz_files_json || '[]');
  for (const f of ev.files) if (!files.some((x) => x.fileAccessKey === f.fileAccessKey)) files.push(f);
  const stamp = now();
  stmts.push(
    q(
      `UPDATE orders SET kfz_order_id = ?, kfz_transaction = COALESCE(NULLIF(?, ''), kfz_transaction), kfz_status = COALESCE(?, kfz_status),
         kfz_display = COALESCE(?, kfz_display), kfz_updated_at = ?, kfz_files_json = ?,
         kfz_messages_json = CASE WHEN ? != '[]' THEN ? ELSE kfz_messages_json END, updated_at = ? WHERE id = ?`,
      ev.attemptOf ?? ev.orderId ?? order.kfz_order_id,
      ev.businessTransaction ?? '',
      stale || superseded ? null : (ev.rawStatus ?? ev.derivedStatus ?? ''),
      display,
      stamp,
      JSON.stringify(files),
      superseded ? '[]' : JSON.stringify(ev.messages),
      JSON.stringify(ev.messages),
      stamp,
      orderId,
    ),
  );

  const statusText = ev.status ? KFZ_STATUS_TEXT[ev.status] : ev.rawStatus ? `Status ${ev.rawStatus}` : `Gesamtstand ${ev.derivedStatus ?? 'unbekannt'}`;
  const msgText = ev.messages.map((m) => [m.kind, m.code, m.text, m.additional].filter(Boolean).join(': ')).join(' · ');
  const derivedText = ev.derivedStatus && !['PENDING', 'SUCCESS'].includes(ev.derivedStatus) ? ` (${DERIVED_TEXT[ev.derivedStatus]})` : '';
  stmts.push(
    eventStmt(orderId, {
      type: 'kfz',
      message: `kfz-api.de${ev.orderId ? ` (Vorgang ${ev.attemptOf && ev.attemptOf !== ev.orderId ? `${ev.attemptOf}, Versuch ${ev.orderId}` : ev.orderId})` : ''}: ${ev.rawStatus ?? ev.derivedStatus ?? '–'} – ${statusText}${derivedText}${ev.applicationId ? ` · KBA-Antrag ${ev.applicationId}` : ''}${stale ? ' (verspätete Meldung, Stand bleibt „abgeschlossen“)' : ''}${superseded ? ` (Meldung zu Versuch ${ev.attempt}, jüngerer Versuch ${newest} vorhanden – Stand bleibt)` : ''}${!mail ? ' – intern zu klären, keine automatische Kundenmail' : ''}${msgText ? ` Meldungen: ${msgText}` : ''}${ev.files.length ? ` · ${ev.files.length} Beleg(e)` : ''}`,
      publicMessage: display && !stale ? DISPLAY[display].label : '',
      actor: 'kfz-api.de',
    }),
  );

  // Zugeteiltes Kennzeichen übernehmen
  let plate = order.assigned_plate;
  const kfzPlate = normalizeKfzPlate(ev.licensePlate);
  if (kfzPlate && kfzPlate !== plate) {
    stmts.push(q('UPDATE orders SET assigned_plate = ? WHERE id = ?', kfzPlate, orderId));
    stmts.push(eventStmt(orderId, { type: 'plate', message: `Kennzeichen ${kfzPlate} laut Bescheid übernommen`, actor: 'kfz-api.de' }));
    plate = kfzPlate;
  }

  // Auftrags-Workflow nachziehen, soweit der Weg erlaubt ist
  const target = display ? WORKFLOW_TARGET[display] : undefined;
  if (target) {
    if (target === 'zugelassen' && order.service !== 'abmeldung' && !plate && order.previous_plate) {
      stmts.push(q('UPDATE orders SET assigned_plate = ? WHERE id = ?', order.previous_plate, orderId));
      plate = order.previous_plate;
    }
    const path = workflowPath(order.status, target);
    if (path && path.length && (target !== 'zugelassen' || order.service === 'abmeldung' || plate)) {
      let from = order.status;
      for (const to of path) {
        stmts.push(q('UPDATE orders SET status = ? WHERE id = ?', to, orderId));
        stmts.push(eventStmt(orderId, { type: 'status', from, to, publicMessage: STATUSES[to].publicText, message: 'Automatisch nach Meldung von kfz-api.de', actor: 'kfz-api.de' }));
        transitions.push({ from, to });
        from = to;
      }
    } else if (path === null && order.status !== target) {
      stmts.push(
        eventStmt(orderId, {
          type: 'note',
          message: `Status „${STATUSES[target].label}“ laut kfz-api.de nicht automatisch gesetzt (aktuell „${STATUSES[order.status].label}“) – bitte prüfen.`,
          actor: 'kfz-api.de',
        }),
      );
    }
  }
  // Beim Partner eingereicht, obwohl intern nicht freigegeben bzw. ohne bestätigte QES: echte Meldung bleibt protokolliert,
  // nichts wird als erfüllt markiert (Freigabe und Vollmachtsstand bleiben unverändert) – Warnung im Verlauf und im OS
  const st = await submissionState(orderId);
  const problems = st?.problems ?? [];
  if (problems.length && (!order.kfz_order_id || display !== order.kfz_display))
    stmts.push(
      eventStmt(orderId, {
        type: 'note',
        message: `WARNUNG: kfz-api.de meldet einen Vorgang (${ev.rawStatus ?? ev.derivedStatus ?? '–'}), aber ${problems.join('; ')}. Externer Stand übernommen – bitte sofort prüfen.`,
        actor: 'kfz-api.de',
      }),
    );
  stmts.push(touchStmt(orderId));
  return { stmts, applied: { display, previousDisplay: order.kfz_display, transitions, problems, mail } };
}

/**
 * Kunden-E-Mail bei einem Wechsel in eine benachrichtigungswürdige Anzeige – über das Transaktionsmail-System (Idempotenz,
 * Freigabe KUNDENMAILS, Wiederholung). Schlüssel teilen sich Behördenmeldung und OS-Status, damit nie doppelt geschrieben wird.
 * Der Eintrag in notifications bleibt als Kurzprotokoll für Kundenakte und Automatisierung erhalten.
 */
export async function notifyCustomer(orderId: number, display: DisplayStatus, eventId = ''): Promise<void> {
  const { queueStatusMail } = await import('./transactional-mail.ts');
  const map = {
    in_bearbeitung: ['antrag_eingereicht', `antrag:${orderId}`],
    angaben_erforderlich: ['unterlagen_erforderlich', `unterlagen:${orderId}:kfz:${eventId || Date.now()}`],
    abgeschlossen: ['zulassung_abgeschlossen', `zulassung:${orderId}`],
    fehlgeschlagen: ['auftrag_abgelehnt', `abgelehnt:${orderId}:kfz:${eventId || Date.now()}`],
  } as const;
  const target = map[display as keyof typeof map];
  if (!target) return;
  const r = await queueStatusMail(orderId, target[0], target[1]);
  if (!r.queued) return;
  const db = await getDb();
  const m = await db.first<{ subject: string; state: string; error: string }>('SELECT subject, state, error FROM messages WHERE id = ?', r.id);
  await db.run(
    'INSERT INTO notifications (order_id, at, topic, subject, state, error) VALUES (?, ?, ?, ?, ?, ?)',
    orderId,
    now(),
    `kfz:${display}`,
    m?.subject ?? '',
    m?.state === 'versendet' ? 'versendet' : m?.state === 'fehler' || m?.state === 'aufgegeben' ? 'fehler' : 'nicht_konfiguriert',
    m?.error ?? '',
  );
}

/**
 * Nach dem Speichern: erst die Status-E-Mail an den Kunden (falls eingerichtet), dann die OS-Ereignisse – die
 * Automatisierung „Zulassung abgeschlossen“ sieht so, ob der Kunde bereits automatisch informiert wurde.
 * Automatisch gesetzte Status-Schritte laufen als order.status durch dieselben Regeln wie manuelle.
 */
async function afterKfz(eventId: string, orderId: number, ev: KfzEvent, applied: Applied): Promise<void> {
  if (applied.problems.length)
    await emitSafe({
      type: 'order.compliance',
      orderId,
      actor: 'kfz-api.de',
      payload: { problems: applied.problems, display: applied.display ?? '', kfzOrderId: ev.orderId ?? '' },
      dedupeKey: `compliance:${orderId}:${applied.display ?? ''}:${applied.problems.join('|')}`,
    });
  await scheduleNotify(orderId, applied, eventId);
  await emitKfz(eventId, orderId, ev, applied);
  for (const t of applied.transitions) {
    await emitSafe({ type: 'order.status', orderId, actor: 'kfz-api.de', payload: { from: t.from, to: t.to, publicMessage: true, source: 'kfz-api' }, dedupeKey: `kfz:${eventId}:${t.from}->${t.to}` });
  }
}

/** Ereignis für EasyKFZ24 OS (Benachrichtigung, Automatisierung) – je Webhook-Ereignis genau einmal. */
function emitKfz(eventId: string, orderId: number, ev: KfzEvent, applied: Applied): Promise<void> {
  return emitSafe({
    type: 'kfz.status',
    orderId,
    actor: 'kfz-api.de',
    payload: { display: applied.display ?? '', previousDisplay: applied.previousDisplay, status: ev.status ?? ev.rawStatus ?? '', derived: ev.derivedStatus ?? '', eventId },
    dedupeKey: `kfz:${eventId}`,
  });
}

function emitKfzProblem(eventId: string, outcome: 'nicht_zugeordnet' | 'fehler', ev: KfzEvent | null, error: string): Promise<void> {
  return emitSafe({
    type: 'kfz.problem',
    actor: 'kfz-api.de',
    payload: { outcome, error, externalId: ev?.externalId ?? '', kfzOrderId: ev?.orderId ?? '', eventId },
    dedupeKey: `kfz:${eventId}:${outcome}`,
  });
}

/** Startet die Kunden-E-Mail (falls nötig) und liefert das Promise – für waitUntil bzw. „nach der Antwort“. */
function scheduleNotify(orderId: number, applied: Applied, eventId: string): Promise<void> | undefined {
  const d = applied.display;
  if (!d || d === applied.previousDisplay || !NOTIFY_ON.includes(d) || !applied.mail) return undefined;
  return notifyCustomer(orderId, d, eventId).catch((e) => console.error('[kfz-api] Benachrichtigung fehlgeschlagen:', (e as Error).message));
}

/**
 * Verarbeitet einen eingehenden Webhook. Reihenfolge: Größe → Signatur → JSON → Doppelt? → PING → Zuordnung → Übernahme.
 * Antworten: 2xx = angenommen (auch doppelt, PING, nicht zugeordnet); 401 = Signatur ungültig; 5xx = bitte erneut senden.
 */
export async function handleKfzWebhook(raw: string, headers: Headers): Promise<{ result: WebhookResult; after?: () => Promise<void> | undefined }> {
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
    await tryRecord(eventId, 'fehler', bodyHash, null, 'Rumpf ist kein gültiges JSON');
    return { result: { status: 400, body: { error: 'Ungültiges JSON' } } };
  }

  const ev = parseKfzEvent(json);

  // PING / Test ohne Vorgang: immer bestätigen – auch wenn das Protokoll gerade nicht geschrieben werden kann.
  if (!ev.hasOrder) {
    await tryRecord(eventId, 'ping', bodyHash, ev);
    return { result: { status: 200, body: { received: true, ping: true } } };
  }

  // Ab hier wird gespeichert. Ist der Speicher nicht erreichbar: 503, damit kfz-api.de später erneut zustellt.
  let db: Awaited<ReturnType<typeof getDb>>;
  let seen: { outcome: WebhookOutcome } | null;
  try {
    db = await getDb();
    seen = await db.first<{ outcome: WebhookOutcome }>('SELECT outcome FROM kfz_webhook_events WHERE event_id = ?', eventId);
  } catch (e) {
    console.error('[kfz-api] Datenbank nicht verfügbar – Meldung wird nicht verarbeitet:', (e as Error).message);
    return { result: { status: 503, body: { error: 'Speicher vorübergehend nicht verfügbar' } } };
  }
  if (seen && seen.outcome !== 'fehler') {
    await db.run('UPDATE kfz_webhook_events SET last_seen_at = ?, deliveries = deliveries + 1 WHERE event_id = ?', now(), eventId);
    return { result: { status: 200, body: { received: true, duplicate: true } } };
  }

  try {
    const orderId = await findOrder(ev);
    if (!orderId) {
      await db.batch([recordStmt(eventId, 'nicht_zugeordnet', bodyHash, ev, null, 'Kein Auftrag zu externalId/order.id gefunden')]);
      return { result: { status: 200, body: { received: true, matched: false } }, after: () => emitKfzProblem(eventId, 'nicht_zugeordnet', ev, 'Kein Auftrag zu externalId/order.id gefunden') };
    }
    const plan = await planEvent(orderId, ev);
    if (!plan) throw new Error('Auftrag nicht mehr vorhanden');
    await db.batch([...plan.stmts, recordStmt(eventId, 'verarbeitet', bodyHash, ev, orderId)]);
    return {
      result: { status: 200, body: { received: true } },
      after: () => afterKfz(eventId, orderId, ev, plan.applied),
    };
  } catch (e) {
    const msg = (e as Error).message;
    console.error('[kfz-api] Verarbeitung fehlgeschlagen:', msg);
    await tryRecord(eventId, 'fehler', bodyHash, ev, msg);
    return { result: { status: 500, body: { error: 'Verarbeitung fehlgeschlagen' } }, after: () => emitKfzProblem(eventId, 'fehler', ev, msg) };
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

export async function listKfzEvents(limit = 50): Promise<KfzEventRow[]> {
  return (await getDb()).all<KfzEventRow>(
    `SELECT e.event_id, e.received_at, e.last_seen_at, e.deliveries, e.outcome, e.order_id, o.number AS order_number, e.kfz_order_id,
       e.external_id, e.business_transaction, e.status, e.derived_status, e.error
     FROM kfz_webhook_events e LEFT JOIN orders o ON o.id = e.order_id ORDER BY e.received_at DESC LIMIT ?`,
    limit,
  );
}

export async function kfzEventStats(): Promise<{ total: number; problems: number; lastAt: string | null }> {
  const r = await (await getDb()).first<{ total: number; problems: number | null; lastAt: string | null }>(
    "SELECT COUNT(*) AS total, SUM(outcome IN ('fehler','nicht_zugeordnet')) AS problems, MAX(received_at) AS lastAt FROM kfz_webhook_events",
  );
  return { total: r?.total ?? 0, problems: r?.problems ?? 0, lastAt: r?.lastAt ?? null };
}

/** Nicht zugeordnetes oder fehlerhaftes Ereignis einem Auftrag zuweisen und verarbeiten. */
export async function assignKfzEvent(
  eventId: string,
  orderNumber: string,
): Promise<{ ok: true; notify?: Promise<void> } | { ok: false; error: string }> {
  const db = await getDb();
  const row = await db.first<{ event_json: string; outcome: WebhookOutcome; body_sha256: string }>(
    'SELECT event_json, outcome, body_sha256 FROM kfz_webhook_events WHERE event_id = ?',
    eventId,
  );
  if (!row) return { ok: false, error: 'Ereignis nicht gefunden' };
  if (row.outcome === 'verarbeitet' || row.outcome === 'ping') return { ok: false, error: 'Ereignis ist bereits verarbeitet' };
  const order = await db.first<{ id: number }>('SELECT id FROM orders WHERE number = ?', orderNumber.trim().toUpperCase());
  if (!order) return { ok: false, error: 'Auftragsnummer nicht gefunden' };
  const ev = parseKfzEvent(JSON.parse(row.event_json || '{}'));
  if (!ev.hasOrder) return { ok: false, error: 'Ereignis enthält keinen Vorgang' };
  const plan = await planEvent(order.id, ev);
  if (!plan) return { ok: false, error: 'Auftrag nicht gefunden' };
  await db.batch([...plan.stmts, recordStmt(eventId, 'verarbeitet', row.body_sha256, ev, order.id, '', false)]);
  return { ok: true, notify: afterKfz(eventId, order.id, ev, plan.applied) };
}

/**
 * Fehlgeschlagenes Ereignis kontrolliert erneut verarbeiten (gleiche Zuordnung wie beim Empfang).
 * Bereits verarbeitete Ereignisse werden nie ein zweites Mal angewendet.
 */
export async function retryKfzEvent(eventId: string): Promise<{ ok: true; matched: boolean; notify?: Promise<void> } | { ok: false; error: string }> {
  const db = await getDb();
  const row = await db.first<{ event_json: string; outcome: WebhookOutcome; body_sha256: string }>(
    'SELECT event_json, outcome, body_sha256 FROM kfz_webhook_events WHERE event_id = ?',
    eventId,
  );
  if (!row) return { ok: false, error: 'Ereignis nicht gefunden' };
  if (row.outcome === 'verarbeitet' || row.outcome === 'ping') return { ok: false, error: 'Ereignis ist bereits verarbeitet' };
  if (!row.event_json) return { ok: false, error: 'Ereignis ohne gespeicherten Inhalt (ungültiges JSON beim Empfang)' };
  const ev = parseKfzEvent(JSON.parse(row.event_json));
  if (!ev.hasOrder) return { ok: false, error: 'Ereignis enthält keinen Vorgang' };
  const orderId = await findOrder(ev);
  if (!orderId) {
    await db.run("UPDATE kfz_webhook_events SET outcome = 'nicht_zugeordnet', error = ?, last_seen_at = ? WHERE event_id = ?", 'Erneut versucht: kein Auftrag gefunden', now(), eventId);
    return { ok: true, matched: false };
  }
  const plan = await planEvent(orderId, ev);
  if (!plan) return { ok: false, error: 'Auftrag nicht gefunden' };
  await db.batch([...plan.stmts, recordStmt(eventId, 'verarbeitet', row.body_sha256, ev, orderId, '', false)]);
  return { ok: true, matched: true, notify: afterKfz(eventId, orderId, ev, plan.applied) };
}

/**
 * Stand aus der Vorgangsauskunft (GET …/orders/{id}) wie ein Ereignis übernehmen – für den Abgleich nach einem verlorenen
 * Webhook. Gleicher Stand ⇒ gleiche Kennung ⇒ wird nie doppelt angewendet. Kein Rohinhalt wird gespeichert.
 */
export async function applyKfzSnapshot(orderId: number, ev: KfzEvent, snapshotKey: string): Promise<{ ok: true; applied: boolean } | { ok: false; error: string }> {
  const db = await getDb();
  const eventId = `abgleich:${snapshotKey}`.slice(0, 200);
  const seen = await db.first<{ outcome: WebhookOutcome }>('SELECT outcome FROM kfz_webhook_events WHERE event_id = ?', eventId);
  if (seen && seen.outcome === 'verarbeitet') return { ok: true, applied: false };
  const plan = await planEvent(orderId, ev);
  if (!plan) return { ok: false, error: 'Auftrag nicht gefunden' };
  await db.batch([...plan.stmts, recordStmt(eventId, 'verarbeitet', sha256Hex(eventJson(ev)), ev, orderId, '', false)]);
  await afterKfz(eventId, orderId, ev, plan.applied);
  return { ok: true, applied: true };
}

/** Vorgangsnummer von kfz-api.de von Hand mit einem Auftrag verknüpfen (z. B. bei Erfassung im Dashboard). */
export async function linkKfzOrder(orderId: number, kfzOrderId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const id = kfzOrderId.trim();
  if (id && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { ok: false, error: 'Ungültige Vorgangsnummer' };
  const db = await getDb();
  if (id) {
    // Verknüpfen heißt: beim Partner eingereicht – während der Widerrufsfrist ohne verlangten Beginn gesperrt
    const o = await getOrder(orderId);
    const wait = o ? earlyStartWait(o) : null;
    if (wait) return { ok: false, error: waitMessage(wait.until) };
    // Nur nach interner Freigabe und – bei QES-Pflicht – vom Partner bestätigter Vollmacht; nie für Testaufträge
    const st = await submissionState(orderId);
    if (!st) return { ok: false, error: 'Auftrag nicht gefunden' };
    if (st.problems.length) return { ok: false, error: `Verknüpfung nicht möglich: ${st.problems.join('; ')}` };
    const other = await db.first<{ number: string }>('SELECT number FROM orders WHERE kfz_order_id = ? AND id != ?', id, orderId);
    if (other) return { ok: false, error: `Vorgang ist bereits mit ${other.number} verknüpft` };
  }
  // Manuelle Verknüpfung und automatische Übermittlung schließen sich aus (auch das Lösen einer automatisch gesetzten Verknüpfung)
  const auto = await db.first<{ state: string; external_order_id: string }>(
    "SELECT state, external_order_id FROM kfz_submissions WHERE order_id = ? AND state IN ('sendet', 'angenommen', 'ungewiss', 'konflikt') LIMIT 1",
    orderId,
  );
  if (auto) return { ok: false, error: `Automatische Übermittlung ${auto.external_order_id} (${auto.state}) – keine manuelle Verknüpfung möglich` };
  await db.batch([
    q('UPDATE orders SET kfz_order_id = ? WHERE id = ?', id, orderId),
    eventStmt(orderId, { type: 'kfz', message: id ? `Mit kfz-api.de-Vorgang ${id} verknüpft` : 'Verknüpfung mit kfz-api.de gelöst', actor: 'Admin' }),
    touchStmt(orderId),
  ]);
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

export async function getKfzOrderInfo(orderId: number): Promise<KfzOrderInfo | null> {
  const db = await getDb();
  const r = await db.first<{
    kfz_order_id: string;
    kfz_transaction: string;
    kfz_status: string;
    kfz_display: DisplayStatus | '';
    kfz_updated_at: string;
    kfz_files_json: string;
    kfz_messages_json: string;
  }>('SELECT kfz_order_id, kfz_transaction, kfz_status, kfz_display, kfz_updated_at, kfz_files_json, kfz_messages_json FROM orders WHERE id = ?', orderId);
  if (!r) return null;
  const notifications = await db.all<{ at: string; subject: string; state: string; error: string }>(
    'SELECT at, subject, state, error FROM notifications WHERE order_id = ? ORDER BY at DESC',
    orderId,
  );
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

export function apiAuth(): { base: string; header: string } | null {
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
