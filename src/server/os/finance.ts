// Finanzen: Zahlungsbuchungen (mit echten Gebühren vom Zahlungsanbieter), Rechnungen und Gutschriften mit
// fortlaufender Nummer, offene Posten, Zahlungsabgleich, Deckungsbeitrag je Auftrag, Gutscheine.
// Es werden keine Umsätze oder Zahlungen erfunden: Buchungen entstehen nur aus Stripe-Webhooks oder
// aus einer ausdrücklichen Eingabe in der Verwaltung.

import { z } from 'zod';
import type { PriceBreakdown } from '../../lib/pricing.ts';
import { SERVICES, type ServiceId } from '../../lib/services.ts';
import type { ValidatedOrder } from '../../lib/order.ts';
import { getDb, q } from '../db.ts';
import { getSettings } from '../settings.ts';
import { getCompany, invoiceReadiness, type Company } from './company.ts';
import { emitSafe } from './events.ts';

const now = () => new Date().toISOString();
type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/* ---------- Zahlungsbuchungen ---------- */

export async function recordManualPayment(orderId: number, status: string, amountCents: number, ref: string, actor: string): Promise<void> {
  const kind = status === 'erstattet' ? 'erstattung' : status === 'bezahlt' ? 'zahlung' : 'korrektur';
  await (await getDb()).run(
    "INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by) VALUES (?, ?, 'manuell', '', ?, ?, ?, NULL, '', ?, ?)",
    orderId,
    now(),
    kind,
    status,
    status === 'erstattet' ? -amountCents : status === 'bezahlt' ? amountCents : 0,
    ref ? `Referenz: ${ref}` : status === 'offen' ? 'Zahlungsstatus zurückgesetzt' : '',
    actor,
  );
}

interface StripeSession {
  id: string;
  amount_total?: number;
  payment_status?: string;
  payment_intent?: {
    id: string;
    latest_charge?: {
      payment_method_details?: { type?: string };
      balance_transaction?: { fee?: number; net?: number } | string | null;
    } | string | null;
  } | string | null;
}

/** Liest Betrag, Gebühr und Zahlart einer Checkout-Session bei Stripe (nur lesend). */
export async function fetchStripeSession(sessionId: string): Promise<{ amount: number | null; fee: number | null; method: string } | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  try {
    const url = `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=payment_intent.latest_charge.balance_transaction`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const s = (await res.json()) as StripeSession;
    const pi = typeof s.payment_intent === 'object' ? s.payment_intent : null;
    const ch = pi && typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
    const bt = ch && typeof ch.balance_transaction === 'object' ? ch.balance_transaction : null;
    return { amount: s.amount_total ?? null, fee: bt?.fee ?? null, method: ch?.payment_method_details?.type ?? '' };
  } catch {
    return null;
  }
}

/** Buchung aus dem Stripe-Webhook (idempotent über Session-ID und Status). */
export async function recordStripeEvent(orderId: number, sessionId: string, status: 'bezahlt' | 'fehlgeschlagen' | 'abgebrochen', fallbackAmount: number): Promise<boolean> {
  const info = status === 'bezahlt' ? await fetchStripeSession(sessionId) : null;
  const r = await (await getDb()).run(
    `INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by)
     VALUES (?, ?, 'stripe', ?, 'zahlung', ?, ?, ?, ?, '', 'Zahlungsdienstleister') ON CONFLICT DO NOTHING`,
    orderId,
    now(),
    sessionId,
    status,
    status === 'bezahlt' ? (info?.amount ?? fallbackAmount) : 0,
    info?.fee ?? null,
    info?.method ?? '',
  );
  return r.changes > 0;
}

/** Gebühr nachträglich bei Stripe abrufen (z. B. wenn sie beim Webhook noch nicht feststand). */
export async function refreshStripeFee(paymentId: number): Promise<R> {
  const db = await getDb();
  const p = await db.first<{ provider: string; provider_ref: string }>('SELECT provider, provider_ref FROM payments WHERE id = ?', paymentId);
  if (!p || p.provider !== 'stripe' || !p.provider_ref) return { ok: false, error: 'Keine Stripe-Zahlung' };
  const info = await fetchStripeSession(p.provider_ref);
  if (!info) return { ok: false, error: 'Stripe nicht erreichbar oder nicht eingerichtet' };
  if (info.fee === null) return { ok: false, error: 'Stripe liefert (noch) keine Gebühr' };
  await db.run('UPDATE payments SET fee_cents = ?, method = ? WHERE id = ?', info.fee, info.method, paymentId);
  return { ok: true };
}

