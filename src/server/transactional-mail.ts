// Transaktionsmails an Kunden über das bestehende Nachrichtenprotokoll (Tabelle messages, Quelle „automatisch“).
//
// - Idempotenz: je Ereignis ein fester Schlüssel (dedupe_key, eindeutig) – doppelte Webhooks/Statuswechsel senden nichts doppelt.
// - Freigabe: Ohne KUNDENMAILS=1 werden Kundenmails nur protokolliert („zurückgehalten“) und nie verschickt; im OS einzeln
//   freigebbar. Testmails (synthetische Inhalte) nur an eine vom Inhaber eingegebene Adresse.
// - Wiederholung: bei Versandfehlern bis zu 5 Versuche mit wachsenden Abständen (Zeitsteuerung „Mail-Wiederholung“);
//   danach „aufgegeben“ und Hinweis im OS.
// - Nachweis: Resend-E-Mail-ID (provider_id) – im Resend-Dashboard nachschlagbar (Zustellstatus).
// - Datenschutz: Inhalte ohne Fahrzeug- und Ausweisdaten; Schlüssel und Adressen werden nie protokolliert.

import { getDb } from './db.ts';
import { mailConfigured, sendMail } from './mailer.ts';
import { getCompany } from './os/company.ts';
import { emitSafe } from './os/events.ts';
import { publicBaseUrl } from './payments.ts';
import { customerPaymentsOpen as paymentsOpen } from './checkout.ts';
import { earlyStartWait } from '../lib/withdrawal-period.ts';
import { MAIL_KIND_LABEL, sampleMail, type Mail, type MailContext, type MailKind } from '../lib/mail-templates.ts';
import { PROVIDER } from '../lib/site.ts';

const now = () => new Date().toISOString();
export const MAX_ATTEMPTS = 5;
/** Abstand bis zum nächsten Versuch nach dem n-ten Fehlschlag (Minuten) */
const BACKOFF_MIN = [5, 30, 120, 720];

export function customerMailsEnabled(): boolean {
  return process.env.KUNDENMAILS === '1' && mailConfigured();
}

interface Row {
  id: number;
  order_id: number | null;
  to_addr: string;
  subject: string;
  body: string;
  html: string;
  state: string;
  attempts: number;
  dedupe_key: string;
  mail_kind: string;
}

export type QueueResult = { queued: false; reason: string } | { queued: true; id: number; state: string };

/**
 * Kundenmail zu einem bestätigten Ereignis anlegen und (wenn freigegeben) sofort senden. Gleicher Schlüssel → nichts Neues.
 * build bekommt Basisadresse und Auftragsnummer und liefert Betreff, Text und HTML.
 */
export async function queueCustomerMail(input: {
  orderId: number;
  kind: MailKind;
  dedupeKey: string;
  build: (ctx: MailContext) => Mail | Promise<Mail>;
}): Promise<QueueResult> {
  const db = await getDb();
  const o = await db.first<{ id: number; number: string; email: string; customer_id: number | null; is_test: number }>(
    'SELECT id, number, email, customer_id, is_test FROM orders WHERE id = ?',
    input.orderId,
  );
  if (!o) return { queued: false, reason: 'Auftrag nicht gefunden' };
  if (o.is_test) return { queued: false, reason: 'Testauftrag – keine Kundenmail' };
  if (!o.email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(o.email)) return { queued: false, reason: 'keine gültige E-Mail-Adresse' };
  if (await db.first('SELECT 1 AS x FROM messages WHERE dedupe_key = ?', input.dedupeKey)) return { queued: false, reason: 'bereits angelegt' };
  const mail = await input.build({ baseUrl: publicBaseUrl(), number: o.number });
  const state = customerMailsEnabled() ? 'wartet' : 'zurueckgehalten';
  const row = await db.first<{ id: number }>(
    `INSERT OR IGNORE INTO messages (at, order_id, customer_id, to_addr, subject, body, html, template_id, state, error, author, source, dedupe_key, mail_kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'System', 'automatisch', ?, ?) RETURNING id`,
    now(),
    o.id,
    o.customer_id,
    o.email,
    mail.subject,
    mail.text,
    mail.html,
    input.kind,
    state,
    state === 'zurueckgehalten' ? 'Kundenmails noch nicht freigegeben (KUNDENMAILS)' : '',
    input.dedupeKey,
    input.kind,
  );
  if (!row) return { queued: false, reason: 'bereits angelegt' };
  if (state === 'wartet') await deliver(row.id);
  const after = await db.first<{ state: string }>('SELECT state FROM messages WHERE id = ?', row.id);
  return { queued: true, id: row.id, state: after?.state ?? state };
}

