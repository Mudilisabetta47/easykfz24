'use client';

// KFZ-API Center: technische Steuerzentrale der kfz-api.de-Anbindung. Liest, prüft, ordnet zu und verarbeitet
// fehlgeschlagene Ereignisse kontrolliert erneut – übermittelt aber nie einen Antrag. Keine Geheimnisse im Browser.

import { useEffect, useState } from 'react';
import { dateTime, euro, osFetch, relTime, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { Badge, Empty, ErrorBox, Kpi, Loading, Panel, Tabs, useFlash } from '../ui.tsx';

export const OUTCOME: Record<string, { label: string; tone: string }> = {
  verarbeitet: { label: 'verarbeitet', tone: 'green' },
  ping: { label: 'PING', tone: 'blue' },
  nicht_zugeordnet: { label: 'nicht zugeordnet', tone: 'amber' },
  fehler: { label: 'Fehler', tone: 'red' },
};

interface KfzEvent {
  event_id: string;
  received_at: string;
  last_seen_at: string;
  deliveries: number;
  outcome: string;
  order_id: number | null;
  order_number: string | null;
  kfz_order_id: string;
  external_id: string;
  business_transaction: string;
  status: string;
  derived_status: string;
  error: string;
}

interface KfzData {
  url: string;
  webhook: boolean;
  apiAccess: boolean;
  mail: boolean;
  stats: { total: number; problems: number; lastAt: string | null };
  events: KfzEvent[];
  duplicates: { events: number; redeliveries: number };
  byOutcome: { outcome: string; n: number }[];
  help: { outcomes: Record<string, string>; http: Record<string, string>; statuses: Record<string, string>; display: Record<string, string>; transactions: Record<string, { label: string; prefix: string }> };
  contract: { limits?: string; fees?: string; contact?: string; note?: string };
  costs: Record<string, number | null>;
  canWrite: boolean;
  submission: { enabled: boolean; reason: string };
}

type Tab = 'uebersicht' | 'ereignisse' | 'abgleich' | 'erklaerungen' | 'vertrag';
type Filter = 'alle' | 'probleme' | 'verarbeitet' | 'ping' | 'doppelt';

export function KfzApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { data, error, loading, reload } = useOsData<KfzData>('kfz', { pollMs: 30_000 });
  const [tab, setTab] = useState<Tab>('uebersicht');
  const [filter, setFilter] = useState<Filter>('alle');
  const flash = useFlash();
  useEffect(() => {
    if (params?.filter === 'probleme') {
      setTab('ereignisse');
      setFilter('probleme');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  const run = async (path: string, body: unknown, label: string) => {
    try {
      const r = await osFetch<{ ok: boolean; status?: number | null; message?: string; matched?: boolean }>(path, { method: 'POST', body });
      flash.show(r.ok !== false, `${label}: ${r.message ?? (r.matched === false ? 'weiterhin keinem Auftrag zuordenbar' : r.ok ? 'OK' : 'fehlgeschlagen')}${r.status ? ` (HTTP ${r.status})` : ''}`);
      await reload(true);
    } catch (e) {
      flash.show(false, `${label}: ${(e as Error).message}`);
    }
  };

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
            { id: 'ereignisse', label: `Ereignisse (${data.stats.total})` },
            { id: 'abgleich', label: 'Datenabgleich' },
            { id: 'erklaerungen', label: 'Status & Fehlercodes' },
            { id: 'vertrag', label: 'Limits & Gebühren' },
          ]}
        />
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
      </div>
      <div className="os-scroll os-app__pad">
        {flash.node}
        {tab === 'uebersicht' ? <Overview data={data} run={run} onProblems={() => (setTab('ereignisse'), setFilter('probleme'))} /> : null}
        {tab === 'ereignisse' ? <Events data={data} filter={filter} setFilter={setFilter} run={run} /> : null}
        {tab === 'abgleich' ? <Compare /> : null}
        {tab === 'erklaerungen' ? <Help data={data} /> : null}
        {tab === 'vertrag' ? <Contract data={data} onSaved={() => void reload(true)} /> : null}
      </div>
    </div>
  );
}