export async function setPaymentFee(paymentId: number, feeCents: number | null, actor: string): Promise<R> {
  if (feeCents !== null && (!Number.isInteger(feeCents) || feeCents < 0 || feeCents > 100_000)) return { ok: false, error: 'Gebühr ungültig' };
  const r = await (await getDb()).run("UPDATE payments SET fee_cents = ?, note = trim(note || ' Gebühr manuell: ' || ?) WHERE id = ?", feeCents, actor, paymentId);
  return r.changes ? { ok: true } : { ok: false, error: 'Buchung nicht gefunden' };
}

/* ---------- Steuer ---------- */

export function splitGross(gross: number, c: Pick<Company, 'taxMode' | 'vatRate'>): { net: number; vat: number } {
  if (c.taxMode === 'kleinunternehmer' || !c.vatRate) return { net: gross, vat: 0 };
  const vat = Math.round((gross * c.vatRate) / (100 + c.vatRate));
  return { net: gross - vat, vat };
}

/* ---------- Deckungsbeitrag je Auftrag ---------- */

export interface Contribution {
  orderId: number;
  number: string;
  holder: string;
  service: ServiceId;
  status: string;
  paymentStatus: string;
  createdAt: string;
  grossCents: number;
  netCents: number;
  vatCents: number;
  costCents: number | null;
  feeCents: number | null;
  feeIsActual: boolean;
  otherCostCents: number;
  contributionCents: number | null;
}

/** Verkaufspreis (netto) – Einkaufskosten – Zahlungsgebühren – weitere direkte Kosten = Deckungsbeitrag. */
export async function contributions(filter: { from?: string; to?: string; limit?: number } = {}): Promise<Contribution[]> {
  const db = await getDb();
  const settings = await getSettings(true);
  const company = await getCompany();
  const where = ["o.status != 'storniert'"];
  const params: (string | number)[] = [];
  if (filter.from) {
    where.push('o.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('o.created_at < ?');
    params.push(filter.to);
  }
  params.push(Math.min(filter.limit ?? 2000, 5000));
  const rows = await db.all<{ id: number; number: string; holder_name: string; service: ServiceId; status: string; payment_status: string; created_at: string; total_cents: number; fee: number | null; fees_known: number; pays: number }>(
    `SELECT o.id, o.number, o.holder_name, o.service, o.status, o.payment_status, o.created_at, o.total_cents,
       (SELECT SUM(p.fee_cents) FROM payments p WHERE p.order_id = o.id AND p.fee_cents IS NOT NULL) AS fee,
       (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id AND p.kind = 'zahlung' AND p.status = 'bezahlt' AND p.fee_cents IS NOT NULL) AS fees_known,
       (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id AND p.kind = 'zahlung' AND p.status = 'bezahlt') AS pays
     FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT ?`,
    ...params,
  );
  return rows.map((r) => {
    const { net, vat } = splitGross(r.total_cents, company);
    const cost = settings.costs[r.service];
    const feeActual = r.pays > 0 && r.fees_known === r.pays;
    const fee = r.fee ?? (r.pays === 0 && r.payment_status !== 'bezahlt' ? 0 : null);
    const contribution = cost === null || fee === null ? null : net - cost - fee;
    return {
      orderId: r.id,
      number: r.number,
      holder: r.holder_name,
      service: r.service,
      status: r.status,
      paymentStatus: r.payment_status,
      createdAt: r.created_at,
      grossCents: r.total_cents,
      netCents: net,
      vatCents: vat,
      costCents: cost,
      feeCents: fee,
      feeIsActual: feeActual,
      otherCostCents: 0,
      contributionCents: contribution,
    };
  });
}

/* ---------- Kennzahlen nach Zeitraum ---------- */

function startOf(unit: 'tag' | 'woche' | 'monat' | 'jahr', d = new Date()): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (unit === 'woche') x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  if (unit === 'monat') x.setDate(1);
  if (unit === 'jahr') {
    x.setMonth(0);
    x.setDate(1);
  }
  return x;
}