/**
 * Eine Mail zustellen. Nur ein Aufruf gewinnt (Zustand „wird_versendet“ wird atomar beansprucht). force: auch zurückgehaltene,
 * nicht versendete oder aufgegebene Mails (manuelle Freigabe im OS).
 */
export async function deliver(
  id: number,
  opts: { force?: boolean; actor?: string } = {},
): Promise<{ ok: boolean; state: string; error?: string; providerId?: string }> {
  const db = await getDb();
  const states = opts.force ? "('wartet', 'fehler', 'zurueckgehalten', 'nicht_versendet', 'aufgegeben')" : "('wartet', 'fehler')";
  const row = await db.first<Row>(
    `UPDATE messages SET state = 'wird_versendet', attempts = attempts + 1 WHERE id = ? AND dedupe_key != '' AND state IN ${states}
     RETURNING id, order_id, to_addr, subject, body, html, state, attempts, dedupe_key, mail_kind`,
    id,
  );
  if (!row) return { ok: false, state: 'unverändert', error: 'Nachricht nicht versendbar (bereits versendet oder in Bearbeitung)' };
  const company = await getCompany().catch(() => null);
  const replyTo = company?.replyTo || PROVIDER.email;
  const res = await sendMail({ to: row.to_addr, subject: row.subject, text: row.body, ...(row.html ? { html: row.html } : {}), replyTo });
  const at = now();
  if (res.state === 'versendet') {
    await db.run(
      "UPDATE messages SET state = 'versendet', sent_at = ?, error = '', provider_id = ?, next_attempt_at = '', author = CASE WHEN ? != '' THEN ? ELSE author END WHERE id = ?",
      at,
      res.id ?? '',
      opts.actor ?? '',
      opts.actor ?? '',
      id,
    );
    return { ok: true, state: 'versendet', providerId: res.id };
  }
  if (res.state === 'nicht_konfiguriert') {
    await db.run("UPDATE messages SET state = 'nicht_versendet', error = 'E-Mail-Versand nicht eingerichtet (RESEND_API_KEY, MAIL_FROM)' WHERE id = ?", id);
    return { ok: false, state: 'nicht_versendet', error: 'E-Mail-Versand nicht eingerichtet' };
  }
  const giveUp = row.attempts >= MAX_ATTEMPTS;
  const next = giveUp ? '' : new Date(Date.now() + BACKOFF_MIN[Math.min(row.attempts - 1, BACKOFF_MIN.length - 1)] * 60_000).toISOString();
  await db.run(
    'UPDATE messages SET state = ?, error = ?, next_attempt_at = ? WHERE id = ?',
    giveUp ? 'aufgegeben' : 'fehler',
    res.error.slice(0, 300),
    next,
    id,
  );
  if (giveUp)
    await emitSafe({
      type: 'message.failed',
      orderId: row.order_id,
      actor: 'System',
      payload: { subject: row.subject.slice(0, 120), error: res.error.slice(0, 160), kind: row.mail_kind },
      dedupeKey: `mail.aufgegeben:${row.id}`,
    });
  return { ok: false, state: giveUp ? 'aufgegeben' : 'fehler', error: res.error };
}

