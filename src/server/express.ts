// Express-Bearbeitung: Einstellungen (versioniert in settings 'express_settings'), Angebot, Kosten-Momentaufnahme je Auftrag,
// Meilensteine aus echten Ereignissen und Auswertung der tatsächlichen Bearbeitungszeiten. Keine erfundenen Zeiten:
// Ein Meilenstein hat nur dann einen Zeitpunkt, wenn das Ereignis im System nachweisbar ist.

import { z } from 'zod';
import {
  EXPRESS_DEFAULT,
  EXPRESS_LEVELS,
  expressOfferOf,
  MILESTONES,
  PROCESSING_LEVELS,
  processingOf,
  type ExpressCostSnapshot,
  type ExpressLevel,
  type ExpressOffer,
  type ExpressVersion,
  type Milestone,
  type ProcessingLevel,
} from '../lib/express.ts';
import type { ValidatedOrder } from '../lib/order.ts';
import type { PriceBreakdown } from '../lib/pricing.ts';
import { requiredDocuments, type ServiceId } from '../lib/services.ts';
import { allIn, getDb } from './db.ts';
import { setSettings } from './settings.ts';

const KEY = 'express_settings';

const cents = z.number().int().min(0).max(100_000);
const level = z.object({ sellCents: cents.nullable(), active: z.boolean(), internalCostCents: cents, internalHours: z.number().int().min(1).max(240) });
const inputSchema = z
  .object({
    levels: z.object({ express: level, express_plus: level }),
    plusServices: z.array(z.string().trim().min(3).max(160)).max(6),
  })
  .superRefine((v, ctx) => {
    for (const l of EXPRESS_LEVELS) if (v.levels[l].active && !v.levels[l].sellCents) ctx.addIssue({ code: 'custom', message: `Für ${l === 'express' ? 'Express' : 'Express Plus'} fehlt der Aufpreis` });
    if (v.levels.express_plus.active && !v.plusServices.length) ctx.addIssue({ code: 'custom', message: 'Express Plus braucht mindestens eine fest zugesagte Zusatzleistung' });
  });

export async function expressHistory(): Promise<ExpressVersion[]> {
  const row = await (await getDb()).first<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  if (!row?.value) return [];
  try {
    const list = JSON.parse(row.value) as ExpressVersion[];
    return Array.isArray(list) ? list.filter((v) => Number.isInteger(v.version) && inputSchema.safeParse({ levels: v.levels, plusServices: v.plusServices }).success) : [];
  } catch {
    return [];
  }
}

export async function currentExpress(): Promise<ExpressVersion> {
  const h = await expressHistory();
  return h.length ? h[h.length - 1] : EXPRESS_DEFAULT;
}

export async function getExpressOffer(): Promise<ExpressOffer> {
  return expressOfferOf(await currentExpress());
}

export async function saveExpress(input: unknown, by: string): Promise<{ ok: true; version: ExpressVersion } | { ok: false; error: string }> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Ungültige Einstellungen' };
  const history = await expressHistory();
  const version: ExpressVersion = { version: (history.at(-1)?.version ?? 0) + 1, from: new Date().toISOString(), by, ...parsed.data };
  history.push(version);
  await setSettings({ [KEY]: JSON.stringify(history.slice(-200)) }, by);
  return { ok: true, version };
}

export function expressCostSnapshot(v: ExpressVersion, l: ExpressLevel): ExpressCostSnapshot {
  return { level: l, internalCostCents: v.levels[l].internalCostCents, internalHours: v.levels[l].internalHours, version: v.version };
}

/* ---------- Meilensteine ---------- */

interface OrderRow {
  id: number;
  service: ServiceId;
  status: string;
  created_at: string;
  released_at: string;
  data_json: string;
}

export interface OrderTimes {
  eingang: string;
  zahlung: string | null;
  unterlagen: string | null;
  pruefung: string | null;
  freigabe: string | null;
  uebertragen: string | null;
  behoerde: string | null;
  ergebnis: string | null;
  /** Ergebnis der Behörde: ok | rueckfrage | fehler; manuelle Prüfung (FORWARDED) */
  result: 'ok' | 'rueckfrage' | 'fehler' | null;
  manual: boolean;
}