export async function periodTotals() {
  const db = await getDb();
  const company = await getCompany();
  const out: Record<string, { grossCents: number; netCents: number; paidCents: number; orders: number; prevGrossCents: number }> = {};
  for (const unit of ['tag', 'woche', 'monat', 'jahr'] as const) {
    const from = startOf(unit);
    const prevFrom = new Date(from);
    if (unit === 'tag') prevFrom.setDate(prevFrom.getDate() - 1);
    if (unit === 'woche') prevFrom.setDate(prevFrom.getDate() - 7);
    if (unit === 'monat') prevFrom.setMonth(prevFrom.getMonth() - 1);
    if (unit === 'jahr') prevFrom.setFullYear(prevFrom.getFullYear() - 1);
    const elapsed = Date.now() - from.getTime();
    const prevTo = new Date(prevFrom.getTime() + elapsed);
    const cur = await db.first<{ g: number | null; p: number | null; n: number }>(
      "SELECT SUM(total_cents) AS g, SUM(CASE WHEN payment_status = 'bezahlt' THEN total_cents END) AS p, COUNT(*) AS n FROM orders WHERE status != 'storniert' AND created_at >= ?",
      from.toISOString(),
    );
    const prev = await db.first<{ g: number | null }>(
      "SELECT SUM(total_cents) AS g FROM orders WHERE status != 'storniert' AND created_at >= ? AND created_at < ?",
      prevFrom.toISOString(),
      prevTo.toISOString(),
    );
    const g = cur?.g ?? 0;
    out[unit] = { grossCents: g, netCents: splitGross(g, company).net, paidCents: cur?.p ?? 0, orders: cur?.n ?? 0, prevGrossCents: prev?.g ?? 0 };
  }
  return out as Record<'tag' | 'woche' | 'monat' | 'jahr', { grossCents: number; netCents: number; paidCents: number; orders: number; prevGrossCents: number }>;
}

/* ---------- Rechnungen ---------- */

async function nextNumber(series: string, prefix: string): Promise<string> {
  const year = new Date().getFullYear();
  const row = await (await getDb()).first<{ last: number }>(
    'INSERT INTO invoice_counters (series, year, last) VALUES (?, ?, 1) ON CONFLICT(series, year) DO UPDATE SET last = last + 1 RETURNING last',
    series,
    year,
  );
  if (!row) throw new Error('Rechnungsnummer konnte nicht vergeben werden');
  return `${prefix}-${year}-${String(row.last).padStart(5, '0')}`;
}

export interface InvoiceLine {
  label: string;
  grossCents: number;
  netCents: number;
  vatCents: number;
}

