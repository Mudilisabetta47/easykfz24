'use client';

// Kontrollzentrum (Unternehmensleitstand): startet beim Einloggen. Alle Zahlen live aus der Datenbank.
// Widgets ein-/ausblendbar (pro Benutzer gespeichert), Zeitraum wählbar mit Vergleich zum Vorzeitraum,
// kritische Probleme priorisiert mit Sprung in die passende Funktion.

import { useEffect, useState } from 'react';
import { SERVICES, type ServiceId } from '../../../lib/services.ts';
import type { StatusId } from '../../../lib/status.ts';
import { STAGE_META, STAGES, type Stage } from '../../../lib/workflow.ts';
import { dateTime, euro, relTime, useOsData } from '../api.ts';
import { BarList, ColumnChart } from '../charts.tsx';
import { useOs } from '../context.ts';
import type { AppId } from '../icons.tsx';
import { IRefresh } from '../icons.tsx';
import { Chips, dateOnly, isOverdue, PriorityBadge } from '../shared.tsx';
import { Badge, Empty, ErrorBox, KfzState, Kpi, Loading, Panel, StatusBadge } from '../ui.tsx';
import { OUTCOME } from './KfzCenter.tsx';

interface Period {
  grossCents: number;
  netCents: number;
  paidCents: number;
  orders: number;
  prevGrossCents: number;
}

interface DashboardData {
  range: number;
  counts: { neu: number; laufend: number; rueckfrage: number; beimPartner: number; abgeschlossen: number; storniert: number; gesamt: number; fehlendeUnterlagen: number; ueberfaellig: number };
  byStatus: Record<StatusId, number>;
  byStage: Record<Stage, number>;
  periods: Record<'tag' | 'woche' | 'monat' | 'jahr', Period>;
  compare: { orders: number; prevOrders: number; revenue: number; prevRevenue: number };
  series: { day: string; orders: number; revenue: number }[];
  customers: { day: number; week: number; month: number };
  processing: { medianHours: number | null; meanHours: number | null; samples: number };
  success: { kfz: number | null; kfzOk: number; kfzFail: number; overall: number | null };
  cancellations: { storniert: number; checkoutAbgebrochen: number };
  payments: { failed: number; openOld: number; openOldCents: number };
  webhooks: { total: number; redeliveries: number; lastAt: string | null; outcomes: Record<string, number> };
  system: {
    platform: string;
    database: { ok: boolean; ms: number; schema: number; expected: number };
    storage: { ok: boolean; kind: string };
    cloudflare: { worker: boolean; d1: boolean; r2: boolean };
    kfzWebhook: boolean;
    kfzApi: boolean;
    mail: boolean;
    payments: boolean;
  };
  tasks: { id: number; title: string; due_at: string; priority: string; order_id: number | null; status: string }[];
  problems: { level: 'kritisch' | 'wichtig' | 'hinweis'; title: string; text: string; app: string; params?: Record<string, unknown> }[];
  recent: { id: number; number: string; holder_name: string; service: ServiceId; status: StatusId; created_at: string; total_cents: number; kfz_display: string; payment_status: string }[];
  recentEvents: { event_id: string; received_at: string; outcome: string; order_id: number | null; status: string; derived_status: string; error: string; deliveries: number }[];
}

const WIDGETS = {
  probleme: 'Kritische Probleme',
  umsatz: 'Umsatz nach Zeitraum',
  auftraege: 'Auftragseingang',
  phasen: 'Aufträge nach Phase',
  qualitaet: 'Bearbeitung & Erfolgsquote',
  aufgaben: 'Meine Aufgaben & Wiedervorlagen',
  system: 'Systemzustand',
  webhooks: 'Webhook-Zustellung',
  neueste: 'Neueste Aufträge',
} as const;
type WidgetId = keyof typeof WIDGETS;
const WKEY = 'ekos:dashboard:widgets';

