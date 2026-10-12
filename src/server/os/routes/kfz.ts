// Endpunkte: KFZ-API Center (Integrationskonsole). Löst nie einen Antrag aus – nur lesen, prüfen, zuordnen,
// fehlgeschlagene Ereignisse kontrolliert erneut verarbeiten.

import { BUSINESS_TRANSACTIONS, DISPLAY, KFZ_STATUS_TEXT } from '../../../lib/kfz-status.ts';
import { signKfzBody } from '../../../lib/kfz-api.ts';
import { audit } from '../../audit.ts';
import { getDb, runAfter } from '../../db.ts';
import {
  assignKfzEvent,
  checkKfzConnection,
  kfzApiConfigured,
  kfzEventStats,
  kfzWebhookConfigured,
  kfzWebhookUrl,
  listKfzEvents,
  retryKfzEvent,
} from '../../kfz-api.ts';
import { mailConfigured } from '../../mailer.ts';
import { getSettings, setSettings } from '../../settings.ts';
import { HttpError, ok, str, type Route } from '../http.ts';

/** Erklärungen zu Status und Ergebnissen – nur dokumentierte Werte, keine erfundenen Fehlercodes. */
const OUTCOME_HELP: Record<string, string> = {
  verarbeitet: 'Signatur gültig, Auftrag gefunden, Status übernommen.',
  ping: 'Erreichbarkeitstest ohne Vorgang – bestätigt mit HTTP 200.',
  nicht_zugeordnet: 'Signatur gültig, aber kein Auftrag zu externalId/Vorgangsnummer gefunden. Manuell zuordnen.',
  fehler: 'Signatur gültig, Verarbeitung fehlgeschlagen (z. B. Speicher nicht erreichbar). kfz-api.de stellt erneut zu; hier kontrolliert erneut verarbeiten.',
};
const HTTP_HELP: Record<string, string> = {
  '200': 'Angenommen (auch doppelte Zustellung oder PING).',
  '400': 'Rumpf ist kein gültiges JSON.',
  '401': 'Signatur fehlt oder ist ungültig – Geheimnis bei kfz-api.de und KFZ_API_WEBHOOK_SECRET vergleichen.',
  '413': 'Rumpf zu groß.',
  '500': 'Verarbeitung fehlgeschlagen – kfz-api.de stellt erneut zu.',
  '503': 'Speicher nicht erreichbar oder Webhook nicht eingerichtet – kfz-api.de stellt erneut zu.',
};