export async function issueInvoice(orderId: number, actor: string, note = ''): Promise<R<{ id: number; number: string }>> {
  const db = await getDb();
  const company = await getCompany(true);
  const missing = invoiceReadiness(company);
  if (missing.length) return { ok: false, error: `Unternehmensdaten unvollständig (Systemeinstellungen → Unternehmen): ${missing.join(', ')}` };
  const o = await db.first<{ id: number; number: string; status: string; customer_id: number | null; price_json: string; data_json: string; total_cents: number; created_at: string; service: ServiceId }>(
    'SELECT id, number, status, customer_id, price_json, data_json, total_cents, created_at, service FROM orders WHERE id = ?',
    orderId,
  );
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (o.status === 'storniert') return { ok: false, error: 'Stornierter Auftrag – keine Rechnung' };
  const open = await db.first<{ id: number; number: string }>(
    "SELECT i.id, i.number FROM invoices i WHERE i.order_id = ? AND i.kind = 'rechnung' AND NOT EXISTS (SELECT 1 FROM invoices g WHERE g.refers_to = i.id AND g.kind = 'gutschrift')",
    orderId,
  );
  if (open) return { ok: false, error: `Für diesen Auftrag besteht bereits Rechnung ${open.number} (erst per Gutschrift korrigieren)` };
  const price = JSON.parse(o.price_json) as PriceBreakdown;
  const d = JSON.parse(o.data_json) as ValidatedOrder;
  const line = (label: string, grossCents: number): InvoiceLine => {
    const sp = splitGross(grossCents, company);
    return { label, grossCents, netCents: sp.net, vatCents: sp.vat };
  };
  // Die Preispositionen enthalten Paketvorteil und Neukundenrabatt bereits als eigene (negative) Zeilen
  const lines: InvoiceLine[] = price.lines.map((l) => line(l.label, l.cents));
  const adjustments = await db.all<{ label: string; cents: number }>(
    "SELECT note AS label, amount_cents AS cents FROM payments WHERE order_id = ? AND kind = 'preis_anpassung'",
    orderId,
  );
  for (const a of adjustments) lines.push(line(a.label || 'Preisanpassung', a.cents));
  const gross = o.total_cents;
  const sumLines = lines.reduce((x, l) => x + l.grossCents, 0);
  if (sumLines !== gross) lines.push(line('Abgleich zum Auftragsbetrag', gross - sumLines));
  const { net, vat } = splitGross(gross, company);
  // Rundungsausgleich: Die USt der Positionen muss exakt die Gesamt-USt ergeben (größte Position trägt die Differenz)
  const vatDiff = vat - lines.reduce((x, l) => x + l.vatCents, 0);
  if (vatDiff && lines.length) {
    const big = lines.reduce((a, b) => (Math.abs(b.grossCents) > Math.abs(a.grossCents) ? b : a));
    big.vatCents += vatDiff;
    big.netCents -= vatDiff;
  }
  // Leistungsdatum = Tag der Zulassung bzw. Abmeldung (Statuswechsel), sonst Rechnungsdatum
  const done = await db.first<{ at: string }>("SELECT MIN(at) AS at FROM events WHERE order_id = ? AND type = 'status' AND to_status = 'zugelassen'", orderId);
  const serviceDate = (done?.at || now()).slice(0, 10);
  const h = d.holder;
  const buyer = {
    name: h.typ === 'firma' ? h.firmenname : `${h.vorname} ${h.nachname}`.trim(),
    contact: h.typ === 'firma' ? h.ansprechpartner : '',
    street: `${h.strasse} ${h.hausnummer}`.trim(),
    city: `${h.plz} ${h.ort}`.trim(),
    email: h.email,
  };
  const number = await nextNumber('rechnung', company.invoicePrefix || 'RE');
  const row = await db.first<{ id: number }>(
    `INSERT INTO invoices (number, kind, order_id, customer_id, issued_at, service_date, net_cents, vat_cents, gross_cents, passthrough_cents, lines_json, seller_json, buyer_json, tax_mode, note, created_by)
     VALUES (?, 'rechnung', ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?) RETURNING id`,
    number,
    orderId,
    o.customer_id,
    now(),
    serviceDate,
    net,
    vat,
    gross,
    JSON.stringify(lines),
    JSON.stringify(company),
    JSON.stringify(buyer),
    company.taxMode === 'kleinunternehmer' ? 'kleinunternehmer' : `regel_${company.vatRate}`,
    note.slice(0, 500),
    actor,
  );
  if (!row) return { ok: false, error: 'Rechnung konnte nicht gespeichert werden' };
  await emitSafe({ type: 'invoice.issued', orderId, customerId: o.customer_id, actor, payload: { number, gross }, dedupeKey: `invoice.issued:${row.id}` });
  return { ok: true, id: row.id, number };
}

