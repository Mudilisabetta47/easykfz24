// Regelbasierte Automatisierungen. Jede Regel hat einen festen Auslöser, nachvollziehbare Bedingungen,
// ein Protokoll (automation_runs) und läuft je Auslöser höchstens einmal (UNIQUE rule_id + run_key).
// Keine Regel übermittelt Anträge, versendet Kunden-E-Mails oder löst kostenpflichtige Aktionen aus –
// sie bereitet vor (Aufgabe, Entwurf, Hinweis) oder führt rein interne Schritte aus.

import { DOCUMENTS, requiredDocuments, type DocumentKind, type ServiceId } from '../../lib/services.ts';
import type { ValidatedOrder } from '../../lib/order.ts';
import { getDb } from '../db.ts';
import { emitSafe, type OsEvent, type OsEventType } from './events.ts';

export interface RuleParam {
  key: string;
  label: string;
  type: 'number' | 'user';
  default: number | null;
  min?: number;
  max?: number;
}

interface Ctx {
  event?: OsEvent;
  params: Record<string, number | null>;
}

interface Outcome {
  result: 'ausgeführt' | 'übersprungen';
  detail: string;
}

export interface RuleDef {
  id: string;
  title: string;
  description: string;
  trigger: OsEventType[] | 'zeitgesteuert';
  safety: string;
  params: RuleParam[];
  defaultEnabled: boolean;
  /** Ereignisregeln */
  run?: (ctx: Ctx & { event: OsEvent }) => Promise<Outcome>;
  /** Zeitregeln: liefert Fälle (je Fall ein eindeutiger Schlüssel) */
  scan?: (ctx: Ctx) => Promise<{ key: string; orderId?: number | null; exec: () => Promise<Outcome> }[]>;
}

const now = () => new Date().toISOString();
const ACTIVE = "('neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle')";

async function orderBasics(id: number) {
  return (await getDb()).first<{ id: number; number: string; status: string; service: ServiceId; assignee_id: number | null; customer_id: number | null; data_json: string; holder_name: string }>(
    'SELECT id, number, status, service, assignee_id, customer_id, data_json, holder_name FROM orders WHERE id = ?',
    id,
  );
}

async function task(input: { title: string; description?: string; priority?: string; dueInDays?: number; orderId?: number | null; assigneeId?: number | null }): Promise<number | null> {
  // Gleiche offene Aufgabe zum selben Auftrag nicht doppelt anlegen (z. B. Eingang + später „Unterlagen fehlen“)
  if (input.orderId) {
    const open = await (await getDb()).first<{ id: number }>(
      "SELECT id FROM tasks WHERE order_id = ? AND title = ? AND status NOT IN ('erledigt', 'abgebrochen') LIMIT 1",
      input.orderId,
      input.title,
    );
    if (open) return open.id;
  }
  const { createTask } = await import('./tasks.ts');
  const r = await createTask(
    {
      title: input.title,
      description: input.description ?? '',
      priority: input.priority ?? 'normal',
      due_at: input.dueInDays !== undefined ? new Date(Date.now() + input.dueInDays * 86_400_000).toISOString() : '',
      assignee_id: input.assigneeId ?? null,
      order_id: input.orderId ?? null,
    },
    { id: null, name: 'Automatisierung' },
    'automatisierung',
  );
  return r.ok ? r.id : null;
}

