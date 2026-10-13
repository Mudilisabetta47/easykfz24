// Kommunikationszentrale: ausgehende Kunden-E-Mails zu Aufträgen (Entwurf → Versand) mit Vorlagen.
// Eingehende Nachrichten gibt es erst mit einer echten E-Mail-Anbindung – hier wird nichts simuliert.

import { z } from 'zod';
import { statusLabel, type StatusId } from '../../lib/status.ts';
import { SERVICES, type ServiceId } from '../../lib/services.ts';
import { getDb } from '../db.ts';
import { mailConfigured, sendMail } from '../mailer.ts';
import { publicBaseUrl } from '../payments.ts';
import { getCompany } from './company.ts';
import { emitSafe } from './events.ts';

const now = () => new Date().toISOString();

export interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
}

/** Mitgelieferte Vorlagen – in der Kommunikationszentrale anpassbar (dann in mail_templates gespeichert). */
export const DEFAULT_TEMPLATES: Template[] = [
  {
    id: 'unterlagen_anfordern',
    name: 'Unterlagen anfordern',
    subject: 'Ihr Auftrag {{auftrag}}: Wir benötigen noch Unterlagen',
    body: 'Guten Tag {{anrede_name}},\n\nfür Ihren Auftrag {{auftrag}} ({{leistung}}) fehlen uns noch folgende Unterlagen:\n\n{{fehlende_unterlagen}}\n\nBitte senden Sie uns diese als Antwort auf diese E-Mail oder reichen Sie sie im Original ein.\n\nDen aktuellen Stand sehen Sie jederzeit hier: {{status_link}}\n\nFreundliche Grüße\n{{firma}}',
  },
  {
    id: 'rueckfrage',
    name: 'Rückfrage zum Auftrag',
    subject: 'Rückfrage zu Ihrem Auftrag {{auftrag}}',
    body: 'Guten Tag {{anrede_name}},\n\nzu Ihrem Auftrag {{auftrag}} haben wir eine Rückfrage:\n\n[Bitte Rückfrage eintragen]\n\nVielen Dank für Ihre Unterstützung.\n\nFreundliche Grüße\n{{firma}}',
  },
  {
    id: 'zulassung_abgeschlossen',
    name: 'Zulassung abgeschlossen',
    subject: 'Ihr Auftrag {{auftrag}} ist abgeschlossen',
    body: 'Guten Tag {{anrede_name}},\n\nIhr Vorgang ({{leistung}}) ist erledigt.{{kennzeichen_satz}}\n\n{{zustellung_satz}}\n\nDen Stand finden Sie hier: {{status_link}}\n\nVielen Dank für Ihren Auftrag!\n{{firma}}',
  },
  {
    id: 'versand_info',
    name: 'Versandinformation',
    subject: 'Ihre Unterlagen zu {{auftrag}} sind unterwegs',
    body: 'Guten Tag {{anrede_name}},\n\nIhre Unterlagen zum Auftrag {{auftrag}} wurden versendet.{{sendung_satz}}\n\nFreundliche Grüße\n{{firma}}',
  },
  {
    id: 'zahlung_erinnerung',
    name: 'Zahlungserinnerung',
    subject: 'Zahlung zu Ihrem Auftrag {{auftrag}}',
    body: 'Guten Tag {{anrede_name}},\n\nfür Ihren Auftrag {{auftrag}} ist die Zahlung über {{betrag}} noch offen. Sie können hier bezahlen: {{zahlung_link}}\n\nSollten Sie bereits bezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.\n\nFreundliche Grüße\n{{firma}}',
  },
];

export async function listTemplates(): Promise<(Template & { custom: boolean })[]> {
  const rows = await (await getDb()).all<Template>('SELECT id, name, subject, body FROM mail_templates');
  const map = new Map(rows.map((r) => [r.id, r]));
  const out = DEFAULT_TEMPLATES.map((t) => ({ ...(map.get(t.id) ?? t), custom: map.has(t.id) }));
  for (const r of rows) if (!DEFAULT_TEMPLATES.some((t) => t.id === r.id)) out.push({ ...r, custom: true });
  return out;
}

const templateSchema = z.object({
  id: z.string().trim().regex(/^[a-z0-9_]{3,40}$/, 'Kennung: 3–40 Zeichen a–z, 0–9, _'),
  name: z.string().trim().min(2).max(80),
  subject: z.string().trim().min(2).max(200),
  body: z.string().trim().min(2).max(8000),
});

export async function saveTemplate(input: unknown, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = templateSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const t = p.data;
  await (await getDb()).run(
    'INSERT INTO mail_templates (id, name, subject, body, updated_at, updated_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, subject = excluded.subject, body = excluded.body, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    t.id,
    t.name,
    t.subject,
    t.body,
    now(),
    by,
  );
  return { ok: true };
}

