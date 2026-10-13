// Online-Zahlung über Mollie (Payments API v2, ohne SDK, nur HTTPS). Siehe src/lib/mollie.ts für die dokumentierten Felder.
//
// Grundsätze:
// - Der Betrag kommt immer aus dem Auftrag in der Datenbank (orders.total_cents) – nie aus dem Browser.
// - Maßgeblich ist ausschließlich GET /v2/payments/{id}. Webhook und Rückleitung stoßen nur einen Abgleich an.
// - Beim Abgleich wird geprüft, dass Betrag, Währung, Auftragsbezug und Modus zum gespeicherten Versuch passen – sonst wird
//   nichts als bezahlt markiert, sondern gemeldet.
// - Statuswechsel werden atomar übernommen (UPDATE … WHERE status = alter Stand): doppelte Webhooks lösen nichts doppelt aus;
//   Buchungen sind über (Anbieter, Referenz, Art, Status) eindeutig.
// - Ein offener Versuch wird wiederverwendet; ein neuer Versuch entsteht nur nach fehlgeschlagen/abgebrochen/abgelaufen.
//
// Umgebung:
//   MOLLIE_API_KEY       Hauptschlüssel test_… oder live_… (Secret; wird nie ausgegeben, nur der Modus am Präfix)
//   MOLLIE_TEST_API_KEY  optionaler separater Testschlüssel test_… – für Testzahlungen, wenn der Hauptschlüssel live ist
//   ZAHLUNG_ONLINE=1     Online-Zahlung für Kunden einschalten – ohne bleibt alles wie bisher (Zahlung „offen“, manuell)
//
// Testzahlungen (OS, nur Inhaber, je Auftrag) laufen immer im Mollie-Testmodus. Ist der Hauptschlüssel live, zählt eine
// Testzahlung nie als echte Zahlung: Auftrag bleibt „offen“, keine Automatisierung, nur Buchung „TESTMODUS“.
//   MOLLIE_API_BASE     nur für Tests (Testnachbau scripts/fake-mollie.mjs); Vorgabe https://api.mollie.com/v2

import { getDb, q, type Stmt } from './db.ts';
import { eventStmt, touchStmt } from './orders.ts';
import { emitSafe } from './os/events.ts';
import {
  centsToValue,
  isMollieStatus,
  isPaymentId,
  keyMode,
  MOLLIE_OPEN,
  MOLLIE_RETRY,
  payView,
  valueToCents,
  type MollieKeyMode,
  type MollieStatus,
  type PayView,
} from '../lib/mollie.ts';

const now = () => new Date().toISOString();
const TIMEOUT_MS = 10_000;
/** Mindestabstand zwischen zwei Abfragen desselben Versuchs (Neuladen der Rückkehrseite) */
const THROTTLE_MS = 10_000;
/** Offene Versuche gleicht die Zeitsteuerung höchstens so oft ab (falls ein Webhook ausbleibt) */
const SWEEP_MS = 10 * 60_000;

export function mollieMode(): MollieKeyMode | null {
  return keyMode(process.env.MOLLIE_API_KEY);
}
/** Schlüssel für einen Modus: Testzahlungen mit dem separaten Testschlüssel bzw. einem Test-Hauptschlüssel – nie mit live */
function keyFor(mode: MollieKeyMode): string | null {
  const main = process.env.MOLLIE_API_KEY;
  const test = process.env.MOLLIE_TEST_API_KEY;
  if (mode === 'test') return keyMode(test) === 'test' ? test! : keyMode(main) === 'test' ? main! : null;
  return keyMode(main) === 'live' ? main! : null;
}
/** Testzahlungen möglich (separater Testschlüssel oder Test-Hauptschlüssel) */
export function mollieTestAvailable(): boolean {
  return keyFor('test') !== null;
}
/** Für Protokoll und Diagnose: nur Modus und Vorhandensein, nie Schlüsselwerte */
export function mollieModes(): { haupt: MollieKeyMode | null; testschluessel: boolean; online: boolean } {
  return { haupt: mollieMode(), testschluessel: keyMode(process.env.MOLLIE_TEST_API_KEY) === 'test', online: molliePaymentsEnabled() };
}
/** Online-Zahlung für Kunden: nur mit gültigem Schlüssel UND ausdrücklich ZAHLUNG_ONLINE=1 */
export function molliePaymentsEnabled(): boolean {
  return !!mollieMode() && process.env.ZAHLUNG_ONLINE === '1';
}
function apiBase(): string {
  return (process.env.MOLLIE_API_BASE || 'https://api.mollie.com/v2').replace(/\/$/, '');
}