/** Gutschrift/Rechnungskorrektur: storniert eine Rechnung vollständig (Rechnungen werden nie gelöscht). */
export async function issueCredit(invoiceId: number, reason: string, actor: string): Promise<R<{ id: number; number: string }>> {
  if (!reason.trim()) return { ok: false, error: 'Begründung fehlt' };
  const db = await getDb();
  const inv = await db.first<{ id: number; number: string; kind: string; order_id: number; customer_id: number | null; net_cents: number; vat_cents: number; gross_cents: number; lines_json: string; seller_json: string; buyer_json: string; tax_mode: string }>(
    'SELECT * FROM invoices WHERE id = ?',
    invoiceId,
  );
  if (!inv || inv.kind !== 'rechnung') return { ok: false, error: 'Rechnung nicht gefunden' };
  if (await db.first("SELECT 1 AS x FROM invoices WHERE refers_to = ? AND kind = 'gutschrift'", invoiceId)) return { ok: false, error: 'Rechnung wurde bereits korrigiert' };
  const company = await getCompany(true);
  const number = await nextNumber('gutschrift', company.creditPrefix || 'GS');
  const lines = (JSON.parse(inv.lines_json) as InvoiceLine[]).map((l) => ({ ...l, grossCents: -l.grossCents, netCents: -l.netCents, vatCents: -l.vatCents }));
  const row = await db.first<{ id: number }>(
    `INSERT INTO invoices (number, kind, order_id, customer_id, refers_to, issued_at, service_date, net_cents, vat_cents, gross_cents, passthrough_cents, lines_json, seller_json, buyer_json, tax_mode, note, created_by)
     VALUES (?, 'gutschrift', ?, ?, ?, ?, '', ?, ?, ?, 0, ?, ?, ?, ?, ?, ?) RETURNING id`,
    number,
    inv.order_id,
    inv.customer_id,
    inv.id,
    now(),
    -inv.net_cents,
    -inv.vat_cents,
    -inv.gross_cents,
    JSON.stringify(lines),
    inv.seller_json,
    inv.buyer_json,
    inv.tax_mode,
    `Korrektur zu ${inv.number}: ${reason.trim().slice(0, 400)}`,
    actor,
  );
  if (!row) return { ok: false, error: 'Gutschrift konnte nicht gespeichert werden' };
  return { ok: true, id: row.id, number };
}

export async function listInvoices(filter: { orderId?: number; customerId?: number } = {}) {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.orderId) {
    where.push('i.order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.customerId) {
    where.push('i.customer_id = ?');
    params.push(filter.customerId);
  }
  return (await getDb()).all<{ id: number; number: string; kind: string; order_id: number; order_number: string; customer_id: number | null; refers_to: number | null; issued_at: string; net_cents: number; vat_cents: number; gross_cents: number; tax_mode: string; payment_status: string; corrected: number; buyer_json: string }>(
    `SELECT i.id, i.number, i.kind, i.order_id, o.number AS order_number, i.customer_id, i.refers_to, i.issued_at, i.net_cents, i.vat_cents, i.gross_cents, i.tax_mode, o.payment_status,
       (SELECT COUNT(*) FROM invoices g WHERE g.refers_to = i.id) AS corrected, i.buyer_json
     FROM invoices i JOIN orders o ON o.id = i.order_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issued_at DESC LIMIT 2000`,
    ...params,
  );
}

export async function getInvoice(id: number) {
  const r = await (await getDb()).first<{ id: number; number: string; kind: string; order_id: number; refers_to: number | null; issued_at: string; service_date: string; net_cents: number; vat_cents: number; gross_cents: number; lines_json: string; seller_json: string; buyer_json: string; tax_mode: string; note: string; order_number: string; ref_number: string | null }>(
    'SELECT i.*, o.number AS order_number, r.number AS ref_number FROM invoices i JOIN orders o ON o.id = i.order_id LEFT JOIN invoices r ON r.id = i.refers_to WHERE i.id = ?',
    id,
  );
  if (!r) return null;
  return { ...r, lines: JSON.parse(r.lines_json) as InvoiceLine[], seller: JSON.parse(r.seller_json) as Company, buyer: JSON.parse(r.buyer_json) as Record<string, string> };
}

/* ---------- Offene Posten & Abgleich ---------- */

export async function openItems() {
  return (await getDb()).all<{ id: number; number: string; holder_name: string; total_cents: number; created_at: string; status: string; invoice_number: string | null; days: number }>(
    `SELECT o.id, o.number, o.holder_name, o.total_cents, o.created_at, o.status,
       (SELECT i.number FROM invoices i WHERE i.order_id = o.id AND i.kind = 'rechnung' AND NOT EXISTS (SELECT 1 FROM invoices g WHERE g.refers_to = i.id) ORDER BY i.id DESC LIMIT 1) AS invoice_number,
       CAST((julianday('now') - julianday(o.created_at)) AS INTEGER) AS days
     FROM orders o WHERE o.payment_status = 'offen' AND o.status != 'storniert' AND o.total_cents > 0 ORDER BY o.created_at`,
  );
}

