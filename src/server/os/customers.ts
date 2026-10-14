// Kundenstamm (CRM): Kunden, Standorte, Ansprechpartner, Fahrzeuge. Aufträge werden einem bestehenden Kunden
// zugeordnet (E-Mail-Adresse) statt bei jeder Bestellung einen losen Datensatz zu erzeugen.

import { z } from 'zod';
import type { ValidatedOrder } from '../../lib/order.ts';
import { getDb, q } from '../db.ts';
import { deleteBlobs } from '../blobs.ts';
import { emitSafe } from './events.ts';
import { PARTNER_RETENTION_DAYS, retainedOrderIds, retainedOrders } from './partner-retention.ts';

const now = () => new Date().toISOString();
export const normEmail = (e: string) => e.trim().toLowerCase();
const digits = (s: string) => s.replace(/\D/g, '');

export const CUSTOMER_CATEGORIES = ['', 'Stammkunde', 'Autohaus', 'Flotte', 'Gewerbe', 'Privat', 'VIP', 'Gesperrt'] as const;

export interface CustomerRow {
  id: number;
  number: string;
  type: 'privat' | 'firma';
  name: string;
  first_name: string;
  last_name: string;
  company: string;
  register_no: string;
  email: string;
  phone: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
  category: string;
  owner_id: number | null;
  price_group: string;
  notes: string;
  created_at: string;
  updated_at: string;
  anonymized_at: string;
}

export interface CustomerListRow extends CustomerRow {
  orders: number;
  open_orders: number;
  vehicles: number;
  revenue_cents: number;
  open_cents: number;
  last_order_at: string | null;
}

async function nextNumber(id: number): Promise<string> {
  return `K${String(id).padStart(6, '0')}`;
}

/* ---------- Zuordnung Auftrag → Kunde ---------- */

/**
 * Ordnet einen Auftrag dem Kundenstamm zu (bestehender Kunde per E-Mail, sonst neu) und pflegt das Fahrzeug.
 * Idempotent: ist der Auftrag schon zugeordnet, passiert nichts.
 */
