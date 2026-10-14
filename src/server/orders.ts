// Auftragsdaten in SQLite: Anlage, Suche, Kennzahlen, Statuswechsel, Checkliste, Notizen, Verlauf.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { buildChecklist, isChecklistComplete, type ChecklistItem, type ChecklistState } from '../lib/checklist.ts';
import type { DetectedType } from '../lib/files.ts';
import { holderDisplayName, type ValidatedOrder } from '../lib/order.ts';
import { formatOrderNumber } from '../lib/order-number.ts';
import { calculatePrice, type PriceBreakdown } from '../lib/pricing.ts';
import { offerOf } from '../lib/plates.ts';
import { withExpressOffer, withPlateOffer } from '../lib/pricing.ts';
import { expressOfferOf, isExpress, PROCESSING, processingOf, type Milestone, type ProcessingLevel } from '../lib/express.ts';
import { currentExpress, expressCostSnapshot, orderMilestones } from './express.ts';
import { PRICE_CONFIG } from '../lib/pricing.config.ts';
import { currentPlateVersion, plateCostSnapshot } from './plates.ts';
import type { DocumentKind, ServiceId } from '../lib/services.ts';
import { checkTransition, isStatusId, OPEN_STATUSES, STATUS_IDS, type StatusId } from '../lib/status.ts';
import { checkPlate } from '../lib/validation.ts';
import { isPaymentStatus, PAYMENT_STATUS_LABEL, type PaymentStatus } from '../lib/payment.ts';
import { CARRIERS, isCarrierId, normalizeTrackingNumber, type CarrierId } from '../lib/shipping.ts';
import { deleteBlobs, getBlob, putBlob } from './blobs.ts';
import { getDb, q, type Stmt } from './db.ts';

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
  /** Bearbeitungsstand laut kfz-api.de (leer, solange keine Meldung vorliegt) */
  kfz_display: string;
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
  type: 'created' | 'status' | 'note' | 'plate' | 'checklist' | 'shipment' | 'payment' | 'kfz' | 'vollmacht';
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
  author: string;
}

export interface UploadFile {
  kind: DocumentKind;
  name: string;
  bytes: Uint8Array;
  type: DetectedType;
}

const LIST_COLUMNS =
  'id, number, created_at, updated_at, status, service, email, holder_name, fin, previous_plate, assigned_plate, iban, delivery, total_cents, carrier, tracking_number, payment_status, kfz_display';

const now = () => new Date().toISOString();

type EventInput = { type: EventRow['type']; from?: StatusId | null; to?: StatusId | null; message?: string; publicMessage?: string; actor: string };

/** Verlaufseintrag als Befehl – wird zusammen mit der eigentlichen Änderung atomar geschrieben. */
export function eventStmt(orderId: number, e: EventInput): Stmt {
  return q(
    'INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    orderId,
    now(),
    e.type,
    e.from ?? null,
    e.to ?? null,
    e.message ?? '',
    e.publicMessage ?? '',
    e.actor,
  );
}

export function touchStmt(orderId: number): Stmt {
  return q('UPDATE orders SET updated_at = ? WHERE id = ?', now(), orderId);
}

/* ---------- Anlage ---------- */

