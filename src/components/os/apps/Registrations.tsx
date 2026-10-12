'use client';

// Zulassungsmanager: fachliche Zulassungsabwicklung als Arbeitswarteschlangen – Vollständigkeit prüfen,
// freigeben (manuell, vor jeder kostenpflichtigen Einreichung), übergeben, überwachen, Rückfragen/Ablehnungen
// bearbeiten. Je Vorgangsart die Anforderungen (Unterlagen, eVB, SEPA, Originale, Sicherheitscodes).

import { useMemo, useState } from 'react';
import { DOCUMENTS, documentsFor, SERVICE_IDS, SERVICES, type ServiceId } from '../../../lib/services.ts';
import { SECURITY_CODES, securityCodesFor, type Stage } from '../../../lib/workflow.ts';
import type { OrderListRow } from '../../../server/os/order-query.ts';
import { relTime, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { IssueList, PriorityBadge, staffName, StageBadge, useStaff } from '../shared.tsx';
import { Badge, Empty, ErrorBox, KfzState, Loading, Panel, Tabs } from '../ui.tsx';

type Queue = 'pruefung' | 'freigabe' | 'uebergabe' | 'ueberwachung' | 'klaerung' | 'anforderungen';

const QUEUES: { id: Queue; label: string; stages: Stage[]; hint: string; tab?: string }[] = [
  { id: 'pruefung', label: 'Prüfen', stages: ['neu', 'dokumente'], hint: 'Neu eingegangen oder Unterlagen/Angaben/Zahlung offen', tab: 'unterlagen' },
  { id: 'freigabe', label: 'Freigeben', stages: ['zahlung_bestaetigt'], hint: 'Vollständig und bezahlt – Sicherheitscodes bestätigen und manuell freigeben', tab: 'freigabe' },
  { id: 'uebergabe', label: 'Übergeben', stages: ['bereit'], hint: 'Freigegeben – beim Zulassungspartner einreichen, dann „Bei Zulassungsstelle“ setzen', tab: 'uebersicht' },
  { id: 'ueberwachung', label: 'Überwachen', stages: ['beim_partner', 'in_bearbeitung'], hint: 'Beim Partner bzw. in Bearbeitung der Behörde – Meldungen kommen über den Webhook', tab: 'kfz' },
  { id: 'klaerung', label: 'Rückfragen & Ablehnungen', stages: ['rueckfrage', 'fehler'], hint: 'Fehlende Unterlagen, Rückfragen der Behörde, Ablehnungen', tab: 'kfz' },
];

export function RegistrationsApp() {
  const { openApp } = useOs();
  const staff = useStaff();
  const [queue, setQueue] = useState<Queue>('pruefung');
  const [service, setService] = useState<'alle' | ServiceId>('alle');
  const { data, error, loading, reload } = useOsData<OrderListRow[]>('orders?status=laufend&limit=2000', { pollMs: 30_000 });

  const rows = useMemo(() => (data ?? []).filter((o) => service === 'alle' || o.service === service), [data, service]);
  const count = (q: (typeof QUEUES)[number]) => rows.filter((o) => q.stages.includes(o.stage)).length;
  const current = QUEUES.find((q) => q.id === queue);
  const items = current ? rows.filter((o) => current.stages.includes(o.stage)) : [];

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Tabs<'alle' | ServiceId> value={service} onChange={setService} tabs={[{ id: 'alle', label: 'Alle Vorgänge' }, ...SERVICE_IDS.map((s) => ({ id: s, label: SERVICES[s].title }))]} />
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
      </div>
      <div className="os-queue">
        <nav className="os-queue__nav" aria-label="Arbeitsschritte">
          {QUEUES.map((q, i) => (
            <button key={q.id} type="button" className={queue === q.id ? 'is-sel' : ''} onClick={() => setQueue(q.id)}>
              <span className="os-queue__step">{i + 1}</span>
              <span className="os-queue__label">{q.label}</span>
              <span className="os-count">{count(q)}</span>
            </button>
          ))}
          <button type="button" className={queue === 'anforderungen' ? 'is-sel' : ''} onClick={() => setQueue('anforderungen')}>
            <span className="os-queue__step">i</span>
            <span className="os-queue__label">Anforderungen je Vorgang</span>
          </button>
          <p className="os-muted os-small os-queue__note">
            Übermittlung an kfz-api.de ist gesperrt, bis Dokumentation, KBA-Freischaltung und Produktivfreigabe vorliegen. Die Freigabe ist immer ein bewusster, manueller
            Schritt.
          </p>
        </nav>
        <section className="os-queue__main os-scroll">
          {queue === 'anforderungen' ? (
            <Requirements service={service === 'alle' ? null : service} />
          ) : current ? (
            <>
              <p className="os-muted os-queue__hint">{current.hint}</p>
              {items.length ? (
                <ul className="os-stack" role="list">
                  {items.map((o) => (
                    <li key={o.id} className="os-panel os-regcard">
                      <div className="os-regcard__head">
                        <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: o.id, tab: current.tab })}>
                          {o.number}
                        </button>
                        <strong>{o.holder_name}</strong>
                        <span className="os-muted os-small">
                          {SERVICES[o.service].title} · {o.vehicle} · <span className="os-mono">{o.fin}</span>
                        </span>
                        <span className="os-row os-row--tight os-regcard__badges">
                          <PriorityBadge value={o.priority} />
                          <StageBadge stage={o.stage} />
                          {o.kfz_display ? <KfzState display={o.kfz_display} /> : null}
                        </span>
                      </div>
                      <div className="os-regcard__body">
                        <span className="os-small">
                          Checkliste {o.checklist.done}/{o.checklist.total} · {o.payment_status === 'bezahlt' ? 'bezahlt' : 'Zahlung offen'} · {staffName(staff, o.assignee_id)} · zuletzt geändert {relTime(o.updated_at)}
                          {o.kfz_status ? ` · KFZ-API: ${o.kfz_status}` : ''}
                        </span>
                        <IssueList issues={o.issues} compact />
                      </div>
                      <div className="os-row">
                        <button type="button" className="os-btn os-btn--sm" onClick={() => openApp('orders', { orderId: o.id, tab: current.tab })}>
                          {queue === 'freigabe' ? 'Prüfen & freigeben' : queue === 'uebergabe' ? 'Übergabe erfassen' : queue === 'klaerung' ? 'Klären' : 'Öffnen'}
                        </button>
                        {queue === 'klaerung' && o.stage === 'rueckfrage' ? (
                          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('messages', { compose: o.id, template: 'unterlagen_anfordern' })}>
                            Kunden anschreiben
                          </button>
                        ) : null}
                        {queue === 'pruefung' ? (
                          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('documents', { orderId: o.id })}>
                            Unterlagen ansehen
                          </button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="Nichts zu tun" text="In diesem Schritt liegen keine Vorgänge." />
              )}
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}

function Requirements({ service }: { service: ServiceId | null }) {
  const list = service ? [service] : [...SERVICE_IDS];
  return (
    <div className="os-grid os-grid--2">
      {list.map((s) => {
        const def = SERVICES[s];
        return (
          <Panel key={s} title={def.title}>
            <p className="os-muted os-small">{def.summary}</p>
            <dl className="os-dl">
              <dt>Unterlagen</dt>
              <dd>
                {documentsFor(s).map((d) => (
                  <Badge key={d.kind} tone={d.requirement === 'pflicht' ? 'blue' : 'slate'}>
                    {DOCUMENTS[d.kind].short}
                    {d.requirement === 'pflicht' ? '' : ' (optional)'}
                  </Badge>
                ))}
              </dd>
              <dt>eVB</dt>
              <dd>{def.evb === 'pflicht' ? 'Pflicht' : def.evb === 'bei_kennzeichenwechsel' ? 'bei Kennzeichenwechsel' : 'nein'}</dd>
              <dt>SEPA (Kfz-Steuer)</dt>
              <dd>{def.sepa ? 'Pflicht' : 'nein'}</dd>
              <dt>Bisheriges Kennzeichen</dt>
              <dd>{def.previousPlate === 'nein' ? 'nein' : def.previousPlate}</dd>
              <dt>Sicherheitscodes (i-Kfz)</dt>
              <dd>
                {securityCodesFor(s, true)
                  .map((c) => SECURITY_CODES[c].label)
                  .join(' · ')}
              </dd>
              <dt>Originale</dt>
              <dd>{def.originals.join(' · ')}</dd>
            </dl>
            {def.notes.length ? <p className="os-muted os-small">{def.notes.join(' ')}</p> : null}
          </Panel>
        );
      })}
      <Panel title="Hinweis">
        <p className="os-muted os-small">
          Die Liste der Sicherheitscodes folgt dem internetbasierten Zulassungsverfahren (i-Kfz). Welche Angaben kfz-api.de je Vorgangsart verlangt, steht in deren
          Dokumentation (nur nach Login) – vor der Produktivfreigabe abgleichen.
        </p>
      </Panel>
    </div>
  );
}