type ApiResult =
  | { kind: 'ok'; status: number; json: Record<string, unknown>; replayed: boolean }
  | { kind: 'error'; status: number; title: string; detail: string; field: string }
  | { kind: 'unreachable'; error: string };

async function api(mode: MollieKeyMode, method: 'GET' | 'POST', path: string, body?: unknown, idempotencyKey?: string): Promise<ApiResult> {
  const key = keyFor(mode);
  if (!key) return { kind: 'unreachable', error: mode === 'test' ? 'Kein Mollie-Testschlüssel eingerichtet' : 'Mollie ist nicht eingerichtet' };
  try {
    const res = await fetch(`${apiBase()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: 'application/hal+json, application/json',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { kind: 'ok', status: res.status, json, replayed: res.headers.get('idempotent-replayed') === 'true' };
    return {
      kind: 'error',
      status: res.status,
      title: String(json.title ?? `HTTP ${res.status}`).slice(0, 120),
      detail: String(json.detail ?? '').slice(0, 300),
      field: String(json.field ?? ''),
    };
  } catch (e) {
    return { kind: 'unreachable', error: (e as Error).name === 'TimeoutError' ? 'Zeitüberschreitung bei Mollie' : 'Mollie nicht erreichbar' };
  }
}

/** Verbindungstest (Diagnose): GET /v2/methods liest nur die aktiven Zahlarten, legt nichts an */
export async function checkMollie(): Promise<{
  configured: boolean;
  mode: MollieKeyMode | null;
  online: boolean;
  ok: boolean;
  message: string;
  methods: string[];
  test: { available: boolean; separate: boolean; ok: boolean; message: string };
}> {
  const mode = mollieMode();
  const online = molliePaymentsEnabled();
  const listOf = (json: Record<string, unknown>) =>
    ((json._embedded as { methods?: { id?: unknown }[] } | undefined)?.methods ?? []).map((m) => String(m.id ?? '')).filter(Boolean).slice(0, 30);
  const msg = (r: ApiResult) => (r.kind === 'error' ? (r.status === 401 ? 'Anmeldung abgelehnt – Schlüssel prüfen' : `Antwort ${r.status}: ${r.title}`) : r.kind === 'unreachable' ? r.error : '');
  // Testschlüssel getrennt prüfen (nur wenn ein separater hinterlegt ist; sonst gilt der Test-Hauptschlüssel)
  const separate = keyMode(process.env.MOLLIE_TEST_API_KEY) === 'test';
  let test = { available: mollieTestAvailable(), separate, ok: false, message: separate || mode === 'test' ? '' : 'kein Testschlüssel' };
  if (separate) {
    const t = await api('test', 'GET', '/methods');
    test = { ...test, ok: t.kind === 'ok', message: t.kind === 'ok' ? 'Testschlüssel in Ordnung' : msg(t) };
  } else if (process.env.MOLLIE_TEST_API_KEY) test = { ...test, message: 'MOLLIE_TEST_API_KEY ist kein Testschlüssel (test_…) – wird nicht verwendet' };
  if (!process.env.MOLLIE_API_KEY) return { configured: false, mode, online, ok: false, message: 'MOLLIE_API_KEY fehlt', methods: [], test };
  if (!mode) return { configured: true, mode, online, ok: false, message: 'MOLLIE_API_KEY hat kein gültiges Format (test_… oder live_…)', methods: [], test };
  const r = await api(mode, 'GET', '/methods');
  if (mode === 'test' && !separate) test = { ...test, ok: r.kind === 'ok', message: r.kind === 'ok' ? 'Hauptschlüssel ist ein Testschlüssel' : msg(r) };
  if (r.kind === 'ok') return { configured: true, mode, online, ok: true, message: `Verbindung in Ordnung (${mode === 'test' ? 'Testmodus' : 'Live'})`, methods: listOf(r.json), test };
  return { configured: true, mode, online, ok: false, message: msg(r), methods: [], test };
}

let methodsCache: { at: number; ids: string[] } | null = null;
/** Aktive Zahlarten für die Logos auf der Bezahlseite (1 Stunde zwischengespeichert; bei Fehlern leer) */
export async function mollieMethodIds(): Promise<string[]> {
  const mode = mollieMode();
  if (!molliePaymentsEnabled() || !mode) return [];
  if (methodsCache && Date.now() - methodsCache.at < 3_600_000) return methodsCache.ids;
  const r = await api(mode, 'GET', '/methods');
  const ids =
    r.kind === 'ok' ? ((r.json._embedded as { methods?: { id?: unknown }[] } | undefined)?.methods ?? []).map((m) => String(m.id ?? '')).filter(Boolean) : [];
  if (r.kind === 'ok') methodsCache = { at: Date.now(), ids };
  return ids;
}

// ---------- Datensätze ----------

export interface AttemptRecord {
  id: number;
  order_id: number;
  attempt: number;
  provider: string;
  provider_id: string | null;
  idempotency_key: string;
  mode: string;
  amount_cents: number;
  status: MollieStatus | '';
  checkout_url: string;
  method: string;
  expires_at: string;
  paid_at: string;
  refunded_cents: number;
  charged_back_cents: number;
  mismatch: string;
  create_error: string;
  checked_at: string;
  check_error: string;
  created_at: string;
  updated_at: string;
}

export interface AttemptView {
  id: number;
  attempt: number;
  paymentId: string | null;
  mode: string;
  amountCents: number;
  status: MollieStatus | '';
  view: PayView;
  method: string;
  paidAt: string;
  refundedCents: number;
  chargedBackCents: number;
  mismatch: string;
  createError: string;
  checkError: string;
  checkedAt: string;
  createdAt: string;
}

export function attemptView(r: AttemptRecord): AttemptView {
  return {
    id: r.id,
    attempt: r.attempt,
    paymentId: r.provider_id,
    mode: r.mode,
    amountCents: r.amount_cents,
    status: r.status,
    view: payView(r.status),
    method: r.method,
    paidAt: r.paid_at,
    refundedCents: r.refunded_cents,
    chargedBackCents: r.charged_back_cents,
    mismatch: r.mismatch,
    createError: r.create_error,
    checkError: r.check_error,
    checkedAt: r.checked_at,
    createdAt: r.created_at,
  };
}

export async function listAttempts(orderId: number): Promise<AttemptRecord[]> {
  return (await getDb()).all<AttemptRecord>('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt DESC', orderId);
}
async function latestAttempt(orderId: number): Promise<AttemptRecord | null> {
  return (await getDb()).first<AttemptRecord>('SELECT * FROM payment_attempts WHERE order_id = ? ORDER BY attempt DESC LIMIT 1', orderId);
}
async function getAttempt(id: number): Promise<AttemptRecord | null> {
  return (await getDb()).first<AttemptRecord>('SELECT * FROM payment_attempts WHERE id = ?', id);
}
export async function attemptByPaymentId(paymentId: string): Promise<AttemptRecord | null> {
  return (await getDb()).first<AttemptRecord>('SELECT * FROM payment_attempts WHERE provider_id = ?', paymentId);
}

interface OrderForPay {
  id: number;
  number: string;
  status: string;
  total_cents: number;
  payment_status: string;
  payment_token: string;
}
async function orderForPay(orderId: number): Promise<OrderForPay | null> {
  return (await getDb()).first<OrderForPay>('SELECT id, number, status, total_cents, payment_status, payment_token FROM orders WHERE id = ?', orderId);
}

/** Webhook nur an öffentlich erreichbare HTTPS-Adressen (Mollie erreicht kein localhost) */
function webhookUrlFor(base: string): string | undefined {
  try {
    const u = new URL(base);
    if (u.protocol !== 'https:' || /^(localhost|127\.|\[::1\]|0\.0\.0\.0)/.test(u.hostname) || u.hostname.endsWith('.localhost')) return undefined;
    return `${u.origin}/api/zahlung/mollie`;
  } catch {
    return undefined;
  }
}

// ---------- Zahlung starten ----------

export type StartResult = { ok: true; checkoutUrl: string; reused: boolean } | { ok: false; error: string; paid?: boolean };

/**
 * Bezahlung für einen Auftrag starten oder fortsetzen. Betrag aus der Datenbank; offener Versuch → derselbe Checkout;
 * unklarer Anstoß (Antwort verloren) → derselbe Idempotency-Key, Mollie liefert dieselbe Zahlung.
 */
export async function startMolliePayment(orderId: number, base: string, opts: { test?: boolean } = {}): Promise<StartResult> {
  // Kunden: nur mit ZAHLUNG_ONLINE=1 und dem Hauptschlüssel. Testzahlung (OS, Inhaber): immer Mollie-Testmodus.
  const mode: MollieKeyMode | null = opts.test ? (mollieTestAvailable() ? 'test' : null) : molliePaymentsEnabled() ? mollieMode() : null;
  if (!mode) return { ok: false, error: opts.test ? 'Kein Mollie-Testschlüssel eingerichtet (MOLLIE_TEST_API_KEY).' : 'Die Online-Zahlung ist nicht freigeschaltet.' };
  const db = await getDb();
  const order = await orderForPay(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (order.status === 'storniert') return { ok: false, error: 'Der Auftrag ist storniert.' };
  if (order.payment_status !== 'offen') return { ok: false, error: 'Der Auftrag ist bereits bezahlt.', paid: true };
  if (!Number.isSafeInteger(order.total_cents) || order.total_cents <= 0) return { ok: false, error: 'Für diesen Auftrag ist kein Betrag offen.' };

  let last = await latestAttempt(orderId);
  // Offener Versuch: erst den echten Stand holen, dann ggf. weiterverwenden
  if (last?.provider_id && (last.status === '' || MOLLIE_OPEN.includes(last.status as MollieStatus))) {
    if (last.mode !== mode) return { ok: false, error: mode === 'test' ? 'Es läuft bereits eine echte Zahlung – keine Testzahlung möglich.' : 'Es läuft noch eine Testzahlung – bitte abschließen lassen.' };
    await reconcileAttempt(last.id, { force: true });
    last = (await getAttempt(last.id))!;
    if (last.status === 'paid') return { ok: false, error: 'Der Auftrag ist bereits bezahlt.', paid: true };
    if (last.status === 'open' && last.checkout_url && last.amount_cents === order.total_cents)
      return { ok: true, checkoutUrl: last.checkout_url, reused: true };
    if (last.status === 'pending' || last.status === 'authorized')
      return { ok: false, error: 'Ihre Zahlung wird gerade bestätigt. Bitte einen Moment warten.' };
  }
  const retrySame =
    !!last && !last.provider_id && last.mode === mode && last.amount_cents === order.total_cents && Date.now() - Date.parse(last.created_at) < 50 * 60_000;
  const attempt = retrySame && last ? last.attempt : (last?.attempt ?? 0) + 1;
  let rec: AttemptRecord;
  if (retrySame && last) rec = last;
  else {
    const t = now();
    try {
      await db.run(
        'INSERT INTO payment_attempts (order_id, attempt, provider, idempotency_key, mode, amount_cents, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        orderId,
        attempt,
        'mollie',
        `${order.number}-Z${attempt}-${crypto.randomUUID()}`,
        mode,
        order.total_cents,
        t,
        t,
      );
    } catch {
      return { ok: false, error: 'Die Zahlung wird gerade vorbereitet – bitte einen Moment warten.' };
    }
    rec = (await db.first<AttemptRecord>('SELECT * FROM payment_attempts WHERE order_id = ? AND attempt = ?', orderId, attempt))!;
  }

  const origin = new URL(base).origin;
  const body = {
    amount: { currency: 'EUR', value: centsToValue(rec.amount_cents) },
    description: `EasyKFZ24 Auftrag ${order.number}`,
    redirectUrl: `${origin}/zahlung/${order.number}?t=${encodeURIComponent(order.payment_token)}&rueckkehr=1`,
    ...(webhookUrlFor(base) ? { webhookUrl: webhookUrlFor(base) } : {}),
    locale: 'de_DE',
    metadata: { order: order.number, attempt },
  };
  const r = await api(mode, 'POST', '/payments', body, rec.idempotency_key);
  if (r.kind !== 'ok') {
    const error = r.kind === 'error' ? `${r.status} ${r.title}${r.field ? ` (${r.field})` : ''}${r.detail ? `: ${r.detail}` : ''}` : r.error;
    await db.run('UPDATE payment_attempts SET create_error = ?, updated_at = ? WHERE id = ?', error.slice(0, 400), now(), rec.id);
    console.error('[zahlung] Mollie: Anlage fehlgeschlagen', r.kind === 'error' ? r.status : r.error);
    return { ok: false, error: 'Die Bezahlseite konnte gerade nicht geöffnet werden. Bitte später erneut versuchen.' };
  }
  const p = r.json;
  const id = p.id;
  const href = String(((p._links as { checkout?: { href?: unknown } } | undefined)?.checkout?.href as string | undefined) ?? '');
  const cents = valueToCents((p.amount as { value?: unknown } | undefined)?.value);
  if (!isPaymentId(id) || !/^https:\/\//.test(href) || cents !== rec.amount_cents || p.mode !== mode || !isMollieStatus(p.status)) {
    await db.run('UPDATE payment_attempts SET create_error = ?, updated_at = ? WHERE id = ?', 'Antwort von Mollie nicht verwertbar', now(), rec.id);
    return { ok: false, error: 'Die Bezahlseite konnte gerade nicht geöffnet werden. Bitte später erneut versuchen.' };
  }
  const clash = await attemptByPaymentId(id);
  if (clash && clash.id !== rec.id) return { ok: false, error: 'Zahlung bereits zugeordnet – bitte erneut versuchen.' };
  const t = now();
  await db.batch([
    q(
      "UPDATE payment_attempts SET provider_id = ?, mode = ?, status = ?, checkout_url = ?, expires_at = ?, create_error = '', checked_at = ?, updated_at = ? WHERE id = ?",
      id,
      mode,
      p.status,
      href,
      String(p.expiresAt ?? '').slice(0, 40),
      t,
      t,
      rec.id,
    ),
    eventStmt(orderId, {
      type: 'payment',
      message: `${opts.test ? 'Testzahlung' : 'Online-Zahlung'} gestartet (Mollie ${id}, Versuch ${attempt}, ${centsToValue(rec.amount_cents)} €${mode === 'test' ? ', TESTMODUS – kein echtes Geld' : ''})`,
      actor: opts.test ? 'Inhaber (Testzahlung)' : 'Kunde',
    }),
  ]);
  return { ok: true, checkoutUrl: href, reused: r.replayed };
}

// ---------- Abgleich (Webhook, Rückleitung, OS, Zeitsteuerung) ----------

export type ReconcileResult = { ok: true; attempt: AttemptView; changed: boolean } | { ok: false; error: string; retry: boolean; attempt?: AttemptView };

/**
 * Echten Stand über GET /v2/payments/{id} holen und übernehmen. Nur hier wird ein Auftrag als bezahlt markiert –
 * und nur, wenn Betrag, Währung, Auftrag und Modus zum gespeicherten Versuch passen.
 */
export async function reconcileAttempt(attemptId: number, opts: { force?: boolean; actor?: string } = {}): Promise<ReconcileResult> {
  const db = await getDb();
  const rec = await getAttempt(attemptId);
  if (!rec) return { ok: false, error: 'Zahlungsversuch nicht gefunden', retry: false };
  if (!rec.provider_id) return { ok: false, error: 'Noch keine Zahlungs-ID von Mollie', retry: false, attempt: attemptView(rec) };
  if (!opts.force && rec.checked_at && Date.now() - Date.parse(rec.checked_at) < THROTTLE_MS) return { ok: true, attempt: attemptView(rec), changed: false };
  const order = await orderForPay(rec.order_id);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden', retry: false };

  const r = await api(rec.mode === 'live' ? 'live' : 'test', 'GET', `/payments/${encodeURIComponent(rec.provider_id)}`);
  const at = now();
  if (r.kind !== 'ok') {
    const error = r.kind === 'error' ? `${r.status} ${r.title}` : r.error;
    await db.run('UPDATE payment_attempts SET checked_at = ?, check_error = ?, updated_at = ? WHERE id = ?', at, error.slice(0, 300), at, rec.id);
    // 5xx/429/Zeitüberschreitung: später erneut (Webhook antwortet dann mit 503 → Mollie wiederholt)
    const retry = r.kind === 'unreachable' || r.status >= 500 || r.status === 429;
    return { ok: false, error, retry, attempt: attemptView((await getAttempt(rec.id))!) };
  }
  const p = r.json;
  const status = isMollieStatus(p.status) ? p.status : null;
  if (!status || p.id !== rec.provider_id) {
    await db.run(
      'UPDATE payment_attempts SET checked_at = ?, check_error = ?, updated_at = ? WHERE id = ?',
      at,
      'Antwort von Mollie nicht verwertbar',
      at,
      rec.id,
    );
    return { ok: false, error: 'Antwort von Mollie nicht verwertbar', retry: true };
  }
  const amount = p.amount as { currency?: unknown; value?: unknown } | undefined;
  const cents = valueToCents(amount?.value);
  const meta = (p.metadata ?? {}) as { order?: unknown };
  const problems: string[] = [];
  if (amount?.currency !== 'EUR' || cents !== rec.amount_cents)
    problems.push(`Betrag ${String(amount?.value ?? '?')} ${String(amount?.currency ?? '')} statt ${centsToValue(rec.amount_cents)} EUR`);
  if (rec.amount_cents !== order.total_cents) problems.push('Auftragsbetrag wurde nach dem Zahlungsstart geändert');
  if (meta.order !== order.number) problems.push('Zahlung gehört laut Mollie zu einem anderen Auftrag');
  if (p.mode !== rec.mode) problems.push('Modus (Test/Live) passt nicht');
  const mismatch = problems.join('; ');
  const refunded = valueToCents((p.amountRefunded as { value?: unknown } | undefined)?.value) ?? 0;
  const chargedBack = valueToCents((p.amountChargedBack as { value?: unknown } | undefined)?.value) ?? 0;
  const method = typeof p.method === 'string' ? p.method.slice(0, 40) : '';
  const paidAt = typeof p.paidAt === 'string' ? p.paidAt.slice(0, 40) : '';
  const href = String(((p._links as { checkout?: { href?: unknown } } | undefined)?.checkout?.href as string | undefined) ?? '');

  // Atomar: nur der Aufruf, der den alten Stand noch vorfindet, löst Folgen aus (doppelte Webhooks, Rückleitung, Zeitsteuerung)
  const upd = await db.run(
    `UPDATE payment_attempts SET status = ?, method = ?, paid_at = ?, checkout_url = CASE WHEN ? != '' THEN ? ELSE checkout_url END, mismatch = ?,
       checked_at = ?, check_error = '', updated_at = ? WHERE id = ? AND status = ?`,
    status,
    method,
    paidAt,
    href,
    href,
    mismatch,
    at,
    at,
    rec.id,
    rec.status,
  );
  const statusChanged = upd.changes > 0 && status !== rec.status;
  const actor = opts.actor ?? 'Mollie';
  const testNote = rec.mode === 'test' ? 'TESTMODUS' : '';
  // Testzahlung bei Live-Hauptschlüssel: nie eine echte Zahlung – Auftrag bleibt offen, keine Automatisierung
  const testOnly = rec.mode === 'test' && mollieMode() !== 'test';
  const stmts: Stmt[] = [];
  const after: (() => Promise<void>)[] = [];

  if (statusChanged) {
    if (status === 'paid' && mismatch) {
      stmts.push(
        eventStmt(rec.order_id, {
          type: 'payment',
          message: `Mollie meldet Zahlung ${rec.provider_id}, aber: ${mismatch} – NICHT als bezahlt übernommen, bitte prüfen`,
          actor,
        }),
      );
      after.push(() =>
        emitSafe({
          type: 'payment.failed',
          orderId: rec.order_id,
          actor,
          payload: { reason: `Prüfung nötig: ${mismatch}`.slice(0, 160), critical: true },
          dedupeKey: `payment.mismatch:mollie:${rec.provider_id}`,
        }),
      );
    } else if (status === 'paid' && testOnly) {
      stmts.push(
        q(
          `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
           VALUES (?, ?, 'mollie', ?, 'testzahlung', 'bezahlt', 0, NULL, ?, 'TESTMODUS – kein echtes Geld, Auftrag bleibt offen', 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
          rec.order_id,
          at,
          rec.provider_id,
          method,
        ),
        eventStmt(rec.order_id, {
          type: 'payment',
          message: `Testzahlung erfolgreich (Mollie ${rec.provider_id}${method ? `, ${method}` : ''}, TESTMODUS – kein echtes Geld) – Auftrag bleibt „Zahlung offen“`,
          actor,
        }),
      );
      after.push(() =>
        emitSafe({ type: 'payment.test', orderId: rec.order_id, actor, payload: { payment: rec.provider_id, status }, dedupeKey: `payment.test:mollie:${rec.provider_id}:${status}` }),
      );
    } else if (status === 'paid') {
      const double =
        order.payment_status === 'bezahlt' &&
        !(await db.first(
          "SELECT 1 AS x FROM payments WHERE provider = 'mollie' AND provider_ref = ? AND kind = 'zahlung' AND status = 'bezahlt'",
          rec.provider_id,
        ));
      stmts.push(
        q(
          `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
           VALUES (?, ?, 'mollie', ?, 'zahlung', 'bezahlt', ?, NULL, ?, ?, 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
          rec.order_id,
          at,
          rec.provider_id,
          cents ?? rec.amount_cents,
          method,
          [testNote, double ? 'DOPPELZAHLUNG – erstatten' : ''].filter(Boolean).join(' · '),
        ),
      );
      if (order.payment_status === 'offen') {
        stmts.push(
          q(
            "UPDATE orders SET payment_status = 'bezahlt', payment_ref = ?, updated_at = ? WHERE id = ? AND payment_status = 'offen'",
            rec.provider_id,
            at,
            rec.order_id,
          ),
          eventStmt(rec.order_id, {
            type: 'payment',
            message: `Bezahlt (Mollie ${rec.provider_id}${method ? `, ${method}` : ''}${testNote ? `, ${testNote}` : ''})`,
            actor,
          }),
        );
      } else if (double) {
        stmts.push(
          eventStmt(rec.order_id, {
            type: 'payment',
            message: `Weitere Zahlung eingegangen (Mollie ${rec.provider_id}) – Auftrag war bereits bezahlt, bitte erstatten`,
            actor,
          }),
        );
      }
      // Zahlungsbestätigung an den Kunden – nur für die erste echte Zahlung (nicht bei Doppelzahlung), genau einmal je Zahlung
      if (!double && order.payment_status === 'offen')
        after.push(() => import('./transactional-mail.ts').then((m) => m.queuePaymentConfirmed(rec.order_id, rec.provider_id!, cents ?? rec.amount_cents, method, paidAt)).then(() => undefined));
      after.push(() =>
        emitSafe({
          type: 'payment.paid',
          orderId: rec.order_id,
          actor,
          payload: { provider: 'mollie', payment: rec.provider_id, test: rec.mode === 'test', double },
          dedupeKey: `payment.paid:mollie:${rec.provider_id}`,
        }),
      );
    } else if (MOLLIE_RETRY.includes(status)) {
      const label = status === 'failed' ? 'fehlgeschlagen' : status === 'canceled' ? 'abgebrochen' : 'abgelaufen';
      stmts.push(
        q(
          `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
           VALUES (?, ?, 'mollie', ?, 'zahlung', ?, 0, NULL, ?, ?, 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
          rec.order_id,
          at,
          rec.provider_id,
          status === 'failed' ? 'fehlgeschlagen' : 'abgebrochen',
          method,
          [testNote, status === 'expired' ? 'abgelaufen' : ''].filter(Boolean).join(' · '),
        ),
        eventStmt(rec.order_id, {
          type: 'payment',
          message: `Online-Zahlung ${label} (Mollie ${rec.provider_id}${testNote ? `, ${testNote}` : ''}) – erneute Zahlung möglich`,
          actor,
        }),
      );
      if (testOnly)
        after.push(() =>
          emitSafe({ type: 'payment.test', orderId: rec.order_id, actor, payload: { payment: rec.provider_id, status }, dedupeKey: `payment.test:mollie:${rec.provider_id}:${status}` }),
        );
      else if (status === 'failed') {
        after.push(() => import('./transactional-mail.ts').then((m) => m.queuePaymentFailed(rec.order_id, rec.provider_id!)).then(() => undefined));
        after.push(() =>
          emitSafe({
            type: 'payment.failed',
            orderId: rec.order_id,
            actor,
            payload: { reason: 'Zahlung abgelehnt', provider: 'mollie' },
            dedupeKey: `payment.failed:mollie:${rec.provider_id}`,
          }),
        );
      }
    }
  }
  // Erstattungen und Rückbuchungen (nur bei echter Zahlung); Beträge je Stand eindeutig gebucht
  const refundClaim =
    status === 'paid' && !mismatch && !testOnly && refunded > rec.refunded_cents
      ? await db.run('UPDATE payment_attempts SET refunded_cents = ? WHERE id = ? AND refunded_cents = ?', refunded, rec.id, rec.refunded_cents)
      : null;
  if (refundClaim?.changes) {
    const delta = refunded - rec.refunded_cents;
    const full = refunded >= (cents ?? rec.amount_cents);
    stmts.push(
      q(
        `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
         VALUES (?, ?, 'mollie', ?, 'erstattung', 'erstattet', ?, NULL, ?, ?, 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
        rec.order_id,
        at,
        `${rec.provider_id}:erstattet:${refunded}`,
        -delta,
        method,
        [testNote, full ? 'vollständig' : 'teilweise'].filter(Boolean).join(' · '),
      ),
      eventStmt(rec.order_id, { type: 'payment', message: `Erstattung über Mollie: ${centsToValue(delta)} €${full ? ' (vollständig)' : ''}`, actor }),
    );
    if (full) stmts.push(q("UPDATE orders SET payment_status = 'erstattet', updated_at = ? WHERE id = ? AND payment_status = 'bezahlt'", at, rec.order_id));
    after.push(() => import('./transactional-mail.ts').then((m) => m.queueRefund(rec.order_id, rec.provider_id!, refunded, delta, full)).then(() => undefined));
    after.push(() =>
      emitSafe({
        type: 'payment.refunded',
        orderId: rec.order_id,
        actor,
        payload: { provider: 'mollie', cents: delta, full },
        dedupeKey: `payment.refunded:mollie:${rec.provider_id}:${refunded}`,
      }),
    );
  }
  const chargebackClaim =
    !testOnly && chargedBack > rec.charged_back_cents
      ? await db.run('UPDATE payment_attempts SET charged_back_cents = ? WHERE id = ? AND charged_back_cents = ?', chargedBack, rec.id, rec.charged_back_cents)
      : null;
  if (chargebackClaim?.changes) {
    const delta = chargedBack - rec.charged_back_cents;
    stmts.push(
      q(
        `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
         VALUES (?, ?, 'mollie', ?, 'rueckbuchung', 'rueckbuchung', ?, NULL, ?, ?, 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
        rec.order_id,
        at,
        `${rec.provider_id}:rueckbuchung:${chargedBack}`,
        -delta,
        method,
        testNote,
      ),
      eventStmt(rec.order_id, { type: 'payment', message: `Rückbuchung (Chargeback) über Mollie: ${centsToValue(delta)} € – bitte prüfen`, actor }),
    );
    after.push(() =>
      emitSafe({
        type: 'payment.failed',
        orderId: rec.order_id,
        actor,
        payload: { reason: `Rückbuchung ${centsToValue(delta)} €`, critical: true },
        dedupeKey: `payment.chargeback:mollie:${rec.provider_id}:${chargedBack}`,
      }),
    );
  }
  if (stmts.length) {
    stmts.push(touchStmt(rec.order_id));
    await db.batch(stmts);
  }
  // Folgen (OS-Ereignisse, Kundenmails) dürfen den Abgleich nie scheitern lassen – der Stand ist bereits gespeichert
  for (const f of after) await f().catch((e: unknown) => console.error('[zahlung] Folgeaktion fehlgeschlagen:', (e as Error).message));
  return { ok: true, attempt: attemptView((await getAttempt(rec.id))!), changed: statusChanged };
}

/**
 * Webhook (POST id=tr_…): nur Anstoß zum Abgleich. Antwort laut Mollie-Doku: 200 auch für unbekannte IDs (verrät nichts);
 * 503 nur, wenn der Stand gerade nicht abrufbar ist – dann wiederholt Mollie die Zustellung.
 */
export async function handleMollieWebhook(id: unknown): Promise<number> {
  if (!mollieMode() && !mollieTestAvailable()) return 503;
  if (!isPaymentId(id)) return 200;
  const rec = await attemptByPaymentId(id);
  if (!rec) return 200;
  const r = await reconcileAttempt(rec.id, { force: true });
  return !r.ok && r.retry ? 503 : 200;
}

/** Rückkehrseite: Stand des letzten Versuchs (gedrosselt abgeglichen) – ohne Personendaten */
export async function paymentStateForOrder(orderId: number): Promise<{ view: PayView; attempt: AttemptView | null; checkFailed: boolean }> {
  const last = await latestAttempt(orderId);
  if (!last) return { view: 'keine', attempt: null, checkFailed: false };
  let checkFailed = false;
  if (last.provider_id && (last.status === '' || MOLLIE_OPEN.includes(last.status as MollieStatus))) {
    const r = await reconcileAttempt(last.id);
    checkFailed = !r.ok;
  }
  const fresh = (await getAttempt(last.id))!;
  return { view: payView(fresh.status), attempt: attemptView(fresh), checkFailed };
}

/** Offene Versuche, die länger nicht abgeglichen wurden (Zeitsteuerung – falls ein Webhook ausbleibt) */
export async function attemptsDue(limit = 20): Promise<{ id: number; order_id: number; provider_id: string }[]> {
  if (!mollieMode() && !mollieTestAvailable()) return [];
  const before = new Date(Date.now() - SWEEP_MS).toISOString();
  const since = new Date(Date.now() - 3 * 86_400_000).toISOString();
  return (await getDb()).all(
    "SELECT id, order_id, provider_id FROM payment_attempts WHERE provider_id IS NOT NULL AND status IN ('', 'open', 'pending', 'authorized') AND created_at > ? AND (checked_at = '' OR checked_at < ?) ORDER BY checked_at ASC LIMIT ?",
    since,
    before,
    limit,
  );
}
