'use client';

// Finanzcenter: Umsätze nach Zeitraum, Netto/USt/Brutto, Deckungsbeitrag je Auftrag
// (Verkaufspreis netto − Einkauf − Zahlungsgebühren − weitere Kosten), Rechnungen und Gutschriften, offene Posten,
// Zahlungsabgleich, Preise und Gutscheine, Umsatzsteuer-Übersicht, Export. Keine erfundenen Zahlen.

import { useEffect, useState } from 'react';
import { PRICE_CONFIG } from '../../../lib/pricing.config.ts';
import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { SERVICES, type ServiceId } from '../../../lib/services.ts';
import { dateTime, euro, osFetch, useOsData } from '../api.ts';
import { ColumnChart } from '../charts.tsx';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { dateOnly, ExportMenu } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Kpi, Loading, Panel, Tabs, useFlash } from '../ui.tsx';

interface Period {
  grossCents: number;
  netCents: number;
  paidCents: number;
  orders: number;
  prevGrossCents: number;
}
interface FinanceData {
  periods: Record<'tag' | 'woche' | 'monat' | 'jahr', Period>;
  totals: { grossCents: number; netCents: number; vatCents: number; paidCents: number; openCents: number; refundedCents: number; cancelledCents: number; cancelled: number; orders: number; feesCents: number; contributionCents: number | null; contributionKnown: number };
  byService: { service: ServiceId; title: string; count: number; grossCents: number; netCents: number; costCents: number | null; feeCents: number; contributionCents: number | null; unitCostCents: number | null }[];
  months: { month: string; grossCents: number; paidCents: number; netCents: number; vatCents: number; count: number }[];
  costs: Record<ServiceId, number | null>;
  company: { taxMode: string; vatRate: number; ready: string[]; feeHintPercent: number; feeHintFixedCents: number };
  canWrite: boolean;
}

type Tab = 'uebersicht' | 'deckung' | 'rechnungen' | 'offen' | 'zahlungen' | 'preise' | 'steuer';
const MONTHS = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const short = (c: number) => euro(c).replace(/,00\s€/, ' €');

export function FinanceApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { data, error, loading, reload } = useOsData<FinanceData>('finance');
  const [tab, setTab] = useState<Tab>('uebersicht');
  useEffect(() => {
    if (typeof params?.tab === 'string') setTab(params.tab as Tab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'uebersicht', label: 'Übersicht' },
            { id: 'deckung', label: 'Deckungsbeitrag' },
            { id: 'rechnungen', label: 'Rechnungen' },
            { id: 'offen', label: 'Offene Posten' },
            { id: 'zahlungen', label: 'Zahlungen & Abgleich' },
            { id: 'preise', label: 'Preise, Gutscheine, Kosten' },
            { id: 'steuer', label: 'Umsatzsteuer' },
          ]}
        />
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
      </div>
      <div className="os-scroll os-app__pad">
        {data.company.ready.length ? (
          <p className="os-flash is-error">
            Rechnungen erst möglich, wenn die Unternehmensdaten vollständig sind (Systemeinstellungen → Unternehmen): {data.company.ready.join(', ')}.
          </p>
        ) : null}
        {tab === 'uebersicht' ? <Overview data={data} /> : null}
        {tab === 'deckung' ? <Contribution /> : null}
        {tab === 'rechnungen' ? <Invoices canWrite={data.canWrite} /> : null}
        {tab === 'offen' ? <OpenItems /> : null}
        {tab === 'zahlungen' ? <Payments canWrite={data.canWrite} /> : null}
        {tab === 'preise' ? <Prices data={data} onSaved={() => void reload(true)} /> : null}
        {tab === 'steuer' ? <Tax /> : null}
      </div>
    </div>
  );
}

