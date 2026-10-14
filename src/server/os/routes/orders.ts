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
import { createTestOrder, setTestWindow, testOrderState } from '../test-orders.ts';
import { listTasks } from '../tasks.ts';
import { HttpError, int, ok, optInt, str, type Ctx, type Route } from '../http.ts';
import { processingOf } from '../../../lib/express.ts';
import { orderMilestones } from '../../express.ts';
import { orderWishPlace } from '../../regions.ts';
import { attemptView, listAttempts, mollieMode, mollieTestAvailable, reconcileAttempt, startMolliePayment } from '../../mollie.ts';
import { publicBaseUrl } from '../../payments.ts';
import { getTestRelease, latestPoa, listPoas, poaCreationEnabled, poaMode, previewPoa, requestPoa, setBirthPlace, setTestRelease, verifyPoa, viewOf } from '../../power-of-attorney.ts';

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
    express: p.get('express') === '1',
    test: p.get('test') === 'nur' ? 'nur' : undefined,
    limit: p.get('limit') ? Math.min(2000, Number(p.get('limit')) || 500) : 500,
  };
}

/** Testmodus der digitalen Vollmacht: Freigabe dieses Auftrags (bzw. Hinweis auf einen anderen freigegebenen Auftrag) */
async function poaTestInfo(c: Ctx, orderId: number) {
  const r = poaMode() === 'test' ? await getTestRelease() : null;
  const active = !!r && Date.parse(r.expiresAt) > Date.now();
  return {
    canGrant: poaMode() === 'test' && c.s.user.role === 'inhaber',
    isInhaber: c.s.user.role === 'inhaber',
    release: r && r.orderId === orderId ? { ...r, active } : null,
    otherOrder: r && active && r.orderId !== orderId ? r.number : null,
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
  // Bearbeitung und Meilensteine (tatsächliche Zeitpunkte: Eingang, Zahlung, Vollständigkeit, Freigabe, Übermittlung, Ergebnis)
  const processing = processingOf(order.data);
  const milestones = await orderMilestones(id);
  return {
    processing,
    milestones,
    // Im Konfigurator gewählter Ort (AGS) mit Abgleich gegen das Wunsch-Kürzel
    wishPlace: orderWishPlace(order.data),
    // Digitale Vollmacht: alle Versuche mit bestätigtem Stand (Abgleich über die Partner-Schnittstelle)
    poas: (await listPoas(id)).map(viewOf),
    poaEnabled: poaCreationEnabled(),
    poaMode: poaMode(),
    poaTest: await poaTestInfo(c, id),
    // Online-Zahlung (Mollie): Versuche mit bestätigtem Stand; Modus nur am Schlüssel-Präfix
    paymentAttempts: (await listAttempts(id)).map(attemptView),
    mollieMode: mollieMode(),
    mollieTest: { available: mollieTestAvailable(), canStart: mollieTestAvailable() && c.s.user.role === 'inhaber' },
    // Einkaufspreise und Kosten nur mit Finanzrecht
    order: { ...order, payment_token: undefined, ...extra, price: c.can('finance.read') ? order.price : { ...order.price, cost: undefined } },
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
    // Vorschau vor dem Anlegen: Angaben, Kosten, Rechtshinweise und Prüfsumme – ruft den Partner nicht auf
    method: 'POST',
    path: 'orders/:id/vollmacht/vorschau',
    perm: 'orders.write',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      if (!(await getOrder(id))) throw new HttpError(404, 'Auftrag nicht gefunden');
      const r = await previewPoa(id, { name: c.actor.name, role: c.s.user.role }, { sepa: c.body.sepa === true });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, reasons: r.reasons ?? [] }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      return NextResponse.json(r, { headers: { 'Cache-Control': 'no-store' } });
    },
  },
  {
    // Digitale Vollmacht anfordern (kostenpflichtig beim Partner) – nur mit bestätigter Vorschau (Prüfsumme), je Auftrag einzeln,
    // bestehender offener Vorgang wird wiederverwendet; im Testmodus nur Inhaber mit Testfreigabe dieses Auftrags
    method: 'POST',
    path: 'orders/:id/vollmacht',
    perm: 'orders.write',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      if (!(await getOrder(id))) throw new HttpError(404, 'Auftrag nicht gefunden');
      if (c.body.bestaetigt !== true || typeof c.body.fingerprint !== 'string')
        return NextResponse.json({ ok: false, error: 'Bitte zuerst die Vorschau prüfen und die Kosten und Hinweise bestätigen.', reasons: [] }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      const r = await requestPoa(id, { name: c.actor.name, role: c.s.user.role }, { sepa: c.body.sepa === true, fingerprint: str(c.body.fingerprint, 100) });
      if (!r.ok) {
        const status = r.code === 'denied' ? 403 : r.code === 'changed' || r.code === 'busy' ? 409 : 422;
        return NextResponse.json({ ok: false, error: r.error, code: r.code ?? null, reasons: r.reasons ?? [], poa: r.poa ?? null }, { status, headers: { 'Cache-Control': 'no-store' } });
      }
      await audit(c.audit, r.reused ? 'vollmacht.bestehend' : 'vollmacht.angefordert', String(id), `Vorgang ${r.poa.processId ?? '–'}${r.poa.withSepa ? ', mit SEPA-Mandat' : ''}`);
      return r;
    },
  },
  {
    // Testmodus: genau diesen Auftrag für einen echten Vorgang freigeben bzw. die Freigabe zurückziehen (nur Inhaber)
    method: 'POST',
    path: 'orders/:id/vollmacht/testfreigabe',
    perm: 'settings.manage',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      if (c.s.user.role !== 'inhaber') throw new HttpError(403, 'Nur der Inhaber kann eine Testfreigabe erteilen.');
      const r = await setTestRelease(id, c.body.aktiv === true, { name: c.actor.name, role: c.s.user.role });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      await audit(c.audit, c.body.aktiv === true ? 'vollmacht.testfreigabe' : 'vollmacht.testfreigabe_entzogen', String(id), r.release ? `bis ${r.release.expiresAt}` : '');
      return r;
    },
  },
  {
    // Stand der digitalen Vollmacht jetzt beim Partner abfragen (kostenlos, GET /powerOfAttorneys/{processId})
    method: 'POST',
    path: 'orders/:id/vollmacht/abgleich',
    perm: 'orders.read',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      const rec = await latestPoa(id);
      if (!rec) return NextResponse.json({ ok: false, error: 'Zu diesem Auftrag gibt es keinen Vollmachtsvorgang.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      const r = await verifyPoa(rec.id, { force: true, actor: c.actor.name });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, poa: r.poa ?? null }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      return r;
    },
  },
  {
    // Testzahlung im Mollie-Testmodus (kein echtes Geld) für genau diesen Auftrag – nur Inhaber. Ist der Hauptschlüssel live,
    // bleibt der Auftrag „Zahlung offen“ und es laufen keine Automatisierungen (src/server/mollie.ts).
    method: 'POST',
    path: 'orders/:id/zahlung/test',
    perm: 'settings.manage',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      if (c.s.user.role !== 'inhaber') throw new HttpError(403, 'Nur der Inhaber kann eine Testzahlung starten.');
      if (!(await getOrder(id))) throw new HttpError(404, 'Auftrag nicht gefunden');
      const r = await startMolliePayment(id, publicBaseUrl(c.req), { test: true });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      await audit(c.audit, 'zahlung.testzahlung', String(id), r.reused ? 'fortgesetzt' : 'gestartet');
      return { ok: true, checkoutUrl: r.checkoutUrl, reused: r.reused };
    },
  },
  {
    // Stand der Online-Zahlung jetzt bei Mollie abfragen (kostenlos, GET /v2/payments/{id})
    method: 'POST',
    path: 'orders/:id/zahlung/abgleich',
    perm: 'orders.read',
    handler: async (c) => {
      const id = int(c.params.id, 'Auftrags-ID');
      const last = (await listAttempts(id)).find((a) => a.provider_id);
      if (!last) return NextResponse.json({ ok: false, error: 'Zu diesem Auftrag gibt es keine Online-Zahlung.' }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      const r = await reconcileAttempt(last.id, { force: true, actor: c.actor.name });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      return r;
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
    // Testaufträge des Inhabers (digitale Vollmacht testen, Kunden-Checkout bleibt gesperrt): Stand, Fenster, Liste
    method: 'GET',
    path: 'testauftraege',
    perm: 'settings.manage',
    handler: async (c) => {
      if (c.s.user.role !== 'inhaber') throw new HttpError(403, 'Nur der Inhaber kann Testaufträge verwalten.');
      return { ...(await testOrderState({ name: c.actor.name, role: c.s.user.role })), orders: await queryOrders({ test: 'nur', limit: 50 }, c.actor.id) };
    },
  },
  {
    method: 'POST',
    path: 'testauftraege/fenster',
    perm: 'settings.manage',
    handler: async (c) => {
      if (c.s.user.role !== 'inhaber') throw new HttpError(403, 'Nur der Inhaber kann das Testfenster öffnen oder schließen.');
      const open = c.body.offen === true;
      const r = await setTestWindow(open, { name: c.actor.name, role: c.s.user.role });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      await audit(c.audit, open ? 'testauftrag.fenster_geoeffnet' : 'testauftrag.fenster_geschlossen', '', r.window ? `bis ${r.window.expiresAt}` : '');
      return r;
    },
  },
  {
    // Anlegen fordert keine Vollmacht an und löst keine Zahlung, Mail oder Übermittlung aus
    method: 'POST',
    path: 'testauftraege',
    perm: 'settings.manage',
    handler: async (c) => {
      if (c.s.user.role !== 'inhaber') throw new HttpError(403, 'Nur der Inhaber kann Testaufträge anlegen.');
      const r = await createTestOrder(c.body.data, { name: c.actor.name, role: c.s.user.role });
      if (!r.ok) return NextResponse.json({ ok: false, error: r.error, fields: r.fields ?? {} }, { status: 422, headers: { 'Cache-Control': 'no-store' } });
      await audit(c.audit, 'testauftrag.angelegt', r.number);
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
        case 'birthPlace': {
          // Geburtsort für die digitale Vollmacht nachtragen (Wert nicht ins Protokoll)
          c.need('orders.write');
          const r = ok(await setBirthPlace(id, str(b.value, 105), c.actor.name));
          await audit(c.audit, 'auftrag.geburtsort', order.number);
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