export const RULES: RuleDef[] = [
  {
    id: 'zahlung_zur_pruefung',
    title: 'Zahlung bestätigt → Auftrag zur Prüfung freigeben',
    description: 'Geht die Zahlung für einen neuen Auftrag ein, wird er automatisch auf „In Prüfung“ gesetzt.',
    trigger: ['payment.paid'],
    safety: 'Nur interner Statuswechsel Neu → In Prüfung (Workflow-Prüfung wie bei manueller Änderung). Keine Übermittlung.',
    params: [],
    defaultEnabled: true,
    async run({ event }) {
      if (!event.order_id) return { result: 'übersprungen', detail: 'kein Auftrag' };
      const o = await orderBasics(event.order_id);
      if (!o || o.status !== 'neu') return { result: 'übersprungen', detail: `Status ist ${o?.status ?? 'unbekannt'}` };
      const { actStatus } = await import('./order-actions.ts');
      const r = await actStatus(o.id, 'in_pruefung', '', 'Automatisch nach Zahlungseingang', { id: null, name: 'Automatisierung' });
      return r.ok ? { result: 'ausgeführt', detail: `${o.number}: Neu → In Prüfung` } : { result: 'übersprungen', detail: r.error };
    },
  },
  {
    id: 'express_priorisierung',
    title: 'Express bezahlt → priorisieren und interne Frist setzen',
    description:
      'Ist ein Express-Auftrag bezahlt, erhält er Priorität „hoch“ (Express Plus: „dringend“) und eine interne Bearbeitungsfrist laut Express-Einstellungen. Express Plus wird der eingestellten Ansprechperson zugewiesen, falls noch niemand zuständig ist.',
    trigger: ['payment.paid'],
    safety: 'Nur Priorität, interne Frist und Zuweisung. Keine Kundenzusage, keine Übermittlung.',
    params: [{ key: 'zustaendig_plus', label: 'Ansprechperson Express Plus (falls niemand zugewiesen)', type: 'user', default: null }],
    defaultEnabled: true,
    async run({ event, params }) {
      if (!event.order_id) return { result: 'übersprungen', detail: 'kein Auftrag' };
      const o = await (await getDb()).first<{ id: number; number: string; status: string; data_json: string; price_json: string; due_at: string; assignee_id: number | null }>(
        'SELECT id, number, status, data_json, price_json, due_at, assignee_id FROM orders WHERE id = ?',
        event.order_id,
      );
      if (!o || o.status === 'storniert') return { result: 'übersprungen', detail: 'Auftrag fehlt oder storniert' };
      const { isExpress, processingOf } = await import('../../lib/express.ts');
      const level = processingOf(JSON.parse(o.data_json) as { bearbeitung?: unknown });
      if (!isExpress(level)) return { result: 'übersprungen', detail: 'Standard-Bearbeitung' };
      const snap = (JSON.parse(o.price_json) as { cost?: { express?: { internalHours: number } } }).cost?.express;
      const hours = snap?.internalHours ?? (await (await import('../express.ts')).currentExpress()).levels[level].internalHours;
      const due = new Date(Date.now() + hours * 3_600_000).toISOString();
      const { actAssign, actPlanning } = await import('./order-actions.ts');
      const actor = { id: 0, name: 'Automatisierung' };
      const r = await actPlanning(o.id, { priority: level === 'express_plus' ? 'dringend' : 'hoch', ...(o.due_at && o.due_at < due ? {} : { due_at: due }) }, actor);
      if (!r.ok) return { result: 'übersprungen', detail: r.error };
      let assigned = '';
      if (level === 'express_plus' && o.assignee_id === null && params.zustaendig_plus) {
        const a = await actAssign(o.id, params.zustaendig_plus, actor);
        assigned = a.ok ? ', Ansprechperson zugewiesen' : '';
      }
      return { result: 'ausgeführt', detail: `${o.number}: ${level === 'express_plus' ? 'Express Plus' : 'Express'} priorisiert, interne Frist ${hours} h${assigned}` };
    },
  },
  {
    id: 'express_plus_rueckruf',
    title: 'Express Plus: Rückfrage der Behörde → Rückruf-Aufgabe',
    description: 'Bei einer Rückfrage (Unterlagen fehlen bzw. Rückfrage über kfz-api.de) entsteht für Express-Plus-Aufträge eine dringende Aufgabe „Kunde zurückrufen“.',
    trigger: ['order.status', 'kfz.status'],
    safety: 'Legt nur eine interne Aufgabe an.',
    params: [],
    defaultEnabled: true,
    async run({ event }) {
      if (!event.order_id) return { result: 'übersprungen', detail: 'kein Auftrag' };
      const query = event.type === 'order.status' ? event.payload.to === 'unterlagen_fehlen' : event.payload.display === 'angaben_erforderlich';
      if (!query) return { result: 'übersprungen', detail: 'keine Rückfrage' };
      const o = await orderBasics(event.order_id);
      if (!o) return { result: 'übersprungen', detail: 'Auftrag fehlt' };
      const { processingOf } = await import('../../lib/express.ts');
      if (processingOf(JSON.parse(o.data_json) as { bearbeitung?: unknown }) !== 'express_plus') return { result: 'übersprungen', detail: 'kein Express Plus' };
      const id = await task({
        title: `Kunde zurückrufen (Express Plus): ${o.number}`,
        description: 'Zugesagter Rückruf bei Rückfragen – Kunde während der Geschäftszeiten anrufen und Rückfrage klären.',
        priority: 'dringend',
        dueInDays: 0,
        orderId: o.id,
        assigneeId: o.assignee_id,
      });
      return { result: 'ausgeführt', detail: `Aufgabe #${id}` };
    },
  },
  {
    id: 'unterlagen_aufgabe',
    title: 'Dokument fehlt → Aufgabe erstellen',
    description: 'Fehlen Pflichtunterlagen beim Eingang oder wird „Unterlagen fehlen“ gesetzt, entsteht eine Aufgabe „Unterlagen anfordern“.',
    trigger: ['order.created', 'order.status'],
    safety: 'Legt nur eine interne Aufgabe an. Die Kunden-E-Mail wird nicht automatisch versendet.',
    params: [
      { key: 'frist_tage', label: 'Frist (Tage)', type: 'number', default: 2, min: 0, max: 30 },
      { key: 'zustaendig', label: 'Zuständig, falls Auftrag niemandem zugewiesen', type: 'user', default: null },
    ],
    defaultEnabled: true,
    async run({ event, params }) {
      if (!event.order_id) return { result: 'übersprungen', detail: 'kein Auftrag' };
      if (event.type === 'order.status' && event.payload.to !== 'unterlagen_fehlen') return { result: 'übersprungen', detail: 'anderer Status' };
      const o = await orderBasics(event.order_id);
      if (!o) return { result: 'übersprungen', detail: 'Auftrag fehlt' };
      const d = JSON.parse(o.data_json) as ValidatedOrder;
      const uploaded = (await (await getDb()).all<{ kind: DocumentKind }>("SELECT DISTINCT kind FROM documents WHERE order_id = ? AND deleted_at = ''", o.id)).map((r) => r.kind);
      const missing = requiredDocuments(o.service, { hKennzeichen: d.vehicle.hKennzeichen }).filter((k) => !uploaded.includes(k));
      if (event.type === 'order.created' && !missing.length) return { result: 'übersprungen', detail: 'alle Pflichtunterlagen vorhanden' };
      const id = await task({
        title: `Unterlagen anfordern: ${o.number}`,
        description: missing.length ? `Fehlend: ${missing.map((k) => DOCUMENTS[k].label).join(', ')}` : 'Status „Unterlagen fehlen“ – Rückfrage an den Kunden stellen (Vorlage „Unterlagen anfordern“).',
        priority: 'hoch',
        dueInDays: params.frist_tage ?? 2,
        orderId: o.id,
        assigneeId: o.assignee_id ?? params.zustaendig ?? null,
      });
      return { result: 'ausgeführt', detail: `Aufgabe #${id} für ${o.number}` };
    },
  },
  {
    id: 'api_fehler_aufgabe',
    title: 'API meldet Fehler → zuständigen Mitarbeiter benachrichtigen',
    description: 'Bei Ablehnung, Rückfrage der Behörde oder fehlerhafter Webhook-Meldung entsteht eine dringende Aufgabe für den Zuständigen.',
    trigger: ['kfz.status', 'kfz.problem'],
    safety: 'Nur Aufgabe und Benachrichtigung. Keine erneute Übermittlung.',
    params: [{ key: 'zustaendig', label: 'Zuständig, falls Auftrag niemandem zugewiesen', type: 'user', default: null }],
    defaultEnabled: true,
    async run({ event, params }) {
      const display = String(event.payload.display ?? '');
      if (event.type === 'kfz.status' && display !== 'fehlgeschlagen' && display !== 'angaben_erforderlich') return { result: 'übersprungen', detail: `Status ${display || '–'}` };
      const o = event.order_id ? await orderBasics(event.order_id) : null;
      const title =
        event.type === 'kfz.problem'
          ? `KFZ-API-Meldung prüfen${o ? `: ${o.number}` : ' (nicht zugeordnet)'}`
          : display === 'fehlgeschlagen'
            ? `Zulassung abgelehnt/fehlgeschlagen: ${o?.number ?? ''}`
            : `Rückfrage der Behörde: ${o?.number ?? ''}`;
      const id = await task({
        title,
        description: String(event.payload.error ?? event.payload.status ?? ''),
        priority: display === 'angaben_erforderlich' ? 'hoch' : 'dringend',
        dueInDays: 1,
        orderId: o?.id ?? null,
        assigneeId: o?.assignee_id ?? params.zustaendig ?? null,
      });
      return { result: 'ausgeführt', detail: `Aufgabe #${id}` };
    },
  },
  {
    id: 'zulassung_nachricht',
    title: 'Zulassung abgeschlossen → Kundenbenachrichtigung vorbereiten',
    description: 'Beim Status „Zugelassen“ wird eine E-Mail an den Kunden als Entwurf in der Kommunikationszentrale angelegt.',
    trigger: ['order.status'],
    safety: 'Nur Entwurf – der Versand erfolgt erst nach Prüfung durch einen Mitarbeiter.',
    params: [],
    defaultEnabled: true,
    async run({ event }) {
      if (event.payload.to !== 'zugelassen' || !event.order_id) return { result: 'übersprungen', detail: 'anderer Status' };
      // Kam der Bescheid von kfz-api.de und ging die automatische Status-E-Mail raus, nicht doppelt anschreiben
      if (event.actor === 'kfz-api.de' && (await (await getDb()).first("SELECT 1 AS x FROM notifications WHERE order_id = ? AND topic = 'kfz:abgeschlossen' AND state = 'versendet'", event.order_id))) {
        return { result: 'übersprungen', detail: 'Kunde wurde bereits automatisch per Status-E-Mail informiert' };
      }
      const { prepareMessage } = await import('./messages.ts');
      const id = await prepareMessage(event.order_id, 'zulassung_abgeschlossen', 'Automatisierung');
      return id ? { result: 'ausgeführt', detail: `Entwurf #${id}` } : { result: 'übersprungen', detail: 'keine E-Mail-Adresse' };
    },
  },
  {
    id: 'stammkunde',
    title: 'Kunde bestellt erneut → Bestandskunde erkennen',
    description: 'Neue Bestellungen werden dem bestehenden Kundenprofil zugeordnet (E-Mail). Ab der eingestellten Anzahl erhält der Kunde die Kategorie „Stammkunde“.',
    trigger: ['customer.returning'],
    safety: 'Ändert nur die Kundenkategorie, wenn noch keine gesetzt ist.',
    params: [{ key: 'ab_auftraegen', label: 'Stammkunde ab … Aufträgen', type: 'number', default: 2, min: 2, max: 50 }],
    defaultEnabled: true,
    async run({ event, params }) {
      if (!event.customer_id) return { result: 'übersprungen', detail: 'kein Kunde' };
      const n = Number(event.payload.orders ?? 0);
      if (n < (params.ab_auftraegen ?? 2)) return { result: 'übersprungen', detail: `${n} Aufträge` };
      const r = await (await getDb()).run("UPDATE customers SET category = 'Stammkunde', updated_at = ? WHERE id = ? AND category = ''", now(), event.customer_id);
      return r.changes ? { result: 'ausgeführt', detail: `Kunde #${event.customer_id} → Stammkunde` } : { result: 'übersprungen', detail: 'Kategorie bereits gesetzt' };
    },
  },
  {
    id: 'auto_zuweisung',
    title: 'Neuer Auftrag → automatisch zuweisen',
    description: 'Neue Aufträge ohne Zuständigen werden dem eingestellten Mitarbeiter zugewiesen.',
    trigger: ['order.created'],
    safety: 'Nur Zuweisung.',
    params: [{ key: 'zustaendig', label: 'Mitarbeiter', type: 'user', default: null }],
    defaultEnabled: false,
    async run({ event, params }) {
      if (!event.order_id || params.zustaendig === null || params.zustaendig === undefined) return { result: 'übersprungen', detail: 'kein Mitarbeiter eingestellt' };
      const o = await orderBasics(event.order_id);
      if (!o || o.assignee_id !== null) return { result: 'übersprungen', detail: 'bereits zugewiesen' };
      const { actAssign } = await import('./order-actions.ts');
      const r = await actAssign(o.id, params.zustaendig, { id: 0, name: 'Automatisierung' });
      return r.ok ? { result: 'ausgeführt', detail: `${o.number} zugewiesen` } : { result: 'übersprungen', detail: r.error };
    },
  },
  {
    id: 'wiedervorlage',
    title: 'Auftrag seit mehreren Tagen unverändert → Wiedervorlage',
    description: 'Laufende Aufträge ohne Änderung seit der eingestellten Zahl an Tagen erhalten eine Wiedervorlage samt Aufgabe.',
    trigger: 'zeitgesteuert',
    safety: 'Nur Wiedervorlage, Aufgabe und Hinweis.',
    params: [{ key: 'tage', label: 'Unverändert seit (Tage)', type: 'number', default: 3, min: 1, max: 60 }],
    defaultEnabled: true,
    async scan({ params }) {
      const days = params.tage ?? 3;
      const before = new Date(Date.now() - days * 86_400_000).toISOString();
      const rows = await (await getDb()).all<{ id: number; number: string; updated_at: string; assignee_id: number | null }>(
        `SELECT id, number, updated_at, assignee_id FROM orders WHERE status IN ${ACTIVE} AND updated_at < ? LIMIT 200`,
        before,
      );
      return rows.map((r) => ({
        key: `${r.id}:${r.updated_at}`,
        orderId: r.id,
        exec: async () => {
          await (await getDb()).run('UPDATE orders SET follow_up_at = ? WHERE id = ?', now(), r.id);
          const id = await task({ title: `Wiedervorlage: ${r.number}`, description: `Seit ${days} Tagen keine Änderung.`, orderId: r.id, assigneeId: r.assignee_id, dueInDays: 0 });
          await emitSafe({ type: 'order.followup', orderId: r.id, actor: 'Automatisierung', payload: { days }, dedupeKey: `order.followup:${r.id}:${r.updated_at}` });
          return { result: 'ausgeführt', detail: `${r.number}: Aufgabe #${id}` };
        },
      }));
    },
  },
  {
    id: 'frist_ueberfaellig',
    title: 'Bearbeitungsfrist überschritten → Hinweis',
    description: 'Ist die Frist eines laufenden Auftrags überschritten, erscheint ein wichtiger Hinweis.',
    trigger: 'zeitgesteuert',
    safety: 'Nur Hinweis.',
    params: [],
    defaultEnabled: true,
    async scan() {
      const rows = await (await getDb()).all<{ id: number; number: string; due_at: string }>(
        `SELECT id, number, due_at FROM orders WHERE status IN ${ACTIVE} AND due_at != '' AND due_at < ? LIMIT 200`,
        now(),
      );
      return rows.map((r) => ({
        key: `${r.id}:${r.due_at}`,
        orderId: r.id,
        exec: async () => {
          await emitSafe({ type: 'order.overdue', orderId: r.id, actor: 'Automatisierung', payload: { due: r.due_at }, dedupeKey: `order.overdue:${r.id}:${r.due_at}` });
          return { result: 'ausgeführt', detail: `${r.number}: Frist ${r.due_at.slice(0, 10)}` };
        },
      }));
    },
  },
  {
    id: 'vollmacht_abgleich',
    title: 'Digitale Vollmacht: Stand beim Partner abgleichen',
    description:
      'Fragt offene Vollmachtsvorgänge regelmäßig über die Partner-Schnittstelle ab (kfz-api.de bietet dafür keinen Webhook). Änderungen erscheinen im Auftrag und als Hinweis.',
    trigger: 'zeitgesteuert',
    safety: 'Nur lesende, kostenlose Abfrage (GET /powerOfAttorneys/{processId}); höchstens alle 10 Minuten je Vorgang.',
    params: [],
    defaultEnabled: true,
    async scan() {
      const { poasDue, verifyPoa } = await import('../power-of-attorney.ts');
      const rows = await poasDue(20);
      return rows.map((r) => ({
        key: `${r.id}:${Math.floor(Date.now() / 600_000)}`,
        orderId: r.order_id,
        exec: async () => {
          const res = await verifyPoa(r.id, { actor: 'Automatisierung (Abgleich)' });
          if (!res.ok) return { result: 'übersprungen', detail: `Vorgang ${r.process_id}: Abfrage nicht möglich (${res.error}) – nächster Versuch beim nächsten Lauf` };
          return { result: res.changed ? 'ausgeführt' : 'übersprungen', detail: `Vorgang ${r.process_id}: ${res.poa.label}` };
        },
      }));
    },
  },
  {
    id: 'zahlung_abgleich',
    title: 'Online-Zahlung: Stand bei Mollie abgleichen',
    description:
      'Fragt offene Zahlungsversuche bei Mollie ab, falls ein Webhook ausbleibt oder nicht zugestellt werden konnte. Übernommen wird nur der von Mollie bestätigte Stand.',
    trigger: 'zeitgesteuert',
    safety: 'Nur lesende, kostenlose Abfrage (GET /v2/payments/{id}); höchstens alle 10 Minuten je Zahlung, nur Versuche der letzten 3 Tage.',
    params: [],
    defaultEnabled: true,
    async scan() {
      const { attemptsDue, reconcileAttempt } = await import('../mollie.ts');
      const rows = await attemptsDue(20);
      return rows.map((r) => ({
        key: `${r.id}:${Math.floor(Date.now() / 600_000)}`,
        orderId: r.order_id,
        exec: async () => {
          const res = await reconcileAttempt(r.id, { force: true, actor: 'Automatisierung (Zahlungsabgleich)' });
          if (!res.ok) return { result: 'übersprungen', detail: `Zahlung ${r.provider_id}: Abfrage nicht möglich (${res.error}) – nächster Versuch beim nächsten Lauf` };
          return { result: res.changed ? 'ausgeführt' : 'übersprungen', detail: `Zahlung ${r.provider_id}: ${res.attempt.status || 'unbekannt'}` };
        },
      }));
    },
  },
  {
    id: 'aufgaben_erinnerung',
    title: 'Erinnerung zu Aufgaben',
    description: 'Zum eingestellten Erinnerungszeitpunkt erhält der Zuständige einen Hinweis.',
    trigger: 'zeitgesteuert',
    safety: 'Nur Hinweis.',
    params: [],
    defaultEnabled: true,
    async scan() {
      const rows = await (await getDb()).all<{ id: number; title: string; remind_at: string; assignee_id: number | null; order_id: number | null }>(
        "SELECT id, title, remind_at, assignee_id, order_id FROM tasks WHERE remind_at != '' AND remind_at <= ? AND status IN ('offen', 'in_arbeit', 'wartet') LIMIT 200",
        now(),
      );
      return rows.map((r) => ({
        key: `${r.id}:${r.remind_at}`,
        orderId: r.order_id,
        exec: async () => {
          await emitSafe({ type: 'task.reminder', taskId: r.id, orderId: r.order_id, actor: 'Automatisierung', payload: { title: r.title, assigneeId: r.assignee_id }, dedupeKey: `task.reminder:${r.id}:${r.remind_at}` });
          return { result: 'ausgeführt', detail: `Aufgabe #${r.id}` };
        },
      }));
    },
  },
];