function Overview({ data }: { data: FinanceData }) {
  const t = data.totals;
  const tax = data.company.taxMode === 'kleinunternehmer' ? 'Kleinunternehmer (§ 19 UStG)' : `USt ${data.company.vatRate} %`;
  return (
    <>
      <div className="os-kpis">
        {(['tag', 'woche', 'monat', 'jahr'] as const).map((u) => {
          const p = data.periods[u];
          const d = p.prevGrossCents ? Math.round(((p.grossCents - p.prevGrossCents) / p.prevGrossCents) * 100) : null;
          return <Kpi key={u} label={`Umsatz ${u === 'tag' ? 'heute' : u === 'woche' ? 'Woche' : u === 'monat' ? 'Monat' : 'Jahr'} (brutto)`} value={euro(p.grossCents)} hint={`netto ${euro(p.netCents)} · bezahlt ${euro(p.paidCents)}${d === null ? '' : ` · ${d >= 0 ? '+' : ''}${d} %`}`} />;
        })}
      </div>
      <div className="os-kpis">
        <Kpi label="Umsatz gesamt (ohne Stornos)" value={euro(t.grossCents)} hint={`netto ${euro(t.netCents)} · USt ${euro(t.vatCents)} · ${tax}`} />
        <Kpi label="Bezahlt" value={euro(t.paidCents)} tone="good" />
        <Kpi label="Offen" value={euro(t.openCents)} tone={t.openCents ? 'warn' : undefined} />
        <Kpi label="Stornos / Erstattungen" value={`${t.cancelled} / ${euro(t.refundedCents)}`} hint={`stornierte Aufträge über ${euro(t.cancelledCents)}`} />
        <Kpi label="Zahlungsgebühren (Ist)" value={euro(t.feesCents)} hint="aus Stripe bzw. manuell erfasst" />
        <Kpi
          label="Deckungsbeitrag"
          value={t.contributionCents === null ? '–' : euro(t.contributionCents)}
          hint={t.contributionCents === null ? `nur für ${t.contributionKnown} von ${t.orders} Aufträgen berechenbar (Einkaufskosten/Gebühren fehlen)` : 'netto − Einkauf − Gebühren'}
          tone={t.contributionCents === null ? undefined : t.contributionCents >= 0 ? 'good' : 'bad'}
        />
      </div>
      <Panel title="Umsatz pro Monat">
        {data.months.length ? (
          <ColumnChart
            data={data.months}
            xKey="month"
            series={[
              { key: 'grossCents', label: 'Umsatz brutto', color: 'var(--viz-1)' },
              { key: 'paidCents', label: 'davon bezahlt', color: 'var(--viz-2)' },
            ]}
            format={short}
            xLabel={monthLabel}
            title="Umsatz und bezahlter Umsatz pro Monat"
          />
        ) : (
          <Empty title="Noch kein Umsatz" />
        )}
      </Panel>
      <Panel title="Nach Dienstleistung" actions={<ExportMenu base="finance/export?kind=deckungsbeitrag" />}>
        <ServiceTable data={data} />
      </Panel>
    </>
  );
}