/** Fällige Wiederholungen (Zeitsteuerung) */
export async function mailsDue(limit = 20): Promise<{ id: number; order_id: number | null; dedupe_key: string }[]> {
  return (await getDb()).all(
    "SELECT id, order_id, dedupe_key FROM messages WHERE state = 'fehler' AND dedupe_key != '' AND next_attempt_at != '' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT ?",
    now(),
    limit,
  );
}

/** Kontrollierter Testversand (nur Inhaber): synthetische Beispielinhalte an genau die eingegebene Adresse */
export async function sendTestMail(
  kind: MailKind,
  to: string,
  actor: string,
): Promise<{ ok: true; state: string; providerId: string; id: number } | { ok: false; error: string }> {
  const addr = to.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr) || addr.length > 200) return { ok: false, error: 'Bitte eine gültige E-Mail-Adresse angeben.' };
  if (!(kind in MAIL_KIND_LABEL)) return { ok: false, error: 'Unbekannte Vorlage' };
  if (!mailConfigured()) return { ok: false, error: 'E-Mail-Versand nicht eingerichtet (RESEND_API_KEY, MAIL_FROM)' };
  const m = sampleMail(kind, publicBaseUrl());
  const db = await getDb();
  const row = await db.first<{ id: number }>(
    `INSERT INTO messages (at, order_id, customer_id, to_addr, subject, body, html, template_id, state, author, source, dedupe_key, mail_kind)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, 'wartet', ?, 'test', ?, ?) RETURNING id`,
    now(),
    addr,
    m.subject,
    m.text,
    m.html,
    kind,
    actor,
    `test:${crypto.randomUUID()}`,
    kind,
  );
  const r = await deliver(row!.id, { actor });
  if (!r.ok) return { ok: false, error: r.error ?? 'Versand fehlgeschlagen' };
  return { ok: true, state: r.state, providerId: r.providerId ?? '', id: row!.id };
}

/** Für Statistik/Diagnose: Zustand der automatischen Mails */
export async function mailStats(): Promise<Record<string, number>> {
  const rows = await (await getDb()).all<{ state: string; n: number }>("SELECT state, COUNT(*) AS n FROM messages WHERE dedupe_key != '' GROUP BY state");
  return Object.fromEntries(rows.map((r) => [r.state, r.n]));
}

// ---------- Auslöser (nur bestätigte Ereignisse) ----------

/** Bestell- und Vertragsbestätigung nach verbindlicher Bestellung über die Website */
export async function queueOrderConfirmation(orderId: number): Promise<QueueResult> {
  const { orderConfirmationMail } = await import('../lib/mail-templates.ts');
  const { SERVICES } = await import('../lib/services.ts');
  const { customerPaymentsOpen } = await import('./checkout.ts');
  const { withdrawalMode } = await import('./withdrawal.ts');
  const { withdrawalNotice, WITHDRAW_PATH } = await import('../lib/withdrawal.ts');
  const o = await (
    await getDb()
  ).first<{ number: string; service: string; created_at: string; price_json: string; payment_status: string; payment_token: string; data_json: string }>(
    'SELECT number, service, created_at, price_json, payment_status, payment_token, data_json FROM orders WHERE id = ?',
    orderId,
  );
  if (!o) return { queued: false, reason: 'Auftrag nicht gefunden' };
  const price = JSON.parse(o.price_json) as { lines: { label: string; cents: number }[]; discountCents: number; totalCents: number };
  const data = JSON.parse(o.data_json) as { holder?: { typ?: string }; finish?: { vorzeitigerBeginnAt?: string } };
  const wait = earlyStartWait({ created_at: o.created_at, data: { holder: { typ: data.holder?.typ ?? '' }, finish: data.finish ?? {} } }, Date.parse(o.created_at));
  const withdrawalOn = withdrawalMode() === 'aktiv';
  // Überweisung (Vorkasse), solange keine Online-Zahlung angeboten wird und eine IBAN hinterlegt ist
  const { bankTransferRequest } = await import('./bank-transfer.ts');
  const transfer = o.payment_status === 'offen' ? await bankTransferRequest({ number: o.number, total_cents: JSON.parse(o.price_json).totalCents, created_at: o.created_at }) : null;
  return queueCustomerMail({
    orderId,
    kind: 'bestellung',
    dedupeKey: `bestellung:${orderId}`,
    build: (ctx) =>
      orderConfirmationMail(ctx, {
        createdAt: o.created_at,
        serviceTitle: SERVICES[o.service as keyof typeof SERVICES]?.title ?? o.service,
        lines: price.lines.map((l) => ({ label: l.label, cents: l.cents })),
        discountCents: price.discountCents,
        totalCents: price.totalCents,
        paymentStatus: o.payment_status === 'bezahlt' ? 'bezahlt' : o.payment_status === 'erstattet' ? 'erstattet' : 'offen',
        payUrl: customerPaymentsOpen() && o.payment_token ? `${ctx.baseUrl}/zahlung/${o.number}?t=${encodeURIComponent(o.payment_token)}` : null,
        withdrawal: withdrawalOn ? withdrawalNotice(ctx.baseUrl) : null,
        formUrl: withdrawalOn ? `${ctx.baseUrl}${WITHDRAW_PATH}` : null,
        earlyStartAt: data.finish?.vorzeitigerBeginnAt ?? null,
        serviceStartFrom: wait ? wait.until.toISOString() : null,
        bankTransfer: transfer,
      }),
  });
}

