// Auftragsaktionen von EasyKFZ24 OS: rufen die bestehende Geschäftslogik (orders.ts) auf und erzeugen
// Ereignisse (→ Benachrichtigungen, Automatisierungen). Neue Felder: Zuweisung, Priorität, Frist, Wiedervorlage,
// Freigabe vor Übermittlung, Prüfpunkte (Sicherheitscodes).

import { isChecklistComplete } from '../../lib/checklist.ts';
import { validateOrder, type ValidatedOrder } from '../../lib/order.ts';
import type { DocumentKind } from '../../lib/services.ts';
import { isStatusId } from '../../lib/status.ts';
import { checkFin, orderIssues, releaseBlockers, securityCodesFor, stageOf, type Issue, type IssueInput } from '../../lib/workflow.ts';
import { getDb } from '../db.ts';
import { addNote, changeStatus, createOrder, getOrder, setAssignedPlate, setChecklistItem, setPaymentStatus, setShipment, type OrderDetail } from '../orders.ts';
import { emitSafe } from './events.ts';
import { linkOrderToCustomer } from './customers.ts';
import { recordManualPayment } from './finance.ts';
import { getPlateOffer } from '../plates.ts';
import { getExpressOffer } from '../express.ts';
import { placeByAgs, wishCodeCheck } from '../regions.ts';
import { earlyStartWait, waitMessage } from '../../lib/withdrawal-period.ts';
import { poaGate, type PoaStatus } from '../../lib/power-of-attorney.ts';

export interface Actor {
  id: number;
  name: string;
}

type R = { ok: true } | { ok: false; error: string };
const now = () => new Date().toISOString();
export const PRIORITIES = ['niedrig', 'normal', 'hoch', 'dringend'] as const;

/* ---------- Prüfungen ---------- */

export async function issueInput(o: OrderDetail): Promise<IssueInput> {
  const db = await getDb();
  const [docs, same, extra, paid, poa] = await Promise.all([
    db.all<{ kind: DocumentKind }>("SELECT DISTINCT kind FROM documents WHERE order_id = ? AND deleted_at = ''", o.id),
    db.all<{ id: number; number: string }>(
      "SELECT id, number FROM orders WHERE fin = ? AND id != ? AND status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle') LIMIT 5",
      o.fin,
      o.id,
    ),
    db.first<{ released_at: string; due_at: string; reg_checks_json: string; kfz_status: string; total_cents: number }>(
      'SELECT released_at, due_at, reg_checks_json, kfz_status, total_cents FROM orders WHERE id = ?',
      o.id,
    ),
    db.first<{ n: number; sum: number | null }>(
      "SELECT COUNT(*) AS n, SUM(amount_cents) AS sum FROM payments WHERE order_id = ? AND kind IN ('zahlung', 'erstattung') AND status IN ('bezahlt', 'erstattet')",
      o.id,
    ),
    db.first<{ status: PoaStatus | ''; ready: number; send_email: number; note: string; create_error: string }>(
      'SELECT status, ready, send_email, note, create_error FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC, id DESC LIMIT 1',
      o.id,
    ),
  ]);
  let regChecks: Record<string, boolean> = {};
  try {
    regChecks = JSON.parse(extra?.reg_checks_json || '{}') as Record<string, boolean>;
  } catch {
    regChecks = {};
  }
  return {
    status: o.status,
    service: o.service,
    payment_status: o.payment_status,
    kfz_display: o.kfz_display,
    kfz_status: extra?.kfz_status ?? '',
    assigned_plate: o.assigned_plate,
    due_at: extra?.due_at ?? '',
    released_at: extra?.released_at ?? '',
    data: o.data,
    checklistItems: o.checklistItems,
    checklist: o.checklist,
    uploadedKinds: docs.map((d) => d.kind),
    regChecks,
    sameFinOpen: o.fin ? same : [],
    totalCents: extra?.total_cents,
    wishCode: wishCodeCheck(o.data),
    // Ohne gebuchte Zahlung (z. B. Altaufträge vor dem Zahlungsjournal) kein Betragsabgleich
    paidCents: paid?.n ? (paid.sum ?? 0) : null,
    poa: poaGate(
      o.service,
      process.env.VOLLMACHT_DIGITAL === '1',
      poa ? { status: poa.status, ready: !!poa.ready, sendEmail: !!poa.send_email, note: poa.note, createError: poa.create_error } : null,
    ),
  };
}

