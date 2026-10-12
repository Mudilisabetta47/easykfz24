// Aufgaben und Wiedervorlagen (Mitarbeiter- und Aufgabencenter). Aufgaben können an Aufträge und Kunden
// gebunden sein; Automatisierungen legen sie mit festem Schlüssel an (nie doppelt).

import { z } from 'zod';
import { getDb } from '../db.ts';
import { emitSafe } from './events.ts';

export const TASK_STATUS = ['offen', 'in_arbeit', 'wartet', 'erledigt', 'abgebrochen'] as const;
export const TASK_PRIORITY = ['niedrig', 'normal', 'hoch', 'dringend'] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

const now = () => new Date().toISOString();

export interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: (typeof TASK_PRIORITY)[number];
  due_at: string;
  remind_at: string;
  assignee_id: number | null;
  order_id: number | null;
  customer_id: number | null;
  source: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  done_at: string;
  order_number?: string | null;
  customer_name?: string | null;
  comments?: number;
}

const dateish = z
  .string()
  .trim()
  .max(30)
  .refine((v) => v === '' || !Number.isNaN(Date.parse(v)), 'Ungültiges Datum')
  .default('');

export const taskSchema = z.object({
  title: z.string().trim().min(2, 'Titel fehlt').max(200),
  description: z.string().trim().max(4000).default(''),
  status: z.enum(TASK_STATUS).default('offen'),
  priority: z.enum(TASK_PRIORITY).default('normal'),
  due_at: dateish,
  remind_at: dateish,
  assignee_id: z.number().int().min(0).nullable().default(null),
  order_id: z.number().int().positive().nullable().default(null),
  customer_id: z.number().int().positive().nullable().default(null),
});

export async function listTasks(filter: { assigneeId?: number | null; scope?: 'mine' | 'team'; orderId?: number; customerId?: number; status?: string; userId: number }): Promise<TaskRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.scope === 'mine') {
    where.push('t.assignee_id = ?');
    params.push(filter.userId);
  } else if (filter.assigneeId !== undefined) {
    if (filter.assigneeId === null) where.push('t.assignee_id IS NULL');
    else {
      where.push('t.assignee_id = ?');
      params.push(filter.assigneeId);
    }
  }
  if (filter.orderId) {
    where.push('t.order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.customerId) {
    where.push('(t.customer_id = ? OR t.order_id IN (SELECT id FROM orders WHERE customer_id = ?))');
    params.push(filter.customerId, filter.customerId);
  }
  if (filter.status === 'aktiv') where.push("t.status IN ('offen', 'in_arbeit', 'wartet')");
  else if (filter.status && (TASK_STATUS as readonly string[]).includes(filter.status)) {
    where.push('t.status = ?');
    params.push(filter.status);
  }
  return (await getDb()).all<TaskRow>(
    `SELECT t.*, o.number AS order_number, c.name AS customer_name, (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comments
     FROM tasks t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN customers c ON c.id = COALESCE(t.customer_id, o.customer_id)
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY CASE t.status WHEN 'erledigt' THEN 2 WHEN 'abgebrochen' THEN 3 ELSE 0 END,
       CASE t.priority WHEN 'dringend' THEN 0 WHEN 'hoch' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       CASE WHEN t.due_at = '' THEN 1 ELSE 0 END, t.due_at, t.id DESC
     LIMIT 1000`,
    ...params,
  );
}

export async function getTask(id: number) {
  const db = await getDb();
  const t = await db.first<TaskRow>(
    'SELECT t.*, o.number AS order_number, c.name AS customer_name FROM tasks t LEFT JOIN orders o ON o.id = t.order_id LEFT JOIN customers c ON c.id = COALESCE(t.customer_id, o.customer_id) WHERE t.id = ?',
    id,
  );
  if (!t) return null;
  const comments = await db.all<{ id: number; at: string; author: string; text: string }>('SELECT id, at, author, text FROM task_comments WHERE task_id = ? ORDER BY at', id);
  return { task: t, comments };
}

type R = { ok: true; id: number } | { ok: false; error: string };