export async function createOrder(
  order: ValidatedOrder,
  files: UploadFile[],
): Promise<{ id: number; number: string; discountApplied: boolean; totalCents: number; paymentToken: string }> {
  const db = await getDb();
  const created = now();
  const year = new Date().getFullYear();

  // Dateien zuerst ablegen; schlägt die Anlage fehl, werden sie wieder entfernt.
  const dirName = randomBytes(12).toString('hex');
  const stored = files.map((f) => {
    const id = randomBytes(16).toString('hex');
    return { id, f, storedName: `${dirName}/${id}.${f.type.ext}`, sha256: createHash('sha256').update(f.bytes).digest('hex') };
  });
  try {
    for (const s of stored) await putBlob(s.storedName, s.f.bytes, s.f.type.mime);

    // Laufende Nummer atomar hochzählen (ein einziger Befehl – sicher auch bei gleichzeitigen Aufträgen).
    const counter = await db.first<{ last: number }>(
      'INSERT INTO order_counters (year, last) VALUES (?, 1) ON CONFLICT(year) DO UPDATE SET last = last + 1 RETURNING last',
      year,
    );
    if (!counter) throw new Error('Auftragsnummer konnte nicht vergeben werden');
    const number = formatOrderNumber(year, counter.last);

    // Neukunde = noch kein (nicht stornierter) Auftrag mit dieser E-Mail-Adresse.
    const existing = await db.first("SELECT 1 AS x FROM orders WHERE email = ? AND status != 'storniert' LIMIT 1", order.holder.email);
    // Preise mit den aktuellen Schilderpreisen aus dem Finanzcenter (gleiche Quelle wie die Website)
    const plateVersion = await currentPlateVersion();
    const expressVersion = await currentExpress();
    const price = calculatePrice(
      {
        service: order.service,
        vehicleType: order.vehicle.art,
        plateChoice: order.plate.wahl,
        plateSigns: order.plate.schilder,
        delivery: order.plate.zustellung,
        newCustomer: !existing,
        carrier: order.plate.versanddienst ?? undefined,
        plateFinish: order.plate.ausfuehrung,
        processing: order.bearbeitung,
      },
      withExpressOffer(withPlateOffer(PRICE_CONFIG, offerOf(plateVersion.prices, plateVersion.carbonChecks)), expressOfferOf(expressVersion)),
    );
    // Einkauf, Versand des Lieferanten und Preisversion dauerhaft am Auftrag – Preisänderungen ändern ihn nicht mehr
    const plateLine = price.lines.find((l) => l.key === 'schilder');
    if (plateLine?.finish && plateLine.qty) price.cost = { plates: plateCostSnapshot(plateVersion, plateLine.finish, plateLine.qty) };
    if (isExpress(order.bearbeitung) && price.lines.some((l) => l.key === 'express')) {
      price.cost = { ...price.cost, express: expressCostSnapshot(expressVersion, order.bearbeitung) };
    }
    const paymentToken = randomBytes(18).toString('base64url');
    const idOf = '(SELECT id FROM orders WHERE number = ?)';

    await db.batch([
      q(
        `INSERT INTO orders (number, created_at, updated_at, status, service, email, holder_name, fin, previous_plate, iban, delivery, data_json, price_json, total_cents, checklist_json, consent_at, carrier, payment_token)
         VALUES (?, ?, ?, 'neu', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`,
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
      ),
      ...stored.map((s) =>
        q(
          `INSERT INTO documents (id, order_id, kind, original_name, mime, size, stored_name, sha256, created_at) VALUES (?, ${idOf}, ?, ?, ?, ?, ?, ?, ?)`,
          s.id,
          number,
          s.f.kind,
          s.f.name.slice(0, 200),
          s.f.type.mime,
          s.f.bytes.byteLength,
          s.storedName,
          s.sha256,
          created,
        ),
      ),
      q(
        `INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (${idOf}, ?, 'created', NULL, 'neu', ?, '', 'Kunde')`,
        number,
        created,
        `Auftrag online eingegangen (${files.length} Dokumente)${price.discountCents ? ', Neukundenrabatt angewendet' : ''}`,
      ),
    ]);
    const row = await db.first<{ id: number }>('SELECT id FROM orders WHERE number = ?', number);
    if (!row) throw new Error('Auftrag wurde nicht gespeichert');
    return { id: row.id, number, discountApplied: price.discountCents > 0, totalCents: price.totalCents, paymentToken };
  } catch (e) {
    await deleteBlobs(stored.map((s) => s.storedName)).catch(() => undefined);
    throw e;
  }
}

/* ---------- Lesen ---------- */