const KFZ_OK = ['APPROVED', 'APPROVED_WITH_DOCUMENTS'];
const KFZ_QUERY = ['REJECTED', 'REJECTED_WITH_DOCUMENTS'];

/** Tatsächliche Zeitpunkte je Auftrag (für viele Aufträge gebündelt – wenige Abfragen, D1-freundlich). */
export async function orderTimes(orders: OrderRow[]): Promise<Map<number, OrderTimes>> {
  const out = new Map<number, OrderTimes>();
  if (!orders.length) return out;
  const db = await getDb();
  const ids = orders.map((o) => o.id);
  // In Blöcken (D1: höchstens 100 Parameter je Abfrage)
  const pays = await allIn<{ order_id: number; at: string }>(db, ids, (ph) => `SELECT order_id, MIN(at) AS at FROM payments WHERE kind = 'zahlung' AND status = 'bezahlt' AND order_id IN (${ph}) GROUP BY order_id`);
  const docs = await allIn<{ order_id: number; kind: string; at: string }>(
    db,
    ids,
    (ph) => `SELECT order_id, kind, MIN(created_at) AS at FROM documents WHERE deleted_at = '' AND order_id IN (${ph}) GROUP BY order_id, kind`,
  );
  const events = await allIn<{ order_id: number; to_status: string; at: string }>(
    db,
    ids,
    (ph) =>
      `SELECT order_id, to_status, MIN(at) AS at FROM events WHERE type = 'status' AND to_status IN ('in_pruefung', 'bei_zulassungsstelle', 'zugelassen', 'unterlagen_fehlen') AND order_id IN (${ph}) GROUP BY order_id, to_status`,
  );
  const kfz = (
    await allIn<{ order_id: number; status: string; derived_status: string; at: string }>(
      db,
      ids,
      (ph) => `SELECT order_id, status, derived_status, received_at AS at FROM kfz_webhook_events WHERE outcome = 'verarbeitet' AND order_id IN (${ph})`,
    )
  ).sort((a, b) => a.at.localeCompare(b.at));
  for (const o of orders) {
    let data: ValidatedOrder | null = null;
    try {
      data = JSON.parse(o.data_json) as ValidatedOrder;
    } catch {
      data = null;
    }
    const required = requiredDocuments(o.service, { hKennzeichen: !!data?.vehicle.hKennzeichen });
    const firstUpload = new Map(docs.filter((d) => d.order_id === o.id).map((d) => [d.kind, d.at]));
    const unterlagen = required.every((k) => firstUpload.has(k)) ? (required.map((k) => firstUpload.get(k) as string).sort().at(-1) ?? o.created_at) : null;
    const ev = (s: string) => events.find((e) => e.order_id === o.id && e.to_status === s)?.at ?? null;
    const k = kfz.filter((e) => e.order_id === o.id);
    const behoerdeEv = k.find((e) => e.status === 'ACCEPTED' || e.status === 'FORWARDED');
    const resultEv = k.find((e) => KFZ_OK.includes(e.status) || KFZ_QUERY.includes(e.status) || e.status === 'FAILED');
    let result: OrderTimes['result'] = null;
    let ergebnis: string | null = null;
    if (resultEv) {
      ergebnis = resultEv.at;
      result = KFZ_OK.includes(resultEv.status) ? 'ok' : KFZ_QUERY.includes(resultEv.status) ? 'rueckfrage' : 'fehler';
    } else if (ev('zugelassen')) {
      // ohne kfz-api.de (manuell eingereicht): Zulassung laut Auftragsstatus
      ergebnis = ev('zugelassen');
      result = 'ok';
    }
    out.set(o.id, {
      eingang: o.created_at,
      zahlung: pays.find((p) => p.order_id === o.id)?.at ?? null,
      unterlagen,
      pruefung: ev('in_pruefung'),
      freigabe: o.released_at || null,
      uebertragen: ev('bei_zulassungsstelle'),
      behoerde: behoerdeEv?.at ?? null,
      ergebnis,
      result,
      manual: k.some((e) => e.status === 'FORWARDED'),
    });
  }
  return out;
}