const dayLabel = (d: string) => `${d.slice(8, 10)}.${d.slice(5, 7)}.`;
const hours = (h: number | null) => (h === null ? '–' : h < 48 ? `${h.toLocaleString('de-DE', { maximumFractionDigits: 1 })} Std.` : `${(h / 24).toLocaleString('de-DE', { maximumFractionDigits: 1 })} Tage`);
const pct = (v: number | null) => (v === null ? '–' : `${Math.round(v * 100)} %`);
function delta(cur: number, prev: number): string {
  if (!prev) return cur ? 'neu im Vergleichszeitraum' : 'keine Vergleichswerte';
  const d = Math.round(((cur - prev) / prev) * 100);
  return `${d >= 0 ? '+' : ''}${d} % ggü. Vorzeitraum`;
}

export function DashboardApp() {
  const { openApp, can, session } = useOs();
  const [range, setRange] = useState<'7' | '30' | '90' | '365'>('30');
  const [hidden, setHidden] = useState<WidgetId[]>([]);
  const [customize, setCustomize] = useState(false);
  const { data, error, loading, reload } = useOsData<DashboardData>(`dashboard?range=${range}`, { pollMs: 30_000 });
  useEffect(() => {
    try {
      setHidden(JSON.parse(localStorage.getItem(`${WKEY}:${session.user.id}`) || '[]') as WidgetId[]);
    } catch {
      /* Standard */
    }
  }, [session.user.id]);
  const toggle = (w: WidgetId) => {
    const n = hidden.includes(w) ? hidden.filter((x) => x !== w) : [...hidden, w];
    setHidden(n);
    try {
      localStorage.setItem(`${WKEY}:${session.user.id}`, JSON.stringify(n));
    } catch {
      /* nur Komfort */
    }
  };
  const show = (w: WidgetId) => !hidden.includes(w);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const c = data.counts;
  const finance = can('finance.read');
  const go = (app: string, params?: Record<string, unknown>) => openApp(app as AppId, params);

  return (
    <div className="os-app os-scroll">
      <header className="os-app__head">
        <div>
          <h2>Guten {greeting()}, {session.user.displayName}</h2>
          <p className="os-muted">Unternehmensleitstand · live aus der Datenbank · aktualisiert alle 30 Sekunden</p>
        </div>
        <div className="os-row">
          <Chips
            value={range}
            onChange={setRange}
            options={[
              { id: '7', label: '7 Tage' },
              { id: '30', label: '30 Tage' },
              { id: '90', label: '90 Tage' },
              { id: '365', label: '1 Jahr' },
            ]}
          />
          <button type="button" className={`os-btn os-btn--ghost os-btn--sm${customize ? ' is-on' : ''}`} onClick={() => setCustomize((v) => !v)}>
            Widgets
          </button>
          <button type="button" className="os-iconbtn" onClick={() => void reload()} disabled={loading} aria-label="Aktualisieren">
            <IRefresh width={16} height={16} />
          </button>
        </div>
      </header>

      {customize ? (
        <Panel title="Widgets anpassen">
          <div className="os-chipset">
            {(Object.keys(WIDGETS) as WidgetId[]).map((w) => (
              <button key={w} type="button" className={show(w) ? 'is-on' : ''} onClick={() => toggle(w)} aria-pressed={show(w)}>
                {WIDGETS[w]}
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <div className="os-kpis">
        <button type="button" className="os-kpi-btn" onClick={() => go('orders', { status: 'neu' })}>
          <Kpi label="Neue Aufträge" value={c.neu} hint="noch nicht geprüft" tone={c.neu ? 'warn' : undefined} />
        </button>
        <button type="button" className="os-kpi-btn" onClick={() => go('registrations')}>
          <Kpi label="Laufende Zulassungen" value={c.laufend} hint={`${c.beimPartner} beim Partner`} />
        </button>
        <button type="button" className="os-kpi-btn" onClick={() => go('orders', { status: 'laufend', issues: true })}>
          <Kpi label="Fehlende Dokumente" value={c.fehlendeUnterlagen} tone={c.fehlendeUnterlagen ? 'warn' : 'good'} hint={`${c.rueckfrage} Rückfrage(n)`} />
        </button>
        <button type="button" className="os-kpi-btn" onClick={() => go('orders', { status: 'laufend', overdue: true })}>
          <Kpi label="Überfällig" value={c.ueberfaellig} tone={c.ueberfaellig ? 'bad' : 'good'} hint="Bearbeitungsfrist überschritten" />
        </button>
        {can('customers.read') ? (
          <button type="button" className="os-kpi-btn" onClick={() => go('customers')}>
            <Kpi label="Neue Kunden" value={data.customers.month} hint={`heute ${data.customers.day} · 7 Tage ${data.customers.week}`} />
          </button>
        ) : null}
        {finance ? (
          <button type="button" className="os-kpi-btn" onClick={() => go('finance', { tab: 'offen' })}>
            <Kpi label="Zahlungsprobleme" value={data.payments.failed + data.payments.openOld} tone={data.payments.failed ? 'bad' : data.payments.openOld ? 'warn' : 'good'} hint={`${data.payments.failed} fehlgeschlagen · ${data.payments.openOld} offen > 7 Tage`} />
          </button>
        ) : null}
      </div>

      {show('probleme') ? (
        <Panel title={`Kritische Probleme (${data.problems.length})`}>
          {data.problems.length ? (
            <ul className="os-problems" role="list">
              {data.problems.map((p, i) => (
                <li key={i} className={`is-${p.level}`}>
                  <button type="button" onClick={() => go(p.app, p.params)}>
                    <Badge tone={p.level === 'kritisch' ? 'red' : p.level === 'wichtig' ? 'amber' : 'slate'}>{p.level}</Badge>
                    <strong>{p.title}</strong>
                    <span className="os-muted os-small">{p.text}</span>
                    <span className="os-linkbtn os-small">Öffnen →</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-ok-line">Keine kritischen Probleme.</p>
          )}
        </Panel>
      ) : null}

      {show('umsatz') && finance ? (
        <div className="os-kpis">
          {(['tag', 'woche', 'monat', 'jahr'] as const).map((u) => {
            const p = data.periods[u];
            return (
              <button key={u} type="button" className="os-kpi-btn" onClick={() => go('finance')}>
                <Kpi
                  label={`Umsatz ${u === 'tag' ? 'heute' : u === 'woche' ? 'diese Woche' : u === 'monat' ? 'diesen Monat' : 'dieses Jahr'}`}
                  value={euro(p.grossCents)}
                  hint={`${p.orders} Aufträge · netto ${euro(p.netCents)} · ${delta(p.grossCents, p.prevGrossCents)}`}
                />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="os-grid os-grid--2">
        {show('auftraege') ? (
          <Panel title={`Auftragseingang · ${data.range} Tage (${data.compare.orders}) · ${delta(data.compare.orders, data.compare.prevOrders)}`}>
            {data.compare.orders ? (
              <ColumnChart data={data.series} xKey="day" series={[{ key: 'orders', label: 'Aufträge', color: 'var(--viz-1)' }]} format={(v) => v.toLocaleString('de-DE', { maximumFractionDigits: 0 })} xLabel={dayLabel} title="Aufträge pro Tag" />
            ) : (
              <Empty title="Keine Aufträge im Zeitraum" />
            )}
          </Panel>
        ) : null}
        {show('auftraege') && finance ? (
          <Panel title={`Umsatz · ${data.range} Tage (${euro(data.compare.revenue)}) · ${delta(data.compare.revenue, data.compare.prevRevenue)}`}>
            {data.compare.revenue ? (
              <ColumnChart data={data.series} xKey="day" series={[{ key: 'revenue', label: 'Umsatz', color: 'var(--viz-1)' }]} format={(v) => euro(v).replace(/,00\s€/, ' €')} xLabel={dayLabel} title="Umsatz pro Tag (ohne Stornos)" />
            ) : (
              <Empty title="Kein Umsatz im Zeitraum" />
            )}
          </Panel>
        ) : null}
      </div>

      <div className="os-grid os-grid--3">
        {show('phasen') ? (
          <Panel title="Aufträge nach Phase">
            <BarList items={[...STAGES, 'rueckfrage' as Stage, 'fehler' as Stage].map((s) => ({ label: STAGE_META[s].label, value: data.byStage[s] ?? 0, onClick: () => go('orders', { stage: s }) }))} />
          </Panel>
        ) : null}
        {show('qualitaet') ? (
          <Panel title="Bearbeitung & Erfolgsquote">
            <dl className="os-dl">
              <dt>Bearbeitungsdauer</dt>
              <dd>
                Median {hours(data.processing.medianHours)} · Ø {hours(data.processing.meanHours)}
                <span className="os-muted os-small"> ({data.processing.samples} Zulassungen, 12 Monate)</span>
              </dd>
              <dt>Erfolgsquote kfz-api.de</dt>
              <dd>
                {pct(data.success.kfz)}
                <span className="os-muted os-small">
                  {' '}
                  ({data.success.kfzOk} beschieden, {data.success.kfzFail} fehlgeschlagen)
                </span>
              </dd>
              <dt>Abschlussquote gesamt</dt>
              <dd>
                {pct(data.success.overall)}
                <span className="os-muted os-small"> (erledigt ggü. storniert)</span>
              </dd>
              <dt>Abgebrochene Bestellungen</dt>
              <dd>
                {data.cancellations.storniert} storniert · {data.cancellations.checkoutAbgebrochen} Bezahlvorgänge abgebrochen ({data.range} Tage)
              </dd>
            </dl>
          </Panel>
        ) : null}
        {show('aufgaben') ? (
          <Panel title="Meine Aufgaben & Wiedervorlagen" actions={<button type="button" className="os-linkbtn" onClick={() => go('tasks')}>Aufgabencenter</button>}>
            {data.tasks.length ? (
              <ul className="os-msglist" role="list">
                {data.tasks.map((t) => (
                  <li key={t.id}>
                    <button type="button" onClick={() => go('tasks', { taskId: t.id })}>
                      <strong>{t.title}</strong>
                      <span className={`os-small ${isOverdue(t.due_at) ? 'os-overdue' : 'os-muted'}`}>{t.due_at ? `fällig ${dateOnly(t.due_at)}` : 'ohne Frist'}</span>
                      <PriorityBadge value={t.priority} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="os-ok-line">Keine offenen Aufgaben.</p>
            )}
          </Panel>
        ) : null}
        {show('system') ? (
          <Panel title="Systemzustand" actions={can('settings.manage') ? <button type="button" className="os-linkbtn" onClick={() => go('settings', { tab: 'system' })}>Diagnose</button> : null}>
            <ul className="os-status" role="list">
              <StatusRow ok={data.system.database.ok} label={data.system.cloudflare.d1 ? 'Cloudflare D1' : 'Datenbank'} text={`${data.system.database.ms} ms · Schema v${data.system.database.schema}${data.system.database.schema !== data.system.database.expected ? ` (erwartet v${data.system.database.expected})` : ''}`} />
              <StatusRow ok={data.system.storage.ok} label={data.system.cloudflare.r2 ? 'Cloudflare R2' : 'Dateispeicher'} text={data.system.storage.kind} />
              <StatusRow ok={data.system.cloudflare.worker || data.system.platform === 'node'} label="Laufzeit" text={data.system.cloudflare.worker ? 'Cloudflare Worker' : 'lokal (Node.js)'} />
              <StatusRow ok={data.system.kfzWebhook} label="KFZ-API Webhook" text={data.system.kfzWebhook ? 'eingerichtet' : 'Geheimnis fehlt'} />
              <StatusRow ok={data.system.kfzApi} warn label="KFZ-API Zugang" text={data.system.kfzApi ? 'eingerichtet' : 'nur Webhook'} />
              <StatusRow ok={data.system.mail} warn label="E-Mail" text={data.system.mail ? 'eingerichtet' : 'nicht eingerichtet'} />
              <StatusRow ok={data.system.payments} warn label="Zahlung (Stripe)" text={data.system.payments ? 'eingerichtet' : 'manuell'} />
            </ul>
          </Panel>
        ) : null}
        {show('webhooks') ? (
          <Panel title="Webhook-Zustellung" actions={can('kfz.read') ? <button type="button" className="os-linkbtn" onClick={() => go('kfz')}>KFZ-API Center</button> : null}>
            <p className="os-small">
              {data.webhooks.total} Ereignisse gesamt · {data.webhooks.redeliveries} Neuzustellungen erkannt (nicht doppelt verarbeitet) · zuletzt {data.webhooks.lastAt ? relTime(data.webhooks.lastAt) : 'nie'}
            </p>
            <p className="os-muted os-small">
              {data.range} Tage: {Object.entries(data.webhooks.outcomes).map(([k, v]) => `${OUTCOME[k]?.label ?? k} ${v}`).join(' · ') || 'keine'}
            </p>
            {data.recentEvents.length ? (
              <ul className="os-feed" role="list">
                {data.recentEvents.map((e) => (
                  <li key={e.event_id}>
                    <button type="button" onClick={() => (e.order_id ? go('orders', { orderId: e.order_id, tab: 'kfz' }) : go('kfz'))}>
                      <Badge tone={OUTCOME[e.outcome]?.tone ?? 'slate'}>{OUTCOME[e.outcome]?.label ?? e.outcome}</Badge>
                      <span className="os-feed__text">
                        {e.status || e.derived_status || 'PING'}
                        {e.deliveries > 1 ? ` · ${e.deliveries}×` : ''}
                        {e.error ? <span className="os-muted"> · {e.error}</span> : null}
                      </span>
                      <time className="os-muted">{relTime(e.received_at)}</time>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </Panel>
        ) : null}
      </div>

      {show('neueste') ? (
        <Panel title="Neueste Aufträge" actions={<button type="button" className="os-linkbtn" onClick={() => go('orders', { status: 'alle' })}>Alle Aufträge</button>}>
          {data.recent.length ? (
            <div className="os-tablewrap">
              <table className="os-table">
                <thead>
                  <tr>
                    <th scope="col">Auftrag</th>
                    <th scope="col">Halter</th>
                    <th scope="col">Leistung</th>
                    <th scope="col">Status</th>
                    <th scope="col">KFZ-API</th>
                    <th scope="col">Eingang</th>
                    <th scope="col" className="num">
                      Betrag
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map((o) => (
                    <tr key={o.id} className="is-link" onClick={() => go('orders', { orderId: o.id })}>
                      <td className="os-mono">
                        <button type="button" className="os-rowbtn" onClick={() => go('orders', { orderId: o.id })}>
                          {o.number}
                        </button>
                      </td>
                      <td>{o.holder_name}</td>
                      <td>{SERVICES[o.service]?.title ?? o.service}</td>
                      <td>
                        <StatusBadge status={o.status} service={o.service} />
                      </td>
                      <td>
                        <KfzState display={o.kfz_display} />
                      </td>
                      <td>{dateTime(o.created_at)}</td>
                      <td className="num">{euro(o.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Noch keine Aufträge" text="Neue Aufträge von easykfz24.de erscheinen hier automatisch." />
          )}
        </Panel>
      ) : null}
    </div>
  );
}

function StatusRow({ ok, warn, label, text }: { ok: boolean; warn?: boolean; label: string; text: string }) {
  const tone = ok ? 'ok' : warn ? 'warn' : 'bad';
  return (
    <li className={`os-status__row is-${tone}`}>
      <span className="os-status__dot" aria-hidden="true" />
      <span className="os-status__label">{label}</span>
      <span className="os-status__text">
        {ok ? 'OK' : warn ? 'Hinweis' : 'Problem'} · {text}
      </span>
    </li>
  );
}

function greeting(): string {
  const h = new Date().getHours();
  return h < 11 ? 'Morgen' : h < 18 ? 'Tag' : 'Abend';
}
