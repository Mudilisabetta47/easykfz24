// Endpunkte: Auftragscenter, Kanban, Zulassungsmanager.

import { NextResponse } from 'next/server';
import { checklistProgress, isChecklistComplete } from '../../../lib/checklist.ts';
import { SERVICES } from '../../../lib/services.ts';
import { STATUSES, transitionOptions } from '../../../lib/status.ts';
import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { STAGE_META } from '../../../lib/workflow.ts';
import { audit } from '../../audit.ts';
import { getDb } from '../../db.ts';
import { getKfzOrderInfo, linkKfzOrder } from '../../kfz-api.ts';
import { getOrder, listDocuments, listEvents, listNotes, trashNote } from '../../orders.ts';
import { listEvents as listOsEvents } from '../events.ts';
import { exportResponse } from '../export.ts';
import { adjustPrice, listInvoices } from '../finance.ts';
import { listMessages } from '../messages.ts';
import {
  actAssign,
  actChecklist,
  actNote,
  actPayment,
  actPlanning,
  actPlate,
  actRegCheck,
  actRelease,
  actShipment,
  actStatus,
  bulk,
  createOrderAdmin,
  duplicateTemplate,
  orderInsights,
} from '../order-actions.ts';
import { queryOrders, type OrderFilter } from '../order-query.ts';
import { listTasks } from '../tasks.ts';
import { HttpError, int, ok, optInt, str, type Ctx, type Route } from '../http.ts';

function filterFrom(url: URL): OrderFilter {
  const p = url.searchParams;
  return {
    q: str(p.get('q'), 100) || undefined,
    status: str(p.get('status'), 30) || undefined,
    stage: str(p.get('stage'), 30) || undefined,
    service: str(p.get('service'), 30) || undefined,
    payment: str(p.get('payment'), 20) || undefined,
    assignee: str(p.get('assignee'), 20) || undefined,
    priority: str(p.get('priority'), 20) || undefined,
    from: str(p.get('from'), 10) || undefined,
    to: str(p.get('to'), 10) || undefined,
    customerId: p.get('customer') ? int(p.get('customer'), 'Kunden-ID') : undefined,
    vehicleFin: str(p.get('fin'), 17) || undefined,
    overdue: p.get('overdue') === '1',
    issues: p.get('issues') === '1',
    limit: p.get('limit') ? Math.min(2000, Number(p.get('limit')) || 500) : 500,
  };
}

async function orderBundle(c: Ctx, id: number) {
  const order = await getOrder(id);
  if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
  const db = await getDb();
  const [docs, events, notes, kfz, insights, extra, tasks, messages, invoices, payments, osEvents] = await Promise.all([
    listDocuments(id),
    listEvents(id),
    listNotes(id),
    getKfzOrderInfo(id),
    orderInsights(order),
    db.first<{ assignee_id: number | null; priority: string; due_at: string; follow_up_at: string; released_at: string; released_by: string; customer_id: number | null; vehicle_id: number | null; source: string; kfz_status: string }>(
      'SELECT assignee_id, priority, due_at, follow_up_at, released_at, released_by, customer_id, vehicle_id, source, kfz_status FROM orders WHERE id = ?',
      id,
    ),
    listTasks({ orderId: id, userId: c.actor.id }),
    c.can('orders.read') ? listMessages({ orderId: id, limit: 100 }) : null,
    c.can('finance.read') ? listInvoices({ orderId: id }) : [],
    c.can('finance.read')
      ? db.all('SELECT id, at, provider, provider_ref, kind, status, amount_cents, fee_cents, method, note, created_by FROM payments WHERE order_id = ? ORDER BY at DESC', id)
      : [],
    listOsEvents({ orderId: id, limit: 100 }),
  ]);
  const ctx = {
    service: order.service,
    delivery: order.delivery,
    checklistComplete: isChecklistComplete(order.checklistItems, order.checklist),
    hasAssignedPlate: order.assigned_plate !== '',
  };
  const customer = extra?.customer_id ? await db.first<{ id: number; number: string; name: string; category: string }>('SELECT id, number, name, category FROM customers WHERE id = ?', extra.customer_id) : null;
  return {
    order: { ...order, payment_token: undefined, ...extra },
    customer,
    documents: docs
      .filter((d) => !(d as { deleted_at?: string }).deleted_at && !(d as { superseded_at?: string }).superseded_at)
      .map((d) => ({ ...d, stored_name: undefined, url: `/api/admin/dokumente/${d.id}` })),
    events,
    notes,
    kfz,
    tasks,
    messages,
    invoices,
    payments,
    osEvents,
    insights,
    transitions: transitionOptions(order.status, ctx),
    checklistProgress: checklistProgress(order.checklistItems, order.checklist),
    canWrite: c.can('orders.write'),
    canPayment: c.can('finance.write'),
    canFinance: c.can('finance.read'),
    canKfz: c.can('kfz.write'),
    canDocs: c.can('docs.read'),
    canDocsWrite: c.can('docs.write'),
    canMessages: c.can('messages.send'),
  };
}