export async function getOrder(id: number): Promise<OrderDetail | null> {
  const db = await getDb();
  const row = await db.first<OrderRow & { data_json: string; price_json: string; checklist_json: string; consent_at: string; payment_token: string }>(
    `SELECT ${LIST_COLUMNS}, data_json, price_json, checklist_json, consent_at, payment_token FROM orders WHERE id = ?`,
    id,
  );
  if (!row) return null;
  const data = JSON.parse(row.data_json) as ValidatedOrder;
  const { data_json: _d, price_json, checklist_json, ...rest } = row;
  return {
    ...rest,
    data,
    price: JSON.parse(price_json) as PriceBreakdown,
    checklist: JSON.parse(checklist_json) as ChecklistState,
    checklistItems: buildChecklist(row.service, data.plate.wahl, { hKennzeichen: !!data.vehicle.hKennzeichen, digitalPoa: process.env.VOLLMACHT_DIGITAL === '1' }),
  };
}

export interface ListFilter {
  q?: string;
  status?: string;
  limit?: number;
}

export async function listOrders(filter: ListFilter = {}): Promise<OrderRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.status === 'offen') {
    where.push(`status IN (${OPEN_STATUSES.map(() => '?').join(',')})`);
    params.push(...OPEN_STATUSES);
  } else if (filter.status && isStatusId(filter.status)) {
    where.push('status = ?');
    params.push(filter.status);
  }
  const qText = filter.q?.trim();
  if (qText) {
    const like = `%${qText.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      "(number LIKE ? ESCAPE '\\' OR holder_name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR fin LIKE ? ESCAPE '\\' OR previous_plate LIKE ? ESCAPE '\\' OR assigned_plate LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like, like, like);
  }
  const sql = `SELECT ${LIST_COLUMNS} FROM orders ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC, id DESC LIMIT ?`;
  params.push(Math.min(filter.limit ?? 200, 500));
  return (await getDb()).all<OrderRow>(sql, ...params);
}

export interface Stats {
  total: number;
  open: number;
  byStatus: Record<StatusId, number>;
  last7Days: number;
}

export async function getStats(): Promise<Stats> {
  const db = await getDb();
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<StatusId, number>;
  for (const r of await db.all<{ status: StatusId; n: number }>('SELECT status, COUNT(*) AS n FROM orders GROUP BY status')) {
    if (r.status in byStatus) byStatus[r.status] = r.n;
  }
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const last7 = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM orders WHERE created_at >= ?', since);
  const total = Object.values(byStatus).reduce((a, b) => a + b, 0);
  return { total, open: OPEN_STATUSES.reduce((a, s) => a + byStatus[s], 0), byStatus, last7Days: last7?.n ?? 0 };
}

export async function listDocuments(orderId: number): Promise<DocumentRow[]> {
  return (await getDb()).all<DocumentRow>('SELECT * FROM documents WHERE order_id = ? ORDER BY kind, created_at', orderId);
}

export async function getDocument(id: string): Promise<DocumentRow | null> {
  if (!/^[a-f0-9]{32}$/.test(id)) return null;
  return (await getDb()).first<DocumentRow>('SELECT * FROM documents WHERE id = ?', id);
}

/** Datei eines Dokuments aus dem Dateispeicher (R2 bzw. lokal). */
export async function readDocumentFile(doc: DocumentRow): Promise<Uint8Array | null> {
  return getBlob(doc.stored_name);
}

export async function listEvents(orderId: number): Promise<EventRow[]> {
  return (await getDb()).all<EventRow>('SELECT * FROM events WHERE order_id = ? ORDER BY at DESC, id DESC', orderId);
}

export async function listNotes(orderId: number): Promise<NoteRow[]> {
  return (await getDb()).all<NoteRow>("SELECT id, at, text, author FROM notes WHERE order_id = ? AND deleted_at = '' ORDER BY at DESC, id DESC", orderId);
}

/* ---------- Papierkorb (interne Notizen) ---------- */

export interface TrashRow {
  id: number;
  order_id: number;
  number: string;
  holder_name: string;
  at: string;
  text: string;
  author: string;
  deleted_at: string;
  deleted_by: string;
}

/** Notiz in den Papierkorb legen (wiederherstellbar). */
export async function trashNote(orderId: number, noteId: number, actor: string): Promise<ActionResult> {
  const db = await getDb();
  const note = await db.first<{ id: number }>("SELECT id FROM notes WHERE id = ? AND order_id = ? AND deleted_at = ''", noteId, orderId);
  if (!note) return { ok: false, error: 'Notiz nicht gefunden' };
  await db.batch([
    q('UPDATE notes SET deleted_at = ?, deleted_by = ? WHERE id = ?', now(), actor, noteId),
    eventStmt(orderId, { type: 'note', message: 'Interne Notiz in den Papierkorb verschoben', actor }),
  ]);
  return { ok: true };
}

export async function listTrash(): Promise<TrashRow[]> {
  return (await getDb()).all<TrashRow>(
    "SELECT n.id, n.order_id, o.number, o.holder_name, n.at, n.text, n.author, n.deleted_at, n.deleted_by FROM notes n JOIN orders o ON o.id = n.order_id WHERE n.deleted_at != '' ORDER BY n.deleted_at DESC LIMIT 500",
  );
}

export async function restoreNote(noteId: number, actor: string): Promise<ActionResult & { orderNumber?: string }> {
  const db = await getDb();
  const note = await db.first<{ order_id: number; number: string }>(
    "SELECT n.order_id, o.number FROM notes n JOIN orders o ON o.id = n.order_id WHERE n.id = ? AND n.deleted_at != ''",
    noteId,
  );
  if (!note) return { ok: false, error: 'Eintrag nicht im Papierkorb' };
  await db.batch([
    q("UPDATE notes SET deleted_at = '', deleted_by = '' WHERE id = ?", noteId),
    eventStmt(note.order_id, { type: 'note', message: 'Interne Notiz wiederhergestellt', actor }),
  ]);
  return { ok: true, orderNumber: note.number };
}

/** Endgültig löschen – nur Einträge, die bereits im Papierkorb liegen. */
export async function purgeTrash(noteId: number | 'alle'): Promise<{ ok: true; count: number }> {
  const db = await getDb();
  const r =
    noteId === 'alle' ? await db.run("DELETE FROM notes WHERE deleted_at != ''") : await db.run("DELETE FROM notes WHERE id = ? AND deleted_at != ''", noteId);
  return { ok: true, count: r.changes };
}

/* ---------- Ändern (Admin) ---------- */

export type ActionResult = { ok: true } | { ok: false; error: string };

export async function changeStatus(orderId: number, to: string, publicMessage: string, internalMessage = '', actor = 'Admin'): Promise<ActionResult> {
  if (!isStatusId(to)) return { ok: false, error: 'Unbekannter Status' };
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const check = checkTransition(order.status, to, {
    service: order.service,
    delivery: order.delivery,
    checklistComplete: isChecklistComplete(order.checklistItems, order.checklist),
    hasAssignedPlate: order.assigned_plate !== '',
  });
  if (!check.ok) return { ok: false, error: check.reason };
  await (await getDb()).batch([
    q('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?', to, now(), orderId),
    eventStmt(orderId, {
      type: 'status',
      from: order.status,
      to,
      message: internalMessage.trim().slice(0, 1000),
      publicMessage: publicMessage.trim().slice(0, 1000),
      actor,
    }),
  ]);
  return { ok: true };
}

export async function setChecklistItem(orderId: number, key: string, checked: boolean, actor = 'Admin'): Promise<ActionResult> {
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  const item = order.checklistItems.find((i) => i.key === key);
  if (!item) return { ok: false, error: 'Unbekannter Checklistenpunkt' };
  const state: ChecklistState = { ...order.checklist, [key]: { checked, at: now() } };
  await (await getDb()).batch([
    q('UPDATE orders SET checklist_json = ?, updated_at = ? WHERE id = ?', JSON.stringify(state), now(), orderId),
    eventStmt(orderId, { type: 'checklist', message: `${item.label}: ${checked ? 'abgehakt' : 'zurückgesetzt'}`, actor }),
  ]);
  return { ok: true };
}

export async function setAssignedPlate(orderId: number, input: string, actor = 'Admin'): Promise<ActionResult> {
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  let plate = '';
  if (input.trim()) {
    const c = checkPlate(input);
    if (!c.ok) return { ok: false, error: c.error };
    plate = c.value;
  }
  await (await getDb()).batch([
    q('UPDATE orders SET assigned_plate = ?, updated_at = ? WHERE id = ?', plate, now(), orderId),
    eventStmt(orderId, { type: 'plate', message: plate ? `Zugeteiltes Kennzeichen: ${plate}` : 'Zugeteiltes Kennzeichen entfernt', actor }),
  ]);
  return { ok: true };
}

export async function addNote(orderId: number, text: string, actor = 'Admin'): Promise<ActionResult> {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Notiz ist leer' };
  if (t.length > 4000) return { ok: false, error: 'Notiz ist zu lang (max. 4000 Zeichen)' };
  if (!(await getOrder(orderId))) return { ok: false, error: 'Auftrag nicht gefunden' };
  await (await getDb()).batch([
    q('INSERT INTO notes (order_id, at, text, author) VALUES (?, ?, ?, ?)', orderId, now(), t, actor),
    eventStmt(orderId, { type: 'note', message: 'Interne Notiz hinzugefügt', actor }),
    touchStmt(orderId),
  ]);
  return { ok: true };
}

export async function setShipment(orderId: number, carrier: string, trackingInput: string, actor = 'Admin'): Promise<ActionResult> {
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (order.delivery !== 'versand') return { ok: false, error: 'Der Kunde hat Abholung gewählt' };
  if (!isCarrierId(carrier)) return { ok: false, error: 'Bitte DHL oder UPS wählen' };
  let tracking = '';
  if (trackingInput.trim()) {
    const t = normalizeTrackingNumber(trackingInput);
    if (!t) return { ok: false, error: 'Sendungsnummer: 8–40 Buchstaben oder Ziffern' };
    tracking = t;
  }
  await (await getDb()).batch([
    q('UPDATE orders SET carrier = ?, tracking_number = ?, updated_at = ? WHERE id = ?', carrier, tracking, now(), orderId),
    eventStmt(orderId, {
      type: 'shipment',
      message: tracking ? `Sendung ${CARRIERS[carrier].name} ${tracking}` : `Versandpartner ${CARRIERS[carrier].name}`,
      actor,
    }),
  ]);
  return { ok: true };
}

export async function setPaymentStatus(orderId: number, status: string, ref = '', actor = 'Admin'): Promise<ActionResult> {
  if (!isPaymentStatus(status)) return { ok: false, error: 'Unbekannter Zahlungsstatus' };
  const order = await getOrder(orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (order.payment_status === status) return { ok: true };
  await (await getDb()).batch([
    q("UPDATE orders SET payment_status = ?, payment_ref = CASE WHEN ? = '' THEN payment_ref ELSE ? END, updated_at = ? WHERE id = ?", status, ref, ref, now(), orderId),
    eventStmt(orderId, { type: 'payment', message: `${PAYMENT_STATUS_LABEL[status]}${ref ? ` (${ref})` : ''}`, actor }),
  ]);
  return { ok: true };
}

/** Für Zahlungslinks: Auftrag nur mit passendem Zufallstoken herausgeben. */
export async function getOrderForPayment(
  number: string,
  token: string,
): Promise<{ id: number; number: string; email: string; totalCents: number; paymentStatus: PaymentStatus; token: string } | null> {
  const row = await (await getDb()).first<{ id: number; number: string; email: string; total_cents: number; payment_status: PaymentStatus; payment_token: string }>(
    'SELECT id, number, email, total_cents, payment_status, payment_token FROM orders WHERE number = ?',
    number,
  );
  if (!row || !row.payment_token || !token) return null;
  const a = Buffer.from(row.payment_token);
  const b = Buffer.from(token);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { id: row.id, number: row.number, email: row.email, totalCents: row.total_cents, paymentStatus: row.payment_status, token: row.payment_token };
}

export async function getOrderIdByNumber(number: string): Promise<number | null> {
  const row = await (await getDb()).first<{ id: number }>('SELECT id FROM orders WHERE number = ?', number);
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
  /** Bearbeitungsstand laut kfz-api.de ('' = noch keine Meldung → „Auftrag eingegangen“) */
  kfzDisplay: string;
  kfzTimeline: { at: string; label: string }[];
  /** Nur bei Express: Stufe und Meilensteine mit tatsächlichen Zeitpunkten (keine Dauer-Zusagen) */
  express?: { level: 'express' | 'express_plus'; label: string; milestones: Milestone[] };
  /** Digitale Vollmacht: bestätigter Stand (Abgleich über die Partner-Schnittstelle), Link nur solange offen */
  vollmacht?: { view: string; title: string; verifiedAt: string; signatureUrl: string };
}

export async function lookupStatus(number: string, email: string): Promise<PublicStatus | null> {
  const db = await getDb();
  const row = await db.first<{
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
    kfz_display: string;
    data_json: string;
  }>(
    'SELECT id, number, service, status, created_at, assigned_plate, delivery, email, carrier, tracking_number, payment_status, payment_token, total_cents, kfz_display, data_json FROM orders WHERE number = ?',
    number,
  );
  // Gleiche Antwort für „unbekannte Nummer“ und „falsche E-Mail“ – verrät nichts.
  if (!row || row.email !== email.trim().toLowerCase()) return null;
  const events = await db.all<{ at: string; to_status: StatusId; public_message: string }>(
    "SELECT at, to_status, public_message FROM events WHERE order_id = ? AND type IN ('created', 'status') ORDER BY at ASC, id ASC",
    row.id,
  );
  const kfz = await db.all<{ at: string; public_message: string }>(
    "SELECT at, public_message FROM events WHERE order_id = ? AND type = 'kfz' AND public_message != '' ORDER BY at ASC, id ASC",
    row.id,
  );
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
    kfzDisplay: row.kfz_display,
    kfzTimeline: kfz.map((e) => ({ at: e.at, label: e.public_message })),
    ...(await expressStatus(row.id, row.data_json)),
    ...(await poaStatus(row.id)),
  };
}

async function poaStatus(orderId: number): Promise<Pick<PublicStatus, 'vollmacht'>> {
  const { latestPoa, verifyPoa } = await import('./power-of-attorney.ts');
  const { customerView, CUSTOMER_TEXT } = await import('../lib/power-of-attorney.ts');
  const rec = await latestPoa(orderId);
  if (!rec || !rec.process_id) return {};
  const r = await verifyPoa(rec.id, { actor: 'Statusabfrage (Abgleich)' });
  const cur = r.ok ? r.poa : r.poa;
  const status = (cur?.status || rec.status || 'offen') as Parameters<typeof customerView>[0];
  const view = customerView(status, cur ? cur.ready : !!rec.ready);
  return {
    vollmacht: {
      view,
      title: CUSTOMER_TEXT[view].title,
      verifiedAt: cur?.verifiedAt ?? rec.verified_at,
      signatureUrl: view === 'pending' ? (cur?.signatureUrl ?? rec.signature_url) : '',
    },
  };
}

async function expressStatus(orderId: number, dataJson: string): Promise<Pick<PublicStatus, 'express'>> {
  let level: ProcessingLevel = 'standard';
  try {
    level = processingOf(JSON.parse(dataJson) as ValidatedOrder);
  } catch {
    level = 'standard';
  }
  if (level === 'standard') return {};
  const milestones = (await orderMilestones(orderId)) ?? [];
  return { express: { level, label: PROCESSING[level].label, milestones } };
}
