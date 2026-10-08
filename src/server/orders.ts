// Auftragsdaten in SQLite: Anlage, Suche, Kennzahlen, Statuswechsel, Checkliste, Notizen, Verlauf.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { buildChecklist, isChecklistComplete, type ChecklistItem, type ChecklistState } from '../lib/checklist.ts';
import type { DetectedType } from '../lib/files.ts';
import { holderDisplayName, type ValidatedOrder } from '../lib/order.ts';
import { formatOrderNumber } from '../lib/order-number.ts';
import { calculatePrice, type PriceBreakdown } from '../lib/pricing.ts';
import type { DocumentKind, ServiceId } from '../lib/services.ts';
import { checkTransition, isStatusId, OPEN_STATUSES, STATUS_IDS, type StatusId } from '../lib/status.ts';
import { checkPlate } from '../lib/validation.ts';
import { isPaymentStatus, PAYMENT_STATUS_LABEL, type PaymentStatus } from '../lib/payment.ts';
import { CARRIERS, isCarrierId, normalizeTrackingNumber, type CarrierId } from '../lib/shipping.ts';
import { getDb, transaction, uploadsDir } from './db.ts';

export interface OrderRow {
  id: number;
  number: string;
  created_at: string;
  updated_at: string;
  status: StatusId;
  service: ServiceId;
  email: string;
  holder_name: string;
  fin: string;
  previous_plate: string;
  assigned_plate: string;
  iban: string;
  delivery: 'versand' | 'abholung';
  total_cents: number;
  carrier: CarrierId | '';
  tracking_number: string;
  payment_status: PaymentStatus;
}

export interface OrderDetail extends OrderRow {
  data: ValidatedOrder;
  price: PriceBreakdown;
  checklist: ChecklistState;
  checklistItems: ChecklistItem[];
  consent_at: string;
  payment_token: string;
}

export interface DocumentRow {
  id: string;
  order_id: number;
  kind: DocumentKind;
  original_name: string;
  mime: string;
  size: number;
  stored_name: string;
  sha256: string;
  created_at: string;
}

export interface EventRow {
  id: number;
  at: string;
  type: 'created' | 'status' | 'note' | 'plate' | 'checklist' | 'shipment' | 'payment';
  from_status: StatusId | null;
  to_status: StatusId | null;
  message: string;
  public_message: string;
  actor: string;
}

export interface NoteRow {
  id: number;
  at: string;
  text: string;
}

export interface UploadFile {
  kind: DocumentKind;
  name: string;
  bytes: Uint8Array;
  type: DetectedType;
}

const LIST_COLUMNS =
  'id, number, created_at, updated_at, status, service, email, holder_name, fin, previous_plate, assigned_plate, iban, delivery, total_cents, carrier, tracking_number, payment_status';

const now = () => new Date().toISOString();

