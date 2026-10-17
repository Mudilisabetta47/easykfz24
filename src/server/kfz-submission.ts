// Automatische Übermittlung von Anträgen an kfz-api.de – Phase 1: Außerbetriebsetzung (AB).
//
// Grundlage ist ausschließlich die offizielle Spezifikation API 2.3.0 (spec/api.yaml):
//   POST /vehicleDeregistrations/deregistrations     Antrag (kostenpflichtig, geht an das KBA, nicht rückholbar)
//   GET  /vehicleDeregistrations/orders?externalId=  eigene Aufträge exakt nach Referenz (lesend, kostenlos) – Klärung
//   GET  /vehicleDeregistrations/orders/{orderId}    Vorgangsauskunft (lesend, kostenlos) – Abgleich ohne Webhook
// Testumgebung: kfz-api.de bietet nach Partnervertrag einen separaten Sandbox-Zugang im Dashboard (eigene Zugangsdaten,
// simulierte Vorgänge ohne Behördenantrag, keine echten Webhooks – öffentliche FAQ kfz-api.de/api). Ob und wie die Sandbox die
// Außerbetriebsetzung abbildet, steht nur in der Doku nach Anmeldung; der Satz „Sie arbeiten ausschließlich in der Produktion“
// in spec/api.yaml betrifft nur die KBA-Umgebung eines eigenen KoPa-Zugangs (/gksConfigurations). Entwickelt und getestet
// wurde bisher nur gegen den lokalen Testnachbau scripts/fake-kfz-api.mjs.
//
// Sicherheit:
// - Standardmäßig AUS. KFZ_UEBERMITTLUNG=test: nur der Inhaber, nur für einen einzeln freigegebenen Auftrag, einmalig,
//   befristet. KFZ_UEBERMITTLUNG=aktiv: Mitarbeiter mit Recht „KFZ-API bearbeiten“. Beides nur mit Partnerzugang und
//   KFZ_CODES_KEY. Gesetzt werden die Schalter nur vom Inhaber im Cloudflare-Dashboard.
// - Senden nur bei interner Freigabe (alle bestehenden Prüfungen), Zahlung, keinem Testauftrag, keiner manuellen
//   Verknüpfung, vollständigen Codes und bestätigter Vorschau (Prüfsumme über genau den Rumpf, der gesendet wird).
// - Datensatz VOR dem Senden; höchstens ein laufender Versuch je Auftrag (eindeutiger Index); keine automatische Wiederholung.
//   Verlorene Antwort ⇒ „ungewiss“ ⇒ Klärung über die Auftragsliste nach Referenz; erneut gesendet wird nur mit derselben
//   Referenz und nur, wenn dort nichts liegt (binnen 15 Minuten wäre es laut Spezifikation ohnehin kein zweiter Antrag).
// - Sicherheitscodes nur verschlüsselt (secret-box.ts), nie in Antworten, Verlauf, Audit, Protokoll oder gespeichertem Rumpf;
//   gelöscht nach angenommener Übermittlung, bei Storno, oder nach CODES_DAYS Tagen.
//
// Umgebung:
//   KFZ_UEBERMITTLUNG          aus (Vorgabe) | test | aktiv
//   KFZ_CODES_KEY              Schlüssel für die Sicherheitscodes (secret-box.ts)
//   KFZ_VERTRAGSPARTNER        Vertragspartnernummer des KBA (U/B/S + 6 Ziffern) laut Dashboard „Vertragspartner“ – Pflicht,
//                              ohne sie wird nichts gesendet (ohne eigenen KoPa-Schlüssel antwortet der Partner sonst 403)
//   KFZ_UEBERMITTLUNG_EMAIL    E-Mail-Adresse im Antrag (Vorgabe: Kundenservice von EasyKFZ24, keine Kundenadresse; der
//                              Zweck des Pflichtfelds ist in der Spezifikation nicht beschrieben – beim Partner zu klären)

import { apiAuth, applyKfzSnapshot, kfzApiConfigured } from './kfz-api.ts';
import { getDb, q, type Stmt } from './db.ts';
import { eventStmt, getOrder, touchStmt, type OrderDetail } from './orders.ts';
import { emitSafe } from './os/events.ts';
import { open as openSealed, seal, secretBoxConfigured, keyId } from './secret-box.ts';
import { earlyStartWait, waitMessage } from '../lib/withdrawal-period.ts';
import { parseKfzEvent } from '../lib/kfz-api.ts';
import { PROVIDER } from '../lib/site.ts';
import type { Role } from '../lib/permissions.ts';
import { AB_COST, abExternalId, abNotices, AB_PATTERNS, buildAbRequest, checkAbCodes, type AbCodes } from '../lib/kfz-deregistration.ts';

const now = () => new Date().toISOString();
const POST_TIMEOUT_MS = 30_000;
const GET_TIMEOUT_MS = 15_000;
/** Aufbewahrung der Sicherheitscodes ohne Übermittlung */
export const CODES_DAYS = 30;
/** Höchstfrist, solange eine Übermittlung ungeklärt ist (Codes werden für die Wiederholung mit derselben Referenz gebraucht) */
export const CODES_MAX_DAYS = 90;
/** Zustände, in denen die Codes bis zur Klärung erhalten bleiben */
const HOLD_STATES = "('sendet', 'ungewiss', 'konflikt')";
/** Ein „sendet“ ohne Abschluss (abgebrochene Ausführung) gilt danach als ungewiss */
const STALE_SENDING_MS = 2 * 60_000;
/** Frühestens so lange nach dem Senden darf „nicht angelegt“ festgestellt werden */
const CLARIFY_MIN_MS = 2 * 60_000;
const PURPOSE = 'ab_codes';
const BT = 'AB';
const TEST_KEY = 'kfz_uebermittlung_testfreigabe';
const TEST_HOURS = 24;

export type SubmitMode = 'aus' | 'test' | 'aktiv';
export interface SubmitActor {
  name: string;
  role: Role;
}

export function submitMode(): SubmitMode {
  if (!kfzApiConfigured() || !secretBoxConfigured()) return 'aus';
  const v = process.env.KFZ_UEBERMITTLUNG;
  return v === 'aktiv' ? 'aktiv' : v === 'test' ? 'test' : 'aus';
}

export function submitOffReason(): string {
  if (!kfzApiConfigured()) return 'Die automatische Übermittlung ist nicht eingerichtet (kein Zugang zu kfz-api.de).';
  if (!secretBoxConfigured()) return 'Die automatische Übermittlung ist nicht eingerichtet (Schlüssel KFZ_CODES_KEY fehlt).';
  return 'Die automatische Übermittlung ist ausgeschaltet (KFZ_UEBERMITTLUNG). Der manuelle Weg über das Partner-Dashboard bleibt nutzbar.';
}