export const orderRoutes: Route[] = [
  {
    method: 'GET',
    path: 'orders',
    perm: 'orders.read',
    handler: async (c) => queryOrders(filterFrom(c.url), c.actor.id),
  },
  {
    method: 'GET',
    path: 'orders/export',
    perm: 'orders.read',
    handler: async (c) => {
      const rows = await queryOrders({ ...filterFrom(c.url), limit: 2000 }, c.actor.id);
      await audit(c.audit, 'export.auftraege', '', `${rows.length} Zeilen`);
      return exportResponse(
        str(c.url.searchParams.get('format'), 5),
        'auftraege',
        'Aufträge',
        ['Auftrag', 'Eingang', 'Halter', 'E-Mail', 'Leistung', 'Status', 'Phase', 'Zahlung', 'Betrag (EUR)', 'FIN', 'Fahrzeug', 'Kennzeichen', 'Priorität', 'Frist', 'KFZ-API', 'Probleme'],
        rows.map((o) => [
          o.number,
          o.created_at.slice(0, 16).replace('T', ' '),
          o.holder_name,
          o.email,
          SERVICES[o.service]?.title ?? o.service,
          STATUSES[o.status]?.label ?? o.status,
          STAGE_META[o.stage].label,
          PAYMENT_STATUS_LABEL[o.payment_status as keyof typeof PAYMENT_STATUS_LABEL] ?? o.payment_status,
          o.total_cents / 100,
          o.fin,
          o.vehicle,
          o.assigned_plate || o.previous_plate,
          o.priority,
          o.due_at ? o.due_at.slice(0, 10) : '',
          o.kfz_status,
          o.issues.map((i) => i.text).join(' | '),
        ]),
      );
    },
  },
  {
    method: 'GET',
    path: 'orders/:id',
    perm: 'orders.read',
    handler: async (c) => orderBundle(c, int(c.params.id, 'Auftrags-ID')),
  },
  {
    method: 'GET',
    path: 'orders/:id/template',
    perm: 'orders.write',
    handler: async (c) => {
      const t = await duplicateTemplate(int(c.params.id, 'Auftrags-ID'));
      if (!t) throw new HttpError(404, 'Auftrag nicht gefunden');
      return t;
    },
  },
  {
    method: 'POST',
    path: 'orders',
    perm: 'orders.write',
    handler: async (c) => {
      const r = await createOrderAdmin(c.body.data, c.actor);
      // Ungültige Angaben: 422 mit Fehlern je Feld (für die Markierung im Formular)
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, fields: r.fields ?? {} }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      await audit(c.audit, 'auftrag.angelegt', r.number);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'orders/bulk',
    perm: 'orders.write',
    handler: async (c) => {
      const ids = Array.isArray(c.body.ids) ? c.body.ids.map((x) => int(x, 'Auftrags-ID')) : [];
      if (!ids.length) throw new HttpError(400, 'Keine Aufträge gewählt');
      const action = (c.body.action ?? {}) as { type: string; to?: string; assigneeId?: number | null; priority?: string };
      const r = await bulk(ids, action, c.actor);
      await audit(c.audit, 'auftrag.sammelaktion', `${ids.length} Aufträge`, `${action.type} ${action.to ?? action.priority ?? action.assigneeId ?? ''}`);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'orders/:id/action',
    perm: 'orders.read',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      const b = c.body;
      const type = str(b.type, 30);
      const order = await getOrder(id);
      if (!order) throw new HttpError(404, 'Auftrag nicht gefunden');
      switch (type) {
        case 'status': {
          c.need('orders.write');
          const to = str(b.to, 30);
          const r = ok(await actStatus(id, to, str(b.publicMessage, 1000), str(b.internalMessage, 1000), c.actor));
          await audit(c.audit, 'auftrag.status', order.number, `${order.status} → ${to}`);
          return r;
        }
        case 'checklist':
          c.need('orders.write');
          return ok(await actChecklist(id, str(b.key, 60), b.checked === true, c.actor));
        case 'plate': {
          c.need('orders.write');
          const r = ok(await actPlate(id, str(b.plate, 20), c.actor));
          await audit(c.audit, 'auftrag.kennzeichen', order.number, str(b.plate, 20) || 'entfernt');
          return r;
        }
        case 'note':
          c.need('orders.write');
          return ok(await actNote(id, str(b.text, 4000), c.actor));
        case 'noteDelete': {
          c.need('orders.write');
          const r = ok(await trashNote(id, int(b.noteId, 'Notiz-ID'), c.actor.name));
          await audit(c.audit, 'notiz.papierkorb', order.number, String(b.noteId));
          return r;
        }
        case 'shipment':
          c.need('orders.write');
          return ok(await actShipment(id, str(b.carrier, 10), str(b.tracking, 60), c.actor));
        case 'payment': {
          c.need('finance.write');
          const r = ok(await actPayment(id, str(b.status, 20), str(b.ref, 120), c.actor));
          await audit(c.audit, 'auftrag.zahlung', order.number, str(b.status, 20));
          return r;
        }
        case 'adjustPrice': {
          c.need('finance.write');
          const r = ok(
            await adjustPrice(
              id,
              {
                voucher: str(b.voucher, 30) || undefined,
                percent: b.percent === undefined || b.percent === '' ? undefined : Number(b.percent),
                cents: b.cents === undefined || b.cents === '' ? undefined : Math.round(Number(b.cents)),
                reason: str(b.reason, 200),
              },
              c.actor.name,
            ),
          );
          await audit(c.audit, 'auftrag.preis_angepasst', order.number, `${r.newTotal}`);
          return r;
        }
        case 'kfzLink': {
          c.need('kfz.write');
          const r = ok(await linkKfzOrder(id, str(b.kfzOrderId, 80)));
          await audit(c.audit, 'auftrag.kfz_verknuepft', order.number, str(b.kfzOrderId, 80));
          return r;
        }
        case 'assign': {
          c.need('orders.write');
          const r = ok(await actAssign(id, optInt(b.assigneeId), c.actor));
          await audit(c.audit, 'auftrag.zugewiesen', order.number, String(b.assigneeId ?? 'niemand'));
          return r;
        }
        case 'planning':
          c.need('orders.write');
          return ok(
            await actPlanning(
              id,
              {
                priority: b.priority === undefined ? undefined : str(b.priority, 20),
                due_at: b.due_at === undefined ? undefined : str(b.due_at, 30),
                follow_up_at: b.follow_up_at === undefined ? undefined : str(b.follow_up_at, 30),
              },
              c.actor,
            ),
          );
        case 'regCheck':
          c.need('orders.write');
          return ok(await actRegCheck(id, str(b.key, 40), b.value === true, c.actor));
        case 'release': {
          c.need('kfz.write');
          const r = ok(await actRelease(id, b.release !== false, c.actor));
          await audit(c.audit, b.release !== false ? 'auftrag.freigegeben' : 'auftrag.freigabe_zurueck', order.number);
          return r;
        }
      }
      throw new HttpError(400, 'Unbekannte Aktion');
    },
  },
];

