// Zentrales Ereignisprotokoll von EasyKFZ24 OS.
// Jede fachliche Änderung erzeugt genau ein Ereignis (Schutz vor Doppelungen über dedupe_key, z. B. bei
// Webhook-Neuzustellungen). Aus Ereignissen entstehen Benachrichtigungen und Automatisierungen – nie doppelt.

import { getDb } from '../db.ts';

export type OsEventType =
  | 'order.created'
  | 'order.status'
  | 'order.updated'
  | 'order.assigned'
  | 'order.released'
  | 'order.overdue'
  | 'order.followup'
  | 'payment.paid'
  | 'payment.failed'
  | 'payment.refunded'
  | 'payment.test'
  | 'kfz.status'
  | 'kfz.problem'
  | 'task.created'
  | 'task.assigned'
  | 'task.reminder'
  | 'customer.created'
  | 'customer.returning'
  | 'customer.merged'
  | 'document.uploaded'
  | 'document.reviewed'
  | 'message.sent'
  | 'message.failed'
  | 'message.prepared'
  | 'invoice.issued'
  | 'order.withdrawal'
  | 'order.poa';

export interface OsEventInput {
  type: OsEventType;
  orderId?: number | null;
  customerId?: number | null;
  taskId?: number | null;
  actor?: string;
  payload?: Record<string, unknown>;
  /** Fachlicher Schlüssel: gleiches Ereignis = gleicher Schlüssel → wird nur einmal verarbeitet */
  dedupeKey?: string;
}

export interface OsEvent {
  id: number;
  at: string;
  type: OsEventType;
  order_id: number | null;
  customer_id: number | null;
  task_id: number | null;
  actor: string;
  payload: Record<string, unknown>;
  dedupe_key: string;
}

/**
 * Ereignis speichern und – nur wenn es neu ist – Benachrichtigungen und Automatisierungen auslösen.
 * Fehler in Folgeschritten brechen die auslösende Aktion nie ab (werden protokolliert).
 */
export async function emit(input: OsEventInput): Promise<OsEvent | null> {
  const db = await getDb();
  const at = new Date().toISOString();
  const key = input.dedupeKey ?? `${input.type}:${input.orderId ?? ''}:${input.taskId ?? ''}:${input.customerId ?? ''}:${at}:${Math.random().toString(36).slice(2, 8)}`;
  const row = await db.first<{ id: number }>(
    'INSERT INTO os_events (at, type, order_id, customer_id, task_id, actor, payload_json, dedupe_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(dedupe_key) DO NOTHING RETURNING id',
    at,
    input.type,
    input.orderId ?? null,
    input.customerId ?? null,
    input.taskId ?? null,
    input.actor ?? '',
    JSON.stringify(input.payload ?? {}),
    key,
  );
  if (!row) return null;
  const ev: OsEvent = {
    id: row.id,
    at,
    type: input.type,
    order_id: input.orderId ?? null,
    customer_id: input.customerId ?? null,
    task_id: input.taskId ?? null,
    actor: input.actor ?? '',
    payload: input.payload ?? {},
    dedupe_key: key,
  };
  try {
    const { notifyFromEvent } = await import('./notifications.ts');
    await notifyFromEvent(ev);
  } catch (e) {
    console.error('[os] Benachrichtigung aus Ereignis fehlgeschlagen:', (e as Error).message);
  }
  try {
    const { runAutomations } = await import('./automation.ts');
    await runAutomations(ev);
  } catch (e) {
    console.error('[os] Automatisierung fehlgeschlagen:', (e as Error).message);
  }
  return ev;
}

/** Wie emit, aber verschluckt Fehler vollständig – für Kundenabläufe (Bestellung, Webhooks), die nie scheitern dürfen. */
export async function emitSafe(input: OsEventInput): Promise<void> {
  try {
    await emit(input);
  } catch (e) {
    console.error('[os] Ereignis konnte nicht gespeichert werden:', input.type, (e as Error).message);
  }
}

export async function listEvents(filter: { orderId?: number; customerId?: number; limit?: number } = {}): Promise<OsEvent[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.orderId) {
    where.push('order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.customerId) {
    where.push('customer_id = ?');
    params.push(filter.customerId);
  }
  params.push(Math.min(filter.limit ?? 100, 500));
  const rows = await (await getDb()).all<Omit<OsEvent, 'payload'> & { payload_json: string }>(
    `SELECT id, at, type, order_id, customer_id, task_id, actor, payload_json, dedupe_key FROM os_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`,
    ...params,
  );
  return rows.map(({ payload_json, ...r }) => ({ ...r, payload: safeJson(payload_json) }));
}

export function safeJson(s: string): Record<string, unknown> {
  try {
    const v = JSON.parse(s) as unknown;
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
