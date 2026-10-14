// Erweiterte Auftragsabfrage für Auftragscenter, Kanban, Zulassungsmanager, Kontrollzentrum und Export.
// Liefert je Auftrag Arbeitsphase und erkannte Probleme – ohne vertrauliche Inhalte (keine IBAN, kein Geburtsdatum).

import { buildChecklist, isChecklistComplete, type ChecklistState } from '../../lib/checklist.ts';
import type { ValidatedOrder } from '../../lib/order.ts';
import type { DocumentKind, ServiceId } from '../../lib/services.ts';
import { isStatusId, type StatusId } from '../../lib/status.ts';
import { orderIssues, stageOf, type Issue, type Stage } from '../../lib/workflow.ts';
import { allIn, getDb } from '../db.ts';
import { plateFinishOf, type PlateFinish } from '../../lib/plates.ts';
import { processingOf, type ProcessingLevel } from '../../lib/express.ts';
import { wishCodeCheck } from '../regions.ts';
import { poaGate, type PoaStatus } from '../../lib/power-of-attorney.ts';

export interface OrderFilter {
  q?: string;
  status?: string;
  stage?: string;
  service?: string;
  payment?: string;
  assignee?: string;
  priority?: string;
  from?: string;
  to?: string;
  customerId?: number;
  vehicleFin?: string;
  overdue?: boolean;
  issues?: boolean;
  /** nur Express und Express Plus */
  express?: boolean;
  /** Testaufträge des Inhabers: standardmäßig ausgeblendet („nur“ = ausschließlich Testaufträge) */
  test?: 'nur';
  limit?: number;
}

export interface OrderListRow {
  id: number;
  number: string;
  created_at: string;
  updated_at: string;
  status: StatusId;
  service: ServiceId;
  email: string;
  holder_name: string;
  fin: string;
  vehicle: string;
  previous_plate: string;
  assigned_plate: string;
  wish_plate: string;
  /** Schilder mitbestellt: Ausführung, sonst leer */
  plate_signs: '' | PlateFinish;
  /** Bearbeitung (Standard, Express, Express Plus) */
  processing: ProcessingLevel;
  /** erste bestätigte Zahlung (für die Express-Warteschlange) */
  paid_at: string | null;
  delivery: string;
  total_cents: number;
  payment_status: string;
  kfz_display: string;
  kfz_status: string;
  kfz_order_id: string;
  assignee_id: number | null;
  priority: string;
  due_at: string;
  follow_up_at: string;
  released_at: string;
  customer_id: number | null;
  source: string;
  is_test: number;
  checklist: { done: number; total: number; complete: boolean };
  stage: Stage;
  issues: Issue[];
}

const ACTIVE = ['neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle'];

