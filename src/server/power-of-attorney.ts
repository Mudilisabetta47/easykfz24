// Digitale Vollmacht (kfz-api.de / Nect): Anforderung, Zuordnung zum Auftrag, Abgleich des echten Stands.
//
// Grundsätze (laut Partner-Doku, siehe src/lib/power-of-attorney.ts):
// - Der echte Stand kommt ausschließlich aus GET /powerOfAttorneys/{processId}. Für Vollmachten gibt es kein Webhook-Ereignis,
//   deshalb gleicht EasyKFZ24 offene Vorgänge selbst ab (Rücksprung, Statusabfrage, OS, zeitgesteuerte Automatisierung).
// - Der Rücksprung-Parameter `status` ändert nie etwas; er stößt höchstens einen gedrosselten Abgleich an.
// - POST /powerOfAttorneys kostet je Vorgang und ist rechtsverbindlich: nur mit VOLLMACHT_DIGITAL=1 bzw. im ausdrücklich
//   eingeschalteten Testmodus (VOLLMACHT_TESTMODUS=1, nur Inhaber mit Testfreigabe), je Auftrag einzeln,
//   idempotent über externalOrderId (gleiche ID + offener Vorgang + gleiche Angaben → derselbe Vorgang, kein neuer).
//
// Umgebung:
//   (ohne Vollmacht-Variable)       Betriebsart AUS: keine Anforderung, nur Abgleich bereits vorhandener Vorgänge
//   VOLLMACHT_TESTMODUS=1            Testmodus: nur der Inhaber, nur für einen ausdrücklich freigegebenen Auftrag
//   VOLLMACHT_DIGITAL=1              Anforderung für alle geeigneten Aufträge (geht dem Testmodus vor)
//   VOLLMACHT_EMAIL_SENDEN=0         Link NICHT durch den Partner per E-Mail senden (Vorgabe: senden, White Label)
//   VOLLMACHT_RUECKSPRUNG_URL        im Partner-Dashboard hinterlegte Adresse (Vorgabe: <Basis>/vollmacht/abschluss)
//   VOLLMACHT_REDIRECT_SENDEN=1      redirectUrl je Vorgang mitsenden (nur gleicher Origin wie die Dashboard-Adresse)

import { apiAuth, kfzApiConfigured } from './kfz-api.ts';
import { getDb, q, type Stmt } from './db.ts';
import { eventStmt, getOrder, touchStmt } from './orders.ts';
import { earlyStartWait, waitMessage } from '../lib/withdrawal-period.ts';
import { emitSafe } from './os/events.ts';
import { publicBaseUrl } from './payments.ts';
import type { ValidatedOrder } from '../lib/order.ts';
import type { Role } from '../lib/permissions.ts';
import {
  ADMIN_LABEL,
  adminState,
  buildPoaRequest,
  isPoaStatus,
  POA_COST,
  POA_SERVICES,
  poaNotices,
  RETURN_PATH,
  safeRedirectUrl,
  sepaOption,
  type AdminState,
  type PoaStatus,
} from '../lib/power-of-attorney.ts';

const now = () => new Date().toISOString();
const TIMEOUT_MS = 15_000;
/** Mindestabstand zwischen zwei Abfragen desselben Vorgangs (Neuladen der Abschlussseite, viele Aufrufe) */
const THROTTLE_MS = 15_000;
/** Offene Vorgänge gleicht die zeitgesteuerte Automatisierung höchstens so oft ab */
const SWEEP_MS = 10 * 60_000;

export function poaCreationEnabled(): boolean {
  return process.env.VOLLMACHT_DIGITAL === '1' && kfzApiConfigured();
}

/**
 * Betriebsart – standardmäßig AUS. „test“ nur mit ausdrücklich gesetztem VOLLMACHT_TESTMODUS=1 (dann nur der vom Inhaber
 * freigegebene Auftrag, einmalig, befristet); „aktiv“ nur mit VOLLMACHT_DIGITAL=1. Beides setzt den Partner-Zugang voraus.
 */
export type PoaMode = 'aus' | 'test' | 'aktiv';
export function poaMode(): PoaMode {
  if (!kfzApiConfigured()) return 'aus';
  if (process.env.VOLLMACHT_DIGITAL === '1') return 'aktiv';
  if (process.env.VOLLMACHT_TESTMODUS === '1') return 'test';
  return 'aus';
}

/** Warum nichts angefordert werden kann (Betriebsart AUS) */
export function poaOffReason(): string {
  return kfzApiConfigured()
    ? 'Die digitale Vollmacht ist ausgeschaltet. Für einen Test VOLLMACHT_TESTMODUS=1 in Cloudflare setzen.'
    : 'Die digitale Vollmacht ist nicht eingerichtet (kein Zugang zu kfz-api.de).';
}