export async function createTask(input: unknown, actor: { id: number | null; name: string }, source = 'manuell'): Promise<R> {
  const p = taskSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültige Angaben' };
  const t = p.data;
  const db = await getDb();
  let customerId = t.customer_id;
  if (t.order_id) {
    const o = await db.first<{ customer_id: number | null }>('SELECT customer_id FROM orders WHERE id = ?', t.order_id);
    if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
    customerId = customerId ?? o.customer_id;
  }
  const at = now();
  const row = await db.first<{ id: number }>(
    `INSERT INTO tasks (title, description, status, priority, due_at, remind_at, assignee_id, order_id, customer_id, source, created_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.due_at ? new Date(t.due_at).toISOString() : '',
    t.remind_at ? new Date(t.remind_at).toISOString() : '',
    t.assignee_id,
    t.order_id,
    customerId,
    source,
    actor.name,
    at,
    at,
  );
  if (!row) return { ok: false, error: 'Aufgabe konnte nicht angelegt werden' };
  await emitSafe({
    type: 'task.created',
    taskId: row.id,
    orderId: t.order_id,
    customerId,
    actor: actor.name,
    payload: { title: t.title, assigneeId: t.assignee_id, actorId: actor.id, source },
    dedupeKey: `task.created:${row.id}`,
  });
  return { ok: true, id: row.id };
}

export async function updateTask(id: number, patch: Record<string, unknown>, actor: { id: number | null; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const cur = await getTask(id);
  if (!cur) return { ok: false, error: 'Aufgabe nicht gefunden' };
  const merged = { ...cur.task, ...patch };
  const p = taskSchema.safeParse({
    title: merged.title,
    description: merged.description,
    status: merged.status,
    priority: merged.priority,
    due_at: merged.due_at,
    remind_at: merged.remind_at,
    assignee_id: merged.assignee_id,
    order_id: merged.order_id,
    customer_id: merged.customer_id,
  });
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? 'Ungültige Angaben' };
  const t = p.data;
  const done = t.status === 'erledigt' && cur.task.status !== 'erledigt' ? now() : t.status === 'erledigt' ? cur.task.done_at : '';
  const remindChanged = (t.remind_at ? new Date(t.remind_at).toISOString() : '') !== cur.task.remind_at;
  await (await getDb()).run(
    `UPDATE tasks SET title = ?, description = ?, status = ?, priority = ?, due_at = ?, remind_at = ?, assignee_id = ?, order_id = ?, customer_id = ?, updated_at = ?, done_at = ? WHERE id = ?`,
    t.title,
    t.description,
    t.status,
    t.priority,
    t.due_at ? new Date(t.due_at).toISOString() : '',
    t.remind_at ? new Date(t.remind_at).toISOString() : '',
    t.assignee_id,
    t.order_id,
    t.customer_id,
    now(),
    done,
    id,
  );
  if (t.assignee_id !== cur.task.assignee_id && t.assignee_id !== null) {
    await emitSafe({
      type: 'task.assigned',
      taskId: id,
      orderId: t.order_id,
      actor: actor.name,
      payload: { title: t.title, assigneeId: t.assignee_id, actorId: actor.id },
      dedupeKey: `task.assigned:${id}:${t.assignee_id}:${now()}`,
    });
  }
  if (remindChanged) {
    // Neue Erinnerung darf erneut auslösen
    await (await getDb()).run("DELETE FROM automation_runs WHERE rule_id = 'aufgaben_erinnerung' AND run_key LIKE ?", `${id}:%`);
  }
  return { ok: true };
}

export async function addTaskComment(id: number, text: string, author: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Kommentar ist leer' };
  if (t.length > 4000) return { ok: false, error: 'Kommentar ist zu lang' };
  const db = await getDb();
  if (!(await db.first('SELECT 1 AS x FROM tasks WHERE id = ?', id))) return { ok: false, error: 'Aufgabe nicht gefunden' };
  await db.run('INSERT INTO task_comments (task_id, at, author, text) VALUES (?, ?, ?, ?)', id, now(), author, t);
  await db.run('UPDATE tasks SET updated_at = ? WHERE id = ?', now(), id);
  return { ok: true };
}

/** Kennzahlen je Mitarbeiter (nur Aufgabenstände – keine Verhaltens- oder Leistungsüberwachung). */
export async function teamOverview() {
  return (await getDb()).all<{ assignee_id: number | null; open: number; overdue: number; done7: number }>(
    `SELECT assignee_id,
       SUM(CASE WHEN status IN ('offen', 'in_arbeit', 'wartet') THEN 1 ELSE 0 END) AS open,
       SUM(CASE WHEN status IN ('offen', 'in_arbeit', 'wartet') AND due_at != '' AND due_at < ? THEN 1 ELSE 0 END) AS overdue,
       SUM(CASE WHEN status = 'erledigt' AND done_at >= ? THEN 1 ELSE 0 END) AS done7
     FROM tasks GROUP BY assignee_id`,
    now(),
    new Date(Date.now() - 7 * 86_400_000).toISOString(),
  );
}