export async function resetTemplate(id: string): Promise<void> {
  await (await getDb()).run('DELETE FROM mail_templates WHERE id = ?', id);
}

interface OrderCtx {
  id: number;
  number: string;
  email: string;
  holder_name: string;
  service: ServiceId;
  status: StatusId;
  assigned_plate: string;
  delivery: string;
  carrier: string;
  tracking_number: string;
  total_cents: number;
  payment_status: string;
  payment_token: string;
  customer_id: number | null;
  data_json: string;
}

async function orderCtx(orderId: number): Promise<OrderCtx | null> {
  return (await getDb()).first<OrderCtx>(
    'SELECT id, number, email, holder_name, service, status, assigned_plate, delivery, carrier, tracking_number, total_cents, payment_status, payment_token, customer_id, data_json FROM orders WHERE id = ?',
    orderId,
  );
}

/** Platzhalter füllen – ausschließlich mit echten Auftragsdaten. Unbekannte Platzhalter bleiben sichtbar stehen. */
export async function renderTemplate(t: Pick<Template, 'subject' | 'body'>, orderId: number, extra: Record<string, string> = {}): Promise<{ subject: string; body: string; to: string } | null> {
  const o = await orderCtx(orderId);
  if (!o) return null;
  const company = await getCompany();
  const base = publicBaseUrl();
  const vars: Record<string, string> = {
    auftrag: o.number,
    anrede_name: o.holder_name,
    leistung: SERVICES[o.service]?.title ?? o.service,
    status: statusLabel(o.status, o.service, 'kunde'),
    status_link: `${base}/status?nr=${encodeURIComponent(o.number)}`,
    zahlung_link: o.payment_token ? `${base}/zahlung/${o.number}?t=${encodeURIComponent(o.payment_token)}` : `${base}/status?nr=${encodeURIComponent(o.number)}`,
    betrag: (o.total_cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' }),
    kennzeichen: o.assigned_plate,
    kennzeichen_satz: o.assigned_plate ? ` Ihr Kennzeichen lautet ${o.assigned_plate}.` : '',
    zustellung_satz: o.delivery === 'versand' ? 'Wir senden Ihnen die Unterlagen zu.' : 'Sie können die Unterlagen bei uns abholen.',
    sendung_satz: o.tracking_number ? ` Sendungsnummer: ${o.tracking_number}.` : '',
    firma: company.name || 'Ihr EasyKFZ24-Team',
    fehlende_unterlagen: extra.fehlende_unterlagen ?? '[Bitte Unterlagen eintragen]',
    ...extra,
  };
  const fill = (s: string) => s.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
  return { subject: fill(t.subject), body: fill(t.body), to: o.email };
}

/** Entwurf anlegen (z. B. durch Automatisierung). Wird nie automatisch versendet. */
export async function prepareMessage(orderId: number, templateId: string, author: string, extra: Record<string, string> = {}): Promise<number | null> {
  const t = (await listTemplates()).find((x) => x.id === templateId);
  if (!t) return null;
  const r = await renderTemplate(t, orderId, extra);
  const o = await orderCtx(orderId);
  if (!r || !o || !r.to) return null;
  const row = await (await getDb()).first<{ id: number }>(
    "INSERT INTO messages (at, order_id, customer_id, to_addr, subject, body, template_id, state, author, source) VALUES (?, ?, ?, ?, ?, ?, ?, 'entwurf', ?, ?) RETURNING id",
    now(),
    orderId,
    o.customer_id,
    r.to,
    r.subject,
    r.body,
    templateId,
    author,
    author === 'Automatisierung' ? 'automatisierung' : 'manuell',
  );
  if (row) await emitSafe({ type: 'message.prepared', orderId, customerId: o.customer_id, payload: { subject: r.subject, messageId: row.id }, dedupeKey: `message.prepared:${row.id}` });
  return row?.id ?? null;
}

const sendSchema = z.object({
  orderId: z.number().int().positive(),
  to: z.string().trim().email('Empfänger ungültig').max(160),
  subject: z.string().trim().min(2, 'Betreff fehlt').max(200),
  body: z.string().trim().min(2, 'Text fehlt').max(20_000),
  templateId: z.string().trim().max(40).default(''),
  draftId: z.number().int().positive().nullable().default(null),
});

/** Versand einer Kunden-E-Mail (Resend/SMTP). Ergebnis wird mit echtem Versandstatus gespeichert. */
export async function sendMessage(input: unknown, author: string): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const p = sendSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const m = p.data;
  const o = await orderCtx(m.orderId);
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (!mailConfigured()) return { ok: false, error: 'E-Mail-Versand ist nicht eingerichtet (RESEND_API_KEY / MAIL_FROM)' };
  const company = await getCompany();
  const res = await sendMail({ to: m.to, subject: m.subject, text: m.body, ...(company.replyTo ? { replyTo: company.replyTo } : {}) });
  const db = await getDb();
  const state = res.state === 'versendet' ? 'versendet' : res.state === 'fehler' ? 'fehler' : 'nicht_versendet';
  const error = res.state === 'fehler' ? res.error : res.state === 'nicht_konfiguriert' ? 'E-Mail-Versand nicht eingerichtet' : '';
  let id = m.draftId;
  if (id) {
    await db.run(
      "UPDATE messages SET to_addr = ?, subject = ?, body = ?, state = ?, error = ?, author = ?, sent_at = ? WHERE id = ? AND state IN ('entwurf', 'fehler', 'nicht_versendet')",
      m.to,
      m.subject,
      m.body,
      state,
      error,
      author,
      state === 'versendet' ? now() : '',
      id,
    );
  } else {
    const row = await db.first<{ id: number }>(
      'INSERT INTO messages (at, order_id, customer_id, to_addr, subject, body, template_id, state, error, author, sent_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
      now(),
      m.orderId,
      o.customer_id,
      m.to,
      m.subject,
      m.body,
      m.templateId,
      state,
      error,
      author,
      state === 'versendet' ? now() : '',
    );
    id = row?.id ?? null;
  }
  // Versandnachweis des Anbieters (Resend-ID) für Zustellprüfung im Resend-Dashboard
  if (res.state === 'versendet' && res.id && id) await db.run('UPDATE messages SET provider_id = ? WHERE id = ?', res.id, id);
  await emitSafe({
    type: state === 'versendet' ? 'message.sent' : 'message.failed',
    orderId: m.orderId,
    customerId: o.customer_id,
    actor: author,
    payload: { subject: m.subject, error, messageId: id },
    dedupeKey: `message.${state}:${id}:${now()}`,
  });
  return state === 'versendet' ? { ok: true, state } : { ok: false, error: error || 'Versand fehlgeschlagen' };
}