export async function reconciliation() {
  const db = await getDb();
  const [paidWithoutBooking, amountMismatch, cancelledPaid, failed, abandoned] = await Promise.all([
    db.all<{ id: number; number: string; total_cents: number }>(
      "SELECT o.id, o.number, o.total_cents FROM orders o WHERE o.payment_status = 'bezahlt' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id = o.id AND p.status = 'bezahlt')",
    ),
    db.all<{ id: number; number: string; total_cents: number; paid: number }>(
      "SELECT o.id, o.number, o.total_cents, SUM(p.amount_cents) AS paid FROM orders o JOIN payments p ON p.order_id = o.id AND p.kind IN ('zahlung', 'erstattung') AND p.status IN ('bezahlt', 'erstattet') GROUP BY o.id HAVING paid != o.total_cents AND o.payment_status = 'bezahlt'",
    ),
    db.all<{ id: number; number: string; total_cents: number }>("SELECT id, number, total_cents FROM orders WHERE status = 'storniert' AND payment_status = 'bezahlt'"),
    db.all<{ id: number; number: string; at: string }>(
      "SELECT o.id, o.number, p.at FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'fehlgeschlagen' AND o.payment_status != 'bezahlt' ORDER BY p.at DESC LIMIT 100",
    ),
    db.all<{ id: number; number: string; at: string }>(
      "SELECT o.id, o.number, p.at FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'abgebrochen' AND o.payment_status != 'bezahlt' ORDER BY p.at DESC LIMIT 100",
    ),
  ]);
  return { paidWithoutBooking, amountMismatch, cancelledPaid, failed, abandoned };
}

export async function listPayments(limit = 500) {
  return (await getDb()).all<{ id: number; order_id: number; number: string; at: string; provider: string; provider_ref: string; kind: string; status: string; amount_cents: number; fee_cents: number | null; method: string; note: string; created_by: string }>(
    'SELECT p.id, p.order_id, o.number, p.at, p.provider, p.provider_ref, p.kind, p.status, p.amount_cents, p.fee_cents, p.method, p.note, p.created_by FROM payments p JOIN orders o ON o.id = p.order_id ORDER BY p.at DESC LIMIT ?',
    Math.min(limit, 2000),
  );
}

/* ---------- Preisanpassung, Gutscheine, Geschäftskunden ---------- */

export const voucherSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9-]{3,30}$/, 'Code: 3–30 Zeichen A–Z, 0–9, -'),
  label: z.string().trim().max(120).default(''),
  kind: z.enum(['betrag', 'prozent']),
  value: z.number().int().positive(),
  valid_from: z.string().trim().max(10).default(''),
  valid_until: z.string().trim().max(10).default(''),
  max_uses: z.number().int().positive().nullable().default(null),
  active: z.boolean().default(true),
});

export async function listVouchers() {
  return (await getDb()).all('SELECT * FROM vouchers ORDER BY created_at DESC');
}

export async function saveVoucher(input: unknown): Promise<R> {
  const p = voucherSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const v = p.data;
  if (v.kind === 'prozent' && v.value > 100) return { ok: false, error: 'Prozent: höchstens 100' };
  await (await getDb()).run(
    `INSERT INTO vouchers (code, label, kind, value, valid_from, valid_until, max_uses, active, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(code) DO UPDATE SET label = excluded.label, kind = excluded.kind, value = excluded.value, valid_from = excluded.valid_from, valid_until = excluded.valid_until, max_uses = excluded.max_uses, active = excluded.active`,
    v.code,
    v.label,
    v.kind,
    v.value,
    v.valid_from,
    v.valid_until,
    v.max_uses,
    v.active ? 1 : 0,
    now(),
  );
  return { ok: true };
}

/**
 * Preis eines noch unbezahlten Auftrags anpassen (Gutschein, Geschäftskundenpreis, Mengenrabatt, Kulanz).
 * Wird als Buchung „preis_anpassung“ protokolliert und fließt in die Rechnung ein.
 */