function addEvent(
  orderId: number,
  e: { type: EventRow['type']; from?: StatusId | null; to?: StatusId | null; message?: string; publicMessage?: string; actor: string },
): void {
  getDb()
    .prepare('INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(orderId, now(), e.type, e.from ?? null, e.to ?? null, e.message ?? '', e.publicMessage ?? '', e.actor);
}

function touch(orderId: number): void {
  getDb().prepare('UPDATE orders SET updated_at = ? WHERE id = ?').run(now(), orderId);
}

/* ---------- Anlage ---------- */

export function createOrder(
  order: ValidatedOrder,
  files: UploadFile[],
): { id: number; number: string; discountApplied: boolean; totalCents: number; paymentToken: string } {
  const created = now();
  const year = new Date().getFullYear();

  // Dateien zuerst schreiben (außerhalb der Transaktion), bei Fehler wieder entfernen.
  const dirName = randomBytes(12).toString('hex');
  const dir = path.join(uploadsDir(), dirName);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stored = files.map((f) => {
    const id = randomBytes(16).toString('hex');
    const storedName = path.join(dirName, `${id}.${f.type.ext}`);
    fs.writeFileSync(path.join(uploadsDir(), storedName), f.bytes, { mode: 0o600 });
    return { id, f, storedName, sha256: createHash('sha256').update(f.bytes).digest('hex') };
  });

  try {
    return transaction((db) => {
      const counter = db.prepare('SELECT last FROM order_counters WHERE year = ?').get(year) as { last: number } | undefined;
      const seq = (counter?.last ?? 0) + 1;
      if (counter) db.prepare('UPDATE order_counters SET last = ? WHERE year = ?').run(seq, year);
      else db.prepare('INSERT INTO order_counters (year, last) VALUES (?, ?)').run(year, seq);
      const number = formatOrderNumber(year, seq);

      // Neukunde = noch kein (nicht stornierter) Auftrag mit dieser E-Mail-Adresse. In der Transaktion geprüft,
      // damit zwei gleichzeitige Erstaufträge nicht beide den Rabatt erhalten.
      const existing = db.prepare("SELECT 1 FROM orders WHERE email = ? AND status != 'storniert' LIMIT 1").get(order.holder.email);
      const price = calculatePrice({
        service: order.service,
        vehicleType: order.vehicle.art,
        plateChoice: order.plate.wahl,
        plateSigns: order.plate.schilder,
        delivery: order.plate.zustellung,
        newCustomer: !existing,
        carrier: order.plate.versanddienst ?? undefined,
      });
      const paymentToken = randomBytes(18).toString('base64url');

      const res = db
        .prepare(
          `INSERT INTO orders (number, created_at, updated_at, status, service, email, holder_name, fin, previous_plate, iban, delivery, data_json, price_json, total_cents, checklist_json, consent_at, carrier, payment_token)
           VALUES (?, ?, ?, 'neu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
        )
        .run(
          number,
          created,
          created,
          order.service,
          order.holder.email,
          holderDisplayName(order.holder),
          order.vehicle.fin,
          order.vehicle.bisherigesKennzeichen,
          order.finish.iban,
          order.plate.zustellung,
          JSON.stringify(order),
          JSON.stringify(price),
          price.totalCents,
          created,
          order.plate.versanddienst ?? '',
          paymentToken,
        );
      const orderId = Number(res.lastInsertRowid);
      const insertDoc = db.prepare(
        'INSERT INTO documents (id, order_id, kind, original_name, mime, size, stored_name, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      );
      for (const s of stored) {
        insertDoc.run(s.id, orderId, s.f.kind, s.f.name.slice(0, 200), s.f.type.mime, s.f.bytes.byteLength, s.storedName, s.sha256, created);
      }
      addEvent(orderId, {
        type: 'created',
        to: 'neu',
        message: `Auftrag online eingegangen (${files.length} Dokumente)${price.discountCents ? ', Neukundenrabatt angewendet' : ''}`,
        actor: 'Kunde',
      });
      return { id: orderId, number, discountApplied: price.discountCents > 0, totalCents: price.totalCents, paymentToken };
    });
  } catch (e) {
    fs.rmSync(dir, { recursive: true, force: true });
    throw e;
  }
}

/* ---------- Lesen ---------- */

export function getOrder(id: number): OrderDetail | null {
  const row = getDb().prepare(`SELECT ${LIST_COLUMNS}, data_json, price_json, checklist_json, consent_at, payment_token FROM orders WHERE id = ?`).get(id) as
    | (OrderRow & { data_json: string; price_json: string; checklist_json: string; consent_at: string; payment_token: string })
    | undefined;
  if (!row) return null;
  const data = JSON.parse(row.data_json) as ValidatedOrder;
  const { data_json: _d, price_json, checklist_json, ...rest } = row;
  return {
    ...rest,
    data,
    price: JSON.parse(price_json) as PriceBreakdown,
    checklist: JSON.parse(checklist_json) as ChecklistState,
    checklistItems: buildChecklist(row.service, data.plate.wahl),
  };
}

export interface ListFilter {
  q?: string;
  status?: string;
  limit?: number;
}

export function listOrders(filter: ListFilter = {}): OrderRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status === 'offen') {
    where.push(`status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
    params.push(...OPEN_STATUSES);
  } else if (filter.status && isStatusId(filter.status)) {
    where.push('status = ?');
    params.push(filter.status);
  }
  const q = filter.q?.trim();
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      "(number LIKE ? ESCAPE '\\' OR holder_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR fin LIKE ? ESCAPE '\\' OR previous_plate LIKE ? ESCAPE '\\' OR assigned_plate LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like, like, like);
  }
  const sql = `SELECT ${LIST_COLUMNS} FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(Math.min(filter.limit ?? 200, 500));
  return getDb().prepare(sql).all(...params) as unknown as OrderRow[];
}

export interface Stats {
  total: number;
  open: number;
  byStatus: Record<StatusId, number>;
  last7Days: number;
}

export function getStats(): Stats {
  const db = getDb();
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<StatusId, number>;
  for (const r of db.prepare('SELECT status, COUNT(*) AS n FROM orders GROUP BY status').all() as { status: StatusId; n: number }[]) {
    if (r.status in byStatus) byStatus[r.status] = r.n;
  }
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const last7 = db.prepare('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?').get(since) as { n: number };
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { total, open: OPEN_STATUSES.reduce((a, s) => a + byStatus[s], 0), byStatus, last7Days: last7.n };
}

export function listDocuments(orderId: number): DocumentRow[] {
  return getDb().prepare('SELECT * FROM documents WHERE order_id = ? ORDER BY kind, created_at').all(orderId) as unknown as DocumentRow[];
}

export function getDocument(id: string): DocumentRow | null {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return (getDb().prepare('SELECT * FROM documents WHERE id = ?').get(id) as unknown as DocumentRow | undefined) ?? null;
}

/** Liest die Datei eines Dokuments; der Pfad muss innerhalb des Upload-Verzeichnisses liegen. */
export function readDocumentFile(doc: DocumentRow): Buffer {
  const base = uploadsDir();
  const full = path.resolve(base, doc.stored_name);
  if (!full.startsWith(base + path.sep)) throw new Error('Ungültiger Dokumentpfad');
  return fs.readFileSync(full);
}

export function listEvents(orderId: number): EventRow[] {
  return getDb().prepare('SELECT * FROM events WHERE order_id = ? ORDER BY at DESC, id DESC').all(orderId) as unknown as EventRow[];
}

export function listNotes(orderId: number): NoteRow[] {
  return getDb().prepare('SELECT id, at, text FROM notes WHERE order_id = ? ORDER BY at DESC, id DESC').all(orderId) as unknown as NoteRow[];
}

/* ---------- Ändern (Admin) ---------- */

export type ActionResult = { ok: true } | { ok: false; error: string };

export function changeStatus(orderId: number, to: string, publicMessage: string, internalMessage = ''): ActionResult {
  if (!isStatusId(to)) return { ok: false, error: 'Unbekannter Status' };
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const check = checkTransition(order.status, to, {
    service: order.service,
    delivery: order.delivery,
    checklistComplete: isChecklistComplete(order.checklistItems, order.checklist),
    hasAssignedPlate: order.assigned_plate !== '',
  });
  if (!check.ok) return { ok: false, error: check.reason };
  transaction((db) => {
    db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').run(to, now(), orderId);
    addEvent(orderId, {
      type: 'status',
      from: order.status,
      to,
      message: internalMessage.trim().slice(0, 1000),
      publicMessage: publicMessage.trim().slice(0, 1000),
      actor: 'Admin',
    });
  });
  return { ok: true };
}

export function setChecklistItem(orderId: number, key: string, checked: boolean): ActionResult {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const item = order.checklistItems.find((i) => i.key === key);
  if (!item) return { ok: false, error: 'Unbekannter Checklistenpunkt' };
  const state: ChecklistState = { ...order.checklist, [key]: { checked, at: now() } };
  transaction((db) => {
    db.prepare('UPDATE orders SET checklist_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(state), now(), orderId);
    addEvent(orderId, { type: 'checklist', message: `${item.label}: ${checked ? 'abgehakt' : 'zurückgesetzt'}`, actor: 'Admin' });
  });
  return { ok: true };
}

export function setAssignedPlate(orderId: number, input: string): ActionResult {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  let plate = '';
  if (input.trim()) {
    const c = checkPlate(input);
    if (!c.ok) return { ok: false, error: c.error };
    plate = c.value;
  }
  transaction((db) => {
    db.prepare('UPDATE orders SET assigned_plate = ?, updated_at = ? WHERE id = ?').run(plate, now(), orderId);
    addEvent(orderId, { type: 'plate', message: plate ? `Zugeteiltes Kennzeichen: ${plate}` : 'Zugeteiltes Kennzeichen entfernt', actor: 'Admin' });
  });
  return { ok: true };
}

export function addNote(orderId: number, text: string): ActionResult {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Notiz ist leer' };
  if (t.length > 4000) return { ok: false, error: 'Notiz ist zu lang (max. 4000 Zeichen)' };
  if (!getOrder(orderId)) return { ok: false, error: 'Auftrag nicht gefunden' };
  transaction((db) => {
    db.prepare('INSERT INTO notes (order_id, at, text) VALUES (?, ?, ?)').run(orderId, now(), t);
    addEvent(orderId, { type: 'note', message: 'Interne Notiz hinzugefügt', actor: 'Admin' });
  });
  touch(orderId);
  return { ok: true };
}

export function setShipment(orderId: number, carrier: string, trackingInput: string): ActionResult {
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (order.delivery !== 'versand') return { ok: false, error: 'Der Kunde hat Abholung gewählt' };
  if (!isCarrierId(carrier)) return { ok: false, error: 'Bitte DHL oder UPS wählen' };
  let tracking = '';
  if (trackingInput.trim()) {
    const t = normalizeTrackingNumber(trackingInput);
    if (!t) return { ok: false, error: 'Sendungsnummer: 8–40 Buchstaben oder Ziffern' };
    tracking = t;
  }
  transaction((db) => {
    db.prepare('UPDATE orders SET carrier = ?, tracking_number = ?, updated_at = ? WHERE id = ?').run(carrier, tracking, now(), orderId);
    addEvent(orderId, {
      type: 'shipment',
      message: tracking ? `Sendung ${CARRIERS[carrier].name} ${tracking}` : `Versandpartner ${CARRIERS[carrier].name}`,
      actor: 'Admin',
    });
  });
  return { ok: true };
}

export function setPaymentStatus(orderId: number, status: string, ref = '', actor = 'Admin'): ActionResult {
  if (!isPaymentStatus(status)) return { ok: false, error: 'Unbekannter Zahlungsstatus' };
  const order = getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (order.payment_status === status) return { ok: true };
  transaction((db) => {
    db.prepare("UPDATE orders SET payment_status = ?, payment_ref = CASE WHEN ? = '' THEN payment_ref ELSE ? END, updated_at = ? WHERE id = ?").run(status, ref, ref, now(), orderId);
    addEvent(orderId, { type: 'payment', message: `${PAYMENT_STATUS_LABEL[status]}${ref ? ` (${ref})` : ''}`, actor });
  });
  return { ok: true };
}

/** Für Zahlungslinks: Auftrag nur mit passendem Zufallstoken herausgeben. */
export function getOrderForPayment(number: string, token: string): { id: number; number: string; email: string; totalCents: number; paymentStatus: PaymentStatus; token: string } | null {
  const row = getDb().prepare('SELECT id, number, email, total_cents, payment_status, payment_token FROM orders WHERE number = ?').get(number) as
    | { id: number; number: string; email: string; total_cents: number; payment_status: PaymentStatus; payment_token: string }
    | undefined;
  if (!row || !row.payment_token || !token) return null;
  const a = Buffer.from(row.payment_token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: row.id, number: row.number, email: row.email, totalCents: row.total_cents, paymentStatus: row.payment_status, token: row.payment_token };
}

export function getOrderIdByNumber(number: string): number | null {
  const row = getDb().prepare('SELECT id FROM orders WHERE number = ?').get(number) as { id: number } | undefined;
  return row?.id ?? null;
}

/* ---------- Öffentliche Statusabfrage ---------- */

export interface PublicStatus {
  number: string;
  service: ServiceId;
  status: StatusId;
  createdAt: string;
  assignedPlate: string;
  delivery: 'versand' | 'abholung';
  carrier: CarrierId | '';
  trackingNumber: string;
  paymentStatus: PaymentStatus;
  paymentToken: string;
  totalCents: number;
  timeline: { at: string; status: StatusId; message: string }[];
}

export function lookupStatus(number: string, email: string): PublicStatus | null {
  const row = getDb()
    .prepare(
      'SELECT id, number, service, status, created_at, assigned_plate, delivery, email, carrier, tracking_number, payment_status, payment_token, total_cents FROM orders WHERE number = ?',
    )
    .get(number) as
    | {
        id: number;
        number: string;
        service: ServiceId;
        status: StatusId;
        created_at: string;
        assigned_plate: string;
        delivery: 'versand' | 'abholung';
        email: string;
        carrier: CarrierId | '';
        tracking_number: string;
        payment_status: PaymentStatus;
        payment_token: string;
        total_cents: number;
      }
    | undefined;
  // Gleiche Antwort für „unbekannte Nummer“ und „falsche E-Mail“ – verrät nichts.
  if (!row || row.email !== email.trim().toLowerCase()) return null;
  const events = getDb()
    .prepare("SELECT at, to_status, public_message FROM events WHERE order_id = ? AND type IN ('created', 'status') ORDER BY at ASC, id ASC")
    .all(row.id) as { at: string; to_status: StatusId; public_message: string }[];
  return {
    number: row.number,
    service: row.service,
    status: row.status,
    createdAt: row.created_at,
    assignedPlate: row.assigned_plate,
    delivery: row.delivery,
    carrier: row.carrier,
    trackingNumber: row.tracking_number,
    paymentStatus: row.payment_status,
    paymentToken: row.payment_token,
    totalCents: row.total_cents,
    timeline: events.map((e) => ({ at: e.at, status: e.to_status, message: e.public_message })),
  };
}