function Overview({ data, run, onProblems }: { data: KfzData; run: (p: string, b: unknown, l: string) => Promise<void>; onProblems: () => void }) {
  const by = Object.fromEntries(data.byOutcome.map((o) => [o.outcome, o.n]));
  return (
    <>
      <div className="os-kpis">
        <Kpi label="Webhook" value={data.webhook ? 'Aktiv' : 'Nicht eingerichtet'} tone={data.webhook ? 'good' : 'bad'} hint={data.webhook ? 'HMAC-SHA256-Signatur Pflicht' : 'KFZ_API_WEBHOOK_SECRET fehlt'} />
        <Kpi label="API-Zugang (lesend)" value={data.apiAccess ? 'Eingerichtet' : 'Nicht eingerichtet'} tone={data.apiAccess ? 'good' : 'warn'} hint="Belegabruf, Verbindungstest" />
        <Kpi label="Ereignisse" value={data.stats.total} hint={data.stats.lastAt ? `zuletzt ${relTime(data.stats.lastAt)}` : 'noch keine'} />
        <Kpi label="Neuzustellungen erkannt" value={data.duplicates.redeliveries} hint={`${data.duplicates.events} Ereignis(se) mehrfach zugestellt – je einmal verarbeitet`} />
        <button type="button" className="os-kpi-btn" onClick={onProblems}>
          <Kpi label="Zu prüfen" value={data.stats.problems} tone={data.stats.problems ? 'warn' : 'good'} hint="Fehler oder nicht zugeordnet" />
        </button>
      </div>
      <div className="os-grid os-grid--2">
        <Panel title="Webhook">
          <p className="os-mono os-break">{data.url}</p>
          <p className="os-muted os-small">Bei kfz-api.de hinterlegt. Signatur (X-Signature) wird vor jeder Verarbeitung geprüft, Ereignis-ID (X-Event-Id) verhindert Doppelverarbeitung.</p>
          <ul className="os-plain os-small">
            <li>verarbeitet: {by.verarbeitet ?? 0}</li>
            <li>PING: {by.ping ?? 0}</li>
            <li>nicht zugeordnet: {by.nicht_zugeordnet ?? 0}</li>
            <li>Fehler: {by.fehler ?? 0}</li>
          </ul>
          {data.canWrite ? (
            <div className="os-row">
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={!data.apiAccess} onClick={() => void run('kfz/check', {}, 'Verbindungstest')} title="Liest einen Eintrag, legt nichts an">
                Verbindung testen (nur lesen)
              </button>
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={!data.webhook} onClick={() => void run('kfz/selftest', {}, 'Webhook-Selbsttest')} title="Signierter Test an den eigenen Webhook">
                Webhook-Selbsttest
              </button>
            </div>
          ) : null}
        </Panel>
        <Panel title="Übermittlung von Anträgen" actions={<Badge tone="red">gesperrt</Badge>}>
          <p className="os-small">{data.submission.reason}</p>
          <p className="os-muted os-small">Freigegebene Aufträge siehe Zulassungsmanager → „Übergeben“.</p>
        </Panel>
      </div>
    </>
  );
}

