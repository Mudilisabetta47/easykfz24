// Kontrollzentrum (Unternehmensleitstand): alle Kennzahlen aus echten Daten, priorisierte Probleme mit Sprungziel.

import { STAGES, SIDE_STAGES, type Stage } from '../../lib/workflow.ts';
import { STATUS_IDS, type StatusId } from '../../lib/status.ts';
import { cloudflareEnv, getDb, schemaVersion, SCHEMA_VERSION } from '../db.ts';
import { storageInfo } from '../blobs.ts';
import { kfzApiConfigured, kfzWebhookConfigured } from '../kfz-api.ts';
import { mailConfigured } from '../mailer.ts';
import { paymentsEnabled } from '../payments.ts';
import { periodTotals } from './finance.ts';
import { queryOrders } from './order-query.ts';
import { backfillCustomers } from './customers.ts';

export interface Problem {
  level: 'kritisch' | 'wichtig' | 'hinweis';
  title: string;
  text: string;
  app: string;
  params?: Record<string, unknown>;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function days(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

export async function dashboardData(userId: number, range = 30) {
  await backfillCustomers();
  const db = await getDb();
  const r = [7, 30, 90, 365].includes(range) ? range : 30;
  const since = new Date(Date.now() - r * 86_400_000).toISOString();
  const prevSince = new Date(Date.now() - 2 * r * 86_400_000).toISOString();
  const t0 = Date.now();
  const [byStatusRows, series, prevSeries, done, kfzOutcome, hooks, hookStats, newCustomers, tasks, failedPays, abandoned, oldOpen] = await Promise.all([
    db.all<{ status: StatusId; n: number }>('SELECT status, COUNT(*) AS n FROM orders WHERE is_test = 0 GROUP BY status'),
    db.all<{ created_at: string; total_cents: number; status: string }>('SELECT created_at, total_cents, status FROM orders WHERE is_test = 0 AND created_at >= ?', since),
    db.first<{ n: number; g: number | null }>("SELECT COUNT(*) AS n, SUM(total_cents) AS g FROM orders WHERE is_test = 0 AND created_at >= ? AND created_at < ? AND status != 'storniert'", prevSince, since),
    db.all<{ created_at: string; done_at: string }>(
      "SELECT o.created_at, MIN(e.at) AS done_at FROM orders o JOIN events e ON e.order_id = o.id AND e.type = 'status' AND e.to_status = 'zugelassen' WHERE o.is_test = 0 AND o.created_at >= ? GROUP BY o.id",
      new Date(Date.now() - 365 * 86_400_000).toISOString(),
    ),
    db.all<{ kfz_display: string; n: number }>("SELECT kfz_display, COUNT(*) AS n FROM orders WHERE is_test = 0 AND kfz_display IN ('abgeschlossen', 'fehlgeschlagen') GROUP BY kfz_display"),
    db.all<{ outcome: string; n: number }>('SELECT outcome, COUNT(*) AS n FROM kfz_webhook_events WHERE received_at >= ? GROUP BY outcome', since),
    db.first<{ total: number; deliveries: number | null; last: string | null }>('SELECT COUNT(*) AS total, SUM(deliveries) AS deliveries, MAX(received_at) AS last FROM kfz_webhook_events'),
    db.first<{ day: number; week: number; month: number }>(
      'SELECT SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS day, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS week, SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS month FROM customers',
      new Date(new Date().setHours(0, 0, 0, 0)).toISOString(),
      new Date(Date.now() - 7 * 86_400_000).toISOString(),
      new Date(Date.now() - 30 * 86_400_000).toISOString(),
    ),
    db.all<{ id: number; title: string; due_at: string; priority: string; order_id: number | null; status: string }>(
      "SELECT id, title, due_at, priority, order_id, status FROM tasks WHERE status IN ('offen', 'in_arbeit', 'wartet') AND (assignee_id = ? OR assignee_id IS NULL) ORDER BY CASE WHEN due_at = '' THEN 1 ELSE 0 END, due_at LIMIT 12",
      userId,
    ),
    db.all<{ id: number; number: string }>(
      "SELECT DISTINCT o.id, o.number FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'fehlgeschlagen' AND o.payment_status = 'offen' AND o.status != 'storniert'",
    ),
    db.first<{ n: number }>("SELECT COUNT(DISTINCT p.order_id) AS n FROM payments p JOIN orders o ON o.id = p.order_id WHERE p.status = 'abgebrochen' AND o.payment_status = 'offen' AND p.at >= ?", since),
    db.first<{ n: number; cents: number | null }>(
      "SELECT COUNT(*) AS n, SUM(total_cents) AS cents FROM orders WHERE is_test = 0 AND payment_status = 'offen' AND status != 'storniert' AND created_at < ?",
      new Date(Date.now() - 7 * 86_400_000).toISOString(),
    ),
  ]);
  const dbMs = Date.now() - t0;
  const byStatus = Object.fromEntries(STATUS_IDS.map((s) => [s, 0])) as Record<StatusId, number>;
  for (const row of byStatusRows) if (row.status in byStatus) byStatus[row.status] = row.n;

  const running = await queryOrders({ status: 'laufend', limit: 2000 }, userId);
  const byStage = Object.fromEntries([...STAGES, ...SIDE_STAGES].map((s) => [s, 0])) as Record<Stage, number>;
  for (const o of running) byStage[o.stage]++;
  byStage.abgeschlossen = byStatus.zugelassen + byStatus.versendet + byStatus.abgeholt + byStatus.abgeschlossen;
  byStage.storniert = byStatus.storniert;
  const missingDocs = running.filter((o) => o.issues.some((i) => i.code === 'unterlagen') || o.status === 'unterlagen_fehlen').length;

  const dayList = days(r);
  const bucket = (iso: string) => iso.slice(0, 10);
  const seriesOut = dayList.map((d) => {
    const xs = series.filter((x) => bucket(x.created_at) === d && x.status !== 'storniert');
    return { day: d, orders: xs.length, revenue: xs.reduce((a, x) => a + x.total_cents, 0) };
  });
  const curOrders = seriesOut.reduce((a, x) => a + x.orders, 0);
  const curRevenue = seriesOut.reduce((a, x) => a + x.revenue, 0);

  const hours = done.map((x) => (Date.parse(x.done_at) - Date.parse(x.created_at)) / 3_600_000).filter((h) => Number.isFinite(h) && h >= 0);
  const kfzOk = kfzOutcome.find((x) => x.kfz_display === 'abgeschlossen')?.n ?? 0;
  const kfzFail = kfzOutcome.find((x) => x.kfz_display === 'fehlgeschlagen')?.n ?? 0;
  const doneCount = byStage.abgeschlossen;
  const outcomes = Object.fromEntries(hooks.map((h) => [h.outcome, h.n])) as Record<string, number>;
  const deliveries = hookStats?.deliveries ?? 0;

  /* ---------- Probleme priorisieren ---------- */
  const problems: Problem[] = [];
  for (const o of running) {
    const worst = o.issues.find((i) => i.level === 'fehler');
    if (worst) problems.push({ level: worst.code === 'doppelt' || worst.code === 'kfz_fehler' ? 'kritisch' : 'wichtig', title: `${o.number} · ${o.holder_name}`, text: worst.text, app: 'orders', params: { orderId: o.id, tab: worst.fix } });
  }
  if ((outcomes.fehler ?? 0) + (outcomes.nicht_zugeordnet ?? 0) > 0) {
    problems.push({ level: 'kritisch', title: 'KFZ-API-Meldungen prüfen', text: `${(outcomes.fehler ?? 0) + (outcomes.nicht_zugeordnet ?? 0)} Meldung(en) fehlerhaft oder nicht zugeordnet (${r} Tage)`, app: 'kfz', params: { filter: 'probleme' } });
  }
  for (const p of failedPays) problems.push({ level: 'wichtig', title: `Zahlung fehlgeschlagen: ${p.number}`, text: 'Kunde kontaktieren oder Zahlung erneut anstoßen', app: 'orders', params: { orderId: p.id, tab: 'zahlung' } });
  if (oldOpen?.n) problems.push({ level: 'hinweis', title: 'Offene Posten älter als 7 Tage', text: `${oldOpen.n} Auftrag/Aufträge`, app: 'finance', params: { tab: 'offen' } });
  if (!kfzWebhookConfigured()) problems.push({ level: 'kritisch', title: 'KFZ-API Webhook nicht eingerichtet', text: 'KFZ_API_WEBHOOK_SECRET fehlt', app: 'kfz' });
  const order = { kritisch: 0, wichtig: 1, hinweis: 2 };
  problems.sort((a, b) => order[a.level] - order[b.level]);

  const storage = storageInfo();
  const env = cloudflareEnv();
  return {
    range: r,
    counts: {
      neu: byStatus.neu,
      laufend: running.length,
      rueckfrage: byStage.rueckfrage,
      beimPartner: byStage.beim_partner + byStage.in_bearbeitung,
      abgeschlossen: doneCount,
      storniert: byStatus.storniert,
      gesamt: Object.values(byStatus).reduce((a, b) => a + b, 0),
      fehlendeUnterlagen: missingDocs,
      ueberfaellig: running.filter((o) => o.issues.some((i) => i.code === 'frist')).length,
    },
    byStatus,
    byStage,
    periods: await periodTotals(),
    compare: { orders: curOrders, prevOrders: prevSeries?.n ?? 0, revenue: curRevenue, prevRevenue: prevSeries?.g ?? 0 },
    series: seriesOut,
    customers: { day: newCustomers?.day ?? 0, week: newCustomers?.week ?? 0, month: newCustomers?.month ?? 0 },
    processing: { medianHours: median(hours), meanHours: hours.length ? hours.reduce((a, b) => a + b, 0) / hours.length : null, samples: hours.length },
    success: {
      kfz: kfzOk + kfzFail ? kfzOk / (kfzOk + kfzFail) : null,
      kfzOk,
      kfzFail,
      overall: doneCount + byStatus.storniert ? doneCount / (doneCount + byStatus.storniert) : null,
    },
    cancellations: { storniert: byStatus.storniert, checkoutAbgebrochen: abandoned?.n ?? 0 },
    payments: { failed: failedPays.length, openOld: oldOpen?.n ?? 0, openOldCents: oldOpen?.cents ?? 0 },
    webhooks: {
      total: hookStats?.total ?? 0,
      redeliveries: Math.max(0, deliveries - (hookStats?.total ?? 0)),
      lastAt: hookStats?.last ?? null,
      outcomes,
    },
    system: {
      platform: storage.platform,
      database: { ok: storage.db, ms: dbMs, schema: await schemaVersion(), expected: SCHEMA_VERSION },
      storage: { ok: storage.uploads, kind: storage.platform === 'cloudflare' ? 'R2 (privat)' : 'lokal' },
      cloudflare: { worker: !!env, d1: !!env?.DB, r2: !!env?.UPLOADS },
      kfzWebhook: kfzWebhookConfigured(),
      kfzApi: kfzApiConfigured(),
      mail: mailConfigured(),
      payments: paymentsEnabled(),
    },
    tasks,
    problems: problems.slice(0, 30),
    recent: await db.all<{ id: number; number: string; holder_name: string; service: string; status: string; created_at: string; total_cents: number; kfz_display: string; payment_status: string }>(
      'SELECT id, number, holder_name, service, status, created_at, total_cents, kfz_display, payment_status FROM orders WHERE is_test = 0 ORDER BY created_at DESC, id DESC LIMIT 8',
    ),
    recentEvents: await db.all<{ event_id: string; received_at: string; outcome: string; order_id: number | null; status: string; derived_status: string; error: string; deliveries: number }>(
      'SELECT event_id, received_at, outcome, order_id, status, derived_status, error, deliveries FROM kfz_webhook_events ORDER BY received_at DESC LIMIT 8',
    ),
  };
}