export async function adjustPrice(orderId: number, input: { voucher?: string; percent?: number; cents?: number; reason: string }, actor: string): Promise<R<{ newTotal: number }>> {
  const db = await getDb();
  const o = await db.first<{ total_cents: number; payment_status: string; price_json: string; status: string }>('SELECT total_cents, payment_status, price_json, status FROM orders WHERE id = ?', orderId);
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (o.payment_status !== 'offen') return { ok: false, error: 'Nur bei offener Zahlung möglich' };
  if (o.status === 'storniert') return { ok: false, error: 'Auftrag ist storniert' };
  if (await db.first("SELECT 1 AS x FROM invoices i WHERE i.order_id = ? AND i.kind = 'rechnung' AND NOT EXISTS (SELECT 1 FROM invoices g WHERE g.refers_to = i.id)", orderId)) {
    return { ok: false, error: 'Es gibt bereits eine Rechnung – erst per Gutschrift korrigieren' };
  }
  const price = JSON.parse(o.price_json) as PriceBreakdown;
  // Basis für Prozent-Rabatte: regulärer Preis abzüglich Paketvorteil (ohne bereits gewährte Rabatte)
  const base = price.regularCents - price.bundleSaving;
  let delta = 0;
  let label = input.reason.trim();
  let voucherCode = '';
  if (input.voucher) {
    const v = await db.first<{ code: string; label: string; kind: string; value: number; valid_from: string; valid_until: string; max_uses: number | null; used: number; active: number }>(
      'SELECT * FROM vouchers WHERE code = ?',
      input.voucher.trim().toUpperCase(),
    );
    const today = now().slice(0, 10);
    if (!v || !v.active) return { ok: false, error: 'Gutschein unbekannt oder inaktiv' };
    if ((v.valid_from && today < v.valid_from) || (v.valid_until && today > v.valid_until)) return { ok: false, error: 'Gutschein nicht im Gültigkeitszeitraum' };
    if (v.max_uses !== null && v.used >= v.max_uses) return { ok: false, error: 'Gutschein ist aufgebraucht' };
    delta = v.kind === 'prozent' ? -Math.round((base * v.value) / 100) : -v.value;
    label = `Gutschein ${v.code}${v.label ? ` (${v.label})` : ''}`;
    voucherCode = v.code;
  } else if (input.percent !== undefined) {
    if (!(input.percent > 0 && input.percent <= 100)) return { ok: false, error: 'Prozent ungültig' };
    // Manueller Nachlass nur mit Begründung (nachvollziehbar im Verlauf und in der Buchung)
    if (!label) return { ok: false, error: 'Begründung fehlt' };
    delta = -Math.round((base * input.percent) / 100);
    label = `${label} (${input.percent} %)`;
  } else if (input.cents !== undefined) {
    if (!Number.isInteger(input.cents) || input.cents === 0) return { ok: false, error: 'Betrag ungültig' };
    delta = input.cents;
  }
  if (!label) return { ok: false, error: 'Begründung fehlt' };
  const newTotal = o.total_cents + delta;
  if (newTotal < 0) return { ok: false, error: 'Betrag würde negativ' };
  if (!delta) return { ok: false, error: 'Keine Änderung angegeben' };
  await db.batch([
    // Gutschein erst zählen, wenn die Anpassung wirklich gebucht wird
    ...(voucherCode ? [q('UPDATE vouchers SET used = used + 1 WHERE code = ?', voucherCode)] : []),
    q('UPDATE orders SET total_cents = ?, updated_at = ? WHERE id = ?', newTotal, now(), orderId),
    q(
      "INSERT INTO payments (order_id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by) VALUES (?, ?, 'manuell', '', 'preis_anpassung', 'gebucht', ?, NULL, '', ?, ?)",
      orderId,
      now(),
      delta,
      label,
      actor,
    ),
    q(
      "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'payment', NULL, NULL, ?, '', ?)",
      orderId,
      now(),
      `Preis angepasst: ${label} (${(delta / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' })})`,
      actor,
    ),
  ]);
  return { ok: true, newTotal };
}

export function serviceTitle(s: ServiceId): string {
  return SERVICES[s]?.title ?? s;
}