/* ---------- Konfiguration ---------- */

const g = globalThis as unknown as { __ekRules?: { at: number; map: Map<string, { enabled: boolean; params: Record<string, number | null> }> }; __ekScanAt?: number };

async function config() {
  if (g.__ekRules && Date.now() - g.__ekRules.at < 30_000) return g.__ekRules.map;
  const rows = await (await getDb()).all<{ id: string; enabled: number; params_json: string }>('SELECT id, enabled, params_json FROM automation_rules');
  const map = new Map<string, { enabled: boolean; params: Record<string, number | null> }>();
  for (const rule of RULES) {
    const row = rows.find((r) => r.id === rule.id);
    let saved: Record<string, number | null> = {};
    try {
      saved = JSON.parse(row?.params_json || '{}') as Record<string, number | null>;
    } catch {
      saved = {};
    }
    const params = Object.fromEntries(rule.params.map((p) => [p.key, p.key in saved ? saved[p.key] : p.default]));
    map.set(rule.id, { enabled: row ? !!row.enabled : rule.defaultEnabled, params });
  }
  g.__ekRules = { at: Date.now(), map };
  return map;
}

export async function listRules() {
  const cfg = await config();
  const db = await getDb();
  const stats = await db.all<{ rule_id: string; runs: number; last: string | null; errors: number }>(
    "SELECT rule_id, SUM(CASE WHEN result = 'ausgeführt' THEN 1 ELSE 0 END) AS runs, MAX(at) AS last, SUM(CASE WHEN result = 'fehler' THEN 1 ELSE 0 END) AS errors FROM automation_runs GROUP BY rule_id",
  );
  return RULES.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    trigger: r.trigger,
    safety: r.safety,
    params: r.params,
    enabled: cfg.get(r.id)?.enabled ?? r.defaultEnabled,
    values: cfg.get(r.id)?.params ?? {},
    runs: stats.find((s) => s.rule_id === r.id)?.runs ?? 0,
    errors: stats.find((s) => s.rule_id === r.id)?.errors ?? 0,
    lastRun: stats.find((s) => s.rule_id === r.id)?.last ?? null,
  }));
}