function Events({ data, filter, setFilter, run }: { data: KfzData; filter: Filter; setFilter: (f: Filter) => void; run: (p: string, b: unknown, l: string) => Promise<void> }) {
  const { openApp } = useOs();
  const [assign, setAssign] = useState<Record<string, string>>({});
  const events = data.events.filter((e) =>
    filter === 'alle' ? true : filter === 'probleme' ? e.outcome === 'fehler' || e.outcome === 'nicht_zugeordnet' : filter === 'doppelt' ? e.deliveries > 1 : e.outcome === filter,
  );
  return (
    <Panel
      title="Ereignisprotokoll"
      actions={
        <Tabs<Filter>
          value={filter}
          onChange={setFilter}
          tabs={[
            { id: 'alle', label: 'Alle' },
            { id: 'probleme', label: `Zu prüfen (${data.stats.problems})` },
            { id: 'verarbeitet', label: 'Verarbeitet' },
            { id: 'doppelt', label: 'Neuzustellungen' },
            { id: 'ping', label: 'PING' },
          ]}
        />
      }
    >
      {events.length ? (
        <div className="os-tablewrap">
          <table className="os-table">
            <thead>
              <tr>
                <th scope="col">Empfangen</th>
                <th scope="col">Ergebnis</th>
                <th scope="col">Status</th>
                <th scope="col">Vorgang</th>
                <th scope="col">Auftrag</th>
                <th scope="col">Hinweis</th>
                {data.canWrite ? <th scope="col">Aktion</th> : null}
              </tr>
            </thead>
            <tbody>
              {events.map((e) => {
                const open = e.outcome === 'fehler' || e.outcome === 'nicht_zugeordnet';
                return (
                  <tr key={e.event_id}>
                    <td>
                      {dateTime(e.received_at)}
                      {e.deliveries > 1 ? <span className="os-muted os-small"> · {e.deliveries}× zugestellt (zuletzt {relTime(e.last_seen_at)})</span> : null}
                    </td>
                    <td>
                      <Badge tone={OUTCOME[e.outcome]?.tone ?? 'slate'}>{OUTCOME[e.outcome]?.label ?? e.outcome}</Badge>
                    </td>
                    <td className="os-mono" title={data.help.statuses[e.status] ?? ''}>
                      {e.status || e.derived_status || '–'}
                    </td>
                    <td>
                      <span className="os-mono">{e.kfz_order_id || '–'}</span>
                      {e.business_transaction ? <span className="os-muted os-small"> · {data.help.transactions[e.business_transaction]?.label ?? e.business_transaction}</span> : null}
                    </td>
                    <td>
                      {e.order_id ? (
                        <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: e.order_id, tab: 'kfz' })}>
                          {e.order_number}
                        </button>
                      ) : (
                        <span className="os-muted">{e.external_id || '–'}</span>
                      )}
                    </td>
                    <td className="os-small">{e.error || <span className="os-muted">–</span>}</td>
                    {data.canWrite ? (
                      <td>
                        {open ? (
                          <div className="os-stack os-stack--tight">
                            {e.outcome === 'fehler' ? (
                              <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void run('kfz/retry', { eventId: e.event_id }, 'Erneut verarbeiten')}>
                                Erneut verarbeiten
                              </button>
                            ) : null}
                            <form
                              className="os-inline os-inline--tight"
                              onSubmit={(ev) => {
                                ev.preventDefault();
                                void run('kfz/assign', { eventId: e.event_id, number: assign[e.event_id] ?? e.external_id ?? '' }, 'Zuordnung');
                              }}
                            >
                              <input className="os-mono" value={assign[e.event_id] ?? e.external_id ?? ''} onChange={(ev) => setAssign((a) => ({ ...a, [e.event_id]: ev.target.value }))} placeholder="Auftragsnummer" aria-label="Auftragsnummer" />
                              <button type="submit" className="os-btn os-btn--sm">
                                Zuordnen
                              </button>
                            </form>
                          </div>
                        ) : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="Keine Ereignisse" text="Sobald kfz-api.de etwas meldet (auch PING), steht es hier." />
      )}
      <p className="os-muted os-small">Angezeigt werden nur Status, Vorgangsnummern und Hinweise – keine personenbezogenen Inhalte der Meldungen.</p>
    </Panel>
  );
}

function Compare() {
  const { openApp } = useOs();
  const { data, loading } = useOsData<{
    stuck: { id: number; number: string; updated_at: string; kfz_order_id: string; kfz_display: string }[];
    noKfzId: { id: number; number: string; kfz_display: string }[];
    mismatch: { id: number; number: string; status: string; kfz_display: string }[];
    unmatched: { event_id: string; received_at: string; external_id: string; kfz_order_id: string; status: string }[];
  }>('kfz/compare');
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const block = (title: string, hint: string, rows: { id: number; number: string; extra: string }[]) => (
    <Panel title={`${title} (${rows.length})`}>
      <p className="os-muted os-small">{hint}</p>
      {rows.length ? (
        <ul className="os-plain">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: r.id, tab: 'kfz' })}>
                {r.number}
              </button>{' '}
              <span className="os-muted os-small">{r.extra}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="os-ok-line">Alles stimmig.</p>
      )}
    </Panel>
  );
  return (
    <div className="os-grid os-grid--2">
      {block(
        'Beim Partner ohne Rückmeldung',
        'Status „Bei Zulassungsstelle“, aber seit über 3 Tagen keine Meldung von kfz-api.de.',
        data.stuck.map((o) => ({ id: o.id, number: o.number, extra: `seit ${relTime(o.updated_at)}${o.kfz_order_id ? ` · Vorgang ${o.kfz_order_id}` : ' · ohne Vorgangsnummer'}` })),
      )}
      {block('Widersprüchlicher Status', 'kfz-api.de meldet etwas anderes als der eigene Auftragsstatus.', data.mismatch.map((o) => ({ id: o.id, number: o.number, extra: `${o.status} ↔ ${o.kfz_display}` })))}
      {block('Meldung ohne Vorgangsnummer', 'Zuordnung über die Auftragsnummer, Vorgangsnummer nicht gespeichert.', data.noKfzId.map((o) => ({ id: o.id, number: o.number, extra: o.kfz_display })))}
      <Panel title={`Nicht zugeordnete Meldungen (${data.unmatched.length})`}>
        {data.unmatched.length ? (
          <ul className="os-plain os-small">
            {data.unmatched.map((u) => (
              <li key={u.event_id}>
                {dateTime(u.received_at)} · {u.status} · externalId {u.external_id || '–'} · Vorgang {u.kfz_order_id || '–'}
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-ok-line">Keine.</p>
        )}
      </Panel>
    </div>
  );
}

function Help({ data }: { data: KfzData }) {
  const table = (title: string, rows: [string, string][]) => (
    <Panel title={title}>
      <table className="os-table os-table--compact">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <th scope="row" className="os-mono">
                {k}
              </th>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
  return (
    <div className="os-grid os-grid--2">
      {table('Status von kfz-api.de', Object.entries(data.help.statuses))}
      {table('Anzeige für Mitarbeiter und Kunden', Object.entries(data.help.display))}
      {table('Ergebnis der Verarbeitung', Object.entries(data.help.outcomes))}
      {table('HTTP-Antworten unseres Webhooks', Object.entries(data.help.http))}
      {table(
        'Vorgangsarten',
        Object.entries(data.help.transactions).map(([k, v]) => [k, v.label] as [string, string]),
      )}
      <Panel title="Fehlercodes der Behörde">
        <p className="os-muted os-small">
          Codes und Klartexte der Behörde werden je Auftrag unter „KFZ-API → Meldungen der Behörde“ unverändert angezeigt. Eine eigene Code-Liste wird nicht erfunden – die
          verbindliche Liste steht in der Dokumentation von kfz-api.de.
        </p>
      </Panel>
    </div>
  );
}

function Contract({ data, onSaved }: { data: KfzData; onSaved: () => void }) {
  const [c, setC] = useState({ limits: data.contract.limits ?? '', fees: data.contract.fees ?? '', contact: data.contract.contact ?? '', note: data.contract.note ?? '' });
  const flash = useFlash();
  return (
    <div className="os-grid os-grid--2">
      <Panel title="Vertragsdaten (aus Ihrem Vertrag mit kfz-api.de)">
        {flash.node}
        <p className="os-muted os-small">API-Limits und Gebühren sind nicht öffentlich dokumentiert – hier die Werte aus Vertrag/Dokumentation eintragen.</p>
        <label className="os-field">
          <span className="os-field__label">API-Limits</span>
          <textarea rows={3} value={c.limits} onChange={(e) => setC({ ...c, limits: e.target.value })} disabled={!data.canWrite} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Gebühren je Vorgangsart</span>
          <textarea rows={4} value={c.fees} onChange={(e) => setC({ ...c, fees: e.target.value })} disabled={!data.canWrite} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Ansprechpartner / Support</span>
          <input value={c.contact} onChange={(e) => setC({ ...c, contact: e.target.value })} disabled={!data.canWrite} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Notiz</span>
          <textarea rows={2} value={c.note} onChange={(e) => setC({ ...c, note: e.target.value })} disabled={!data.canWrite} />
        </label>
        {data.canWrite ? (
          <button
            type="button"
            className="os-btn os-btn--sm"
            onClick={async () => {
              try {
                await osFetch('kfz/contract', { method: 'POST', body: c });
                flash.show(true, 'Gespeichert');
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
      <Panel title="Einkaufskosten je Vorgang (für Marge und Deckungsbeitrag)">
        <table className="os-table os-table--compact">
          <tbody>
            {Object.entries(data.costs).map(([k, v]) => (
              <tr key={k}>
                <th scope="row">{k}</th>
                <td className="num">{v === null ? <span className="os-muted">nicht gepflegt</span> : euro(v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="os-muted os-small">Pflege im Finanzcenter → Einkaufskosten.</p>
      </Panel>
    </div>
  );
}
