// Endpunkte: Finanzcenter.

import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { SERVICE_IDS, SERVICES } from '../../../lib/services.ts';
import { audit } from '../../audit.ts';
import { getDb } from '../../db.ts';
import { getSettings, setSettings } from '../../settings.ts';
import { getCompany, invoiceReadiness } from '../company.ts';
import { exportResponse } from '../export.ts';
import {
  contributions,
  getInvoice,
  issueCredit,
  issueInvoice,
  listInvoices,
  listPayments,
  listVouchers,
  openItems,
  periodTotals,
  reconciliation,
  refreshStripeFee,
  saveVoucher,
  setPaymentFee,
  splitGross,
} from '../finance.ts';
import { HttpError, int, ok, str, type Route } from '../http.ts';

export const financeRoutes: Route[] = [
  {
    method: 'GET',
    path: 'finance',
    perm: 'finance.read',
    handler: async (c) => {
      const db = await getDb();
      const company = await getCompany();
      const settings = await getSettings(true);
      const rows = await db.all<{ service: string; status: string; payment_status: string; total_cents: number; created_at: string }>(
        'SELECT service, status, payment_status, total_cents, created_at FROM orders',
      );
      const active = rows.filter((r) => r.status !== 'storniert');
      const contrib = await contributions({ limit: 5000 });
      const byService = SERVICE_IDS.map((s) => {
        const xs = contrib.filter((x) => x.service === s);
        const known = xs.filter((x) => x.contributionCents !== null);
        return {
          service: s,
          title: SERVICES[s].title,
          count: xs.length,
          grossCents: xs.reduce((a, x) => a + x.grossCents, 0),
          netCents: xs.reduce((a, x) => a + x.netCents, 0),
          costCents: settings.costs[s] === null ? null : settings.costs[s]! * xs.length,
          feeCents: xs.reduce((a, x) => a + (x.feeCents ?? 0), 0),
          contributionCents: known.length === xs.length ? known.reduce((a, x) => a + (x.contributionCents ?? 0), 0) : null,
          unitCostCents: settings.costs[s],
        };
      });
      const months = new Map<string, { month: string; grossCents: number; paidCents: number; netCents: number; vatCents: number; count: number }>();
      for (const r of active) {
        const m = r.created_at.slice(0, 7);
        const e = months.get(m) ?? { month: m, grossCents: 0, paidCents: 0, netCents: 0, vatCents: 0, count: 0 };
        const sp = splitGross(r.total_cents, company);
        e.grossCents += r.total_cents;
        e.netCents += sp.net;
        e.vatCents += sp.vat;
        if (r.payment_status === 'bezahlt') e.paidCents += r.total_cents;
        e.count++;
        months.set(m, e);
      }
      const sum = (xs: typeof rows) => xs.reduce((a, r) => a + r.total_cents, 0);
      return {
        periods: await periodTotals(),
        totals: {
          grossCents: sum(active),
          netCents: splitGross(sum(active), company).net,
          vatCents: splitGross(sum(active), company).vat,
          paidCents: sum(active.filter((r) => r.payment_status === 'bezahlt')),
          openCents: sum(active.filter((r) => r.payment_status === 'offen')),
          refundedCents: sum(rows.filter((r) => r.payment_status === 'erstattet')),
          cancelledCents: sum(rows.filter((r) => r.status === 'storniert')),
          cancelled: rows.filter((r) => r.status === 'storniert').length,
          orders: active.length,
          feesCents: contrib.reduce((a, x) => a + (x.feeCents ?? 0), 0),
          contributionCents: contrib.every((x) => x.contributionCents !== null) ? contrib.reduce((a, x) => a + (x.contributionCents ?? 0), 0) : null,
          contributionKnown: contrib.filter((x) => x.contributionCents !== null).length,
        },
        byService,
        months: [...months.values()].sort((a, b) => a.month.localeCompare(b.month)).slice(-24),
        costs: settings.costs,
        company: { taxMode: company.taxMode, vatRate: company.vatRate, ready: invoiceReadiness(company), feeHintPercent: company.feeHintPercent, feeHintFixedCents: company.feeHintFixedCents },
        canWrite: c.can('finance.write'),
      };
    },
  },
  {
    method: 'GET',
    path: 'finance/contributions',
    perm: 'finance.read',
    handler: async (c) => contributions({ from: str(c.url.searchParams.get('from'), 10) || undefined, to: str(c.url.searchParams.get('to'), 10) || undefined }),
  },
  { method: 'GET', path: 'finance/invoices', perm: 'finance.read', handler: async () => listInvoices() },
  {
    method: 'GET',
    path: 'finance/invoices/:id',
    perm: 'finance.read',
    handler: async (c) => {
      const r = await getInvoice(int(c.params.id, 'Rechnungs-ID'));
      if (!r) throw new HttpError(404, 'Rechnung nicht gefunden');
      return r;
    },
  },
  {
    method: 'POST',
    path: 'finance/invoices',
    perm: 'finance.write',
    handler: async (c) => {
      const r = ok(await issueInvoice(int(c.body.orderId, 'Auftrags-ID'), c.actor.name, str(c.body.note, 500)));
      await audit(c.audit, 'rechnung.erstellt', r.number);
      return r;
    },
  },
  {
    method: 'POST',
    path: 'finance/invoices/:id/credit',
    perm: 'finance.write',
    handler: async (c) => {
      const r = ok(await issueCredit(int(c.params.id, 'Rechnungs-ID'), str(c.body.reason, 400), c.actor.name));
      await audit(c.audit, 'gutschrift.erstellt', r.number, `zu Rechnung ${c.params.id}`);
      return r;
    },
  },
  { method: 'GET', path: 'finance/open-items', perm: 'finance.read', handler: async () => openItems() },
  { method: 'GET', path: 'finance/reconciliation', perm: 'finance.read', handler: async () => reconciliation() },
  { method: 'GET', path: 'finance/payments', perm: 'finance.read', handler: async () => listPayments() },
  {
    method: 'POST',
    path: 'finance/payments/:id/fee',
    perm: 'finance.write',
    handler: async (c) => {
      const v = c.body.feeCents;
      return ok(await setPaymentFee(int(c.params.id, 'Buchungs-ID'), v === null || v === '' ? null : Math.round(Number(v)), c.actor.name));
    },
  },
  { method: 'POST', path: 'finance/payments/:id/refresh', perm: 'finance.write', handler: async (c) => ok(await refreshStripeFee(int(c.params.id, 'Buchungs-ID'))) },
  { method: 'GET', path: 'finance/vouchers', perm: 'finance.read', handler: async () => listVouchers() },
  {
    method: 'POST',
    path: 'finance/vouchers',
    perm: 'finance.write',
    handler: async (c) => {
      const r = ok(await saveVoucher(c.body));
      await audit(c.audit, 'gutschein.gespeichert', str(c.body.code, 30));
      return r;
    },
  },
  {
    method: 'POST',
    path: 'finance/costs',
    perm: 'finance.write',
    handler: async (c) => {
      const costs = (c.body.costs ?? {}) as Record<string, unknown>;
      const values: Record<string, string> = {};
      for (const svc of SERVICE_IDS) {
        const v = costs[svc];
        if (v === null || v === '' || v === undefined) values[`cost_${svc}`] = '';
        else {
          const n = Math.round(Number(v));
          if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw new HttpError(422, 'Einkaufskosten: 0 bis 10 000 €');
          values[`cost_${svc}`] = String(n);
        }
      }
      await setSettings(values, c.actor.name);
      await audit(c.audit, 'finanzen.einkaufskosten');
      return { ok: true };
    },
  },
  {
    method: 'GET',
    path: 'finance/export',
    perm: 'finance.read',
    handler: async (c) => {
      const kind = str(c.url.searchParams.get('kind'), 20);
      const format = str(c.url.searchParams.get('format'), 5);
      await audit(c.audit, `export.finanzen.${kind}`);
      if (kind === 'invoices') {
        const rows = await listInvoices();
        return exportResponse(format, 'rechnungen', 'Rechnungen', ['Nummer', 'Art', 'Datum', 'Auftrag', 'Empfänger', 'Netto', 'USt', 'Brutto', 'Steuer', 'Korrigiert'], rows.map((r) => [
          r.number,
          r.kind === 'gutschrift' ? 'Gutschrift' : 'Rechnung',
          r.issued_at.slice(0, 10),
          r.order_number,
          (JSON.parse(r.buyer_json) as { name?: string }).name ?? '',
          r.net_cents / 100,
          r.vat_cents / 100,
          r.gross_cents / 100,
          r.tax_mode,
          r.corrected ? 'ja' : '',
        ]));
      }
      if (kind === 'payments') {
        const rows = await listPayments(2000);
        return exportResponse(format, 'zahlungen', 'Zahlungen', ['Datum', 'Auftrag', 'Anbieter', 'Referenz', 'Art', 'Status', 'Betrag', 'Gebühr', 'Zahlart', 'Notiz', 'Erfasst von'], rows.map((r) => [
          r.at.slice(0, 16).replace('T', ' '),
          r.number,
          r.provider,
          r.provider_ref,
          r.kind,
          r.status,
          r.amount_cents / 100,
          r.fee_cents === null ? '' : r.fee_cents / 100,
          r.method,
          r.note,
          r.created_by,
        ]));
      }
      const from = str(c.url.searchParams.get('from'), 10) || undefined;
      const to = str(c.url.searchParams.get('to'), 10) || undefined;
      const rows = await contributions({ from, to, limit: 5000 });
      return exportResponse(format, 'deckungsbeitrag', 'Deckungsbeitrag', ['Auftrag', 'Datum', 'Halter', 'Leistung', 'Zahlung', 'Brutto', 'Netto', 'USt', 'Einkauf', 'Zahlungsgebühr', 'Gebühr Ist-Wert', 'Deckungsbeitrag'], rows.map((r) => [
        r.number,
        r.createdAt.slice(0, 10),
        r.holder,
        SERVICES[r.service]?.title ?? r.service,
        PAYMENT_STATUS_LABEL[r.paymentStatus as keyof typeof PAYMENT_STATUS_LABEL] ?? r.paymentStatus,
        r.grossCents / 100,
        r.netCents / 100,
        r.vatCents / 100,
        r.costCents === null ? '' : r.costCents / 100,
        r.feeCents === null ? '' : r.feeCents / 100,
        r.feeIsActual ? 'ja' : 'nein',
        r.contributionCents === null ? '' : r.contributionCents / 100,
      ]));
    },
  },
  {
    method: 'GET',
    path: 'finance/tax',
    perm: 'finance.read',
    handler: async (c) => {
      // Umsatzsteuer-Übersicht aus ausgestellten Rechnungen/Gutschriften (Soll-Versteuerung nach Rechnungsdatum)
      const year = Number(c.url.searchParams.get('year')) || new Date().getFullYear();
      const rows = await (await getDb()).all<{ month: string; net: number; vat: number; gross: number; n: number }>(
        "SELECT substr(issued_at, 1, 7) AS month, SUM(net_cents) AS net, SUM(vat_cents) AS vat, SUM(gross_cents) AS gross, COUNT(*) AS n FROM invoices WHERE substr(issued_at, 1, 4) = ? GROUP BY month ORDER BY month",
        String(year),
      );
      const company = await getCompany();
      return { year, taxMode: company.taxMode, vatRate: company.vatRate, months: rows };
    },
  },
];