export async function saveRule(id: string, enabled: boolean, values: Record<string, unknown>, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const rule = RULES.find((r) => r.id === id);
  if (!rule) return { ok: false, error: 'Unbekannte Regel' };
  const params: Record<string, number | null> = {};
  for (const p of rule.params) {
    const v = values[p.key];
    if (v === null || v === '' || v === undefined) {
      params[p.key] = p.type === 'user' ? null : p.default;
      continue;
    }
    const n = Number(v);
    if (!Number.isInteger(n) || (p.min !== undefined && n < p.min) || (p.max !== undefined && n > p.max) || (p.type === 'user' && n < 0)) {
      return { ok: false, error: `${p.label}: ungültiger Wert` };
    }
    params[p.key] = n;
  }
  await (await getDb()).run(
    'INSERT INTO automation_rules (id, enabled, params_json, updated_at, updated_by) VALUES (?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, params_json = excluded.params_json, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    id,
    enabled ? 1 : 0,
    JSON.stringify(params),
    now(),
    by,
  );
  g.__ekRules = undefined;
  return { ok: true };
}

/* ---------- Ausführung ---------- */

/** Lauf beanspruchen (nur einmal je Regel und Schlüssel), ausführen, Ergebnis protokollieren. */
async function claimAndRun(ruleId: string, runKey: string, eventId: number | null, orderId: number | null, exec: () => Promise<Outcome>): Promise<void> {
  const db = await getDb();
  const claim = await db.first<{ id: number }>(
    "INSERT INTO automation_runs (rule_id, run_key, at, event_id, order_id, result, detail) VALUES (?, ?, ?, ?, ?, 'läuft', '') ON CONFLICT(rule_id, run_key) DO NOTHING RETURNING id",
    ruleId,
    runKey,
    now(),
    eventId,
    orderId,
  );
  if (!claim) return;
  let out: Outcome | { result: 'fehler'; detail: string };
  try {
    out = await exec();
  } catch (e) {
    out = { result: 'fehler', detail: (e as Error).message.slice(0, 300) };
  }
  await db.run('UPDATE automation_runs SET result = ?, detail = ? WHERE id = ?', out.result, out.detail.slice(0, 500), claim.id);
}