function contractPartner(): string {
  const v = (process.env.KFZ_VERTRAGSPARTNER ?? '').trim().toUpperCase();
  return AB_PATTERNS.contractPartner.test(v) ? v : '';
}
function requestEmail(): string {
  return (process.env.KFZ_UEBERMITTLUNG_EMAIL ?? '').trim() || PROVIDER.email;
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ---------- Sicherheitscodes (verschlüsselt, kurzlebig) ---------- */

interface SecretRow {
  id: number;
  order_id: number;
  ciphertext: string;
  iv: string;
  key_id: string;
  meta_json: string;
  created_by: string;
  created_at: string;
  expires_at: string;
}

const aadFor = (orderId: number) => `order:${orderId}:${PURPOSE}`;

async function liveSecret(orderId: number): Promise<SecretRow | null> {
  return (await getDb()).first<SecretRow>("SELECT * FROM order_secrets WHERE order_id = ? AND purpose = ? AND deleted_at = ''", orderId, PURPOSE);
}

export interface CodesStatus {
  present: boolean;
  plates: 1 | 2 | null;
  createdAt: string;
  createdBy: string;
  expiresAt: string;
  /** false = mit einem anderen Schlüssel verschlüsselt (Schlüsselwechsel) – neu erfassen */
  readable: boolean;
}

export async function codesStatus(orderId: number): Promise<CodesStatus> {
  const r = await liveSecret(orderId);
  if (!r) return { present: false, plates: null, createdAt: '', createdBy: '', expiresAt: '', readable: false };
  const meta = JSON.parse(r.meta_json || '{}') as { plates?: number };
  return {
    present: true,
    plates: meta.plates === 1 || meta.plates === 2 ? meta.plates : null,
    createdAt: r.created_at,
    createdBy: r.created_by,
    expiresAt: r.expires_at,
    readable: secretBoxConfigured() && r.key_id === (await keyId()),
  };
}

function deleteSecretStmt(orderId: number, reason: string): Stmt {
  return q(
    "UPDATE order_secrets SET ciphertext = '', iv = '', deleted_at = ?, delete_reason = ? WHERE order_id = ? AND purpose = ? AND deleted_at = ''",
    now(),
    reason,
    orderId,
    PURPOSE,
  );
}

/** Codes sofort löschen (Storno, Anonymisierung) – Befehl für einen gemeinsamen Schreibvorgang */
export function deleteCodesStmt(orderId: number, reason: 'storniert' | 'anonymisiert'): Stmt {
  return deleteSecretStmt(orderId, reason);
}

async function openSubmission(orderId: number): Promise<SubmissionRow | null> {
  return (await getDb()).first<SubmissionRow>(
    "SELECT * FROM kfz_submissions WHERE order_id = ? AND state IN ('sendet', 'angenommen', 'ungewiss', 'konflikt') ORDER BY id DESC LIMIT 1",
    orderId,
  );
}

/** Codes verschlüsselt speichern (ersetzt frühere). Die Werte gehen nie zurück an die Oberfläche. */
export async function saveCodes(
  orderId: number,
  input: Record<string, unknown>,
  actor: SubmitActor,
): Promise<{ ok: true; codes: CodesStatus } | { ok: false; error: string; fields?: Record<string, string> }> {
  if (submitMode() === 'aus') return { ok: false, error: submitOffReason() };
  const db = await getDb();
  const o = await db.first<{ service: string; status: string; is_test: number }>('SELECT service, status, is_test FROM orders WHERE id = ?', orderId);
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (o.service !== 'abmeldung') return { ok: false, error: 'Automatische Übermittlung derzeit nur für Abmeldungen.' };
  if (o.is_test) return { ok: false, error: 'Testauftrag – keine Übermittlung, daher keine Codes speichern.' };
  if (o.status === 'storniert') return { ok: false, error: 'Der Auftrag ist storniert.' };
  const open = await openSubmission(orderId);
  if (open)
    return { ok: false, error: `Übermittlung ${open.external_order_id} ist ${STATE_LABEL[open.state as SubmissionState]} – Codes sind nicht mehr änderbar.` };
  const c = checkAbCodes({ zb1: input.zb1, rear: input.rear, front: input.front, plates: input.plates });
  if (!c.ok) return { ok: false, error: 'Bitte die Codes prüfen', fields: Object.fromEntries(c.problems.map((p) => [p.field, p.text])) };
  const sealed = await seal(JSON.stringify(c.codes), aadFor(orderId));
  const t = now();
  const plates = c.codes.front ? 2 : 1;
  await db.batch([
    deleteSecretStmt(orderId, 'ersetzt'),
    q(
      'INSERT INTO order_secrets (order_id, purpose, ciphertext, iv, key_id, meta_json, created_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      orderId,
      PURPOSE,
      sealed.ciphertext,
      sealed.iv,
      sealed.keyId,
      JSON.stringify({ plates }),
      actor.name,
      t,
      new Date(Date.now() + CODES_DAYS * 86_400_000).toISOString(),
    ),
    eventStmt(orderId, {
      type: 'kfz',
      message: `Sicherheitscodes für die automatische Abmeldung verschlüsselt erfasst (ZB I, Plakette hinten${plates === 2 ? ' und vorne' : ''}; gelöscht spätestens nach ${CODES_DAYS} Tagen)`,
      actor: actor.name,
    }),
    touchStmt(orderId),
  ]);
  return { ok: true, codes: await codesStatus(orderId) };
}

export async function deleteCodes(orderId: number, actor: SubmitActor): Promise<{ ok: true } | { ok: false; error: string }> {
  const db = await getDb();
  const open = await openSubmission(orderId);
  if (open && open.state !== 'angenommen')
    return { ok: false, error: 'Übermittlung ist noch nicht geklärt – die Codes werden für eine Wiederholung mit derselben Referenz gebraucht.' };
  if (!(await liveSecret(orderId))) return { ok: true };
  await db.batch([
    deleteSecretStmt(orderId, 'manuell'),
    eventStmt(orderId, { type: 'kfz', message: 'Sicherheitscodes gelöscht', actor: actor.name }),
    touchStmt(orderId),
  ]);
  return { ok: true };
}

async function readCodes(orderId: number): Promise<{ codes: AbCodes; secret: SecretRow } | null> {
  const r = await liveSecret(orderId);
  if (!r || !r.ciphertext || !secretBoxConfigured() || r.key_id !== (await keyId())) return null;
  const pt = await openSealed({ ciphertext: r.ciphertext, iv: r.iv }, aadFor(orderId));
  if (!pt) return null;
  const v = JSON.parse(pt) as AbCodes;
  return { codes: { zb1: String(v.zb1), rear: String(v.rear), front: v.front ? String(v.front) : null }, secret: r };
}

/**
 * Abgelaufene Codes und Codes stornierter Aufträge löschen (zeitgesteuert). Ist eine Übermittlung noch ungeklärt (sendet,
 * ungewiss, Konflikt), bleiben die Codes über die 30 Tage hinaus erhalten – höchstens CODES_MAX_DAYS ab Erfassung; danach werden
 * sie trotzdem gelöscht und das im Verlauf vermerkt (eine Wiederholung braucht dann neu erfasste Codes).
 */
export async function purgeSecrets(): Promise<number> {
  const db = await getDb();
  const t = now();
  const hardLimit = new Date(Date.now() - CODES_MAX_DAYS * 86_400_000).toISOString();
  const forced = await db.all<{ order_id: number }>(
    `SELECT order_id FROM order_secrets WHERE deleted_at = '' AND expires_at < ? AND created_at < ?
       AND order_id IN (SELECT order_id FROM kfz_submissions WHERE state IN ${HOLD_STATES})`,
    t,
    hardLimit,
  );
  const a = await db.run(
    `UPDATE order_secrets SET ciphertext = '', iv = '', deleted_at = ?, delete_reason = 'frist' WHERE deleted_at = '' AND expires_at < ?
       AND (created_at < ? OR order_id NOT IN (SELECT order_id FROM kfz_submissions WHERE state IN ${HOLD_STATES}))`,
    t,
    t,
    hardLimit,
  );
  if (forced.length)
    await db.batch(
      forced.map((f) =>
        eventStmt(f.order_id, {
          type: 'note',
          message: `Sicherheitscodes nach Höchstfrist (${CODES_MAX_DAYS} Tage) gelöscht, obwohl die Übermittlung noch ungeklärt ist – bitte klären.`,
          actor: 'Automatisierung',
        }),
      ),
    );
  const b = await db.run(
    "UPDATE order_secrets SET ciphertext = '', iv = '', deleted_at = ?, delete_reason = 'storniert' WHERE deleted_at = '' AND order_id IN (SELECT id FROM orders WHERE status = 'storniert')",
    t,
  );
  return (a.changes ?? 0) + (b.changes ?? 0);
}

/* ---------- Übermittlungen ---------- */

export const SUBMISSION_STATES = ['sendet', 'angenommen', 'ungewiss', 'konflikt', 'abgewiesen', 'nicht_angelegt'] as const;
export type SubmissionState = (typeof SUBMISSION_STATES)[number];
export const STATE_LABEL: Record<SubmissionState, string> = {
  sendet: 'wird gesendet',
  angenommen: 'vom Partner angenommen',
  ungewiss: 'ungewiss – Antwort fehlt, Stand klären',
  konflikt: 'Konflikt – unter der Referenz liegt ein Vorgang mit anderen Angaben',
  abgewiesen: 'abgewiesen – nichts an das KBA gesendet',
  nicht_angelegt: 'laut Partner nicht angelegt',
};

export interface SubmissionRow {
  id: number;
  order_id: number;
  business_transaction: string;
  attempt: number;
  external_order_id: string;
  fingerprint: string;
  state: SubmissionState;
  kfz_order_id: string;
  http_status: number | null;
  trace_id: string;
  error: string;
  mode: string;
  request_json: string;
  confirmed_by: string;
  created_at: string;
  sent_at: string;
  resolved_at: string;
  checked_at: string;
  updated_at: string;
}

export interface SubmissionView {
  id: number;
  attempt: number;
  externalOrderId: string;
  state: SubmissionState;
  label: string;
  kfzOrderId: string;
  httpStatus: number | null;
  traceId: string;
  error: string;
  mode: string;
  confirmedBy: string;
  createdAt: string;
  sentAt: string;
  resolvedAt: string;
  checkedAt: string;
}

export function submissionView(r: SubmissionRow): SubmissionView {
  return {
    id: r.id,
    attempt: r.attempt,
    externalOrderId: r.external_order_id,
    state: r.state,
    label: STATE_LABEL[r.state] ?? r.state,
    kfzOrderId: r.kfz_order_id,
    httpStatus: r.http_status,
    traceId: r.trace_id,
    error: r.error,
    mode: r.mode,
    confirmedBy: r.confirmed_by,
    createdAt: r.created_at,
    sentAt: r.sent_at,
    resolvedAt: r.resolved_at,
    checkedAt: r.checked_at,
  };
}

export async function listSubmissions(orderId: number): Promise<SubmissionRow[]> {
  return (await getDb()).all<SubmissionRow>('SELECT * FROM kfz_submissions WHERE order_id = ? ORDER BY id DESC', orderId);
}
async function getSubmission(id: number): Promise<SubmissionRow | null> {
  return (await getDb()).first<SubmissionRow>('SELECT * FROM kfz_submissions WHERE id = ?', id);
}

/** Hängengebliebenes „sendet“ (abgebrochene Ausführung) als ungewiss markieren – nie als „nicht gesendet“ */
async function settleStale(r: SubmissionRow | null): Promise<SubmissionRow | null> {
  if (!r || r.state !== 'sendet' || !r.sent_at || Date.now() - Date.parse(r.sent_at) < STALE_SENDING_MS) return r;
  await (
    await getDb()
  ).run(
    "UPDATE kfz_submissions SET state = 'ungewiss', error = CASE WHEN error = '' THEN 'Ausführung ohne Abschluss abgebrochen' ELSE error END, updated_at = ? WHERE id = ? AND state = 'sendet'",
    now(),
    r.id,
  );
  return getSubmission(r.id);
}

/* ---------- Testfreigabe (nur Inhaber, genau ein Auftrag, einmalig, befristet) ---------- */

export interface SubmitTestRelease {
  orderId: number;
  number: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  /** Übermittlung, an die die Freigabe gebunden ist (null = noch nicht genutzt) */
  submissionId: number | null;
}

export async function getSubmitTestRelease(): Promise<SubmitTestRelease | null> {
  const row = await (await getDb()).first<{ value: string }>('SELECT value FROM settings WHERE key = ?', TEST_KEY);
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as SubmitTestRelease;
    return Number.isInteger(v.orderId) && typeof v.expiresAt === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function saveSubmitTestRelease(v: SubmitTestRelease | null, by: string): Promise<void> {
  const db = await getDb();
  if (!v) {
    await db.run('DELETE FROM settings WHERE key = ?', TEST_KEY);
    return;
  }
  await db.run(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    TEST_KEY,
    JSON.stringify(v),
    now(),
    by,
  );
}

/** Testfreigabe für genau diesen (echten) Auftrag erteilen bzw. zurückziehen – nur Inhaber, nur im Testmodus */
export async function setSubmitTestRelease(
  orderId: number,
  active: boolean,
  actor: SubmitActor,
): Promise<{ ok: true; release: SubmitTestRelease | null } | { ok: false; error: string }> {
  if (actor.role !== 'inhaber') return { ok: false, error: 'Nur der Inhaber kann eine Testfreigabe erteilen.' };
  const db = await getDb();
  const o = await db.first<{ number: string; service: string; status: string; is_test: number }>(
    'SELECT number, service, status, is_test FROM orders WHERE id = ?',
    orderId,
  );
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  const current = await getSubmitTestRelease();
  if (!active) {
    if (current?.orderId !== orderId) return { ok: true, release: null };
    await saveSubmitTestRelease(null, actor.name);
    await db.batch([eventStmt(orderId, { type: 'kfz', message: 'Testfreigabe automatische Übermittlung zurückgezogen', actor: actor.name })]);
    return { ok: true, release: null };
  }
  const mode = submitMode();
  if (mode === 'aus') return { ok: false, error: submitOffReason() };
  if (mode === 'aktiv') return { ok: false, error: 'Die automatische Übermittlung ist bereits allgemein aktiv – keine Testfreigabe nötig.' };
  // Ein Testauftrag (TEST-…) kann nie übermittelt werden – der Test braucht eine echte, bezahlte und freigegebene Abmeldung
  if (o.is_test) return { ok: false, error: 'Testaufträge werden nie übermittelt. Für den Test eine echte, bezahlte und freigegebene Abmeldung wählen.' };
  if (o.service !== 'abmeldung') return { ok: false, error: 'Automatische Übermittlung derzeit nur für Abmeldungen.' };
  if (o.status === 'storniert') return { ok: false, error: 'Der Auftrag ist storniert.' };
  const t = new Date();
  const release: SubmitTestRelease = {
    orderId,
    number: o.number,
    grantedBy: actor.name,
    grantedAt: t.toISOString(),
    expiresAt: new Date(t.getTime() + TEST_HOURS * 3_600_000).toISOString(),
    submissionId: null,
  };
  await saveSubmitTestRelease(release, actor.name);
  await db.batch([
    eventStmt(orderId, {
      type: 'kfz',
      message: `Testfreigabe automatische Übermittlung erteilt (ein kostenpflichtiger Antrag, gültig ${TEST_HOURS} Stunden)`,
      actor: actor.name,
    }),
  ]);
  return { ok: true, release };
}

async function modeAllows(orderId: number, actor: SubmitActor, reuseSubmissionId: number | null): Promise<string | null> {
  const mode = submitMode();
  if (mode === 'aus') return submitOffReason();
  if (mode === 'aktiv') return null;
  if (actor.role !== 'inhaber') return 'Testmodus: Nur der Inhaber kann einen echten Antrag übermitteln.';
  const r = await getSubmitTestRelease();
  if (!r || r.orderId !== orderId) return 'Testmodus: Für diesen Auftrag besteht keine Testfreigabe.';
  if (Date.parse(r.expiresAt) <= Date.now()) return 'Testmodus: Die Testfreigabe ist abgelaufen – bitte erneut freigeben.';
  if (r.submissionId !== null && r.submissionId !== reuseSubmissionId)
    return 'Testmodus: Die Testfreigabe ist verbraucht. Für einen weiteren kostenpflichtigen Antrag bitte erneut freigeben.';
  return null;
}

/* ---------- Vorschau und Senden ---------- */

type Prepared =
  | { kind: 'error'; error: string; reasons?: string[] }
  | { kind: 'done'; sub: SubmissionRow }
  | {
      kind: 'new';
      order: OrderDetail;
      attempt: number;
      /** Wiederholung mit derselben Referenz (vorher sicher nichts angelegt) */
      retryOf: SubmissionRow | null;
      externalOrderId: string;
      body: Record<string, unknown>;
      /** Rumpf ohne Codes – nur das wird gespeichert */
      redacted: Record<string, unknown>;
      codes: AbCodes;
      fingerprint: string;
      plate: string;
      reservePlate: boolean;
    };

function redact(body: Record<string, unknown>): Record<string, unknown> {
  const c = { ...(body.customization as Record<string, unknown>) };
  for (const k of ['vehicleRegistrationCertificateSecurityCode', 'frontLicensePlateSecurityCode', 'rearLicensePlateSecurityCode']) if (k in c) c[k] = '•••';
  return { ...body, customization: c };
}

/** Gemeinsame Prüfung für Vorschau und Senden – ruft den Partner nicht auf */
async function prepare(orderId: number, opts: { reservePlate: boolean }): Promise<Prepared> {
  const order = await getOrder(orderId);
  if (!order) return { kind: 'error', error: 'Auftrag nicht gefunden' };
  if (order.service !== 'abmeldung') return { kind: 'error', error: 'Automatische Übermittlung derzeit nur für Abmeldungen.' };
  if (order.is_test) return { kind: 'error', error: 'Testauftrag – keine Übermittlung an Partner oder Behörde.' };
  if (order.status === 'storniert') return { kind: 'error', error: 'Der Auftrag ist storniert.' };
  const db = await getDb();
  const extra = await db.first<{ released_at: string; kfz_order_id: string }>('SELECT released_at, kfz_order_id FROM orders WHERE id = ?', orderId);
  const last = await settleStale(
    await db.first<SubmissionRow>(
      'SELECT * FROM kfz_submissions WHERE order_id = ? AND business_transaction = ? ORDER BY attempt DESC, id DESC LIMIT 1',
      orderId,
      BT,
    ),
  );
  if (last?.state === 'angenommen') return { kind: 'done', sub: last };
  if (last?.state === 'sendet') return { kind: 'error', error: 'Die Übermittlung läuft gerade – bitte einen Moment warten und neu laden.' };
  if (last?.state === 'ungewiss' || last?.state === 'konflikt')
    return { kind: 'error', error: 'Erst den Stand beim Partner klären („Stand klären“) – nicht erneut senden.' };
  if (extra?.kfz_order_id)
    return { kind: 'error', error: `Bereits manuell mit kfz-api.de-Vorgang ${extra.kfz_order_id} verknüpft – keine automatische Übermittlung.` };
  if (!extra?.released_at) return { kind: 'error', error: 'Erst „Zur Übermittlung freigeben“ – die interne Freigabe ist Pflicht.' };
  if (order.payment_status !== 'bezahlt') return { kind: 'error', error: 'Erst nach bestätigter Zahlung übermitteln – der Antrag ist kostenpflichtig.' };
  const wait = earlyStartWait(order);
  if (wait) return { kind: 'error', error: waitMessage(wait.until) };
  if (!contractPartner())
    return {
      kind: 'error',
      error: 'Vertragspartnernummer fehlt (KFZ_VERTRAGSPARTNER, Nummer laut Dashboard „Vertragspartner“) – ohne eigenen KoPa-Schlüssel Pflicht.',
    };
  const read = await readCodes(orderId);
  if (!read)
    return { kind: 'error', error: 'Sicherheitscodes fehlen, sind abgelaufen oder wurden mit einem anderen Schlüssel erfasst – bitte (neu) erfassen.' };
  // Nach „abgewiesen“ (laut Spezifikation nichts angelegt) bzw. geklärtem „nicht angelegt“: dieselbe Referenz wiederverwenden
  const retryOf = last && (last.state === 'abgewiesen' || last.state === 'nicht_angelegt') ? last : null;
  const attempt = retryOf ? retryOf.attempt : (last?.attempt ?? 0) + 1;
  const externalOrderId = retryOf ? retryOf.external_order_id : abExternalId(order.number, attempt);
  const built = buildAbRequest(order.data, read.codes, {
    externalOrderId,
    email: requestEmail(),
    contractPartner: contractPartner(),
    reservePlate: opts.reservePlate,
  });
  if (!built.ok) return { kind: 'error', error: `Für die automatische Abmeldung fehlen Angaben: ${built.reasons.join('; ')}`, reasons: built.reasons };
  const redacted = redact(built.body);
  // Prüfsumme ohne Klartext der Codes (sonst ließen sich dreistellige Codes aus ihr zurückrechnen): Codes nur über ihren Datensatz
  const fingerprint = await sha256(
    JSON.stringify({ attempt, externalOrderId, retry: retryOf?.id ?? null, body: redacted, secret: read.secret.id, ct: await sha256(read.secret.ciphertext) }),
  );
  const plate = `${built.plate.city}-${built.plate.middle} ${built.plate.end}${built.plate.usageType === 'ELECTRIC' ? 'E' : built.plate.usageType === 'HISTORIC' ? 'H' : ''}`;
  return {
    kind: 'new',
    order,
    attempt,
    retryOf,
    externalOrderId,
    body: built.body,
    redacted,
    codes: read.codes,
    fingerprint,
    plate,
    reservePlate: opts.reservePlate,
  };
}

export interface SubmitPreview {
  mode: SubmitMode;
  done: SubmissionView | null;
  attempt: number;
  retrySame: boolean;
  externalOrderId: string;
  details: { label: string; value: string }[];
  costs: typeof AB_COST;
  notices: string[];
  fingerprint: string;
}

export async function previewSubmission(
  orderId: number,
  actor: SubmitActor,
  opts: { reservePlate: boolean },
): Promise<{ ok: true; preview: SubmitPreview } | { ok: false; error: string; reasons?: string[] }> {
  const p = await prepare(orderId, opts);
  if (p.kind === 'error') return { ok: false, error: p.error, reasons: p.reasons };
  const mode = submitMode();
  if (p.kind === 'done')
    return {
      ok: true,
      preview: {
        mode,
        done: submissionView(p.sub),
        attempt: p.sub.attempt,
        retrySame: false,
        externalOrderId: p.sub.external_order_id,
        details: [],
        costs: AB_COST,
        notices: ['Bereits übermittelt – es wird nichts erneut gesendet.'],
        fingerprint: '',
      },
    };
  const denied = await modeAllows(orderId, actor, p.retryOf?.id ?? null);
  if (denied) return { ok: false, error: denied };
  const c = p.body.customization as Record<string, unknown>;
  const cp = String(c.contractPartner ?? '');
  return {
    ok: true,
    preview: {
      mode,
      done: null,
      attempt: p.attempt,
      retrySame: !!p.retryOf,
      externalOrderId: p.externalOrderId,
      details: [
        { label: 'Auftrag', value: p.order.number },
        { label: 'Vorgang', value: 'Außerbetriebsetzung (AB)' },
        { label: 'Kennzeichen', value: `${p.plate} (${String((c.licensePlateNumberComponents as Record<string, string>).usageType)})` },
        { label: 'Fahrzeug (FIN)', value: String(c.vehicleIdentificationNumber) },
        {
          label: 'Sicherheitscodes',
          value: `ZB I, Plakette hinten${p.codes.front ? ' und vorne' : ' (ein Kennzeichenschild)'} – verschlüsselt erfasst, nicht angezeigt`,
        },
        { label: 'Kennzeichen reservieren', value: p.reservePlate ? 'ja (längstens zwölf Monate)' : 'nein' },
        { label: 'Vertragspartnernummer', value: cp },
        { label: 'E-Mail im Antrag', value: String(p.body.email) },
        { label: 'Referenz beim Partner', value: `${p.externalOrderId}${p.retryOf ? ' (Wiederholung, vorher nichts angelegt)' : ''}` },
      ],
      costs: AB_COST,
      notices: abNotices({ plate: p.plate, fin: String(c.vehicleIdentificationNumber), reservePlate: p.reservePlate, contractPartner: cp }),
      fingerprint: p.fingerprint,
    },
  };
}

type PartnerResponse = { kind: 'http'; status: number; json: Record<string, unknown> | null; traceId: string } | { kind: 'unreachable'; error: string };

async function call(method: 'GET' | 'POST', path: string, traceId: string, body?: unknown): Promise<PartnerResponse> {
  const auth = apiAuth();
  if (!auth) return { kind: 'unreachable', error: 'kfz-api.de ist nicht eingerichtet' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), method === 'POST' ? POST_TIMEOUT_MS : GET_TIMEOUT_MS);
  try {
    const res = await fetch(`${auth.base}${path}`, {
      method,
      headers: { Authorization: auth.header, Accept: 'application/json', 'X-Trace-Id': traceId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
      cache: 'no-store',
    });
    const text = await res.text().catch(() => '');
    let json: Record<string, unknown> | null = null;
    try {
      const v = JSON.parse(text);
      json = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { kind: 'http', status: res.status, json, traceId: res.headers.get('x-trace-id') ?? '' };
  } catch (e) {
    return {
      kind: 'unreachable',
      error: (e as Error).name === 'AbortError' ? 'Zeitüberschreitung – Antwort des Partners fehlt' : 'Partner nicht erreichbar oder Verbindung abgebrochen',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Fehlertext des Partners ohne Codes (falls er Werte zitiert) und gekürzt */
function scrub(text: string, codes: AbCodes | null): string {
  let t = text.slice(0, 400);
  if (codes) for (const v of [codes.zb1, codes.rear, codes.front]) if (v) t = t.split(v).join('•••');
  return t;
}

/** Laut Spezifikation: diese Antworten (mit Error-Rumpf) bedeuten „nichts angelegt, nichts an das KBA gesendet“ */
const DEFINITIVE_NOT_SENT = [400, 401, 403, 413, 415, 503];
const traceFor = (externalOrderId: string, n: number) => `ek-${externalOrderId}-${n}`.replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 128);

export type SubmitResult =
  | { ok: true; submission: SubmissionView; already: boolean }
  | { ok: false; error: string; code?: 'changed' | 'busy' | 'denied'; reasons?: string[]; submission?: SubmissionView };

/** Nach angenommener Übermittlung: Vorgangsnummer setzen, Codes löschen, Workflow „bei Zulassungsstelle“, Verlauf */
async function accept(sub: SubmissionRow, kfzOrderId: string, actorName: string, note: string): Promise<SubmissionRow> {
  const db = await getDb();
  const clash = await db.first<{ number: string }>(
    "SELECT number FROM orders WHERE kfz_order_id = ? AND id != ? AND kfz_order_id != ''",
    kfzOrderId,
    sub.order_id,
  );
  const t = now();
  const stmts: Stmt[] = [
    q("UPDATE kfz_submissions SET state = 'angenommen', kfz_order_id = ?, resolved_at = ?, updated_at = ? WHERE id = ?", kfzOrderId, t, t, sub.id),
    deleteSecretStmt(sub.order_id, 'uebermittelt'),
    eventStmt(sub.order_id, {
      type: 'kfz',
      message: `Abmeldung automatisch an kfz-api.de übermittelt (Vorgang ${kfzOrderId}, Referenz ${sub.external_order_id})${note ? ` – ${note}` : ''}. Sicherheitscodes gelöscht.`,
      actor: actorName,
    }),
    touchStmt(sub.order_id),
  ];
  if (clash)
    stmts.push(
      eventStmt(sub.order_id, {
        type: 'note',
        message: `WARNUNG: kfz-api.de-Vorgang ${kfzOrderId} ist bereits mit ${clash.number} verknüpft – bitte sofort prüfen.`,
        actor: 'kfz-api.de',
      }),
    );
  else stmts.push(q("UPDATE orders SET kfz_order_id = ?, kfz_transaction = 'AB', kfz_updated_at = ? WHERE id = ?", kfzOrderId, t, sub.order_id));
  await db.batch(stmts);
  // Bestehender Workflow (mit allen Prüfungen und Ereignissen): in Prüfung → bei Zulassungsstelle
  const o = await db.first<{ status: string }>('SELECT status FROM orders WHERE id = ?', sub.order_id);
  if (o?.status === 'in_pruefung') {
    const { actStatus } = await import('./os/order-actions.ts');
    const r = await actStatus(sub.order_id, 'bei_zulassungsstelle', '', `Automatisch nach Übermittlung an kfz-api.de (Vorgang ${kfzOrderId})`, {
      id: null,
      name: actorName,
    });
    if (!r.ok)
      await db.batch([
        eventStmt(sub.order_id, { type: 'note', message: `Status „bei Zulassungsstelle“ nicht automatisch gesetzt: ${r.error}`, actor: 'kfz-api.de' }),
      ]);
  }
  await emitSafe({
    type: 'order.submission',
    orderId: sub.order_id,
    actor: actorName,
    payload: { state: 'angenommen', kfzOrderId, externalOrderId: sub.external_order_id, clash: !!clash },
    dedupeKey: `submission:${sub.id}:angenommen`,
  });
  return (await getSubmission(sub.id))!;
}

/**
 * Antrag senden – nur mit bestätigter Vorschau. Kein automatisches Wiederholen: Jeder Sendevorgang ist ein ausdrücklicher
 * Klick mit Prüfsumme. Ergebnis ist immer ein gespeicherter Zustand; bei fehlender Antwort „ungewiss“.
 */
export async function submitDeregistration(orderId: number, actor: SubmitActor, opts: { reservePlate: boolean; fingerprint: string }): Promise<SubmitResult> {
  if (submitMode() === 'aus') return { ok: false, error: submitOffReason(), code: 'denied' };
  const p = await prepare(orderId, opts);
  if (p.kind === 'error') return { ok: false, error: p.error, reasons: p.reasons };
  if (p.kind === 'done') return { ok: true, submission: submissionView(p.sub), already: true };
  const denied = await modeAllows(orderId, actor, p.retryOf?.id ?? null);
  if (denied) return { ok: false, error: denied, code: 'denied' };
  if (!opts.fingerprint || opts.fingerprint !== p.fingerprint)
    return {
      ok: false,
      error: 'Die Angaben haben sich seit der Vorschau geändert oder wurden nicht bestätigt – bitte Vorschau erneut prüfen.',
      code: 'changed',
    };

  const db = await getDb();
  const t = now();
  const mode = submitMode();
  let subId: number;
  try {
    if (p.retryOf) {
      const r = await db.run(
        "UPDATE kfz_submissions SET state = 'sendet', fingerprint = ?, request_json = ?, mode = ?, confirmed_by = ?, http_status = NULL, error = '', sent_at = ?, resolved_at = '', updated_at = ? WHERE id = ? AND state IN ('abgewiesen', 'nicht_angelegt')",
        p.fingerprint,
        JSON.stringify(p.redacted),
        mode,
        actor.name,
        t,
        t,
        p.retryOf.id,
      );
      if (!r.changes) throw new Error('busy');
      subId = p.retryOf.id;
    } else {
      await db.run(
        `INSERT INTO kfz_submissions (order_id, business_transaction, attempt, external_order_id, fingerprint, state, mode, request_json, confirmed_by, created_at, sent_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'sendet', ?, ?, ?, ?, ?, ?)`,
        orderId,
        BT,
        p.attempt,
        p.externalOrderId,
        p.fingerprint,
        mode,
        JSON.stringify(p.redacted),
        actor.name,
        t,
        t,
        t,
      );
      subId = (await db.first<{ id: number }>('SELECT id FROM kfz_submissions WHERE external_order_id = ?', p.externalOrderId))!.id;
    }
  } catch {
    // Doppelklick bzw. paralleler Aufruf: der andere Aufruf sendet – hier nichts senden
    return { ok: false, error: 'Die Übermittlung läuft bereits – bitte einen Moment warten und den Stand neu laden.', code: 'busy' };
  }
  // Zwischen Prüfung und Datensatz manuell verknüpft (paralleler Klick im KFZ-API-Reiter)? Dann nichts senden.
  const linked = await db.first<{ kfz_order_id: string }>('SELECT kfz_order_id FROM orders WHERE id = ?', orderId);
  if (linked?.kfz_order_id) {
    await db.run(
      "UPDATE kfz_submissions SET state = 'abgewiesen', error = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND state = 'sendet'",
      'Nicht gesendet: Auftrag wurde parallel manuell verknüpft',
      now(),
      now(),
      subId,
    );
    return { ok: false, error: `Nicht gesendet – der Auftrag wurde parallel manuell mit Vorgang ${linked.kfz_order_id} verknüpft.`, code: 'denied' };
  }
  if (mode === 'test') {
    const r = await getSubmitTestRelease();
    if (r && r.orderId === orderId && r.submissionId === null) await saveSubmitTestRelease({ ...r, submissionId: subId }, actor.name);
  }
  await db.batch([
    eventStmt(orderId, {
      type: 'kfz',
      message: `Automatische Abmeldung wird an kfz-api.de gesendet (Referenz ${p.externalOrderId}${p.retryOf ? ', Wiederholung' : ''})`,
      actor: actor.name,
    }),
  ]);

  const res = await call('POST', '/vehicleDeregistrations/deregistrations', traceFor(p.externalOrderId, subId), p.body);
  const sub = (await getSubmission(subId))!;
  const at = now();
  if (res.kind === 'http' && res.status === 200) {
    const order = res.json?.order as { id?: unknown } | undefined;
    const id = typeof order?.id === 'number' && Number.isSafeInteger(order.id) && order.id > 0 ? String(order.id) : '';
    if (id) {
      await db.run('UPDATE kfz_submissions SET http_status = 200, trace_id = ?, updated_at = ? WHERE id = ?', res.traceId.slice(0, 128), at, subId);
      return { ok: true, submission: submissionView(await accept({ ...sub, trace_id: res.traceId }, id, actor.name, '')), already: false };
    }
  }
  let state: SubmissionState;
  let error: string;
  if (res.kind === 'unreachable') {
    state = 'ungewiss';
    error = res.error;
  } else if (res.status === 409) {
    state = 'konflikt';
    error = scrub(String(res.json?.error ?? 'HTTP 409'), p.codes);
  } else if (DEFINITIVE_NOT_SENT.includes(res.status) && res.json && typeof res.json.error === 'string') {
    state = 'abgewiesen';
    error = scrub(res.status === 401 ? 'Anmeldung abgelehnt – API-Benutzer prüfen' : res.json.error, p.codes);
  } else {
    // 500 sagt laut Spezifikation NICHT, ob etwas angelegt wurde; 2xx ohne Vorgangsnummer, Gateways, Unlesbares ebenso
    state = 'ungewiss';
    error = scrub(
      res.status === 200 ? 'Antwort ohne gültige Vorgangsnummer' : `HTTP ${res.status}${typeof res.json?.error === 'string' ? `: ${res.json.error}` : ''}`,
      p.codes,
    );
  }
  await db.batch([
    q(
      'UPDATE kfz_submissions SET state = ?, http_status = ?, trace_id = ?, error = ?, resolved_at = CASE WHEN ? THEN ? ELSE resolved_at END, updated_at = ? WHERE id = ?',
      state,
      res.kind === 'http' ? res.status : null,
      res.kind === 'http' ? res.traceId.slice(0, 128) : '',
      error,
      state === 'abgewiesen' ? 1 : 0,
      at,
      at,
      subId,
    ),
    eventStmt(orderId, { type: 'kfz', message: `Automatische Abmeldung: ${STATE_LABEL[state]} (${error.slice(0, 200)})`, actor: actor.name }),
    touchStmt(orderId),
  ]);
  await emitSafe({
    type: 'order.submission',
    orderId,
    actor: actor.name,
    payload: { state, error: error.slice(0, 160), externalOrderId: p.externalOrderId },
    dedupeKey: `submission:${subId}:${state}:${at}`,
  });
  const view = submissionView((await getSubmission(subId))!);
  const msg =
    state === 'ungewiss'
      ? `Antwort des Partners fehlt – ob der Antrag angelegt wurde, ist offen. Nicht erneut senden, sondern „Stand klären“. (${error.slice(0, 160)})`
      : state === 'konflikt'
        ? `Unter der Referenz liegt bereits ein Vorgang mit anderen Angaben – nichts geändert, nichts gesendet. Bitte „Stand klären“. (${error.slice(0, 160)})`
        : `Vom Partner abgewiesen, nichts an das KBA gesendet: ${error.slice(0, 200)}`;
  return { ok: false, error: msg, submission: view };
}

/* ---------- Klärung und Abgleich (lesend, kostenlos) ---------- */

export type ClarifyResult = { ok: true; submission: SubmissionView; found: boolean } | { ok: false; error: string; submission?: SubmissionView };

/**
 * Ungewisse bzw. strittige Übermittlung klären: GET /vehicleDeregistrations/orders?externalId=<Referenz> (exakt).
 * Genau ein Vorgang ⇒ angenommen. Keiner ⇒ „nicht angelegt“ (Wiederholung mit derselben Referenz erlaubt). Mehrere ⇒ manuell.
 */
export async function clarifySubmission(orderId: number, actor: SubmitActor): Promise<ClarifyResult> {
  const db = await getDb();
  const sub = await settleStale(
    await db.first<SubmissionRow>(
      "SELECT * FROM kfz_submissions WHERE order_id = ? AND state IN ('sendet', 'ungewiss', 'konflikt') ORDER BY id DESC LIMIT 1",
      orderId,
    ),
  );
  if (!sub) return { ok: false, error: 'Keine ungeklärte Übermittlung.' };
  if (sub.state === 'sendet') return { ok: false, error: 'Die Übermittlung läuft noch – bitte kurz warten.', submission: submissionView(sub) };
  const qs = new URLSearchParams({ externalId: sub.external_order_id, businessTransaction: BT, limit: '5' });
  const res = await call('GET', `/vehicleDeregistrations/orders?${qs}`, traceFor(sub.external_order_id, sub.id));
  const at = now();
  if (res.kind !== 'http' || res.status !== 200 || !res.json || !Array.isArray(res.json.orders)) {
    const error = res.kind === 'http' ? `Abfrage gescheitert (HTTP ${res.status})` : res.error;
    await db.run('UPDATE kfz_submissions SET checked_at = ?, updated_at = ? WHERE id = ?', at, at, sub.id);
    return { ok: false, error: `${error} – Stand weiterhin offen, nicht erneut senden.`, submission: submissionView((await getSubmission(sub.id))!) };
  }
  const hits = (res.json.orders as { order?: { id?: unknown; externalId?: unknown }; vehicleIdentificationNumber?: unknown }[]).filter(
    (o) => o?.order?.externalId === sub.external_order_id && typeof o.order.id === 'number' && Number.isSafeInteger(o.order.id),
  );
  // Ein Vorgang unter unserer Referenz, aber zu einem anderen Fahrzeug, wird nie übernommen – das klärt ein Mensch
  const fin = (await db.first<{ fin: string }>('SELECT fin FROM orders WHERE id = ?', orderId))?.fin.trim().toUpperCase() ?? '';
  const foreign = hits.filter((o) => String(o.vehicleIdentificationNumber ?? '').toUpperCase() !== fin);
  if (foreign.length) {
    await db.batch([
      q(
        'UPDATE kfz_submissions SET checked_at = ?, error = ?, updated_at = ? WHERE id = ?',
        at,
        'Vorgang unter dieser Referenz mit anderer FIN – bitte im Partner-Dashboard prüfen',
        at,
        sub.id,
      ),
      eventStmt(orderId, {
        type: 'note',
        message: `WARNUNG: Unter Referenz ${sub.external_order_id} liegt beim Partner ein Vorgang zu einer anderen FIN – nicht übernommen, bitte manuell prüfen.`,
        actor: actor.name,
      }),
    ]);
    return {
      ok: false,
      error: 'Unter dieser Referenz liegt ein Vorgang zu einem anderen Fahrzeug – nicht übernommen, bitte manuell prüfen.',
      submission: submissionView((await getSubmission(sub.id))!),
    };
  }
  if (hits.length === 1) {
    const id = String(hits[0].order!.id);
    const note =
      sub.state === 'konflikt'
        ? 'bestehender Vorgang unter derselben Referenz übernommen (409: abweichende Angaben) – Angaben im Partner-Dashboard prüfen'
        : 'nach Klärung: Vorgang beim Partner vorhanden';
    await db.run('UPDATE kfz_submissions SET checked_at = ? WHERE id = ?', at, sub.id);
    return { ok: true, submission: submissionView(await accept(sub, id, actor.name, note)), found: true };
  }
  if (hits.length > 1) {
    await db.batch([
      q(
        'UPDATE kfz_submissions SET checked_at = ?, error = ?, updated_at = ? WHERE id = ?',
        at,
        `${hits.length} Vorgänge unter dieser Referenz – bitte im Partner-Dashboard prüfen`,
        at,
        sub.id,
      ),
      eventStmt(orderId, {
        type: 'note',
        message: `WARNUNG: ${hits.length} Vorgänge unter Referenz ${sub.external_order_id} beim Partner – bitte manuell prüfen.`,
        actor: actor.name,
      }),
    ]);
    return {
      ok: false,
      error: 'Mehrere Vorgänge unter dieser Referenz – bitte im Partner-Dashboard prüfen.',
      submission: submissionView((await getSubmission(sub.id))!),
    };
  }
  if (sub.state === 'konflikt') {
    await db.run('UPDATE kfz_submissions SET checked_at = ?, updated_at = ? WHERE id = ?', at, at, sub.id);
    return {
      ok: false,
      error: 'Der Partner meldete einen Konflikt, die Liste zeigt aber keinen Vorgang – bitte im Partner-Dashboard bzw. beim Support (Trace-Id) klären.',
      submission: submissionView((await getSubmission(sub.id))!),
    };
  }
  if (sub.sent_at && Date.now() - Date.parse(sub.sent_at) < CLARIFY_MIN_MS) {
    await db.run('UPDATE kfz_submissions SET checked_at = ?, updated_at = ? WHERE id = ?', at, at, sub.id);
    return {
      ok: false,
      error: 'Noch kein Vorgang sichtbar – bitte in zwei Minuten erneut klären.',
      submission: submissionView((await getSubmission(sub.id))!),
    };
  }
  await db.batch([
    q(
      "UPDATE kfz_submissions SET state = 'nicht_angelegt', checked_at = ?, resolved_at = ?, updated_at = ? WHERE id = ? AND state = 'ungewiss'",
      at,
      at,
      at,
      sub.id,
    ),
    eventStmt(orderId, {
      type: 'kfz',
      message: `Übermittlung ${sub.external_order_id} geklärt: beim Partner kein Vorgang angelegt. Erneutes Senden nutzt dieselbe Referenz.`,
      actor: actor.name,
    }),
  ]);
  return { ok: true, submission: submissionView((await getSubmission(sub.id))!), found: false };
}

/**
 * Stand des verknüpften Vorgangs über GET /vehicleDeregistrations/orders/{id} abfragen und wie ein Webhook übernehmen
 * (nach einem verlorenen Ereignis; laut Spezifikation spätestens nach rund 31 Stunden). Ändert nichts beim Partner.
 */
export async function reconcileOrder(
  orderId: number,
): Promise<{ ok: true; applied: boolean; state: string; derivedStatus: string } | { ok: false; error: string }> {
  const db = await getDb();
  const o = await db.first<{ kfz_order_id: string }>('SELECT kfz_order_id FROM orders WHERE id = ?', orderId);
  if (!o?.kfz_order_id) return { ok: false, error: 'Kein kfz-api.de-Vorgang verknüpft.' };
  if (!/^\d{1,18}$/.test(o.kfz_order_id)) return { ok: false, error: 'Vorgangsnummer ungültig.' };
  const res = await call('GET', `/vehicleDeregistrations/orders/${o.kfz_order_id}`, `ek-abgleich-${orderId}-${Date.now()}`);
  if (res.kind !== 'http') return { ok: false, error: res.error };
  if (res.status === 404) return { ok: false, error: 'Vorgang beim Partner unbekannt (404).' };
  if (res.status !== 200 || !res.json) return { ok: false, error: `Abfrage gescheitert (HTTP ${res.status})` };
  const j = res.json;
  const ord = j.order && typeof j.order === 'object' ? (j.order as Record<string, unknown>) : {};
  const ev = parseKfzEvent({
    order: { id: ord.id, externalId: ord.externalId },
    attemptOf: j.attemptOf,
    attempt: j.attempt,
    businessTransaction: j.businessTransaction,
    // Die Auskunft führt `state` (deutsch) statt `status`; die Einordnung übernimmt derivedStatus (dieselbe Abbildung)
    status: typeof j.state === 'string' ? j.state : null,
    derivedStatus: j.derivedStatus,
    applicationId: j.applicationId,
    licensePlate: j.licensePlate,
    files: j.files,
    messages: j.messages,
    retryable: j.retryable,
  });
  const key = `${o.kfz_order_id}:${String(j.state ?? '')}:${String(j.derivedStatus ?? '')}:${String(j.updatedAt ?? '')}:${Array.isArray(j.files) ? j.files.length : 0}`;
  const r = await applyKfzSnapshot(orderId, ev, key);
  if (!r.ok) return r;
  return { ok: true, applied: r.applied, state: String(j.state ?? ''), derivedStatus: String(j.derivedStatus ?? '') };
}

/* ---------- Für die Oberfläche ---------- */

export interface SubmissionPanel {
  mode: SubmitMode;
  offReason: string;
  eligible: boolean;
  codes: CodesStatus;
  submissions: SubmissionView[];
  defaultPlates: 1 | 2;
  test: { canGrant: boolean; release: (SubmitTestRelease & { active: boolean }) | null; otherOrder: string | null };
}

export async function submissionPanel(orderId: number, role: Role): Promise<SubmissionPanel | null> {
  const o = await getOrder(orderId);
  if (!o || o.service !== 'abmeldung') return null;
  const mode = submitMode();
  const r = mode === 'test' ? await getSubmitTestRelease() : null;
  const active = !!r && Date.parse(r.expiresAt) > Date.now();
  const { defaultPlates } = await import('../lib/kfz-deregistration.ts');
  return {
    mode,
    offReason: mode === 'aus' ? submitOffReason() : '',
    eligible: !o.is_test,
    codes: await codesStatus(orderId),
    submissions: (await listSubmissions(orderId)).map(submissionView),
    defaultPlates: defaultPlates(o.data.vehicle.art),
    test: {
      canGrant: mode === 'test' && role === 'inhaber',
      release: r && r.orderId === orderId ? { ...r, active } : null,
      otherOrder: r && active && r.orderId !== orderId ? r.number : null,
    },
  };
}