export async function orderInsights(o: OrderDetail): Promise<{ issues: Issue[]; stage: ReturnType<typeof stageOf>; releaseBlockers: string[]; codes: string[]; fin: ReturnType<typeof checkFin>; regChecks: Record<string, boolean> }> {
  const input = await issueInput(o);
  const issues = orderIssues(input);
  // Widerrufsfrist: ohne ausdrücklich verlangten vorzeitigen Beginn erst danach bearbeiten (technisch gesperrt, siehe actStatus/actRelease)
  const wait = !['abgeschlossen', 'storniert'].includes(o.status) ? earlyStartWait(o) : null;
  if (wait) issues.push({ level: 'warnung', code: 'widerrufsfrist', text: waitMessage(wait.until) });
  return {
    issues,
    stage: stageOf({ ...input, checklistComplete: isChecklistComplete(o.checklistItems, o.checklist) }),
    releaseBlockers: releaseBlockers(input),
    codes: securityCodesFor(o.service, o.data.plate.wahl === 'behalten'),
    fin: checkFin(o.data.vehicle.fin),
    regChecks: input.regChecks ?? {},
  };
}

/* ---------- Bestehende Aktionen mit Ereignis ---------- */

export async function actStatus(id: number, to: string, pub: string, internal: string, actor: Actor | { id: null; name: string }): Promise<R> {
  const before = await getOrder(id);
  if (!before) return { ok: false, error: 'Auftrag nicht gefunden' };
  // Verzögerter Leistungsbeginn: während der Widerrufsfrist nur Stornierung (gilt auch für Automatisierungen)
  const wait = to !== 'storniert' ? earlyStartWait(before) : null;
  if (wait) return { ok: false, error: waitMessage(wait.until) };
  if (to === 'bei_zulassungsstelle') {
    const rel = await (await getDb()).first<{ released_at: string }>('SELECT released_at FROM orders WHERE id = ?', id);
    if (!rel?.released_at) return { ok: false, error: 'Erst „Zur Übermittlung freigeben“ – die Freigabe ist Pflicht vor der Übergabe an den Zulassungspartner' };
  }
  const r = await changeStatus(id, to, pub, internal, actor.name);
  if (!r.ok) return r;
  await emitSafe({
    type: 'order.status',
    orderId: id,
    actor: actor.name,
    payload: { from: before.status, to, publicMessage: pub ? true : false },
    dedupeKey: `order.status:${id}:${before.status}->${to}:${now()}`,
  });
  return { ok: true };
}

export async function actChecklist(id: number, key: string, checked: boolean, actor: Actor): Promise<R> {
  return setChecklistItem(id, key, checked, actor.name);
}

export async function actPlate(id: number, plate: string, actor: Actor): Promise<R> {
  const r = await setAssignedPlate(id, plate, actor.name);
  if (r.ok) {
    const o = await (await getDb()).first<{ vehicle_id: number | null; assigned_plate: string }>('SELECT vehicle_id, assigned_plate FROM orders WHERE id = ?', id);
    if (o?.vehicle_id && o.assigned_plate) await (await getDb()).run('UPDATE vehicles SET plate = ?, updated_at = ? WHERE id = ?', o.assigned_plate, now(), o.vehicle_id);
  }
  return r;
}

export async function actNote(id: number, text: string, actor: Actor): Promise<R> {
  return addNote(id, text, actor.name);
}

export async function actShipment(id: number, carrier: string, tracking: string, actor: Actor): Promise<R> {
  return setShipment(id, carrier, tracking, actor.name);
}