export async function runAutomations(ev: OsEvent): Promise<void> {
  const cfg = await config();
  for (const rule of RULES) {
    if (rule.trigger === 'zeitgesteuert' || !rule.run || !rule.trigger.includes(ev.type)) continue;
    const c = cfg.get(rule.id);
    if (!c?.enabled) continue;
    const run = rule.run;
    await claimAndRun(rule.id, `e${ev.id}`, ev.id, ev.order_id, () => run({ event: ev, params: c.params }));
  }
}

/**
 * Zeitgesteuerte Regeln – höchstens alle 5 Minuten (ausgelöst durch die Oberfläche oder „Jetzt prüfen“). Mit `only` nur die
 * genannten Regeln (Cron-Trigger des Workers, siehe worker.ts) – unabhängig von der Drossel der Oberfläche.
 */
export async function runScheduledRules(force = false, only?: readonly string[]): Promise<{ ran: boolean; cases: number }> {
  if (!only) {
    if (!force && g.__ekScanAt && Date.now() - g.__ekScanAt < 5 * 60_000) return { ran: false, cases: 0 };
    g.__ekScanAt = Date.now();
  }
  const cfg = await config();
  let cases = 0;
  for (const rule of RULES) {
    if (rule.trigger !== 'zeitgesteuert' || !rule.scan) continue;
    if (only && !only.includes(rule.id)) continue;
    const c = cfg.get(rule.id);
    if (!c?.enabled) continue;
    try {
      const items = await rule.scan({ params: c.params });
      for (const it of items) {
        cases++;
        await claimAndRun(rule.id, it.key, null, it.orderId ?? null, it.exec);
      }
    } catch (e) {
      console.error(`[automation] ${rule.id}:`, (e as Error).message);
    }
  }
  return { ran: true, cases };
}

export async function listRuns(limit = 200) {
  return (await getDb()).all<{ id: number; rule_id: string; run_key: string; at: string; order_id: number | null; number: string | null; result: string; detail: string }>(
    'SELECT r.id, r.rule_id, r.run_key, r.at, r.order_id, o.number, r.result, r.detail FROM automation_runs r LEFT JOIN orders o ON o.id = r.order_id ORDER BY r.id DESC LIMIT ?',
    Math.min(limit, 1000),
  );
}