export interface PoaActor {
  name: string;
  role: Role;
}
export function poaReturnUrl(): string {
  return process.env.VOLLMACHT_RUECKSPRUNG_URL || `${publicBaseUrl()}${RETURN_PATH}`;
}
function requestRedirectUrl(): string | undefined {
  if (process.env.VOLLMACHT_REDIRECT_SENDEN !== '1') return undefined;
  return safeRedirectUrl(poaReturnUrl(), `${publicBaseUrl()}${RETURN_PATH}`) ?? undefined;
}

export interface PoaRecord {
  id: number;
  order_id: number;
  attempt: number;
  external_order_id: string;
  process_id: number | null;
  status: PoaStatus | '';
  ready: number;
  send_email: number;
  with_sepa: number;
  signature_url: string;
  valid_until: string;
  note: string;
  missing_json: string;
  blocking_json: string;
  failure_category: string;
  create_error: string;
  partner_updated_at: string;
  verified_at: string;
  status_changed_at: string;
  checked_at: string;
  check_error: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Für Verwaltung: ohne Signaturlink-Inhalt nach außen nur, wenn berechtigt (die Route entscheidet) */
export interface PoaView {
  id: number;
  attempt: number;
  processId: number | null;
  externalOrderId: string;
  status: PoaStatus | '';
  ready: boolean;
  state: AdminState;
  label: string;
  withSepa: boolean;
  sendEmail: boolean;
  signatureUrl: string;
  validUntil: string;
  note: string;
  missingFields: string[];
  blockingIssues: string[];
  failureCategory: string;
  createError: string;
  checkError: string;
  verifiedAt: string;
  statusChangedAt: string;
  checkedAt: string;
  createdAt: string;
  createdBy: string;
}

const parseArr = (s: string): string[] => {
  try {
    const v = JSON.parse(s || '[]');
    return Array.isArray(v) ? v.map(String).slice(0, 20) : [];
  } catch {
    return [];
  }
};

export function viewOf(r: PoaRecord): PoaView {
  const state = adminState({ status: r.status || null, ready: !!r.ready, sendEmail: !!r.send_email, note: r.note, createError: r.create_error });
  return {
    id: r.id,
    attempt: r.attempt,
    processId: r.process_id,
    externalOrderId: r.external_order_id,
    status: r.status,
    ready: !!r.ready,
    state,
    label: ADMIN_LABEL[state],
    withSepa: !!r.with_sepa,
    sendEmail: !!r.send_email,
    signatureUrl: r.signature_url,
    validUntil: r.valid_until,
    note: r.note,
    missingFields: parseArr(r.missing_json),
    blockingIssues: parseArr(r.blocking_json),
    failureCategory: r.failure_category,
    createError: r.create_error,
    checkError: r.check_error,
    verifiedAt: r.verified_at,
    statusChangedAt: r.status_changed_at,
    checkedAt: r.checked_at,
    createdAt: r.created_at,
    createdBy: r.created_by,
  };
}

export async function listPoas(orderId: number): Promise<PoaRecord[]> {
  return (await getDb()).all<PoaRecord>('SELECT * FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC', orderId);
}
export async function latestPoa(orderId: number): Promise<PoaRecord | null> {
  return (await getDb()).first<PoaRecord>('SELECT * FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC LIMIT 1', orderId);
}
export async function poaByProcessId(processId: number): Promise<PoaRecord | null> {
  return (await getDb()).first<PoaRecord>('SELECT * FROM power_of_attorneys WHERE process_id = ?', processId);
}

// ---------- Partner-Aufrufe (nur dokumentierte Endpunkte) ----------

interface PartnerProcess {
  id?: unknown;
  status?: unknown;
  signatureUrl?: unknown;
  validUntil?: unknown;
  readyForApplication?: unknown;
  missingHolderFields?: unknown;
  blockingIssues?: unknown;
  note?: unknown;
  updatedAt?: unknown;
  identificationFailure?: { category?: unknown } | null;
}
type PartnerResult =
  | { kind: 'ok'; process: PartnerProcess; traceId: string }
  | { kind: 'error'; status: number; error: string; powerOfAttorneyId: number | null; traceId: string }
  | { kind: 'unreachable'; error: string };

async function partner(method: 'GET' | 'POST', path: string, body?: unknown): Promise<PartnerResult> {
  const auth = apiAuth();
  if (!auth) return { kind: 'unreachable', error: 'kfz-api.de ist nicht eingerichtet' };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${auth.base}${path}`, {
      method,
      headers: { Authorization: auth.header, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const traceId = res.headers.get('x-trace-id') ?? '';
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok && json.powerOfAttorney && typeof json.powerOfAttorney === 'object') return { kind: 'ok', process: json.powerOfAttorney as PartnerProcess, traceId };
    const id = typeof json.powerOfAttorneyId === 'number' && Number.isSafeInteger(json.powerOfAttorneyId) ? json.powerOfAttorneyId : null;
    return { kind: 'error', status: res.status, error: String(json.error ?? `HTTP ${res.status}`).slice(0, 400), powerOfAttorneyId: id, traceId };
  } catch (e) {
    return { kind: 'unreachable', error: (e as Error).name === 'AbortError' ? 'Zeitüberschreitung beim Partner' : 'Partner nicht erreichbar' };
  } finally {
    clearTimeout(timer);
  }
}

/** Nur dokumentierte Felder übernehmen, Werte prüfen; Unbekanntes wird verworfen */
function partnerFields(p: PartnerProcess) {
  const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
  const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string').slice(0, 20) : []);
  const url = str(p.signatureUrl, 1000);
  return {
    processId: typeof p.id === 'number' && Number.isSafeInteger(p.id) && p.id > 0 ? p.id : null,
    status: isPoaStatus(p.status) ? p.status : null,
    ready: p.readyForApplication === true,
    signatureUrl: /^https:\/\//.test(url) ? url : '',
    validUntil: str(p.validUntil, 40),
    note: str(p.note, 500),
    missing: arr(p.missingHolderFields),
    blocking: arr(p.blockingIssues),
    failureCategory: str(p.identificationFailure?.category, 40),
    updatedAt: str(p.updatedAt, 40),
  };
}

// ---------- Testfreigabe (nur Inhaber, genau ein Auftrag, einmalig, befristet) ----------

const TEST_KEY = 'vollmacht_testfreigabe';
const TEST_HOURS = 24;

export interface PoaTestRelease {
  orderId: number;
  number: string;
  grantedBy: string;
  grantedAt: string;
  expiresAt: string;
  /** Versuch, an den die Freigabe gebunden ist, sobald angefordert wurde (null = noch nicht genutzt) */
  attempt: number | null;
}

export async function getTestRelease(): Promise<PoaTestRelease | null> {
  const row = await (await getDb()).first<{ value: string }>('SELECT value FROM settings WHERE key = ?', TEST_KEY);
  if (!row?.value) return null;
  try {
    const v = JSON.parse(row.value) as PoaTestRelease;
    return Number.isInteger(v.orderId) && typeof v.expiresAt === 'string' ? v : null;
  } catch {
    return null;
  }
}

async function saveTestRelease(v: PoaTestRelease | null, by: string): Promise<void> {
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

const releaseActive = (r: PoaTestRelease | null): r is PoaTestRelease => !!r && Date.parse(r.expiresAt) > Date.now();

/** Testfreigabe für genau diesen Auftrag erteilen (ersetzt eine bestehende) oder zurückziehen. Nur Inhaber, nur im Testmodus. */
export async function setTestRelease(orderId: number, active: boolean, actor: PoaActor): Promise<{ ok: true; release: PoaTestRelease | null } | { ok: false; error: string }> {
  if (actor.role !== 'inhaber') return { ok: false, error: 'Nur der Inhaber kann eine Testfreigabe erteilen.' };
  const db = await getDb();
  const order = await db.first<{ id: number; number: string; service: string; status: string; data_json: string }>('SELECT id, number, service, status, data_json FROM orders WHERE id = ?', orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const current = await getTestRelease();
  if (!active) {
    if (current?.orderId !== orderId) return { ok: true, release: null };
    await saveTestRelease(null, actor.name);
    await db.batch([eventStmt(orderId, { type: 'vollmacht', message: 'Testfreigabe digitale Vollmacht zurückgezogen', actor: actor.name })]);
    return { ok: true, release: null };
  }
  const mode = poaMode();
  if (mode === 'aus') return { ok: false, error: poaOffReason() };
  if (mode === 'aktiv') return { ok: false, error: 'Die digitale Vollmacht ist bereits für alle Aufträge freigeschaltet (VOLLMACHT_DIGITAL=1) – keine Testfreigabe nötig.' };
  if (order.status === 'storniert') return { ok: false, error: 'Der Auftrag ist storniert.' };
  if (!POA_SERVICES.includes(order.service as never)) return { ok: false, error: 'Für diese Leistung ist keine Vollmacht nötig.' };
  if ((JSON.parse(order.data_json) as ValidatedOrder).holder.typ !== 'privat') return { ok: false, error: 'Testfreigabe nur für Privatpersonen (Firmen brauchen Business Sign).' };
  const t = new Date();
  const release: PoaTestRelease = {
    orderId,
    number: order.number,
    grantedBy: actor.name,
    grantedAt: t.toISOString(),
    expiresAt: new Date(t.getTime() + TEST_HOURS * 3_600_000).toISOString(),
    attempt: null,
  };
  await saveTestRelease(release, actor.name);
  await db.batch([
    eventStmt(orderId, { type: 'vollmacht', message: `Testfreigabe digitale Vollmacht erteilt (ein kostenpflichtiger Vorgang, gültig ${TEST_HOURS} Stunden)`, actor: actor.name }),
  ]);
  return { ok: true, release };
}

/** Darf für diesen Auftrag ein neuer (kostenpflichtiger) Vorgang angelegt werden? */
async function creationAllowed(orderId: number, attempt: number, actor: PoaActor): Promise<string | null> {
  const mode = poaMode();
  if (mode === 'aus') return poaOffReason();
  if (mode === 'aktiv') return null;
  if (actor.role !== 'inhaber') return 'Testmodus: Nur der Inhaber kann eine echte Vollmacht anfordern.';
  const r = await getTestRelease();
  if (!r || r.orderId !== orderId) return 'Testmodus: Für diesen Auftrag besteht keine Testfreigabe.';
  if (!releaseActive(r)) return 'Testmodus: Die Testfreigabe ist abgelaufen – bitte erneut freigeben.';
  if (r.attempt !== null && r.attempt !== attempt)
    return `Testmodus: Die Testfreigabe galt für Versuch ${r.attempt} und ist verbraucht. Für einen weiteren kostenpflichtigen Vorgang bitte erneut freigeben.`;
  return null;
}

// ---------- Anforderung ----------

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

type Prepared =
  | { kind: 'error'; error: string; reasons?: string[] }
  | { kind: 'reuse'; rec: PoaRecord }
  | {
      kind: 'new';
      data: ValidatedOrder;
      number: string;
      attempt: number;
      retrySame: boolean;
      body: Record<string, unknown>;
      withSepa: boolean;
      sendEmail: boolean;
      fingerprint: string;
    };

/** Gemeinsame Prüfung für Vorschau und Anforderung – ruft den Partner nicht auf */
async function prepare(orderId: number, sepa: boolean): Promise<Prepared> {
  const db = await getDb();
  const order = await db.first<{ id: number; number: string; service: string; data_json: string; status: string }>(
    'SELECT id, number, service, data_json, status FROM orders WHERE id = ?',
    orderId,
  );
  if (!order) return { kind: 'error', error: 'Auftrag nicht gefunden' };
  if (order.status === 'storniert') return { kind: 'error', error: 'Der Auftrag ist storniert.' };
  if (!POA_SERVICES.includes(order.service as never)) return { kind: 'error', error: 'Für diese Leistung ist keine Vollmacht nötig.' };

  const last = await latestPoa(orderId);
  if (last && (last.status === 'offen' || last.status === 'signiert')) return { kind: 'reuse', rec: last };
  // Unklarer Anstoß (Abbruch vor der Antwort): mit derselben externalOrderId wiederholen – der Partner liefert dann denselben Vorgang
  const retrySame = !!last && last.status === '' && !last.process_id;
  const attempt = retrySame && last ? last.attempt : (last?.attempt ?? 0) + 1;

  const data = JSON.parse(order.data_json) as ValidatedOrder;
  const sendEmail = process.env.VOLLMACHT_EMAIL_SENDEN !== '0';
  const built = buildPoaRequest(data, { number: order.number, attempt, birthPlace: data.holder.geburtsort ?? '', sendEmail, redirectUrl: requestRedirectUrl(), sepa });
  if (!built.ok) return { kind: 'error', error: `Für die digitale Vollmacht fehlen Angaben: ${built.reasons.join('; ')}`, reasons: built.reasons };
  // Prüfsumme über genau die Angaben, die gesendet würden – die Bestätigung gilt nur für diesen Stand
  const fingerprint = await sha256(JSON.stringify({ attempt, retrySame, body: built.body }));
  return { kind: 'new', data, number: order.number, attempt, retrySame, body: built.body, withSepa: built.withSepa, sendEmail, fingerprint };
}

export interface PoaPreview {
  mode: PoaMode;
  /** Bestehender offener/unterschriebener Vorgang: keine neue Anforderung, keine Kosten */
  reuse: PoaView | null;
  attempt: number;
  retrySame: boolean;
  externalOrderId: string;
  details: { label: string; value: string }[];
  sepa: { available: boolean; reason: string; chosen: boolean; ibanMasked: string; accountHolder: string };
  sendEmail: boolean;
  costs: { netCents: number; grossCents: number; source: string };
  notices: string[];
  fingerprint: string;
}

/** Vorschau vor dem Anlegen: alle Angaben, Kosten und Hinweise, die bestätigt werden müssen. Ruft den Partner NICHT auf. */
export async function previewPoa(orderId: number, actor: PoaActor, opts: { sepa: boolean }): Promise<{ ok: true; preview: PoaPreview } | { ok: false; error: string; reasons?: string[] }> {
  const p = await prepare(orderId, opts.sepa);
  if (p.kind === 'error') return { ok: false, error: p.error, reasons: p.reasons };
  const mode = poaMode();
  if (p.kind === 'reuse') {
    const view = viewOf(p.rec);
    return {
      ok: true,
      preview: {
        mode,
        reuse: view,
        attempt: view.attempt,
        retrySame: false,
        externalOrderId: view.externalOrderId,
        details: [],
        sepa: { available: false, reason: '', chosen: view.withSepa, ibanMasked: '', accountHolder: '' },
        sendEmail: view.sendEmail,
        costs: { ...POA_COST, netCents: 0, grossCents: 0 },
        notices: ['Es besteht bereits ein offener oder unterschriebener Vorgang – er wird verwendet, es entstehen keine weiteren Kosten.'],
        fingerprint: '',
      },
    };
  }
  const denied = await creationAllowed(orderId, p.attempt, actor);
  if (denied) return { ok: false, error: denied };
  const h = p.data.holder;
  const principal = p.body.principal as { address: { streetName: string; houseNumber: string; addressSuffix?: string; zipCode: string; cityName: string } };
  const rep = p.body.representative as { address: { companyName: string; streetName: string; houseNumber: string; addressSuffix?: string; zipCode: string; cityName: string } };
  const fin = (p.body.vehicles as { vehicleIdentificationNumber: string }[])[0].vehicleIdentificationNumber;
  const a = principal.address;
  const s = sepaOption(p.data);
  const name = `${h.vorname} ${h.nachname}`;
  return {
    ok: true,
    preview: {
      mode,
      reuse: null,
      attempt: p.attempt,
      retrySame: p.retrySame,
      externalOrderId: String(p.body.externalOrderId),
      details: [
        { label: 'Auftrag', value: p.number },
        { label: 'Vollmachtgeber', value: name },
        { label: 'Geburtsdatum', value: h.geburtsdatum.split('-').reverse().join('.') },
        { label: 'Geburtsort', value: h.geburtsort ?? '' },
        { label: 'Anschrift', value: `${a.streetName} ${a.houseNumber}${a.addressSuffix ?? ''}, ${a.zipCode} ${a.cityName}` },
        { label: 'E-Mail', value: String(p.body.email) },
        { label: 'Fahrzeug (FIN)', value: fin },
        {
          label: 'Bevollmächtigter',
          value: `${rep.address.companyName}, ${rep.address.streetName} ${rep.address.houseNumber}${rep.address.addressSuffix ?? ''}, ${rep.address.zipCode} ${rep.address.cityName}`,
        },
        { label: 'Referenz beim Partner', value: `${String(p.body.externalOrderId)}${p.retrySame ? ' (Wiederholung desselben Anstoßes)' : ''}` },
      ],
      sepa: { available: s.available, reason: s.reason, chosen: p.withSepa, ibanMasked: s.ibanMasked, accountHolder: s.accountHolder },
      sendEmail: p.sendEmail,
      costs: { ...POA_COST },
      notices: poaNotices({ name, fin, email: String(p.body.email), sendEmail: p.sendEmail, withSepa: p.withSepa, ibanMasked: s.ibanMasked }),
      fingerprint: p.fingerprint,
    },
  };
}

export type CreateResult = { ok: true; poa: PoaView; reused: boolean } | { ok: false; error: string; code?: 'changed' | 'busy' | 'denied'; reasons?: string[]; poa?: PoaView };

/**
 * Vollmachtsvorgang anlegen – nur mit bestätigter Vorschau (Prüfsumme über die gesendeten Angaben). Besteht bereits ein
 * offener oder unterschriebener Vorgang, wird er zurückgegeben (keine weiteren Kosten). Nach abgelehnt/verfallen/fehlgeschlagen
 * entsteht ein neuer Versuch – im Testmodus nur mit neuer Testfreigabe.
 */
export async function requestPoa(orderId: number, actor: PoaActor, opts: { sepa: boolean; fingerprint: string }): Promise<CreateResult> {
  if (poaMode() === 'aus') return { ok: false, error: poaOffReason() };
  // Kostenpflichtige Leistung beim Partner: nicht während der Widerrufsfrist ohne verlangten vorzeitigen Beginn
  const order = await getOrder(orderId);
  const wait = order ? earlyStartWait(order) : null;
  if (wait) return { ok: false, error: waitMessage(wait.until), code: 'denied' };
  const p = await prepare(orderId, opts.sepa);
  if (p.kind === 'error') return { ok: false, error: p.error, reasons: p.reasons };
  if (p.kind === 'reuse') return { ok: true, poa: viewOf(p.rec), reused: true };
  const denied = await creationAllowed(orderId, p.attempt, actor);
  if (denied) return { ok: false, error: denied, code: 'denied' };
  if (!opts.fingerprint || opts.fingerprint !== p.fingerprint)
    return { ok: false, error: 'Die Angaben haben sich seit der Vorschau geändert oder wurden nicht bestätigt – bitte Vorschau erneut prüfen.', code: 'changed' };

  const db = await getDb();
  const externalOrderId = String(p.body.externalOrderId);
  const t = now();
  if (!p.retrySame) {
    try {
      await db.run(
        'INSERT INTO power_of_attorneys (order_id, attempt, external_order_id, send_email, with_sepa, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        orderId,
        p.attempt,
        externalOrderId,
        p.sendEmail ? 1 : 0,
        p.withSepa ? 1 : 0,
        actor.name,
        t,
        t,
      );
    } catch {
      // Doppelklick / paralleler Aufruf: der andere Aufruf legt den Vorgang an – hier nichts senden
      return { ok: false, error: 'Die Anforderung läuft bereits – bitte einen Moment warten und den Stand neu laden.', code: 'busy' };
    }
  }
  // Testfreigabe an genau diesen Versuch binden – ein weiterer kostenpflichtiger Versuch braucht eine neue Freigabe
  if (poaMode() === 'test') {
    const r = await getTestRelease();
    if (r && r.orderId === orderId && r.attempt === null) await saveTestRelease({ ...r, attempt: p.attempt }, actor.name);
  }
  const res = await partner('POST', '/powerOfAttorneys', p.body);
  const rec = (await db.first<PoaRecord>('SELECT * FROM power_of_attorneys WHERE external_order_id = ?', externalOrderId))!;
  const attempt = p.attempt;
  const withSepa = p.withSepa;
  const sendEmail = p.sendEmail;

  if (res.kind === 'ok') {
    const f = partnerFields(res.process);
    if (!f.processId || !f.status) {
      await db.run("UPDATE power_of_attorneys SET create_error = ?, updated_at = ? WHERE id = ?", 'Antwort des Partners ohne gültige Vorgangsnummer', now(), rec.id);
      return { ok: false, error: 'Antwort des Partners unvollständig – bitte im Partner-Dashboard prüfen.', poa: viewOf((await getPoa(rec.id))!) };
    }
    // Vorgangsnummer schon einem anderen Datensatz zugeordnet? Dann nicht doppelt verknüpfen.
    const clash = await poaByProcessId(f.processId);
    if (clash && clash.id !== rec.id) {
      await db.run('UPDATE power_of_attorneys SET create_error = ?, updated_at = ? WHERE id = ?', `Vorgang ${f.processId} ist bereits Auftrag ${clash.order_id} zugeordnet`, now(), rec.id);
      return { ok: false, error: 'Der Partner meldet einen bereits zugeordneten Vorgang – bitte prüfen.' };
    }
    const at = now();
    await db.batch([
      q(
        `UPDATE power_of_attorneys SET process_id = ?, status = ?, ready = ?, signature_url = ?, valid_until = ?, note = ?, missing_json = ?, blocking_json = ?,
           failure_category = ?, create_error = '', partner_updated_at = ?, verified_at = ?, status_changed_at = ?, checked_at = ?, check_error = '', updated_at = ? WHERE id = ?`,
        f.processId,
        f.status,
        f.ready ? 1 : 0,
        f.signatureUrl,
        f.validUntil,
        f.note,
        JSON.stringify(f.missing),
        JSON.stringify(f.blocking),
        f.failureCategory,
        f.updatedAt,
        at,
        at,
        at,
        at,
        rec.id,
      ),
      eventStmt(orderId, {
        type: 'vollmacht',
        message: `Digitale Vollmacht angefordert (Vorgang ${f.processId}, Versuch ${attempt}${withSepa ? ', mit SEPA-Mandat' : ''}${sendEmail ? ', Link per E-Mail durch Partner' : ''}) – Stand: ${f.status}`,
        actor: actor.name,
      }),
      touchStmt(orderId),
    ]);
    await emitSafe({ type: 'order.poa', orderId, actor: actor.name, payload: { processId: f.processId, status: f.status, ready: f.ready, attempt }, dedupeKey: `poa:${f.processId}:${f.status}:${f.ready ? 1 : 0}` });
    return { ok: true, poa: viewOf((await getPoa(rec.id))!), reused: false };
  }

  const error = res.kind === 'error' ? `${res.status}: ${res.error}` : res.error;
  const failedId = res.kind === 'error' ? res.powerOfAttorneyId : null;
  // Laut Doku: bei 400/502 steht der gescheiterte Vorgang als „fehlgeschlagen“ in powerOfAttorneyId; bei 409 der offene
  // Vorgang unter derselben externalOrderId (eigener, frühere Angaben) – verknüpfen, damit der Abgleich ihn erfasst.
  const linkId = failedId && !(await poaByProcessId(failedId)) ? failedId : null;
  const failedStatus = res.kind === 'error' && (res.status === 400 || res.status === 502) && linkId ? 'fehlgeschlagen' : null;
  const stmts: Stmt[] = [
    q(
      'UPDATE power_of_attorneys SET create_error = ?, process_id = COALESCE(process_id, ?), status = COALESCE(?, status), updated_at = ? WHERE id = ?',
      error.slice(0, 500),
      linkId,
      failedStatus,
      now(),
      rec.id,
    ),
    eventStmt(orderId, { type: 'vollmacht', message: `Digitale Vollmacht: Anforderung gescheitert (${error.slice(0, 200)})`, actor: actor.name }),
  ];
  await db.batch(stmts);
  await emitSafe({ type: 'order.poa', orderId, actor: actor.name, payload: { status: 'fehler', error: error.slice(0, 120), attempt }, dedupeKey: `poa-create-fail:${externalOrderId}:${Date.now()}` });
  return { ok: false, error: `Anforderung beim Partner gescheitert – ${error.slice(0, 200)}`, poa: viewOf((await getPoa(rec.id))!) };
}

async function getPoa(id: number): Promise<PoaRecord | null> {
  return (await getDb()).first<PoaRecord>('SELECT * FROM power_of_attorneys WHERE id = ?', id);
}

// ---------- Abgleich des echten Stands ----------

export type VerifyResult = { ok: true; poa: PoaView; changed: boolean; fresh: boolean } | { ok: false; error: string; poa?: PoaView };

/**
 * Stand über GET /powerOfAttorneys/{processId} holen und speichern. Gedrosselt (Neuladen, viele Aufrufe); Änderungen werden
 * im Auftragsverlauf protokolliert und gemeldet – genau einmal je Stand (Ereignis mit festem Schlüssel).
 */
export async function verifyPoa(recordId: number, opts: { force?: boolean; actor?: string } = {}): Promise<VerifyResult> {
  const rec = await getPoa(recordId);
  if (!rec) return { ok: false, error: 'Vorgang nicht gefunden' };
  if (!rec.process_id) return { ok: false, error: 'Noch keine Vorgangsnummer des Partners', poa: viewOf(rec) };
  if (!opts.force && rec.checked_at && Date.now() - Date.parse(rec.checked_at) < THROTTLE_MS) return { ok: true, poa: viewOf(rec), changed: false, fresh: false };
  const db = await getDb();
  const res = await partner('GET', `/powerOfAttorneys/${rec.process_id}`);
  const at = now();
  if (res.kind !== 'ok') {
    const error = res.kind === 'error' ? (res.status === 404 ? 'Vorgang beim Partner unbekannt (404)' : `${res.status}: ${res.error}`) : res.error;
    await db.run('UPDATE power_of_attorneys SET checked_at = ?, check_error = ?, updated_at = ? WHERE id = ?', at, error.slice(0, 300), at, rec.id);
    return { ok: false, error, poa: viewOf((await getPoa(rec.id))!) };
  }
  const f = partnerFields(res.process);
  if (!f.status || (f.processId && f.processId !== rec.process_id)) {
    await db.run('UPDATE power_of_attorneys SET checked_at = ?, check_error = ?, updated_at = ? WHERE id = ?', at, 'Antwort des Partners nicht verwertbar', at, rec.id);
    return { ok: false, error: 'Antwort des Partners nicht verwertbar', poa: viewOf((await getPoa(rec.id))!) };
  }
  const changed = f.status !== rec.status || (f.ready ? 1 : 0) !== rec.ready;
  const stmts: Stmt[] = [
    q(
      `UPDATE power_of_attorneys SET status = ?, ready = ?, signature_url = CASE WHEN ? != '' THEN ? ELSE signature_url END, valid_until = ?, note = ?, missing_json = ?,
         blocking_json = ?, failure_category = ?, partner_updated_at = ?, verified_at = ?, status_changed_at = CASE WHEN ? THEN ? ELSE status_changed_at END,
         checked_at = ?, check_error = '', updated_at = ? WHERE id = ?`,
      f.status,
      f.ready ? 1 : 0,
      f.signatureUrl,
      f.signatureUrl,
      f.validUntil,
      f.note,
      JSON.stringify(f.missing),
      JSON.stringify(f.blocking),
      f.failureCategory,
      f.updatedAt,
      at,
      changed ? 1 : 0,
      at,
      at,
      at,
      rec.id,
    ),
  ];
  if (changed) {
    const label = ADMIN_LABEL[adminState({ status: f.status, ready: f.ready, sendEmail: !!rec.send_email, note: f.note, createError: '' })];
    stmts.push(
      eventStmt(rec.order_id, {
        type: 'vollmacht',
        message: `Digitale Vollmacht (Vorgang ${rec.process_id}): ${label} – bestätigt über die Partner-Schnittstelle${f.missing.length && f.status === 'signiert' ? ` · fehlende Halterfelder: ${f.missing.join(', ')}` : ''}${f.blocking.length ? ` · ${f.blocking.join(', ')}` : ''}`,
        actor: opts.actor ?? 'kfz-api.de (Abgleich)',
      }),
      touchStmt(rec.order_id),
    );
  }
  await db.batch(stmts);
  if (changed && f.status === 'signiert' && f.ready) {
    // Kundenmail „Vollmacht bestätigt“ – nur nach über die Partner-API bestätigter, vollständiger Unterschrift
    await import('./transactional-mail.ts')
      .then((m) => m.queueStatusMail(rec.order_id, 'vollmacht_bestaetigt', `vollmacht:${rec.process_id}`))
      .catch((e: unknown) => console.error('[vollmacht] Kundenmail fehlgeschlagen:', (e as Error).message));
  }
  if (changed) {
    await emitSafe({
      type: 'order.poa',
      orderId: rec.order_id,
      actor: opts.actor ?? 'kfz-api.de (Abgleich)',
      payload: { processId: rec.process_id, status: f.status, ready: f.ready, attempt: rec.attempt },
      dedupeKey: `poa:${rec.process_id}:${f.status}:${f.ready ? 1 : 0}`,
    });
  }
  return { ok: true, poa: viewOf((await getPoa(rec.id))!), changed, fresh: true };
}

/** Offene bzw. unvollständige Vorgänge, die länger nicht abgeglichen wurden (für die zeitgesteuerte Automatisierung) */
export async function poasDue(limit = 20): Promise<{ id: number; order_id: number; process_id: number }[]> {
  const before = new Date(Date.now() - SWEEP_MS).toISOString();
  return (await getDb()).all(
    "SELECT id, order_id, process_id FROM power_of_attorneys WHERE process_id IS NOT NULL AND (status = 'offen' OR (status = 'signiert' AND ready = 0)) AND (checked_at = '' OR checked_at < ?) ORDER BY checked_at ASC LIMIT ?",
    before,
    limit,
  );
}

/**
 * Geburtsort (wie im Ausweis) am Auftrag nachtragen – Voraussetzung für die digitale Vollmacht bei Aufträgen ohne diese Angabe.
 * Nicht mehr änderbar, sobald ein offener oder unterschriebener Vorgang besteht (die unterschriebenen Angaben sind fest).
 */
export async function setBirthPlace(orderId: number, value: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const v = value.trim().replace(/\s+/g, ' ');
  if (!v || v.length > 105) return { ok: false, error: 'Bitte den Geburtsort angeben (höchstens 105 Zeichen).' };
  const db = await getDb();
  const order = await db.first<{ data_json: string }>('SELECT data_json FROM orders WHERE id = ?', orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const data = JSON.parse(order.data_json) as ValidatedOrder;
  if (data.holder.typ !== 'privat') return { ok: false, error: 'Nur bei Privatpersonen.' };
  const last = await latestPoa(orderId);
  if (last && (last.status === 'offen' || last.status === 'signiert')) return { ok: false, error: 'Es besteht bereits ein Vollmachtsvorgang – die Angaben darin sind fest.' };
  data.holder.geburtsort = v;
  await db.batch([
    q('UPDATE orders SET data_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), now(), orderId),
    eventStmt(orderId, { type: 'vollmacht', message: 'Geburtsort für die digitale Vollmacht ergänzt (Angabe wie im Ausweis)', actor }),
  ]);
  return { ok: true };
}