/** Meilensteine für Kunde und Akte – nur echte Zeitpunkte, keine Dauer-Zusagen. */
export function milestonesOf(t: OrderTimes): Milestone[] {
  return MILESTONES.map((m): Milestone => {
    if (m.key === 'ergebnis') {
      if (t.result === 'ok') return { key: m.key, label: 'Zulassung erfolgreich', at: t.ergebnis, tone: 'ok' };
      if (t.result === 'rueckfrage') return { key: m.key, label: 'Rückfrage der Zulassungsbehörde', at: t.ergebnis, tone: 'warn' };
      if (t.result === 'fehler') return { key: m.key, label: 'Abgelehnt / gescheitert', at: t.ergebnis, tone: 'fail' };
      return { key: m.key, label: 'Zulassung erfolgreich / Rückfrage / Abgelehnt', at: null };
    }
    if (m.key === 'behoerde' && t.manual) {
      return { key: m.key, label: m.label, at: t.behoerde, note: 'Die Zulassungsbehörde prüft von Hand – die Dauer liegt allein bei der Behörde.' };
    }
    return { key: m.key, label: m.label, at: t[m.key] };
  });
}

export async function orderMilestones(orderId: number): Promise<Milestone[] | null> {
  const o = await (await getDb()).first<OrderRow>('SELECT id, service, status, created_at, released_at, data_json FROM orders WHERE id = ?', orderId);
  if (!o) return null;
  const t = (await orderTimes([o])).get(o.id);
  return t ? milestonesOf(t) : null;
}

/* ---------- Auswertung: Standard und Express ---------- */

const hours = (a: string | null, b: string | null) => (a && b && b >= a ? (Date.parse(b) - Date.parse(a)) / 3_600_000 : null);
function stats(values: (number | null)[]): { n: number; avgHours: number | null; medianHours: number | null } {
  const v = values.filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (!v.length) return { n: 0, avgHours: null, medianHours: null };
  const mid = Math.floor(v.length / 2);
  return { n: v.length, avgHours: v.reduce((a, b) => a + b, 0) / v.length, medianHours: v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2 };
}

export const DURATION_STEPS = [
  { key: 'zahlung_unterlagen', label: 'Zahlung → Unterlagen vollständig', from: 'zahlung', to: 'unterlagen' },
  { key: 'bereit_freigabe', label: 'Bereit (bezahlt + vollständig) → Freigabe', from: 'bereit', to: 'freigabe' },
  { key: 'freigabe_uebertragen', label: 'Freigabe → an Zulassungspartner', from: 'freigabe', to: 'uebertragen' },
  { key: 'uebertragen_ergebnis', label: 'Übertragen → Ergebnis der Behörde', from: 'uebertragen', to: 'ergebnis' },
  { key: 'gesamt', label: 'Eingang → Ergebnis (gesamt)', from: 'eingang', to: 'ergebnis' },
] as const;

export interface ExpressReportRow {
  level: ProcessingLevel;
  orders: number;
  paid: number;
  completed: number;
  surchargeGrossCents: number;
  surchargeNetCents: number;
  internalCostCents: number;
  /** Zahlungsgebühr anteilig nach Anteil des Aufpreises am Auftrag (nur bekannte Gebühren) */
  feeCents: number;
  /** Deckungsbeitrag des Aufpreises nach interner Kosten und Gebühr (nur Aufträge mit bekannter Gebühr) */
  contributionCents: number;
  durations: Record<(typeof DURATION_STEPS)[number]['key'], { n: number; avgHours: number | null; medianHours: number | null }>;
  /** Express: wie oft die interne Frist (ab bezahlt + vollständig) bis zur Freigabe eingehalten wurde */
  internalTarget: { met: number; missed: number; open: number } | null;
}