function ServiceTable({ data }: { data: FinanceData }) {
  return (
    <div className="os-tablewrap">
      <table className="os-table">
        <thead>
          <tr>
            <th scope="col">Leistung</th>
            <th scope="col" className="num">
              Aufträge
            </th>
            <th scope="col" className="num">
              Brutto
            </th>
            <th scope="col" className="num">
              Netto
            </th>
            <th scope="col" className="num">
              Einkauf
            </th>
            <th scope="col" className="num">
              Gebühren
            </th>
            <th scope="col" className="num">
              Deckungsbeitrag
            </th>
          </tr>
        </thead>
        <tbody>
          {data.byService.map((s) => (
            <tr key={s.service}>
              <th scope="row">{s.title}</th>
              <td className="num">{s.count}</td>
              <td className="num">{euro(s.grossCents)}</td>
              <td className="num">{euro(s.netCents)}</td>
              <td className="num">{s.costCents === null ? <span className="os-muted">nicht gepflegt</span> : euro(s.costCents)}</td>
              <td className="num">{euro(s.feeCents)}</td>
              <td className={`num${s.contributionCents !== null && s.contributionCents < 0 ? ' is-neg' : ''}`}>{s.contributionCents === null ? <span className="os-muted">–</span> : euro(s.contributionCents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Contribution() {
  const { openApp } = useOs();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const qs = new URLSearchParams({ ...(from ? { from } : {}), ...(to ? { to } : {}) }).toString();
  const { data, loading } = useOsData<
    { orderId: number; number: string; holder: string; service: ServiceId; paymentStatus: string; createdAt: string; grossCents: number; netCents: number; vatCents: number; costCents: number | null; feeCents: number | null; feeIsActual: boolean; contributionCents: number | null }[]
  >(`finance/contributions${qs ? `?${qs}` : ''}`);
  const sum = (k: 'grossCents' | 'netCents' | 'vatCents') => (data ?? []).reduce((a, r) => a + r[k], 0);
  return (
    <Panel
      title="Deckungsbeitrag je Auftrag"
      actions={
        <span className="os-row">
          <label className="os-field os-field--inline">
            <span className="os-field__label">von</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className="os-field os-field--inline">
            <span className="os-field__label">bis</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
          <ExportMenu base={`finance/export?kind=deckungsbeitrag${qs ? `&${qs}` : ''}`} />
        </span>
      }
    >
      <p className="os-muted os-small">Verkaufspreis netto − Einkaufskosten − Zahlungsgebühren − weitere direkte Kosten = Deckungsbeitrag. Ohne bekannte Kosten bzw. Gebühren wird nichts geschätzt.</p>
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="os-tablewrap">
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Auftrag</th>
                <th scope="col">Datum</th>
                <th scope="col">Leistung</th>
                <th scope="col">Zahlung</th>
                <th scope="col" className="num">
                  Brutto
                </th>
                <th scope="col" className="num">
                  Netto
                </th>
                <th scope="col" className="num">
                  Einkauf
                </th>
                <th scope="col" className="num">
                  Gebühr
                </th>
                <th scope="col" className="num">
                  DB
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((r) => (
                <tr key={r.orderId} className="is-link" onClick={() => openApp('orders', { orderId: r.orderId, tab: 'zahlung' })}>
                  <td className="os-mono">{r.number}</td>
                  <td>{dateOnly(r.createdAt)}</td>
                  <td>{SERVICES[r.service]?.title}</td>
                  <td>{PAYMENT_STATUS_LABEL[r.paymentStatus as keyof typeof PAYMENT_STATUS_LABEL]}</td>
                  <td className="num">{euro(r.grossCents)}</td>
                  <td className="num">{euro(r.netCents)}</td>
                  <td className="num">{r.costCents === null ? '–' : euro(r.costCents)}</td>
                  <td className="num">{r.feeCents === null ? '–' : `${euro(r.feeCents)}${r.feeIsActual ? '' : '*'}`}</td>
                  <td className={`num${r.contributionCents !== null && r.contributionCents < 0 ? ' is-neg' : ''}`}>{r.contributionCents === null ? '–' : euro(r.contributionCents)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th colSpan={4}>Summe</th>
                <th className="num">{euro(sum('grossCents'))}</th>
                <th className="num">{euro(sum('netCents'))}</th>
                <th colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </div>
      ) : (
        <Empty title="Keine Aufträge im Zeitraum" />
      )}
    </Panel>
  );
}

function Invoices({ canWrite }: { canWrite: boolean }) {
  const { openApp } = useOs();
  const { data, loading, reload } = useOsData<{ id: number; number: string; kind: string; order_id: number; order_number: string; issued_at: string; net_cents: number; vat_cents: number; gross_cents: number; payment_status: string; corrected: number; buyer_json: string }[]>('finance/invoices');
  const flash = useFlash();
  return (
    <Panel title="Rechnungen & Gutschriften" actions={<ExportMenu base="finance/export?kind=invoices" />}>
      {flash.node}
      <p className="os-muted os-small">Rechnungen werden nie gelöscht oder geändert – Korrekturen erfolgen per Gutschrift (Stornorechnung) mit eigener Nummer. Neue Rechnung: im Auftrag → Zahlung & Rechnung.</p>
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <div className="os-tablewrap">
          <table className="os-table">
            <thead>
              <tr>
                <th scope="col">Nummer</th>
                <th scope="col">Art</th>
                <th scope="col">Datum</th>
                <th scope="col">Auftrag</th>
                <th scope="col">Empfänger</th>
                <th scope="col" className="num">
                  Netto
                </th>
                <th scope="col" className="num">
                  USt
                </th>
                <th scope="col" className="num">
                  Brutto
                </th>
                <th scope="col">Zahlung</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {data.map((i) => (
                <tr key={i.id}>
                  <td className="os-mono">
                    <a className="os-link" href={`/admin/rechnungen/${i.id}`} target="_blank" rel="noopener">
                      {i.number}
                    </a>
                  </td>
                  <td>{i.kind === 'gutschrift' ? <Badge tone="amber">Gutschrift</Badge> : i.corrected ? <Badge tone="slate">korrigiert</Badge> : <Badge tone="green">Rechnung</Badge>}</td>
                  <td>{dateOnly(i.issued_at)}</td>
                  <td>
                    <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: i.order_id, tab: 'zahlung' })}>
                      {i.order_number}
                    </button>
                  </td>
                  <td>{(JSON.parse(i.buyer_json) as { name?: string }).name}</td>
                  <td className="num">{euro(i.net_cents)}</td>
                  <td className="num">{euro(i.vat_cents)}</td>
                  <td className="num">{euro(i.gross_cents)}</td>
                  <td>{i.kind === 'rechnung' ? PAYMENT_STATUS_LABEL[i.payment_status as keyof typeof PAYMENT_STATUS_LABEL] : ''}</td>
                  <td>
                    {canWrite && i.kind === 'rechnung' && !i.corrected ? (
                      <button
                        type="button"
                        className="os-btn os-btn--ghost os-btn--sm"
                        onClick={async () => {
                          const reason = window.prompt(`Gutschrift zu ${i.number} – Begründung:`);
                          if (!reason) return;
                          try {
                            const r = await osFetch<{ number: string }>(`finance/invoices/${i.id}/credit`, { method: 'POST', body: { reason } });
                            flash.show(true, `Gutschrift ${r.number} erstellt`);
                            void reload(true);
                          } catch (e) {
                            flash.show(false, (e as Error).message);
                          }
                        }}
                      >
                        Gutschrift
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Noch keine Rechnungen" />
      )}
    </Panel>
  );
}

function OpenItems() {
  const { openApp } = useOs();
  const { data, loading } = useOsData<{ id: number; number: string; holder_name: string; total_cents: number; created_at: string; status: string; invoice_number: string | null; days: number }[]>('finance/open-items');
  return (
    <Panel title={`Offene Posten (${data?.length ?? 0} · ${euro((data ?? []).reduce((a, r) => a + r.total_cents, 0))})`}>
      {loading && !data ? (
        <Loading />
      ) : data?.length ? (
        <table className="os-table">
          <thead>
            <tr>
              <th scope="col">Auftrag</th>
              <th scope="col">Kunde</th>
              <th scope="col">Rechnung</th>
              <th scope="col">Alter</th>
              <th scope="col" className="num">
                Betrag
              </th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.id}>
                <td className="os-mono">
                  <button type="button" className="os-linkbtn" onClick={() => openApp('orders', { orderId: r.id, tab: 'zahlung' })}>
                    {r.number}
                  </button>
                </td>
                <td>{r.holder_name}</td>
                <td className="os-mono">{r.invoice_number ?? '–'}</td>
                <td className={r.days > 14 ? 'os-overdue' : ''}>{r.days} Tage</td>
                <td className="num">{euro(r.total_cents)}</td>
                <td>
                  <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('messages', { compose: r.id, template: 'zahlung_erinnerung' })}>
                    Erinnern
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <Empty title="Keine offenen Posten" />
      )}
    </Panel>
  );
}

function Payments({ canWrite }: { canWrite: boolean }) {
  const { openApp } = useOs();
  const pays = useOsData<{ id: number; order_id: number; number: string; at: string; provider: string; provider_ref: string; kind: string; status: string; amount_cents: number; fee_cents: number | null; method: string; note: string; created_by: string }[]>('finance/payments');
  const rec = useOsData<{
    paidWithoutBooking: { id: number; number: string; total_cents: number }[];
    amountMismatch: { id: number; number: string; total_cents: number; paid: number }[];
    cancelledPaid: { id: number; number: string; total_cents: number }[];
    failed: { id: number; number: string; at: string }[];
    abandoned: { id: number; number: string; at: string }[];
  }>('finance/reconciliation');
  const flash = useFlash();
  const list = (title: string, hint: string, rows: { id: number; number: string; extra: string }[]) => (
    <Panel title={`${title} (${rows.length})`}>
      <p className="os-muted os-small">{hint}</p>
      {rows.length ? (
        <ul className="os-plain os-small">
          {rows.map((r) => (
            <li key={`${r.id}-${r.extra}`}>
              <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: r.id, tab: 'zahlung' })}>
                {r.number}
              </button>{' '}
              {r.extra}
            </li>
          ))}
        </ul>
      ) : (
        <p className="os-ok-line">Stimmig.</p>
      )}
    </Panel>
  );
  return (
    <>
      {flash.node}
      {rec.data ? (
        <div className="os-grid os-grid--3">
          {list('Bezahlt ohne Buchung', 'Status „bezahlt“, aber keine Zahlungsbuchung (z. B. vor Einführung der Buchungen).', rec.data.paidWithoutBooking.map((r) => ({ id: r.id, number: r.number, extra: euro(r.total_cents) })))}
          {list('Betrag weicht ab', 'Summe der Buchungen ≠ Auftragsbetrag.', rec.data.amountMismatch.map((r) => ({ id: r.id, number: r.number, extra: `${euro(r.paid)} statt ${euro(r.total_cents)}` })))}
          {list('Storniert, aber bezahlt', 'Erstattung prüfen.', rec.data.cancelledPaid.map((r) => ({ id: r.id, number: r.number, extra: euro(r.total_cents) })))}
          {list('Zahlung fehlgeschlagen', 'Kunde kontaktieren.', rec.data.failed.map((r) => ({ id: r.id, number: r.number, extra: dateTime(r.at) })))}
          {list('Bezahlvorgang abgebrochen', 'Checkout abgelaufen, Zahlung weiterhin offen.', rec.data.abandoned.map((r) => ({ id: r.id, number: r.number, extra: dateTime(r.at) })))}
        </div>
      ) : (
        <Loading />
      )}
      <Panel title="Zahlungsbuchungen" actions={<ExportMenu base="finance/export?kind=payments" />}>
        {pays.data?.length ? (
          <div className="os-tablewrap">
            <table className="os-table os-table--compact">
              <thead>
                <tr>
                  <th scope="col">Datum</th>
                  <th scope="col">Auftrag</th>
                  <th scope="col">Quelle</th>
                  <th scope="col">Art / Status</th>
                  <th scope="col" className="num">
                    Betrag
                  </th>
                  <th scope="col" className="num">
                    Gebühr
                  </th>
                  <th scope="col">Notiz</th>
                </tr>
              </thead>
              <tbody>
                {pays.data.map((p) => (
                  <tr key={p.id}>
                    <td>{dateTime(p.at)}</td>
                    <td className="os-mono">
                      <button type="button" className="os-linkbtn" onClick={() => openApp('orders', { orderId: p.order_id, tab: 'zahlung' })}>
                        {p.number}
                      </button>
                    </td>
                    <td>
                      {p.provider === 'stripe' ? 'Stripe' : 'manuell'}
                      {p.method ? ` · ${p.method}` : ''}
                    </td>
                    <td>
                      {p.kind.replace('_', ' ')} · {p.status}
                    </td>
                    <td className="num">{euro(p.amount_cents)}</td>
                    <td className="num">
                      {p.fee_cents === null ? '–' : euro(p.fee_cents)}
                      {canWrite && p.kind === 'zahlung' && p.status === 'bezahlt' ? (
                        <span className="os-row os-row--tight os-inline-end">
                          {p.provider === 'stripe' ? (
                            <button
                              type="button"
                              className="os-linkbtn os-small"
                              onClick={async () => {
                                try {
                                  await osFetch(`finance/payments/${p.id}/refresh`, { method: 'POST', body: {} });
                                  flash.show(true, 'Gebühr von Stripe übernommen');
                                  void pays.reload(true);
                                } catch (e) {
                                  flash.show(false, (e as Error).message);
                                }
                              }}
                            >
                              von Stripe
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="os-linkbtn os-small"
                            onClick={async () => {
                              const v = window.prompt('Tatsächliche Zahlungsgebühr in € (leer = unbekannt)', p.fee_cents === null ? '' : (p.fee_cents / 100).toFixed(2).replace('.', ','));
                              if (v === null) return;
                              try {
                                await osFetch(`finance/payments/${p.id}/fee`, { method: 'POST', body: { feeCents: v.trim() ? Math.round(Number(v.replace(',', '.')) * 100) : null } });
                                void pays.reload(true);
                              } catch (e) {
                                flash.show(false, (e as Error).message);
                              }
                            }}
                          >
                            erfassen
                          </button>
                        </span>
                      ) : null}
                    </td>
                    <td className="os-small">
                      {p.note}
                      {p.created_by ? <span className="os-muted"> · {p.created_by}</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title="Noch keine Buchungen" text="Buchungen entstehen durch Stripe-Zahlungen und durch Zahlungserfassung im Auftrag." />
        )}
      </Panel>
    </>
  );
}

function Prices({ data, onSaved }: { data: FinanceData; onSaved: () => void }) {
  const vouchers = useOsData<{ code: string; label: string; kind: string; value: number; valid_from: string; valid_until: string; max_uses: number | null; used: number; active: number }[]>('finance/vouchers');
  const [v, setV] = useState({ code: '', label: '', kind: 'betrag', value: '', valid_from: '', valid_until: '', max_uses: '' });
  const [costs, setCosts] = useState<Record<string, string>>({});
  const flash = useFlash();
  useEffect(() => {
    setCosts(Object.fromEntries(Object.entries(data.costs).map(([k, c]) => [k, c === null ? '' : (c / 100).toFixed(2).replace('.', ',')])));
  }, [data.costs]);
  return (
    <>
      {flash.node}
      <div className="os-grid os-grid--2">
        <Panel title="Aktuelle Preise (Website)">
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Leistung</th>
                <th scope="col" className="num">
                  Servicepauschale
                </th>
                <th scope="col" className="num">
                  Paket
                </th>
              </tr>
            </thead>
            <tbody>
              {(Object.keys(PRICE_CONFIG.serviceFeeCents) as ServiceId[]).map((s) => (
                <tr key={s}>
                  <th scope="row">{SERVICES[s].title}</th>
                  <td className="num">{euro(PRICE_CONFIG.serviceFeeCents[s])}</td>
                  <td className="num">{PRICE_CONFIG.bundleCents[s] === null ? '–' : `${euro(PRICE_CONFIG.bundleCents[s])}`}</td>
                </tr>
              ))}
              <tr>
                <td>Wunschkennzeichen-Bearbeitung</td>
                <td className="num">{euro(PRICE_CONFIG.wishPlateHandlingCents)}</td>
                <td />
              </tr>
              <tr>
                <td>Kennzeichenschild (je Stück)</td>
                <td className="num">{euro(PRICE_CONFIG.plateSignCents)}</td>
                <td />
              </tr>
              <tr>
                <td>Versand</td>
                <td className="num">{euro(PRICE_CONFIG.shippingCents)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="os-muted os-small">
            Die Website-Preise sind fest im Programm hinterlegt (lib/pricing.config.ts) und werden mit einer Veröffentlichung geändert – so bleiben Website und
            Rechnungen immer gleich. Geschäftskundenpreise, Mengenrabatte und Kulanz werden je Auftrag über „Preis anpassen“ gebucht – nachvollziehbar und mit Begründung.
          </p>
        </Panel>
        <Panel title="Einkaufskosten je Vorgang (B2B-Zulassung)">
          <p className="os-muted os-small">Kosten je Vorgang beim Zulassungspartner (aus Vertrag). Leer = unbekannt, dann wird kein Deckungsbeitrag berechnet.</p>
          <div className="os-costs">
            {(Object.keys(data.costs) as ServiceId[]).map((s) => (
              <label key={s} className="os-field">
                <span className="os-field__label">{SERVICES[s].title}</span>
                <span className="os-money">
                  <input inputMode="decimal" value={costs[s] ?? ''} onChange={(e) => setCosts({ ...costs, [s]: e.target.value })} placeholder="nicht gepflegt" disabled={!data.canWrite} />
                  <span>€</span>
                </span>
              </label>
            ))}
          </div>
          {data.canWrite ? (
            <button
              type="button"
              className="os-btn os-btn--sm"
              onClick={async () => {
                const body: Record<string, number | null> = {};
                for (const [k, raw] of Object.entries(costs)) body[k] = raw.trim() ? Math.round(Number(raw.trim().replace(/\./g, '').replace(',', '.')) * 100) : null;
                try {
                  await osFetch('finance/costs', { method: 'POST', body: { costs: body } });
                  flash.show(true, 'Einkaufskosten gespeichert');
                  onSaved();
                } catch (e) {
                  flash.show(false, (e as Error).message);
                }
              }}
            >
              Speichern
            </button>
          ) : null}
        </Panel>
      </div>
      <Panel title="Gutscheine und Rabattaktionen">
        {vouchers.data?.length ? (
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Code</th>
                <th scope="col">Bezeichnung</th>
                <th scope="col">Wert</th>
                <th scope="col">Gültig</th>
                <th scope="col">Eingelöst</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {vouchers.data.map((x) => (
                <tr key={x.code}>
                  <td className="os-mono">{x.code}</td>
                  <td>{x.label}</td>
                  <td>{x.kind === 'prozent' ? `${x.value} %` : euro(x.value)}</td>
                  <td>
                    {x.valid_from || '–'} bis {x.valid_until || 'unbegrenzt'}
                  </td>
                  <td>
                    {x.used}
                    {x.max_uses ? ` / ${x.max_uses}` : ''}
                  </td>
                  <td>
                    <Badge tone={x.active ? 'green' : 'slate'}>{x.active ? 'aktiv' : 'inaktiv'}</Badge>
                    {data.canWrite ? (
                      <button
                        type="button"
                        className="os-linkbtn os-small"
                        onClick={async () => {
                          try {
                            await osFetch('finance/vouchers', { method: 'POST', body: { ...x, active: !x.active, max_uses: x.max_uses } });
                            void vouchers.reload(true);
                          } catch (e) {
                            flash.show(false, (e as Error).message);
                          }
                        }}
                      >
                        {x.active ? ' deaktivieren' : ' aktivieren'}
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="os-muted">Keine Gutscheine.</p>
        )}
        {data.canWrite ? (
          <form
            className="os-inline"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await osFetch('finance/vouchers', {
                  method: 'POST',
                  body: {
                    code: v.code,
                    label: v.label,
                    kind: v.kind,
                    value: v.kind === 'prozent' ? Number(v.value) : Math.round(Number(v.value.replace(',', '.')) * 100),
                    valid_from: v.valid_from,
                    valid_until: v.valid_until,
                    max_uses: v.max_uses ? Number(v.max_uses) : null,
                    active: true,
                  },
                });
                flash.show(true, 'Gutschein gespeichert');
                setV({ code: '', label: '', kind: 'betrag', value: '', valid_from: '', valid_until: '', max_uses: '' });
                void vouchers.reload(true);
              } catch (err) {
                flash.show(false, (err as Error).message);
              }
            }}
          >
            <input className="os-mono" value={v.code} onChange={(e) => setV({ ...v, code: e.target.value.toUpperCase() })} placeholder="CODE" aria-label="Code" />
            <input value={v.label} onChange={(e) => setV({ ...v, label: e.target.value })} placeholder="Bezeichnung" aria-label="Bezeichnung" />
            <select className="os-select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })} aria-label="Art">
              <option value="betrag">€</option>
              <option value="prozent">%</option>
            </select>
            <input value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} placeholder="Wert" aria-label="Wert" />
            <input type="date" value={v.valid_from} onChange={(e) => setV({ ...v, valid_from: e.target.value })} aria-label="gültig ab" />
            <input type="date" value={v.valid_until} onChange={(e) => setV({ ...v, valid_until: e.target.value })} aria-label="gültig bis" />
            <input value={v.max_uses} onChange={(e) => setV({ ...v, max_uses: e.target.value })} placeholder="max. Anzahl" aria-label="maximale Einlösungen" />
            <button type="submit" className="os-btn os-btn--sm" disabled={!v.code || !v.value}>
              Anlegen
            </button>
          </form>
        ) : null}
      </Panel>
    </>
  );
}

function Tax() {
  const [year, setYear] = useState(new Date().getFullYear());
  const { data, loading } = useOsData<{ year: number; taxMode: string; vatRate: number; months: { month: string; net: number; vat: number; gross: number; n: number }[] }>(`finance/tax?year=${year}`);
  const sum = (k: 'net' | 'vat' | 'gross') => (data?.months ?? []).reduce((a, m) => a + m[k], 0);
  return (
    <Panel
      title={`Umsatzsteuer-Übersicht ${year}`}
      actions={
        <select className="os-select" value={year} onChange={(e) => setYear(Number(e.target.value))} aria-label="Jahr">
          {[0, 1, 2].map((d) => (
            <option key={d} value={new Date().getFullYear() - d}>
              {new Date().getFullYear() - d}
            </option>
          ))}
        </select>
      }
    >
      <p className="os-muted os-small">
        Aus ausgestellten Rechnungen und Gutschriften nach Rechnungsdatum ({data?.taxMode === 'kleinunternehmer' ? 'Kleinunternehmer – keine USt' : `Regelbesteuerung ${data?.vatRate ?? 19} %`}). Grundlage für die
        Voranmeldung – die steuerliche Prüfung bleibt Aufgabe der Steuerberatung.
      </p>
      {loading && !data ? (
        <Loading />
      ) : data?.months.length ? (
        <table className="os-table">
          <thead>
            <tr>
              <th scope="col">Monat</th>
              <th scope="col" className="num">
                Belege
              </th>
              <th scope="col" className="num">
                Netto
              </th>
              <th scope="col" className="num">
                USt
              </th>
              <th scope="col" className="num">
                Brutto
              </th>
            </tr>
          </thead>
          <tbody>
            {data.months.map((m) => (
              <tr key={m.month}>
                <th scope="row">{monthLabel(m.month)}</th>
                <td className="num">{m.n}</td>
                <td className="num">{euro(m.net)}</td>
                <td className="num">{euro(m.vat)}</td>
                <td className="num">{euro(m.gross)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <th>Summe</th>
              <th />
              <th className="num">{euro(sum('net'))}</th>
              <th className="num">{euro(sum('vat'))}</th>
              <th className="num">{euro(sum('gross'))}</th>
            </tr>
          </tfoot>
        </table>
      ) : (
        <Empty title="Keine Rechnungen im Jahr" />
      )}
    </Panel>
  );
}