export async function linkOrderToCustomer(orderId: number, opts: { emitEvents?: boolean } = {}): Promise<{ customerId: number; created: boolean; orders: number } | null> {
  const db = await getDb();
  const o = await db.first<{ id: number; customer_id: number | null; email: string; data_json: string; assigned_plate: string; previous_plate: string; created_at: string; is_test: number }>(
    'SELECT id, customer_id, email, data_json, assigned_plate, previous_plate, created_at, is_test FROM orders WHERE id = ?',
    orderId,
  );
  // Testaufträge nie mit dem Kundenstamm verbinden
  if (!o || o.is_test) return null;
  if (o.customer_id) return { customerId: o.customer_id, created: false, orders: 0 };
  const d = JSON.parse(o.data_json) as ValidatedOrder;
  const h = d.holder;
  const email = normEmail(o.email);
  let customer = await db.first<{ id: number }>("SELECT id FROM customers WHERE email_norm = ? AND anonymized_at = '' ORDER BY id LIMIT 1", email);
  let created = false;
  if (!customer) {
    const at = o.created_at || now();
    const name = h.typ === 'firma' ? h.firmenname : `${h.vorname} ${h.nachname}`.trim();
    const row = await db.first<{ id: number }>(
      `INSERT INTO customers (number, type, name, first_name, last_name, company, register_no, email, email_norm, phone, street, house_no, zip, city, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
      `tmp-${orderId}-${Math.random().toString(36).slice(2)}`,
      h.typ,
      name || o.email,
      h.vorname,
      h.nachname,
      h.firmenname,
      h.registernummer,
      o.email.trim(),
      email,
      h.telefon,
      h.strasse,
      h.hausnummer,
      h.plz,
      h.ort,
      at,
      at,
    );
    if (!row) throw new Error('Kunde konnte nicht angelegt werden');
    await db.run('UPDATE customers SET number = ? WHERE id = ?', await nextNumber(row.id), row.id);
    if (h.typ === 'firma' && h.ansprechpartner) {
      await db.run('INSERT INTO customer_contacts (customer_id, name, role, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)', row.id, h.ansprechpartner, 'Ansprechpartner (aus Auftrag)', o.email, h.telefon, at);
    }
    customer = row;
    created = true;
  }
  const plate = o.assigned_plate || o.previous_plate || '';
  const vehicle = d.vehicle.fin
    ? await db.first<{ id: number }>(
        `INSERT INTO vehicles (customer_id, fin, make, model, vehicle_type, plate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(customer_id, fin) DO UPDATE SET make = excluded.make, model = excluded.model, plate = CASE WHEN excluded.plate != '' THEN excluded.plate ELSE vehicles.plate END, updated_at = excluded.updated_at
         RETURNING id`,
        customer.id,
        d.vehicle.fin.toUpperCase(),
        d.vehicle.hersteller,
        d.vehicle.modell,
        d.vehicle.art,
        plate,
        now(),
        now(),
      )
    : null;
  await db.run('UPDATE orders SET customer_id = ?, vehicle_id = ? WHERE id = ?', customer.id, vehicle?.id ?? null, orderId);
  const count = (await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE customer_id = ?', customer.id))?.n ?? 1;
  if (opts.emitEvents) {
    if (created) await emitSafe({ type: 'customer.created', customerId: customer.id, orderId, dedupeKey: `customer.created:${customer.id}` });
    else await emitSafe({ type: 'customer.returning', customerId: customer.id, orderId, payload: { orders: count }, dedupeKey: `customer.returning:${orderId}` });
  }
  return { customerId: customer.id, created, orders: count };
}

const g = globalThis as unknown as { __ekCustomerBackfill?: boolean };

/**
 * Bestehende Aufträge (vor dem Kundenstamm) zuordnen – in kleinen Portionen je Anfrage, damit die
 * Abfragegrenze von Cloudflare D1 je Aufruf nie erreicht wird (je Auftrag ca. 5 Abfragen).
 */
const BACKFILL_CHUNK = 6;
export async function backfillCustomers(): Promise<number> {
  if (g.__ekCustomerBackfill) return 0;
  const db = await getDb();
  const rows = await db.all<{ id: number }>('SELECT id FROM orders WHERE customer_id IS NULL AND is_test = 0 ORDER BY created_at, id LIMIT ?', BACKFILL_CHUNK);
  for (const r of rows) await linkOrderToCustomer(r.id);
  if (rows.length < BACKFILL_CHUNK) g.__ekCustomerBackfill = true;
  return rows.length;
}

/* ---------- Lesen ---------- */

export async function listCustomers(filter: { q?: string; category?: string; type?: string; ownerId?: number | null; limit?: number } = {}): Promise<CustomerListRow[]> {
  await backfillCustomers();
  const where: string[] = ["c.anonymized_at = ''"];
  const params: (string | number)[] = [];
  const needle = filter.q?.trim();
  if (needle) {
    const like = `%${needle.toLowerCase().replace(/[\\%_]/g, (x) => `\\${x}`)}%`;
    const tel = digits(needle);
    where.push(
      `(lower(c.name) LIKE ? ESCAPE '\\' OR c.email_norm LIKE ? ESCAPE '\\' OR c.number LIKE ? ESCAPE '\\' OR lower(c.company) LIKE ? ESCAPE '\\' OR lower(c.city) LIKE ? ESCAPE '\\'
        ${tel.length >= 4 ? "OR replace(replace(replace(c.phone, ' ', ''), '/', ''), '-', '') LIKE ?" : ''}
        OR EXISTS (SELECT 1 FROM vehicles v WHERE v.customer_id = c.id AND (lower(v.fin) LIKE ? ESCAPE '\\' OR lower(v.plate) LIKE ? ESCAPE '\\'))
        OR EXISTS (SELECT 1 FROM orders o2 WHERE o2.customer_id = c.id AND lower(o2.number) LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM customer_contacts cc WHERE cc.customer_id = c.id AND (lower(cc.name) LIKE ? ESCAPE '\\' OR lower(cc.email) LIKE ? ESCAPE '\\')))`,
    );
    params.push(like, like, like, like, like);
    if (tel.length >= 4) params.push(`%${tel}%`);
    params.push(like, like, like, like, like);
  }
  if (filter.category) {
    where.push('c.category = ?');
    params.push(filter.category);
  }
  if (filter.type === 'privat' || filter.type === 'firma') {
    where.push('c.type = ?');
    params.push(filter.type);
  }
  if (filter.ownerId !== undefined && filter.ownerId !== null) {
    where.push('c.owner_id = ?');
    params.push(filter.ownerId);
  }
  params.push(Math.min(filter.limit ?? 500, 2000));
  return (await getDb()).all<CustomerListRow>(
    `SELECT c.*,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id) AS orders,
       (SELECT COUNT(*) FROM orders o WHERE o.customer_id = c.id AND o.status NOT IN ('abgeschlossen', 'storniert', 'versendet', 'abgeholt')) AS open_orders,
       (SELECT COUNT(*) FROM vehicles v WHERE v.customer_id = c.id) AS vehicles,
       (SELECT COALESCE(SUM(total_cents), 0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'storniert') AS revenue_cents,
       (SELECT COALESCE(SUM(total_cents), 0) FROM orders o WHERE o.customer_id = c.id AND o.status != 'storniert' AND o.payment_status = 'offen') AS open_cents,
       (SELECT MAX(created_at) FROM orders o WHERE o.customer_id = c.id) AS last_order_at
     FROM customers c WHERE ${where.join(' AND ')} ORDER BY COALESCE(last_order_at, c.created_at) DESC LIMIT ?`,
    ...params,
  );
}

export async function getCustomer(id: number) {
  await backfillCustomers();
  const db = await getDb();
  const c = await db.first<CustomerRow>('SELECT * FROM customers WHERE id = ?', id);
  if (!c) return null;
  const [locations, contacts, vehicles, orders, documents, messages, invoices, tasks, mails] = await Promise.all([
    db.all('SELECT * FROM customer_locations WHERE customer_id = ? ORDER BY label', id),
    db.all('SELECT * FROM customer_contacts WHERE customer_id = ? ORDER BY name', id),
    db.all<{ id: number; fin: string; make: string; model: string; vehicle_type: string; plate: string; orders: number }>(
      'SELECT v.*, (SELECT COUNT(*) FROM orders o WHERE o.vehicle_id = v.id) AS orders FROM vehicles v WHERE v.customer_id = ? ORDER BY v.updated_at DESC',
      id,
    ),
    db.all(
      'SELECT id, number, service, status, payment_status, total_cents, created_at, assigned_plate, fin, kfz_display, vehicle_id FROM orders WHERE customer_id = ? ORDER BY created_at DESC',
      id,
    ),
    db.all(
      "SELECT d.id, d.order_id, o.number, d.kind, d.original_name, d.display_name, d.category, d.mime, d.size, d.created_at, d.expires_at FROM documents d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = ? AND d.deleted_at = '' AND d.superseded_at = '' ORDER BY d.created_at DESC",
      id,
    ),
    db.all('SELECT id, at, order_id, direction, kind, to_addr, subject, state, error, author, sent_at FROM messages WHERE customer_id = ? ORDER BY at DESC LIMIT 200', id),
    db.all('SELECT id, number, kind, order_id, issued_at, gross_cents, net_cents, vat_cents FROM invoices WHERE customer_id = ? ORDER BY issued_at DESC', id),
    db.all("SELECT id, title, status, priority, due_at, assignee_id, order_id FROM tasks WHERE customer_id = ? OR order_id IN (SELECT id FROM orders WHERE customer_id = ?) ORDER BY CASE status WHEN 'erledigt' THEN 1 ELSE 0 END, due_at", id, id),
    db.all(
      'SELECT n.at, n.subject, n.state, n.error, o.number FROM notifications n JOIN orders o ON o.id = n.order_id WHERE o.customer_id = ? ORDER BY n.at DESC LIMIT 100',
      id,
    ),
  ]);
  return { customer: c, locations, contacts, vehicles, orders, documents, messages, invoices, tasks, statusMails: mails };
}

/* ---------- Schreiben ---------- */

export const customerSchema = z.object({
  type: z.enum(['privat', 'firma']),
  first_name: z.string().trim().max(80).default(''),
  last_name: z.string().trim().max(80).default(''),
  company: z.string().trim().max(160).default(''),
  register_no: z.string().trim().max(60).default(''),
  email: z.string().trim().max(160).email('E-Mail-Adresse ungültig').or(z.literal('')).default(''),
  phone: z.string().trim().max(40).default(''),
  street: z.string().trim().max(120).default(''),
  house_no: z.string().trim().max(20).default(''),
  zip: z.string().trim().max(10).default(''),
  city: z.string().trim().max(80).default(''),
  category: z.string().trim().max(40).default(''),
  owner_id: z.number().int().min(0).nullable().default(null),
  price_group: z.string().trim().max(40).default(''),
  notes: z.string().trim().max(4000).default(''),
});
export type CustomerInput = z.infer<typeof customerSchema>;

function displayName(c: CustomerInput): string {
  return c.type === 'firma' ? c.company : `${c.first_name} ${c.last_name}`.trim();
}

export async function createCustomer(input: unknown, actor: string): Promise<{ ok: true; id: number; duplicates: number[] } | { ok: false; error: string }> {
  const p = customerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültige Angaben' };
  const c = p.data;
  const name = displayName(c);
  if (!name) return { ok: false, error: c.type === 'firma' ? 'Firmenname fehlt' : 'Name fehlt' };
  const db = await getDb();
  const at = now();
  const row = await db.first<{ id: number }>(
    `INSERT INTO customers (number, type, name, first_name, last_name, company, register_no, email, email_norm, phone, street, house_no, zip, city, category, owner_id, price_group, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    `tmp-${Math.random().toString(36).slice(2)}`,
    c.type,
    name,
    c.first_name,
    c.last_name,
    c.company,
    c.register_no,
    c.email,
    normEmail(c.email),
    c.phone,
    c.street,
    c.house_no,
    c.zip,
    c.city,
    c.category,
    c.owner_id,
    c.price_group,
    c.notes,
    at,
    at,
  );
  if (!row) return { ok: false, error: 'Kunde konnte nicht angelegt werden' };
  await db.run('UPDATE customers SET number = ? WHERE id = ?', await nextNumber(row.id), row.id);
  await emitSafe({ type: 'customer.created', customerId: row.id, actor, dedupeKey: `customer.created:${row.id}` });
  const dup = (await findDuplicates()).find((grp) => grp.ids.includes(row.id));
  return { ok: true, id: row.id, duplicates: dup ? dup.ids.filter((x) => x !== row.id) : [] };
}

export async function updateCustomer(id: number, input: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = customerSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültige Angaben' };
  const c = p.data;
  const name = displayName(c);
  if (!name) return { ok: false, error: 'Name fehlt' };
  const db = await getDb();
  const cur = await db.first<{ anonymized_at: string }>('SELECT anonymized_at FROM customers WHERE id = ?', id);
  if (!cur) return { ok: false, error: 'Kunde nicht gefunden' };
  if (cur.anonymized_at) return { ok: false, error: 'Kunde wurde anonymisiert' };
  await db.run(
    `UPDATE customers SET type = ?, name = ?, first_name = ?, last_name = ?, company = ?, register_no = ?, email = ?, email_norm = ?, phone = ?, street = ?, house_no = ?, zip = ?, city = ?,
       category = ?, owner_id = ?, price_group = ?, notes = ?, updated_at = ? WHERE id = ?`,
    c.type,
    name,
    c.first_name,
    c.last_name,
    c.company,
    c.register_no,
    c.email,
    normEmail(c.email),
    c.phone,
    c.street,
    c.house_no,
    c.zip,
    c.city,
    c.category,
    c.owner_id,
    c.price_group,
    c.notes,
    now(),
    id,
  );
  return { ok: true };
}

const contactSchema = z.object({
  name: z.string().trim().min(1, 'Name fehlt').max(120),
  role: z.string().trim().max(80).default(''),
  email: z.string().trim().max(160).email('E-Mail-Adresse ungültig').or(z.literal('')).default(''),
  phone: z.string().trim().max(40).default(''),
  location_id: z.number().int().nullable().default(null),
});
const locationSchema = z.object({
  label: z.string().trim().min(1, 'Bezeichnung fehlt').max(80),
  street: z.string().trim().max(120).default(''),
  house_no: z.string().trim().max(20).default(''),
  zip: z.string().trim().max(10).default(''),
  city: z.string().trim().max(80).default(''),
});
const vehicleSchema = z.object({
  fin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/, 'FIN: 17 Zeichen, ohne I, O, Q'),
  make: z.string().trim().max(60).default(''),
  model: z.string().trim().max(60).default(''),
  vehicle_type: z.string().trim().max(30).default(''),
  plate: z.string().trim().toUpperCase().max(20).default(''),
});

type R = { ok: true; id?: number } | { ok: false; error: string };

export async function saveContact(customerId: number, contactId: number | null, input: unknown): Promise<R> {
  const p = contactSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const c = p.data;
  const db = await getDb();
  if (contactId) {
    await db.run('UPDATE customer_contacts SET name = ?, role = ?, email = ?, phone = ?, location_id = ? WHERE id = ? AND customer_id = ?', c.name, c.role, c.email, c.phone, c.location_id, contactId, customerId);
    return { ok: true, id: contactId };
  }
  const row = await db.first<{ id: number }>(
    'INSERT INTO customer_contacts (customer_id, location_id, name, role, email, phone, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    customerId,
    c.location_id,
    c.name,
    c.role,
    c.email,
    c.phone,
    now(),
  );
  return { ok: true, id: row?.id };
}

export async function saveLocation(customerId: number, locationId: number | null, input: unknown): Promise<R> {
  const p = locationSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const l = p.data;
  const db = await getDb();
  if (locationId) {
    await db.run('UPDATE customer_locations SET label = ?, street = ?, house_no = ?, zip = ?, city = ? WHERE id = ? AND customer_id = ?', l.label, l.street, l.house_no, l.zip, l.city, locationId, customerId);
    return { ok: true, id: locationId };
  }
  const row = await db.first<{ id: number }>(
    'INSERT INTO customer_locations (customer_id, label, street, house_no, zip, city, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
    customerId,
    l.label,
    l.street,
    l.house_no,
    l.zip,
    l.city,
    now(),
  );
  return { ok: true, id: row?.id };
}

export async function deleteContactOrLocation(kind: 'contact' | 'location', customerId: number, id: number): Promise<R> {
  const db = await getDb();
  if (kind === 'contact') await db.run('DELETE FROM customer_contacts WHERE id = ? AND customer_id = ?', id, customerId);
  else {
    await db.batch([q('UPDATE customer_contacts SET location_id = NULL WHERE location_id = ? AND customer_id = ?', id, customerId), q('DELETE FROM customer_locations WHERE id = ? AND customer_id = ?', id, customerId)]);
  }
  return { ok: true };
}

export async function saveVehicle(customerId: number, vehicleId: number | null, input: unknown): Promise<R> {
  const p = vehicleSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültig' };
  const v = p.data;
  const db = await getDb();
  const other = await db.first<{ id: number }>('SELECT id FROM vehicles WHERE customer_id = ? AND fin = ? AND id != ?', customerId, v.fin, vehicleId ?? 0);
  if (other) return { ok: false, error: 'Fahrzeug mit dieser FIN ist bei diesem Kunden bereits vorhanden' };
  if (vehicleId) {
    await db.run('UPDATE vehicles SET fin = ?, make = ?, model = ?, vehicle_type = ?, plate = ?, updated_at = ? WHERE id = ? AND customer_id = ?', v.fin, v.make, v.model, v.vehicle_type, v.plate, now(), vehicleId, customerId);
    return { ok: true, id: vehicleId };
  }
  const row = await db.first<{ id: number }>(
    'INSERT INTO vehicles (customer_id, fin, make, model, vehicle_type, plate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
    customerId,
    v.fin,
    v.make,
    v.model,
    v.vehicle_type,
    v.plate,
    now(),
    now(),
  );
  return { ok: true, id: row?.id };
}

/* ---------- Dubletten ---------- */

export interface DuplicateGroup {
  reason: string;
  ids: number[];
  names: string[];
}

/** Mögliche Dubletten: gleiche Telefonnummer, gleicher Name + PLZ oder gleicher Firmenname. */
export async function findDuplicates(): Promise<DuplicateGroup[]> {
  const rows = await (await getDb()).all<{ id: number; name: string; phone: string; zip: string; company: string; email_norm: string }>(
    "SELECT id, name, phone, zip, company, email_norm FROM customers WHERE anonymized_at = '' LIMIT 5000",
  );
  const groups = new Map<string, DuplicateGroup>();
  const add = (key: string, reason: string, r: (typeof rows)[number]) => {
    const gr = groups.get(key) ?? { reason, ids: [], names: [] };
    if (!gr.ids.includes(r.id)) {
      gr.ids.push(r.id);
      gr.names.push(r.name);
    }
    groups.set(key, gr);
  };
  for (const r of rows) {
    const tel = digits(r.phone);
    if (tel.length >= 7) add(`tel:${tel.slice(-9)}`, 'gleiche Telefonnummer', r);
    if (r.name && r.zip) add(`name:${r.name.toLowerCase().replace(/\s+/g, ' ')}|${r.zip}`, 'gleicher Name und PLZ', r);
    if (r.company) add(`firma:${r.company.toLowerCase().replace(/[^a-z0-9äöüß]/g, '')}`, 'gleicher Firmenname', r);
    if (r.email_norm) add(`mail:${r.email_norm}`, 'gleiche E-Mail-Adresse', r);
  }
  return [...groups.values()].filter((gr) => gr.ids.length > 1);
}

/** Quelle in Ziel zusammenführen: Aufträge, Fahrzeuge, Ansprechpartner, Standorte, Aufgaben, Nachrichten, Rechnungen. */
export async function mergeCustomers(targetId: number, sourceId: number, actor: string): Promise<R> {
  if (targetId === sourceId) return { ok: false, error: 'Ziel und Quelle sind identisch' };
  const db = await getDb();
  const [t, s] = await Promise.all([
    db.first<{ id: number; anonymized_at: string }>('SELECT id, anonymized_at FROM customers WHERE id = ?', targetId),
    db.first<{ id: number; anonymized_at: string }>('SELECT id, anonymized_at FROM customers WHERE id = ?', sourceId),
  ]);
  if (!t || !s) return { ok: false, error: 'Kunde nicht gefunden' };
  if (t.anonymized_at || s.anonymized_at) return { ok: false, error: 'Anonymisierte Kunden können nicht zusammengeführt werden' };
  const srcVehicles = await db.all<{ id: number; fin: string }>('SELECT id, fin FROM vehicles WHERE customer_id = ?', sourceId);
  const stmts = [];
  for (const v of srcVehicles) {
    const existing = await db.first<{ id: number }>('SELECT id FROM vehicles WHERE customer_id = ? AND fin = ?', targetId, v.fin);
    if (existing) {
      stmts.push(q('UPDATE orders SET vehicle_id = ? WHERE vehicle_id = ?', existing.id, v.id), q('DELETE FROM vehicles WHERE id = ?', v.id));
    } else stmts.push(q('UPDATE vehicles SET customer_id = ? WHERE id = ?', targetId, v.id));
  }
  stmts.push(
    q('UPDATE orders SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE customer_contacts SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE customer_locations SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE tasks SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE messages SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE invoices SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('UPDATE os_notifications SET customer_id = ? WHERE customer_id = ?', targetId, sourceId),
    q('DELETE FROM customers WHERE id = ?', sourceId),
    q('UPDATE customers SET updated_at = ? WHERE id = ?', now(), targetId),
  );
  await db.batch(stmts);
  await emitSafe({ type: 'customer.merged', customerId: targetId, actor, payload: { sourceId }, dedupeKey: `customer.merged:${sourceId}->${targetId}` });
  return { ok: true };
}

/* ---------- DSGVO ---------- */

/** Auskunft nach Art. 15 DSGVO: alle gespeicherten Daten zum Kunden (ohne Dateiinhalte, mit Dateiliste). */
export async function exportCustomer(id: number): Promise<Record<string, unknown> | null> {
  const full = await getCustomer(id);
  if (!full) return null;
  const db = await getDb();
  const orderData = await db.all<{ number: string; created_at: string; data_json: string; price_json: string; status: string; payment_status: string }>(
    'SELECT number, created_at, data_json, price_json, status, payment_status FROM orders WHERE customer_id = ? ORDER BY created_at',
    id,
  );
  return {
    erstellt: now(),
    hinweis: 'Auskunft nach Art. 15 DSGVO – EasyKFZ24. Dateien (Ausweis, Fahrzeugpapiere) werden auf Anfrage gesondert bereitgestellt.',
    kunde: full.customer,
    standorte: full.locations,
    ansprechpartner: full.contacts,
    fahrzeuge: full.vehicles,
    auftraege: orderData.map((o) => ({ ...o, data_json: undefined, price_json: undefined, angaben: JSON.parse(o.data_json), preis: JSON.parse(o.price_json) })),
    dokumente: full.documents,
    nachrichten: full.messages,
    statusmails: full.statusMails,
    rechnungen: full.invoices,
  };
}

/** Prüft, was gelöscht werden darf und was wegen Aufbewahrungspflichten bleiben muss. */
export async function erasureCheck(id: number): Promise<{ blockers: string[]; retained: string[]; erasable: string[] }> {
  const db = await getDb();
  const open = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND status NOT IN ('abgeschlossen', 'storniert', 'versendet', 'abgeholt')", id);
  const invoices = await db.first<{ n: number; first: string | null }>('SELECT COUNT(*) AS n, MIN(issued_at) AS first FROM invoices WHERE customer_id = ?', id);
  const paid = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM orders WHERE customer_id = ? AND payment_status IN ('bezahlt', 'erstattet')", id);
  const docs = await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM documents d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = ? AND d.deleted_at = ''", id);
  const blockers: string[] = [];
  if (open?.n) blockers.push(`${open.n} laufende(r) Auftrag/Aufträge – erst abschließen oder stornieren`);
  const retained: string[] = [];
  const kept = await retainedOrders(id);
  if (kept.length)
    retained.push(
      `Auftragsangaben, Unterlagen, Vollmachtsnachweise und Korrespondenz von ${kept.length} an den Zulassungspartner übermittelten Auftrag/Aufträgen (${kept
        .map((k) => `${k.number} bis ${k.until}`)
        .join(', ')}) – Aufbewahrung mindestens ${Math.round(PARTNER_RETENTION_DAYS / 366)} Jahre ab Antragstellung (Partnervertrag POWR § 4 Abs. 6); danach erneut prüfen und anonymisieren`,
    );
  if (invoices?.n) retained.push(`${invoices.n} Rechnung(en)/Gutschrift(en) inkl. Rechnungsanschrift – Aufbewahrung 8 bzw. 10 Jahre (§ 147 AO, § 14b UStG)`);
  if (paid?.n) retained.push(`Buchungsrelevante Auftragsdaten (Nummer, Leistung, Betrag, Zahlungsstatus) von ${paid.n} Auftrag/Aufträgen`);
  const erasable = [
    'Kontaktdaten im Kundenstamm (Name, Anschrift, Telefon, E-Mail), Ansprechpartner, Standorte, Notizen',
    'Personenbezogene Auftragsangaben (Geburtsdatum, IBAN, eVB, Anschrift, Hinweise) in allen Aufträgen',
    `${docs?.n ?? 0} hochgeladene Dokumente (Ausweis, Fahrzeugpapiere) – Dateien werden endgültig entfernt`,
    'Nachrichteninhalte',
  ];
  return { blockers, retained, erasable };
}

/** Anonymisieren (Löschung nach Art. 17 DSGVO unter Wahrung der Aufbewahrungspflichten). Nicht umkehrbar. */
export async function anonymizeCustomer(id: number, actor: string): Promise<R> {
  const check = await erasureCheck(id);
  if (check.blockers.length) return { ok: false, error: check.blockers.join('; ') };
  const db = await getDb();
  // Aufträge unter Aufbewahrung (Partnervertrag § 4 Abs. 6) bleiben samt Unterlagen unverändert
  const kept = new Set(await retainedOrderIds(id));
  const orders = (await db.all<{ id: number; data_json: string }>('SELECT id, data_json FROM orders WHERE customer_id = ?', id)).filter((o) => !kept.has(o.id));
  const docs = (
    await db.all<{ id: string; stored_name: string; order_id: number }>(
      "SELECT d.id, d.stored_name, d.order_id FROM documents d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = ? AND d.deleted_at = ''",
      id,
    )
  ).filter((d) => !kept.has(d.order_id));
  const at = now();
  const stmts = [];
  for (const o of orders) {
    const d = JSON.parse(o.data_json) as ValidatedOrder;
    const holder = { ...d.holder, vorname: '', nachname: 'gelöscht', geburtsdatum: '', strasse: '', hausnummer: '', plz: '', ort: '', email: '', telefon: '', ansprechpartner: '', registernummer: '', firmenname: d.holder.typ === 'firma' ? 'gelöscht' : '' };
    const finish = { ...d.finish, evb: '', kontoinhaber: '', iban: '', hinweise: '' };
    stmts.push(
      q(
        "UPDATE orders SET data_json = ?, holder_name = 'gelöscht', email = '', iban = '', payment_token = '', updated_at = ? WHERE id = ?",
        JSON.stringify({ ...d, holder, finish }),
        at,
        o.id,
      ),
    );
  }
  stmts.push(
    ...docs.map((d) => q("UPDATE documents SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at = ''", at, `${actor} (DSGVO)`, d.id)),
    // Nachrichteninhalte (Text und HTML-Fassung) leeren – außer Korrespondenz zu Aufträgen unter Aufbewahrung
    kept.size
      ? q(
          `UPDATE messages SET body = '', html = '', to_addr = '' WHERE customer_id = ? AND (order_id IS NULL OR order_id NOT IN (${[...kept].map(() => '?').join(', ')}))`,
          id,
          ...kept,
        )
      : q("UPDATE messages SET body = '', html = '', to_addr = '' WHERE customer_id = ?", id),
    // Vollmachtsvorgänge der anonymisierten Aufträge: Stand und Zeitpunkte bleiben, personenbezogene Hinweise und Link nicht
    ...orders.map((o) => q("UPDATE power_of_attorneys SET signature_url = '', note = '', missing_json = '[]', blocking_json = '[]' WHERE order_id = ?", o.id)),
    ...orders.map((o) => q("UPDATE poa_evidence SET signer_name = '' WHERE order_id = ?", o.id)),
    q('DELETE FROM customer_contacts WHERE customer_id = ?', id),
    q('DELETE FROM customer_locations WHERE customer_id = ?', id),
    q(
      "UPDATE customers SET name = 'Gelöschter Kunde', first_name = '', last_name = '', company = '', register_no = '', email = '', email_norm = '', phone = '', street = '', house_no = '', zip = '', city = '', notes = '', anonymized_at = ?, updated_at = ? WHERE id = ?",
      at,
      at,
      id,
    ),
  );
  await db.batch(stmts);
  await deleteBlobs(docs.map((d) => d.stored_name)).catch((e) => console.error('[dsgvo] Dateien konnten nicht vollständig entfernt werden:', (e as Error).message));
  return { ok: true };
}