export async function queryOrders(f: OrderFilter, userId: number): Promise<OrderListRow[]> {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  // Testaufträge nie mit echten Kundenbestellungen mischen
  where.push(f.test === 'nur' ? 'o.is_test = 1' : 'o.is_test = 0');
  if (f.status === 'offen') where.push("o.status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle', 'zugelassen', 'versendet', 'abgeholt')");
  else if (f.status === 'laufend') where.push("o.status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle')");
  else if (f.status && isStatusId(f.status)) {
    where.push('o.status = ?');
    params.push(f.status);
  }
  if (f.service) {
    where.push('o.service = ?');
    params.push(f.service);
  }
  if (f.payment) {
    where.push('o.payment_status = ?');
    params.push(f.payment);
  }
  if (f.assignee === 'ich') {
    where.push('o.assignee_id = ?');
    params.push(userId);
  } else if (f.assignee === 'niemand') where.push('o.assignee_id IS NULL');
  else if (f.assignee && /^\d+$/.test(f.assignee)) {
    where.push('o.assignee_id = ?');
    params.push(Number(f.assignee));
  }
  if (f.priority) {
    where.push('o.priority = ?');
    params.push(f.priority);
  }
  if (f.from) {
    where.push('o.created_at >= ?');
    params.push(new Date(f.from).toISOString());
  }
  if (f.to) {
    where.push('o.created_at < ?');
    params.push(new Date(new Date(f.to).getTime() + 86_400_000).toISOString());
  }
  if (f.customerId) {
    where.push('o.customer_id = ?');
    params.push(f.customerId);
  }
  if (f.vehicleFin) {
    where.push('o.fin = ?');
    params.push(f.vehicleFin.toUpperCase());
  }
  if (f.overdue) {
    where.push("o.due_at != '' AND o.due_at < ? AND o.status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle')");
    params.push(new Date().toISOString());
  }
  const needle = f.q?.trim();
  if (needle) {
    const like = `%${needle.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(
      "(lower(o.number) LIKE ? ESCAPE '\\' OR lower(o.holder_name) LIKE ? ESCAPE '\\' OR lower(o.email) LIKE ? ESCAPE '\\' OR lower(o.fin) LIKE ? ESCAPE '\\' OR lower(o.previous_plate) LIKE ? ESCAPE '\\' OR lower(o.assigned_plate) LIKE ? ESCAPE '\\' OR lower(o.kfz_order_id) LIKE ? ESCAPE '\\')",
    );
    params.push(like, like, like, like, like, like, like);
  }
  params.push(Math.min(f.limit ?? 500, 2000));
  const rows = await db.all<
    Omit<OrderListRow, 'checklist' | 'stage' | 'issues' | 'vehicle' | 'wish_plate' | 'plate_signs' | 'processing' | 'paid_at'> & { data_json: string; checklist_json: string; reg_checks_json: string; poa_state: string | null }
  >(
    `SELECT o.id, o.number, o.created_at, o.updated_at, o.status, o.service, o.email, o.holder_name, o.fin, o.previous_plate, o.assigned_plate, o.delivery, o.total_cents,
       o.payment_status, o.kfz_display, o.kfz_status, o.kfz_order_id, o.assignee_id, o.priority, o.due_at, o.follow_up_at, o.released_at, o.customer_id, o.source, o.is_test,
       o.data_json, o.checklist_json, o.reg_checks_json,
       (SELECT p.status || ':' || p.ready || ':' || p.send_email || ':' || CASE WHEN p.create_error != '' THEN 1 ELSE 0 END FROM power_of_attorneys p
         WHERE p.order_id = o.id ORDER BY p.attempt DESC, p.id DESC LIMIT 1) AS poa_state
     FROM orders o ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE o.priority WHEN 'dringend' THEN 0 WHEN 'hoch' THEN 1 ELSE 2 END, o.created_at DESC, o.id DESC LIMIT ?`,
    ...params,
  );
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const docs = await allIn<{ order_id: number; kinds: string }>(
    db,
    ids,
    (ph) => `SELECT order_id, GROUP_CONCAT(DISTINCT kind) AS kinds FROM documents WHERE deleted_at = '' AND order_id IN (${ph}) GROUP BY order_id`,
  );
  const docMap = new Map(docs.map((d) => [d.order_id, (d.kinds || '').split(',') as DocumentKind[]]));
  const pays = await allIn<{ order_id: number; at: string }>(
    db,
    ids,
    (ph) => `SELECT order_id, MIN(at) AS at FROM payments WHERE kind = 'zahlung' AND status = 'bezahlt' AND order_id IN (${ph}) GROUP BY order_id`,
  );
  const paidAt = new Map(pays.map((p) => [p.order_id, p.at]));
  const fins = await db.all<{ fin: string; id: number; number: string }>(
    "SELECT fin, id, number FROM orders WHERE fin != '' AND is_test = 0 AND status IN ('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle')",
  );
  const out: OrderListRow[] = [];
  for (const r of rows) {
    const data = JSON.parse(r.data_json) as ValidatedOrder;
    const state = JSON.parse(r.checklist_json || '{}') as ChecklistState;
    const items = buildChecklist(r.service, data.plate.wahl, { hKennzeichen: !!data.vehicle.hKennzeichen });
    const complete = isChecklistComplete(items, state);
    let regChecks: Record<string, boolean> = {};
    try {
      regChecks = JSON.parse(r.reg_checks_json || '{}') as Record<string, boolean>;
    } catch {
      regChecks = {};
    }
    const [pStatus, pReady, pMail, pErr] = (r.poa_state ?? '').split(':');
    const poa = poaGate(r.service, r.poa_state ? { status: (pStatus || '') as PoaStatus | '', ready: pReady === '1', sendEmail: pMail === '1', note: '', createError: pErr === '1' ? 'x' : '' } : null);
    const issues = orderIssues({
      poa,
      kfz_order_id: r.kfz_order_id,
      isTest: !!r.is_test,
      status: r.status,
      service: r.service,
      payment_status: r.payment_status,
      kfz_display: r.kfz_display,
      kfz_status: r.kfz_status,
      assigned_plate: r.assigned_plate,
      due_at: r.due_at,
      released_at: r.released_at,
      data,
      checklistItems: items,
      checklist: state,
      uploadedKinds: docMap.get(r.id) ?? [],
      regChecks,
      sameFinOpen: ACTIVE.includes(r.status) ? fins.filter((x) => x.fin === r.fin && x.id !== r.id) : [],
      wishCode: wishCodeCheck(data),
    });
    const stage = stageOf({ status: r.status, payment_status: r.payment_status, kfz_display: r.kfz_display, released_at: r.released_at, checklistComplete: complete });
    if (f.stage && f.stage !== stage) continue;
    if (f.issues && !issues.some((i) => i.level !== 'hinweis')) continue;
    const processing = processingOf(data);
    if (f.express && processing === 'standard') continue;
    const { data_json: _d, checklist_json: _c, reg_checks_json: _r, poa_state: _p, ...rest } = r;
    out.push({
      ...rest,
      vehicle: `${data.vehicle.hersteller} ${data.vehicle.modell}`.trim(),
      wish_plate: data.plate.wunschkennzeichen,
      plate_signs: data.plate.schilder ? plateFinishOf(data.plate) : '',
      processing,
      paid_at: paidAt.get(r.id) ?? null,
      checklist: { done: items.filter((i) => state[i.key]?.checked).length, total: items.length, complete },
      stage,
      issues,
    });
  }
  return out;
}