export async function deleteDraft(id: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const r = await (await getDb()).run("DELETE FROM messages WHERE id = ? AND state = 'entwurf'", id);
  return r.changes ? { ok: true } : { ok: false, error: 'Nur Entwürfe können verworfen werden' };
}

/** Nachrichtenverlauf: eigene Nachrichten + automatische Statusmails (Tabelle notifications) zusammengeführt. */
export async function listMessages(filter: { orderId?: number; customerId?: number; state?: string; limit?: number } = {}) {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.orderId) {
    where.push('m.order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.customerId) {
    where.push('m.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.state) {
    where.push('m.state = ?');
    params.push(filter.state);
  }
  const limit = Math.min(filter.limit ?? 300, 1000);
  const own = await db.all<{ id: number; at: string; order_id: number | null; number: string | null; customer_id: number | null; to_addr: string; subject: string; body: string; state: string; error: string; author: string; sent_at: string; template_id: string; source: string; mail_kind: string; attempts: number; provider_id: string; next_attempt_at: string; automatic: number }>(
    `SELECT m.id, m.at, m.order_id, o.number, m.customer_id, m.to_addr, m.subject, m.body, m.state, m.error, m.author, m.sent_at, m.template_id, m.source,
       m.mail_kind, m.attempts, m.provider_id, m.next_attempt_at, m.dedupe_key != '' AS automatic
     FROM messages m LEFT JOIN orders o ON o.id = m.order_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY m.at DESC LIMIT ?`,
    ...params,
    limit,
  );
  const autoWhere: string[] = [];
  const autoParams: (string | number)[] = [];
  if (filter.orderId) {
    autoWhere.push('n.order_id = ?');
    autoParams.push(filter.orderId);
  }
  if (filter.customerId) {
    autoWhere.push('o.customer_id = ?');
    autoParams.push(filter.customerId);
  }
  if (filter.state === 'fehler') autoWhere.push("n.state = 'fehler'");
  else if (filter.state === 'entwurf') autoWhere.push('1 = 0');
  const auto = await db.all<{ id: number; at: string; order_id: number; number: string; subject: string; state: string; error: string; topic: string }>(
    `SELECT n.id, n.at, n.order_id, o.number, n.subject, n.state, n.error, n.topic FROM notifications n JOIN orders o ON o.id = n.order_id
     ${autoWhere.length ? `WHERE ${autoWhere.join(' AND ')}` : ''} ORDER BY n.at DESC LIMIT ?`,
    ...autoParams,
    limit,
  );
  return { messages: own, statusMails: auto, mailReady: mailConfigured() };
}