export async function actPayment(id: number, status: string, ref: string, actor: Actor): Promise<R> {
  const before = await getOrder(id);
  if (!before) return { ok: false, error: 'Auftrag nicht gefunden' };
  // Zahlungseingang nur nachvollziehbar verbuchen: Referenz aus dem Kontoauszug (z. B. Buchungsdatum, Auftraggeber) ist Pflicht
  if (status === 'bezahlt' && status !== before.payment_status && ref.trim().length < 3)
    return { ok: false, error: 'Bitte die Buchungsreferenz des Zahlungseingangs angeben (z. B. Buchungsdatum und Auftraggeber laut Kontoauszug).' };
  const r = await setPaymentStatus(id, status, ref, actor.name);
  if (!r.ok) return r;
  if (status !== before.payment_status) {
    const method = status === 'bezahlt' ? 'ueberweisung' : '';
    const paymentId = await recordManualPayment(id, status, before.total_cents, ref, actor.name, method);
    if (status === 'bezahlt') {
      await emitSafe({ type: 'payment.paid', orderId: id, actor: actor.name, payload: { manual: true, ref }, dedupeKey: `payment.paid:${id}:manuell:${now()}` });
      // Zahlungsbestätigung an den Kunden (ohne KUNDENMAILS=1 nur protokolliert)
      const { queuePaymentConfirmed } = await import('../transactional-mail.ts');
      await queuePaymentConfirmed(id, `manuell:${paymentId ?? now()}`, before.total_cents, method, now()).catch((e) =>
        console.error('[zahlung] Bestätigung nicht angelegt:', (e as Error).message),
      );
    }
    if (status === 'erstattet') await emitSafe({ type: 'payment.refunded', orderId: id, actor: actor.name, payload: { ref }, dedupeKey: `payment.refunded:${id}:${now()}` });
  }
  return { ok: true };
}

/* ---------- Neue Felder ---------- */