export async function expressReport(
  filter: { from?: string; to?: string },
  splitGross: (gross: number) => { net: number },
): Promise<ExpressReportRow[]> {
  const db = await getDb();
  const where = ["o.status != 'storniert'"];
  const params: string[] = [];
  if (filter.from) {
    where.push('o.created_at >= ?');
    params.push(filter.from);
  }
  if (filter.to) {
    where.push('o.created_at < ?');
    params.push(filter.to);
  }
  const rows = await db.all<OrderRow & { price_json: string; total_cents: number; payment_status: string; due_at: string; fee: number | null; fees_known: number; pays: number }>(
    `SELECT o.id, o.service, o.status, o.created_at, o.released_at, o.data_json, o.price_json, o.total_cents, o.payment_status, o.due_at,
       (SELECT SUM(p.fee_cents) FROM payments p WHERE p.order_id = o.id AND p.fee_cents IS NOT NULL) AS fee,
       (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id AND p.kind = 'zahlung' AND p.status = 'bezahlt' AND p.fee_cents IS NOT NULL) AS fees_known,
       (SELECT COUNT(*) FROM payments p WHERE p.order_id = o.id AND p.kind = 'zahlung' AND p.status = 'bezahlt') AS pays
     FROM orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT 5000`,
    ...params,
  );
  const times = await orderTimes(rows);
  const result: ExpressReportRow[] = [];
  for (const lv of PROCESSING_LEVELS) {
    const mine = rows.filter((r) => {
      try {
        return processingOf(JSON.parse(r.data_json) as ValidatedOrder) === lv;
      } catch {
        return lv === 'standard';
      }
    });
    const row: ExpressReportRow = {
      level: lv,
      orders: mine.length,
      paid: 0,
      completed: 0,
      surchargeGrossCents: 0,
      surchargeNetCents: 0,
      internalCostCents: 0,
      feeCents: 0,
      contributionCents: 0,
      durations: {} as ExpressReportRow['durations'],
      internalTarget: lv === 'standard' ? null : { met: 0, missed: 0, open: 0 },
    };
    const series: Record<string, (number | null)[]> = Object.fromEntries(DURATION_STEPS.map((s) => [s.key, []]));
    for (const r of mine) {
      const t = times.get(r.id) as OrderTimes;
      if (t.zahlung) row.paid += 1;
      if (t.result === 'ok') row.completed += 1;
      const bereit = t.zahlung && t.unterlagen ? (t.zahlung > t.unterlagen ? t.zahlung : t.unterlagen) : null;
      const at: Record<string, string | null> = { ...t, bereit } as unknown as Record<string, string | null>;
      for (const s of DURATION_STEPS) series[s.key].push(hours(at[s.from], at[s.to]));
      if (lv !== 'standard') {
        let price: PriceBreakdown | null = null;
        try {
          price = JSON.parse(r.price_json) as PriceBreakdown;
        } catch {
          price = null;
        }
        const gross = price?.lines.find((l) => l.key === 'express')?.cents ?? 0;
        const snap = price?.cost?.express;
        const net = splitGross(gross).net;
        const orderFee = r.fee ?? (r.pays === 0 && r.payment_status !== 'bezahlt' ? 0 : null);
        const feeKnown = orderFee !== null && (r.pays === 0 || r.fees_known === r.pays);
        const feeShare = feeKnown && r.total_cents > 0 ? Math.round(((orderFee as number) * gross) / r.total_cents) : 0;
        row.surchargeGrossCents += gross;
        row.surchargeNetCents += net;
        row.internalCostCents += snap?.internalCostCents ?? 0;
        row.feeCents += feeShare;
        if (feeKnown) row.contributionCents += net - (snap?.internalCostCents ?? 0) - feeShare;
        // Interne Frist: ab „bereit“ (bezahlt und Unterlagen vollständig) bis zur Freigabe – nur intern, nie Kundenzusage
        const target = row.internalTarget as { met: number; missed: number; open: number };
        const limitH = snap?.internalHours ?? null;
        if (bereit && limitH) {
          const h = hours(bereit, t.freigabe);
          if (h === null) target.open += 1;
          else if (h <= limitH) target.met += 1;
          else target.missed += 1;
        }
      }
    }
    for (const s of DURATION_STEPS) row.durations[s.key] = stats(series[s.key]);
    result.push(row);
  }
  return result;
}