/** Zahlungsbestätigung – nur aus dem serverseitigen Mollie-Abgleich einer echten Zahlung (nie aus der Rückleitung) */
export async function queuePaymentConfirmed(orderId: number, paymentId: string, amountCents: number, method: string, paidAt: string): Promise<QueueResult> {
  const { paymentConfirmedMail } = await import('../lib/mail-templates.ts');
  return queueCustomerMail({
    orderId,
    kind: 'zahlung_bestaetigt',
    dedupeKey: `zahlung:${paymentId}`,
    build: (ctx) => paymentConfirmedMail(ctx, { amountCents, method, paidAt: paidAt || now() }),
  });
}

export async function queuePaymentFailed(orderId: number, paymentId: string): Promise<QueueResult> {
  const { paymentFailedMail } = await import('../lib/mail-templates.ts');
  const o = await (await getDb()).first<{ number: string; payment_token: string }>('SELECT number, payment_token FROM orders WHERE id = ?', orderId);
  return queueCustomerMail({
    orderId,
    kind: 'zahlung_fehlgeschlagen',
    dedupeKey: `zahlung_fehler:${paymentId}`,
    build: (ctx) => paymentFailedMail(ctx, { payUrl: paymentsOpen() && o?.payment_token ? `${ctx.baseUrl}/zahlung/${o.number}?t=${encodeURIComponent(o.payment_token)}` : null }),
  });
}

export async function queueRefund(orderId: number, paymentId: string, refundedTotalCents: number, deltaCents: number, full: boolean): Promise<QueueResult> {
  const { refundMail } = await import('../lib/mail-templates.ts');
  return queueCustomerMail({
    orderId,
    kind: 'erstattung',
    dedupeKey: `erstattung:${paymentId}:${refundedTotalCents}`,
    build: (ctx) => refundMail(ctx, { amountCents: deltaCents, full }),
  });
}

/** Statusmails (Unterlagen, Vollmacht, Antrag, Zulassung, Ablehnung) – Schlüssel so gewählt, dass OS-Status und kfz-api.de-Meldung nicht doppelt senden */
export async function queueStatusMail(
  orderId: number,
  kind: 'unterlagen_erforderlich' | 'vollmacht_bestaetigt' | 'antrag_eingereicht' | 'zulassung_abgeschlossen' | 'auftrag_abgelehnt',
  dedupeKey: string,
): Promise<QueueResult> {
  const { statusMail } = await import('../lib/mail-templates.ts');
  return queueCustomerMail({ orderId, kind, dedupeKey, build: (ctx) => statusMail(ctx, kind) });
}