export async function actAssign(id: number, assigneeId: number | null, actor: Actor): Promise<R> {
  const db = await getDb();
  if (assigneeId !== null && assigneeId !== 0 && !(await db.first('SELECT 1 AS x FROM users WHERE id = ? AND active = 1', assigneeId))) {
    return { ok: false, error: 'Mitarbeiter nicht gefunden oder gesperrt' };
  }
  const cur = await db.first<{ assignee_id: number | null }>('SELECT assignee_id FROM orders WHERE id = ?', id);
  if (!cur) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (cur.assignee_id === assigneeId) return { ok: true };
  const name = assigneeId === null ? 'niemand' : assigneeId === 0 ? 'Inhaber' : ((await db.first<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', assigneeId))?.display_name ?? '');
  await db.batch([
    { sql: 'UPDATE orders SET assignee_id = ?, updated_at = ? WHERE id = ?', params: [assigneeId, now(), id] },
    {
      sql: "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, ?, '', ?)",
      params: [id, now(), `Zuständig: ${name}`, actor.name],
    },
  ]);
  if (assigneeId !== null) await emitSafe({ type: 'order.assigned', orderId: id, actor: actor.name, payload: { assigneeId, actorId: actor.id }, dedupeKey: `order.assigned:${id}:${assigneeId}:${now()}` });
  return { ok: true };
}

export async function actPlanning(id: number, patch: { priority?: string; due_at?: string; follow_up_at?: string }, actor: Actor): Promise<R> {
  const db = await getDb();
  const cur = await db.first<{ priority: string; due_at: string; follow_up_at: string }>('SELECT priority, due_at, follow_up_at FROM orders WHERE id = ?', id);
  if (!cur) return { ok: false, error: 'Auftrag nicht gefunden' };
  const prio = patch.priority ?? cur.priority;
  if (!(PRIORITIES as readonly string[]).includes(prio)) return { ok: false, error: 'Unbekannte Priorität' };
  const iso = (v: string | undefined, fallback: string) => {
    if (v === undefined) return fallback;
    if (v === '') return '';
    const t = Date.parse(v);
    if (Number.isNaN(t)) throw new Error('Ungültiges Datum');
    return new Date(t).toISOString();
  };
  let due: string;
  let follow: string;
  try {
    due = iso(patch.due_at, cur.due_at);
    follow = iso(patch.follow_up_at, cur.follow_up_at);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const changes: string[] = [];
  if (prio !== cur.priority) changes.push(`Priorität: ${prio}`);
  if (due !== cur.due_at) changes.push(due ? `Frist: ${new Date(due).toLocaleDateString('de-DE')}` : 'Frist entfernt');
  if (follow !== cur.follow_up_at) changes.push(follow ? `Wiedervorlage: ${new Date(follow).toLocaleDateString('de-DE')}` : 'Wiedervorlage entfernt');
  if (!changes.length) return { ok: true };
  await db.batch([
    { sql: 'UPDATE orders SET priority = ?, due_at = ?, follow_up_at = ?, updated_at = ? WHERE id = ?', params: [prio, due, follow, now(), id] },
    { sql: "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, ?, '', ?)", params: [id, now(), changes.join(' · '), actor.name] },
  ]);
  return { ok: true };
}

export async function actRegCheck(id: number, key: string, value: boolean, actor: Actor): Promise<R> {
  if (!/^code_(zb1|zb2|plaketten)$|^pruef_[a-z_]{2,30}$/.test(key)) return { ok: false, error: 'Unbekannter Prüfpunkt' };
  const db = await getDb();
  const cur = await db.first<{ reg_checks_json: string; released_at: string }>('SELECT reg_checks_json, released_at FROM orders WHERE id = ?', id);
  if (!cur) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (cur.released_at && !value) return { ok: false, error: 'Nach der Freigabe erst die Freigabe zurücknehmen' };
  const checks = { ...(JSON.parse(cur.reg_checks_json || '{}') as Record<string, boolean>), [key]: value };
  await db.batch([
    { sql: 'UPDATE orders SET reg_checks_json = ?, updated_at = ? WHERE id = ?', params: [JSON.stringify(checks), now(), id] },
    { sql: "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'checklist', NULL, NULL, ?, '', ?)", params: [id, now(), `Prüfpunkt ${key}: ${value ? 'bestätigt' : 'zurückgesetzt'}`, actor.name] },
  ]);
  return { ok: true };
}

/** Manuelle Freigabe vor der Übermittlung. Übermittelt NICHTS an kfz-api.de. */
export async function actRelease(id: number, release: boolean, actor: Actor): Promise<R> {
  const o = await getOrder(id);
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  const db = await getDb();
  if (!release) {
    if (o.status !== 'in_pruefung') return { ok: false, error: 'Freigabe kann nur vor der Übergabe zurückgenommen werden' };
    await db.batch([
      { sql: "UPDATE orders SET released_at = '', released_by = '', updated_at = ? WHERE id = ?", params: [now(), id] },
      { sql: "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'Freigabe zur Übermittlung zurückgenommen', '', ?)", params: [id, now(), actor.name] },
    ]);
    return { ok: true };
  }
  const wait = earlyStartWait(o);
  if (wait) return { ok: false, error: waitMessage(wait.until) };
  const blockers = releaseBlockers(await issueInput(o));
  if (blockers.length) return { ok: false, error: `Freigabe nicht möglich: ${blockers.join('; ')}` };
  const at = now();
  const r = await db.run("UPDATE orders SET released_at = ?, released_by = ?, updated_at = ? WHERE id = ? AND released_at = ''", at, actor.name, at, id);
  if (!r.changes) return { ok: false, error: 'Bereits freigegeben' };
  await db.run("INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'Zur Übermittlung freigegeben (manuelle Freigabe)', '', ?)", id, at, actor.name);
  await emitSafe({ type: 'order.released', orderId: id, actor: actor.name, dedupeKey: `order.released:${id}:${at}` });
  return { ok: true };
}

/* ---------- Anlegen und Duplizieren ---------- */

/** Auftrag in der Verwaltung anlegen (gleiche Prüfung wie auf der Website). Dokumente danach im Dokumentenmanager. */
export async function createOrderAdmin(raw: unknown, actor: Actor): Promise<{ ok: true; id: number; number: string; warnings: string[] } | { ok: false; error: string; fields?: Record<string, string> }> {
  // Gleicher Sicherheitsschalter wie die Website: ohne rechtliche Freigabe keine neuen Kundenaufträge
  const { checkoutState } = await import('../checkout.ts');
  if (!checkoutState().open) return { ok: false, error: 'Auftragsannahme ist gesperrt (BESTELLUNG_AKTIV) – erst nach rechtlicher Freigabe möglich.' };
  // In der Verwaltung bleibt der Geburtsort freiwillig (Nachtrag aus Ausweis möglich); Pflicht nur im Kundenauftrag
  const v = validateOrder(raw, { plateOffer: await getPlateOffer(), expressOffer: await getExpressOffer(), wishPlace: placeByAgs });
  if (!v.ok) return { ok: false, error: 'Bitte die markierten Felder prüfen', fields: v.errors };
  const order: ValidatedOrder = v.order;
  const db = await getDb();
  const same = await db.all<{ number: string }>(
    "SELECT number FROM orders WHERE fin = ? AND status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle')",
    order.vehicle.fin,
  );
  // Zustimmung zum vorzeitigen Leistungsbeginn (beide Erklärungen) – in der Verwaltung nur, wenn sie vom Kunden vorliegt
  const f = (raw as { finish?: { vorzeitigerBeginn?: unknown; widerrufErlischt?: unknown } } | null)?.finish;
  const earlyStart = f?.vorzeitigerBeginn === true && f?.widerrufErlischt === true;
  if (earlyStart) order.finish.vorzeitigerBeginnAt = now();
  const created = await createOrder(order, []);
  await db.run("UPDATE orders SET source = 'verwaltung' WHERE id = ?", created.id);
  if (earlyStart)
    await db.run(
      "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'Zustimmung zum vorzeitigen Leistungsbeginn und Kenntnis vom Erlöschen in der Verwaltung erfasst', '', ?)",
      created.id,
      now(),
      actor.name,
    );
  await db.run(
    "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'In der Verwaltung angelegt', '', ?)",
    created.id,
    now(),
    actor.name,
  );
  await afterOrderCreated(created.id, 'verwaltung', actor.name);
  return {
    ok: true,
    id: created.id,
    number: created.number,
    warnings: same.length ? [`Achtung: laufende Aufträge mit derselben FIN: ${same.map((s) => s.number).join(', ')}`] : [],
  };
}

/** Nach jeder Bestellung (Website oder Verwaltung): Kunde zuordnen, Ereignis auslösen. Darf nie scheitern. */
export async function afterOrderCreated(orderId: number, source: 'website' | 'verwaltung', actor = 'Kunde'): Promise<void> {
  try {
    await linkOrderToCustomer(orderId, { emitEvents: true });
    const o = await (await getDb()).first<{ customer_id: number | null }>('SELECT customer_id FROM orders WHERE id = ?', orderId);
    await emitSafe({ type: 'order.created', orderId, customerId: o?.customer_id ?? null, actor, payload: { source }, dedupeKey: `order.created:${orderId}` });
  } catch (e) {
    console.error('[os] Nachbearbeitung der Bestellung fehlgeschlagen:', (e as Error).message);
  }
}

/** Vorlage aus einem bestehenden Auftrag (ohne Dokumente, Zahlung, Kennzeichen, eVB) – zum Anlegen eines neuen. */
export async function duplicateTemplate(id: number): Promise<Record<string, unknown> | null> {
  const o = await getOrder(id);
  if (!o) return null;
  const d = o.data;
  return {
    ...d,
    vehicle: { ...d.vehicle },
    holder: { ...d.holder },
    plate: { ...d.plate, wunschkennzeichen: '' },
    finish: { ...d.finish, evb: '', vollmacht: false, datenschutz: false, hinweise: '' },
  };
}

/* ---------- Sammelaktionen ---------- */

export async function bulk(ids: number[], action: { type: string; to?: string; assigneeId?: number | null; priority?: string }, actor: Actor): Promise<{ done: number; failed: { id: number; error: string }[] }> {
  const failed: { id: number; error: string }[] = [];
  let done = 0;
  for (const id of ids.slice(0, 200)) {
    let r: R;
    if (action.type === 'status' && action.to && isStatusId(action.to)) {
      if (action.to === 'storniert') r = { ok: false, error: 'Stornieren nur einzeln mit Begründung' };
      else r = await actStatus(id, action.to, '', 'Sammelaktion', actor);
    } else if (action.type === 'assign') r = await actAssign(id, action.assigneeId ?? null, actor);
    else if (action.type === 'priority') r = await actPlanning(id, { priority: action.priority }, actor);
    else r = { ok: false, error: 'Unbekannte Sammelaktion' };
    if (r.ok) done++;
    else failed.push({ id, error: r.error });
  }
  return { done, failed };
}