export const kfzRoutes: Route[] = [
  {
    method: 'GET',
    path: 'kfz',
    perm: 'kfz.read',
    handler: async (c) => {
      const db = await getDb();
      const [stats, events, dupes, byOutcome, settings] = await Promise.all([
        kfzEventStats(),
        listKfzEvents(300),
        db.first<{ events: number; extra: number | null }>('SELECT COUNT(*) AS events, SUM(deliveries - 1) AS extra FROM kfz_webhook_events WHERE deliveries > 1'),
        db.all<{ outcome: string; n: number }>('SELECT outcome, COUNT(*) AS n FROM kfz_webhook_events GROUP BY outcome'),
        db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'kfz_contract'"),
      ]);
      return {
        url: kfzWebhookUrl(),
        webhook: kfzWebhookConfigured(),
        apiAccess: kfzApiConfigured(),
        mail: mailConfigured(),
        stats,
        events,
        duplicates: { events: dupes?.events ?? 0, redeliveries: dupes?.extra ?? 0 },
        byOutcome,
        help: { outcomes: OUTCOME_HELP, http: HTTP_HELP, statuses: KFZ_STATUS_TEXT, display: Object.fromEntries(Object.entries(DISPLAY).map(([k, v]) => [k, v.label])), transactions: BUSINESS_TRANSACTIONS },
        contract: settings?.value ? (JSON.parse(settings.value) as Record<string, string>) : {},
        costs: (await getSettings()).costs,
        canWrite: c.can('kfz.write'),
        submission: {
          enabled: false,
          reason:
            'Die Übermittlung von Anträgen an kfz-api.de ist gesperrt: Endpunkte zum Anlegen sind im Projekt nicht dokumentiert, die KBA-Freischaltung und die ausdrückliche Produktivfreigabe fehlen. Freigegebene Aufträge werden manuell beim Zulassungspartner eingereicht.',
        },
      };
    },
  },
  {
    method: 'GET',
    path: 'kfz/compare',
    perm: 'kfz.read',
    handler: async () => {
      const db = await getDb();
      const stuck = await db.all<{ id: number; number: string; updated_at: string; kfz_order_id: string; kfz_display: string; released_at: string }>(
        "SELECT id, number, updated_at, kfz_order_id, kfz_display, released_at FROM orders WHERE status = 'bei_zulassungsstelle' AND (kfz_updated_at = '' OR kfz_updated_at < ?) ORDER BY updated_at",
        new Date(Date.now() - 3 * 86_400_000).toISOString(),
      );
      const noKfzId = await db.all<{ id: number; number: string; kfz_display: string }>(
        "SELECT id, number, kfz_display FROM orders WHERE kfz_display != '' AND kfz_order_id = '' ORDER BY updated_at DESC LIMIT 100",
      );
      const mismatch = await db.all<{ id: number; number: string; status: string; kfz_display: string }>(
        "SELECT id, number, status, kfz_display FROM orders WHERE (kfz_display = 'abgeschlossen' AND status IN ('neu', 'in_pruefung', 'unterlagen_fehlen')) OR (kfz_display != '' AND status = 'storniert') ORDER BY updated_at DESC LIMIT 100",
      );
      const unmatched = await db.all<{ event_id: string; received_at: string; external_id: string; kfz_order_id: string; status: string }>(
        "SELECT event_id, received_at, external_id, kfz_order_id, status FROM kfz_webhook_events WHERE outcome = 'nicht_zugeordnet' ORDER BY received_at DESC LIMIT 100",
      );
      return { stuck, noKfzId, mismatch, unmatched };
    },
  },
  {
    method: 'GET',
    path: 'kfz/order/:id',
    perm: 'kfz.read',
    handler: async (c) => {
      const id = Number(c.params.id);
      if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Ungültige Auftrags-ID');
      return (await getDb()).all(
        'SELECT event_id, received_at, last_seen_at, deliveries, outcome, status, derived_status, business_transaction, error FROM kfz_webhook_events WHERE order_id = ? ORDER BY received_at',
        id,
      );
    },
  },
  {
    method: 'POST',
    path: 'kfz/check',
    perm: 'kfz.write',
    handler: async (c) => {
      const r = await checkKfzConnection();
      await audit(c.audit, 'kfz.verbindungstest', '', `${r.ok ? 'ok' : 'fehler'} ${r.status ?? ''}`);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'kfz/selftest',
    perm: 'kfz.write',
    handler: async (c) => {
      const secret = process.env.KFZ_API_WEBHOOK_SECRET;
      if (!secret) throw new HttpError(422, 'KFZ_API_WEBHOOK_SECRET fehlt');
      const raw = JSON.stringify({ test: 'easykfz24-selbsttest', at: new Date().toISOString() });
      try {
        const res = await fetch(kfzWebhookUrl(), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': signKfzBody(raw, secret), 'X-Event-Id': `selbsttest-${Date.now()}` },
          body: raw,
          signal: AbortSignal.timeout(10_000),
          cache: 'no-store',
        });
        await audit(c.audit, 'kfz.selbsttest', '', `HTTP ${res.status}`);
        return { ok: res.status === 200, status: res.status, message: `HTTP ${res.status} von ${kfzWebhookUrl()}` };
      } catch (e) {
        return { ok: false, status: null, message: `nicht erreichbar (${(e as Error).message})` };
      }
    },
  },
  {
    method: 'POST',
    path: 'kfz/assign',
    perm: 'kfz.write',
    handler: async (c) => {
      const r = await assignKfzEvent(str(c.body.eventId, 200), str(c.body.number, 30));
      if (!r.ok) throw new HttpError(422, r.error);
      runAfter(r.notify);
      await audit(c.audit, 'kfz.zugeordnet', str(c.body.number, 30), str(c.body.eventId, 200));
      return { ok: true };
    },
  },
  {
    method: 'POST',
    path: 'kfz/retry',
    perm: 'kfz.write',
    handler: async (c) => {
      const r = await retryKfzEvent(str(c.body.eventId, 200));
      if (!r.ok) throw new HttpError(422, r.error);
      runAfter(r.notify);
      await audit(c.audit, 'kfz.erneut_verarbeitet', '', `${str(c.body.eventId, 200)} ${r.matched ? 'zugeordnet' : 'nicht zugeordnet'}`);
      return { ok: true, matched: r.matched };
    },
  },
  {
    method: 'POST',
    path: 'kfz/contract',
    perm: 'kfz.write',
    handler: async (c) => {
      const b = c.body;
      const contract = {
        limits: str(b.limits, 1000),
        fees: str(b.fees, 2000),
        contact: str(b.contact, 300),
        note: str(b.note, 1000),
      };
      await setSettings({ kfz_contract: JSON.stringify(contract) }, c.actor.name);
      await audit(c.audit, 'kfz.vertragsdaten');
      return ok({ ok: true });
    },
  },
];
