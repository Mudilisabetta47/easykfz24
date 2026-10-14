'use client';

// Auftragsakte im Auftragscenter: alle Bearbeitungsschritte eines Auftrags mit Sprüngen in die anderen Programme.

import { Fragment, useEffect, useMemo, useState } from 'react';
import { OrderFacts } from '../../admin/OrderFacts.tsx';
import { BUSINESS_TRANSACTIONS } from '../../../lib/kfz-status.ts';
import { PAYMENT_STATUS, PAYMENT_STATUS_LABEL, type PaymentStatus } from '../../../lib/payment.ts';
import { DOCUMENT_KINDS, DOCUMENTS, SERVICES } from '../../../lib/services.ts';
import { CARRIER_IDS, CARRIERS } from '../../../lib/shipping.ts';
import { STATUSES, statusLabel, type StatusId } from '../../../lib/status.ts';
import { SECURITY_CODES, type Issue, type Stage } from '../../../lib/workflow.ts';
import type { ChecklistItem, ChecklistState } from '../../../lib/checklist.ts';
import type { ValidatedOrder } from '../../../lib/order.ts';
import { plateSignCount, type PriceBreakdown } from '../../../lib/pricing.ts';
import { plateFinishOf, plateSummary } from '../../../lib/plates.ts';
import { PROCESSING, type Milestone, type ProcessingLevel } from '../../../lib/express.ts';
import { dateTime, euro, OsError, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IChevron, IExternal } from '../icons.tsx';
import {
  dateOnly,
  DropZone,
  fromDateInput,
  IssueList,
  PRIORITY_LABEL,
  PriorityBadge,
  StaffSelect,
  StageBadge,
  staffName,
  toDateInput,
  uploadFiles,
  useStaff,
} from '../shared.tsx';
import { Badge, Empty, ErrorBox, KfzState, Loading, Panel, StatusBadge, Tabs, useFlash } from '../ui.tsx';
import type { PoaPreview, PoaTestRelease, PoaView } from '../../../server/power-of-attorney.ts';
import type { EvidenceView } from '../../../server/os/poa-evidence.ts';
import type { AttemptView } from '../../../server/mollie.ts';
import { Preview } from './Preview.tsx';

interface Transition {
  to: StatusId;
  check: { ok: true } | { ok: false; reason: string };
}

export interface OrderBundle {
  order: {
    id: number;
    number: string;
    created_at: string;
    status: StatusId;
    service: keyof typeof SERVICES;
    email: string;
    holder_name: string;
    fin: string;
    previous_plate: string;
    assigned_plate: string;
    delivery: 'versand' | 'abholung';
    total_cents: number;
    carrier: keyof typeof CARRIERS | '';
    tracking_number: string;
    payment_status: PaymentStatus;
    kfz_display: string;
    /** 1 = Testauftrag des Inhabers */
    is_test?: number;
    data: ValidatedOrder;
    price: PriceBreakdown;
    checklist: ChecklistState;
    checklistItems: ChecklistItem[];
    consent_at: string;
    assignee_id: number | null;
    priority: string;
    due_at: string;
    follow_up_at: string;
    released_at: string;
    released_by: string;
    customer_id: number | null;
    source: string;
    kfz_status: string;
  };
  customer: { id: number; number: string; name: string; category: string } | null;
  documents: { id: string; kind: string; original_name: string; display_name?: string; mime: string; size: number; created_at: string; url: string; review_state?: string; review_note?: string; version?: number; expires_at?: string; category?: string }[];
  events: { id: number; at: string; type: string; from_status: StatusId | null; to_status: StatusId | null; message: string; public_message: string; actor: string }[];
  notes: { id: number; at: string; text: string; author: string }[];
  kfz: {
    kfzOrderId: string;
    transaction: string;
    status: string;
    display: string;
    updatedAt: string;
    files: { purposeType: string; fileAccessKey: string }[];
    messages: { code?: string; text: string }[];
    notifications: { at: string; subject: string; state: string; error: string }[];
  } | null;
  tasks: { id: number; title: string; status: string; priority: string; due_at: string; assignee_id: number | null }[];
  messages: { messages: { id: number; at: string; subject: string; state: string; error: string; author: string; to_addr: string; body: string; source: string; mail_kind: string; attempts: number; provider_id: string; next_attempt_at: string; automatic: number }[]; statusMails: { id: number; at: string; subject: string; state: string; error: string }[]; mailReady: boolean } | null;
  invoices: { id: number; number: string; kind: string; issued_at: string; gross_cents: number; corrected: number }[];
  payments: { id: number; at: string; provider: string; provider_ref: string; kind: string; status: string; amount_cents: number; fee_cents: number | null; method: string; note: string; created_by: string }[];
  osEvents: { id: number; at: string; type: string; actor: string; payload: Record<string, unknown> }[];
  insights: { issues: Issue[]; stage: Stage; releaseBlockers: string[]; codes: (keyof typeof SECURITY_CODES)[]; fin: { ok: boolean; error?: string; checkDigit: string; wmi?: string }; regChecks: Record<string, boolean> };
  processing: ProcessingLevel;
  milestones: Milestone[] | null;
  wishPlace: { ags: string; name: string; kreis: string; land: string; codes: string[]; fits: boolean } | null;
  poas: PoaView[];
  poaEvidence: EvidenceView[];
  poaEnabled: boolean;
  poaMode: 'aus' | 'test' | 'aktiv';
  paymentAttempts: AttemptView[];
  mollieMode: 'test' | 'live' | null;
  mollieTest: { available: boolean; canStart: boolean };
  poaTest: { canGrant: boolean; isInhaber: boolean; release: (PoaTestRelease & { active: boolean }) | null; otherOrder: string | null };
  transitions: Transition[];
  checklistProgress: { done: number; total: number };
  canWrite: boolean;
  canPayment: boolean;
  canFinance: boolean;
  canKfz: boolean;
  canDocs: boolean;
  canDocsWrite: boolean;
  canMessages: boolean;
}

type Tab = 'uebersicht' | 'freigabe' | 'unterlagen' | 'angaben' | 'zahlung' | 'kfz' | 'kommunikation' | 'aufgaben' | 'verlauf';
type Act = (body: Record<string, unknown>, success: string) => Promise<boolean>;

const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);
const FIX_TAB: Record<string, Tab> = { checkliste: 'unterlagen', dokumente: 'unterlagen', angaben: 'angaben', zahlung: 'zahlung', kennzeichen: 'uebersicht', kfz: 'kfz', freigabe: 'freigabe', frist: 'uebersicht' };

export function OrderDetailView({ id, initialTab, onBack, onChanged, onDuplicate }: { id: number; initialTab?: string; onBack: () => void; onChanged: () => void; onDuplicate: (template: Record<string, unknown>) => void }) {
  const { openApp } = useOs();
  const { data, error, loading, reload } = useOsData<OrderBundle>(`orders/${id}`, { pollMs: 30_000 });
  const [tab, setTab] = useState<Tab>((initialTab && (initialTab in FIX_TAB ? FIX_TAB[initialTab] : initialTab)) as Tab || 'uebersicht');
  const flash = useFlash();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialTab) setTab(((initialTab in FIX_TAB ? FIX_TAB[initialTab] : initialTab) as Tab) || 'uebersicht');
  }, [initialTab, id]);

  const act: Act = async (body, success) => {
    setBusy(true);
    try {
      await osFetch(`orders/${id}/action`, { method: 'POST', body });
      flash.show(true, success);
      await reload(true);
      onChanged();
      return true;
    } catch (e) {
      flash.show(false, (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const o = data.order;
  const errors = data.insights.issues.filter((i) => i.level === 'fehler').length;

  return (
    <div className="os-detail">
      <header className="os-detail__head">
        <button type="button" className="os-iconbtn os-detail__back" onClick={onBack} aria-label="Zurück zur Liste">
          <IChevron width={18} height={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="os-detail__title">
          <h2 className="os-mono">{o.number}</h2>
          {o.is_test ? (
            <p className="os-flash is-error" role="note">
              TESTAUFTRAG – keine Kundenbestellung: keine Zahlung, Freigabe, Übermittlung an Partner/Behörde oder Kundenmail.
            </p>
          ) : null}
          <p className="os-muted">
            {SERVICES[o.service].title} ·{' '}
            {data.customer ? (
              <button type="button" className="os-linkbtn" onClick={() => openApp('customers', { customerId: data.customer!.id })}>
                {o.holder_name} ({data.customer.number})
              </button>
            ) : (
              o.holder_name
            )}{' '}
            · eingegangen {dateTime(o.created_at)}
            {o.source === 'verwaltung' ? ' · in der Verwaltung angelegt' : ''}
          </p>
        </div>
        <div className="os-detail__badges">
          <StageBadge stage={data.insights.stage} />
          <StatusBadge status={o.status} service={o.service} />
          <PriorityBadge value={o.priority} />
          <KfzState display={o.kfz_display} />
        </div>
        <div className="os-row os-row--tight">
          {data.canDocs ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('documents', { orderId: o.id })}>
              Dateien
            </button>
          ) : null}
          {data.canWrite ? (
            <button
              type="button"
              className="os-btn os-btn--ghost os-btn--sm"
              onClick={async () => {
                try {
                  onDuplicate(await osFetch<Record<string, unknown>>(`orders/${o.id}/template`));
                } catch (e) {
                  flash.show(false, (e as Error).message);
                }
              }}
              title="Neuen Auftrag mit diesen Halter- und Fahrzeugdaten anlegen (ohne Dokumente, Zahlung, eVB)"
            >
              Duplizieren
            </button>
          ) : null}
          <a className="os-btn os-btn--ghost os-btn--sm" href={`/admin/auftraege/${o.id}/druck`} target="_blank" rel="noopener">
            <IExternal width={14} height={14} /> PDF / Druck
          </a>
        </div>
      </header>
      {flash.node}
      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'uebersicht', label: errors ? `Übersicht · ${errors} Fehler` : 'Übersicht' },
          { id: 'freigabe', label: 'Freigabe & Zulassung' },
          { id: 'unterlagen', label: `Unterlagen ${data.checklistProgress.done}/${data.checklistProgress.total}` },
          { id: 'angaben', label: 'Angaben' },
          ...(data.canFinance || data.canPayment ? [{ id: 'zahlung' as Tab, label: 'Zahlung & Rechnung' }] : []),
          { id: 'kfz', label: 'KFZ-API' },
          { id: 'kommunikation', label: `Kommunikation${data.messages?.messages.length ? ` (${data.messages.messages.length})` : ''}` },
          { id: 'aufgaben', label: `Aufgaben${data.tasks.filter((t) => t.status !== 'erledigt' && t.status !== 'abgebrochen').length ? ` (${data.tasks.filter((t) => t.status !== 'erledigt' && t.status !== 'abgebrochen').length})` : ''}` },
          { id: 'verlauf', label: 'Notizen & Verlauf' },
        ]}
      />
      <div className="os-detail__body os-scroll">
        {tab === 'uebersicht' ? (
          <OverviewTab
            data={data}
            busy={busy}
            act={act}
            onFix={(i) => i.fix && setTab(FIX_TAB[i.fix] ?? 'uebersicht')}
            poaDone={async (ok, text) => {
              flash.show(ok, text);
              await reload(true);
              onChanged();
            }}
          />
        ) : null}
        {tab === 'freigabe' ? <ReleaseTab data={data} busy={busy} act={act} /> : null}
        {tab === 'unterlagen' ? <DocsTab data={data} busy={busy} act={act} reload={() => void reload(true)} flash={flash.show} /> : null}
        {tab === 'angaben' ? (
          <div className="os-facts">
            <OrderFacts order={o as never} wishPlace={data.wishPlace} />
          </div>
        ) : null}
        {tab === 'zahlung' ? <PaymentTab data={data} busy={busy} act={act} reload={() => void reload(true)} flash={flash.show} /> : null}
        {tab === 'kfz' ? <KfzTab data={data} busy={busy} act={act} /> : null}
        {tab === 'kommunikation' ? <CommTab data={data} reload={() => void reload(true)} /> : null}
        {tab === 'aufgaben' ? <TasksTab data={data} reload={() => void reload(true)} /> : null}
        {tab === 'verlauf' ? <LogTab data={data} busy={busy} act={act} /> : null}
      </div>
    </div>
  );
}

/* ---------- Übersicht ---------- */

function OverviewTab({ data, busy, act, onFix, poaDone }: { data: OrderBundle; busy: boolean; act: Act; onFix: (i: Issue) => void; poaDone: (ok: boolean, text: string) => Promise<void> }) {
  const o = data.order;
  const staff = useStaff();
  const forward = data.transitions.filter((t) => t.to !== 'storniert');
  const firstOk = forward.find((t) => t.check.ok)?.to ?? '';
  const [to, setTo] = useState<string>(firstOk);
  const [pub, setPub] = useState('');
  const [internal, setInternal] = useState('');
  const [plate, setPlate] = useState(o.assigned_plate);
  const [carrier, setCarrier] = useState<string>(o.carrier || 'dhl');
  const [tracking, setTracking] = useState(o.tracking_number);
  const [cancelMsg, setCancelMsg] = useState('');
  const canCancel = data.transitions.some((t) => t.to === 'storniert');
  useEffect(() => setTo(firstOk), [firstOk]);
  useEffect(() => setPlate(o.assigned_plate), [o.assigned_plate]);

  const flow: StatusId[] = ['neu', 'in_pruefung', 'bei_zulassungsstelle', 'zugelassen', o.delivery === 'versand' ? 'versendet' : 'abgeholt', 'abgeschlossen'];
  const idx = flow.indexOf(o.status);

  return (
    <div className="os-grid os-grid--detail">
      <div className="os-stack">
        <Panel title={`Prüfung (${data.insights.issues.length})`}>
          <IssueList issues={data.insights.issues} onFix={onFix} />
        </Panel>
        <Panel title="Status">
          <ol className="os-flow" role="list">
            {flow.map((s, i) => (
              <li key={s} className={s === o.status ? 'is-current' : idx > i ? 'is-done' : ''}>
                {statusLabel(s, o.service)}
              </li>
            ))}
          </ol>
          {o.status === 'unterlagen_fehlen' || o.status === 'storniert' ? (
            <p className="os-note">
              Aktuell: <StatusBadge status={o.status} service={o.service} />
            </p>
          ) : null}
          {data.canWrite && forward.length ? (
            <form
              className="os-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (!to) return;
                if (await act({ type: 'status', to, publicMessage: pub, internalMessage: internal }, `Status: ${statusLabel(to as StatusId, o.service)}`)) {
                  setPub('');
                  setInternal('');
                }
              }}
            >
              <fieldset className="os-choices">
                <legend>Nächster Schritt</legend>
                {forward.map((t) => (
                  <label key={t.to} className={t.check.ok ? '' : 'is-disabled'}>
                    <input type="radio" name="to" value={t.to} checked={to === t.to} disabled={!t.check.ok} onChange={() => setTo(t.to)} />
                    <span>
                      <strong>{statusLabel(t.to, o.service)}</strong>
                      {!t.check.ok ? <span className="os-muted"> – {t.check.reason}</span> : null}
                      {t.to === 'bei_zulassungsstelle' && !o.released_at ? <span className="os-muted"> – erst freigeben (Registerkarte „Freigabe“)</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
              <label className="os-field">
                <span className="os-field__label">Nachricht an den Kunden (optional, sichtbar in der Statusabfrage)</span>
                <textarea rows={2} maxLength={1000} value={pub} onChange={(e) => setPub(e.target.value)} />
              </label>
              <label className="os-field">
                <span className="os-field__label">Interner Kommentar (optional)</span>
                <input maxLength={1000} value={internal} onChange={(e) => setInternal(e.target.value)} />
              </label>
              <button type="submit" className="os-btn" disabled={busy || !to}>
                Status ändern
              </button>
            </form>
          ) : !forward.length ? (
            <p className="os-muted">Der Auftrag ist {STATUSES[o.status].label.toLowerCase()} – keine weiteren Schritte.</p>
          ) : (
            <p className="os-muted">Nur Lesen – Ihre Rolle darf den Status nicht ändern.</p>
          )}
          {data.canWrite && canCancel ? (
            <details className="os-danger">
              <summary>Auftrag stornieren</summary>
              <form
                className="os-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!window.confirm(`Auftrag ${o.number} endgültig stornieren?`)) return;
                  if (await act({ type: 'status', to: 'storniert', publicMessage: cancelMsg }, 'Auftrag storniert')) setCancelMsg('');
                }}
              >
                <label className="os-field">
                  <span className="os-field__label">Begründung für den Kunden</span>
                  <textarea rows={2} required maxLength={1000} value={cancelMsg} onChange={(e) => setCancelMsg(e.target.value)} />
                </label>
                <button type="submit" className="os-btn os-btn--danger" disabled={busy || !cancelMsg.trim()}>
                  Endgültig stornieren
                </button>
              </form>
            </details>
          ) : null}
        </Panel>
      </div>
      <div className="os-stack">
        <Panel
          title="Bearbeitung & Zeitstempel"
          actions={data.processing !== 'standard' ? <Badge tone={data.processing === 'express_plus' ? 'red' : 'amber'}>{PROCESSING[data.processing].label}</Badge> : <Badge tone="slate">Standard</Badge>}
        >
          {data.milestones ? (
            <ol className="os-milestones" role="list">
              {data.milestones.map((m) => (
                <li key={m.key} className={`${m.at ? 'is-done' : ''}${m.tone ? ` is-${m.tone}` : ''}`}>
                  <span>{m.label}</span>
                  <span className="os-small">{m.at ? dateTime(m.at) : '–'}</span>
                  {m.note ? <span className="os-small os-muted">{m.note}</span> : null}
                </li>
              ))}
            </ol>
          ) : null}
          {data.processing !== 'standard' ? (
            <p className="os-muted os-small">
              {o.due_at ? `Interne Frist: ${dateTime(o.due_at)}${o.due_at < new Date().toISOString() ? ' – überschritten' : ''}. ` : ''}Express heißt Vorrang in unserer Bearbeitung – keine Fristzusage an den
              Kunden.
            </p>
          ) : null}
        </Panel>
        <PoaPanel data={data} done={poaDone} />
        <Panel title="Planung">
          <div className="os-fields os-fields--2">
            <label className="os-field">
              <span className="os-field__label">Zuständig</span>
              <StaffSelect value={o.assignee_id} disabled={!data.canWrite || busy} onChange={(v) => void act({ type: 'assign', assigneeId: v }, `Zuständig: ${staffName(staff, v)}`)} />
            </label>
            <label className="os-field">
              <span className="os-field__label">Priorität</span>
              <select className="os-select" value={o.priority} disabled={!data.canWrite || busy} onChange={(e) => void act({ type: 'planning', priority: e.target.value }, `Priorität: ${PRIORITY_LABEL[e.target.value]}`)}>
                {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="os-field">
              <span className="os-field__label">Bearbeitungsfrist</span>
              <input type="date" value={toDateInput(o.due_at)} disabled={!data.canWrite || busy} onChange={(e) => void act({ type: 'planning', due_at: fromDateInput(e.target.value) }, e.target.value ? 'Frist gesetzt' : 'Frist entfernt')} />
            </label>
            <label className="os-field">
              <span className="os-field__label">Wiedervorlage</span>
              <input type="date" value={toDateInput(o.follow_up_at)} disabled={!data.canWrite || busy} onChange={(e) => void act({ type: 'planning', follow_up_at: fromDateInput(e.target.value, false) }, e.target.value ? 'Wiedervorlage gesetzt' : 'Wiedervorlage entfernt')} />
            </label>
          </div>
        </Panel>
        <Panel title="Zugeteiltes Kennzeichen">
          <form
            className="os-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ type: 'plate', plate }, plate ? `Kennzeichen ${plate} gespeichert` : 'Kennzeichen entfernt');
            }}
          >
            <input className="os-mono" value={plate} onChange={(e) => setPlate(e.target.value.toUpperCase())} placeholder="z. B. HB-EZ 24" aria-label="Kennzeichen" disabled={!data.canWrite} maxLength={20} />
            {data.canWrite ? (
              <button type="submit" className="os-btn os-btn--sm" disabled={busy || plate === o.assigned_plate}>
                Speichern
              </button>
            ) : null}
          </form>
          {o.data.plate.wunschkennzeichen ? <p className="os-muted os-small">Wunsch des Kunden: {o.data.plate.wunschkennzeichen}</p> : null}
          {data.wishPlace ? (
            <p className="os-small">
              Kennzeichen-Ort: <strong>{data.wishPlace.name}</strong>
              {data.wishPlace.kreis ? ` · ${data.wishPlace.kreis}, ${data.wishPlace.land}` : ''} – verifizierte Kürzel: {data.wishPlace.codes.join(', ') || 'keine'}{' '}
              {data.wishPlace.fits ? <Badge tone="green">Kürzel passt</Badge> : <Badge tone="red">Kürzel passt nicht</Badge>}
            </p>
          ) : null}
          {o.data.plate.schilder ? (
            <p className="os-small">
              Schilder: <strong>{plateSummary(o.data.plate, plateSignCount(o.data.vehicle.art))}</strong>{' '}
              {plateFinishOf(o.data.plate) === 'carbon' ? <Badge tone="carbon">Premium</Badge> : null}
            </p>
          ) : null}
          {o.previous_plate ? <p className="os-muted os-small">Bisher: {o.previous_plate}</p> : null}
        </Panel>
        {o.delivery === 'versand' ? (
          <Panel title="Versand">
            {data.canWrite ? (
              <form
                className="os-inline"
                onSubmit={(e) => {
                  e.preventDefault();
                  void act({ type: 'shipment', carrier, tracking }, 'Sendung gespeichert');
                }}
              >
                <select className="os-select" value={carrier} onChange={(e) => setCarrier(e.target.value)} aria-label="Versandpartner">
                  {CARRIER_IDS.map((c) => (
                    <option key={c} value={c}>
                      {CARRIERS[c].name}
                    </option>
                  ))}
                </select>
                <input className="os-mono" value={tracking} onChange={(e) => setTracking(e.target.value)} placeholder="Sendungsnummer" maxLength={40} aria-label="Sendungsnummer" />
                <button type="submit" className="os-btn os-btn--sm" disabled={busy}>
                  Speichern
                </button>
              </form>
            ) : null}
            {o.carrier && o.tracking_number ? (
              <a className="os-link" href={CARRIERS[o.carrier].trackingUrl(o.tracking_number)} target="_blank" rel="noopener noreferrer">
                Sendung bei {CARRIERS[o.carrier].name} verfolgen
              </a>
            ) : (
              <p className="os-muted os-small">Gewählt: {o.carrier ? CARRIERS[o.carrier].name : 'kein Versandpartner'}</p>
            )}
          </Panel>
        ) : (
          <Panel title="Zustellung">
            <p className="os-muted">Kunde holt die Unterlagen ab.</p>
          </Panel>
        )}
        <Panel title="Kontakt">
          <dl className="os-dl">
            <dt>E-Mail</dt>
            <dd>
              <a className="os-link" href={`mailto:${o.email}`}>
                {o.email}
              </a>
            </dd>
            <dt>Telefon</dt>
            <dd>{o.data.holder.telefon ? <a className="os-link" href={`tel:${o.data.holder.telefon.replace(/\s/g, '')}`}>{o.data.holder.telefon}</a> : '–'}</dd>
            <dt>Fahrzeug</dt>
            <dd>
              {o.data.vehicle.hersteller} {o.data.vehicle.modell} · <span className="os-mono">{o.fin}</span>
            </dd>
          </dl>
        </Panel>
      </div>
    </div>
  );
}

/* ---------- Freigabe & Zulassung ---------- */

function ReleaseTab({ data, busy, act }: { data: OrderBundle; busy: boolean; act: Act }) {
  const o = data.order;
  const ins = data.insights;
  const released = !!o.released_at;
  const tx = SERVICES[o.service];
  return (
    <div className="os-grid os-grid--detail">
      <div className="os-stack">
        <Panel title="Vollständigkeitsprüfung">
          <dl className="os-dl">
            <dt>Vorgang</dt>
            <dd>{tx.title}</dd>
            <dt>FIN</dt>
            <dd>
              <span className="os-mono">{o.fin}</span>{' '}
              {ins.fin.ok ? <Badge tone="green">Format gültig</Badge> : <Badge tone="red">{ins.fin.error}</Badge>}{' '}
              {ins.fin.ok ? (
                <span className="os-muted os-small">
                  {ins.fin.checkDigit === 'stimmt' ? 'Prüfziffer stimmt' : 'ohne Prüfziffer (in Europa nicht vorgeschrieben)'} · Hersteller-Kennung {ins.fin.wmi}
                </span>
              ) : null}
            </dd>
            <dt>Checkliste</dt>
            <dd>
              {data.checklistProgress.done}/{data.checklistProgress.total}
            </dd>
            <dt>Zahlung</dt>
            <dd>{PAYMENT_STATUS_LABEL[o.payment_status]}</dd>
            <dt>Originale</dt>
            <dd>{tx.originals.join(' · ')}</dd>
          </dl>
          <IssueList issues={ins.issues} />
        </Panel>
        <Panel title="Sicherheitscodes (i-Kfz)">
          <p className="os-muted os-small">
            Nur bestätigen, dass die Codes aus den Originalen vorliegen und geprüft wurden. Die Codes selbst werden hier bewusst nicht gespeichert. Welche Codes der
            Zulassungspartner verlangt, richtet sich nach dessen API-Dokumentation.
          </p>
          <ul className="os-checklist" role="list">
            {ins.codes.map((c) => {
              const key = `code_${c}`;
              const checked = !!ins.regChecks[key];
              return (
                <li key={c}>
                  <button type="button" className={checked ? 'is-checked' : ''} aria-pressed={checked} disabled={busy || !data.canWrite || (released && checked)} onClick={() => void act({ type: 'regCheck', key, value: !checked }, checked ? 'Prüfpunkt zurückgesetzt' : 'Prüfpunkt bestätigt')}>
                    <span className="os-check" aria-hidden="true" />
                    <span>{SECURITY_CODES[c].label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Panel>
      </div>
      <div className="os-stack">
        <Panel title="Freigabe zur Übermittlung" actions={released ? <Badge tone="violet">freigegeben</Badge> : <Badge tone="slate">nicht freigegeben</Badge>}>
          {released ? (
            <p>
              Freigegeben am {dateTime(o.released_at)} von {o.released_by}.
            </p>
          ) : ins.releaseBlockers.length ? (
            <>
              <p className="os-muted">Freigabe noch nicht möglich:</p>
              <ul className="os-plain os-small">
                {ins.releaseBlockers.map((b) => (
                  <li key={b}>• {b}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>Alle Voraussetzungen erfüllt. Die Freigabe ist die bewusste Entscheidung, den Vorgang (kostenpflichtig) beim Zulassungspartner einzureichen.</p>
          )}
          {data.canKfz ? (
            released ? (
              o.status === 'in_pruefung' ? (
                <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => void act({ type: 'release', release: false }, 'Freigabe zurückgenommen')}>
                  Freigabe zurücknehmen
                </button>
              ) : null
            ) : (
              <button
                type="button"
                className="os-btn"
                disabled={busy || ins.releaseBlockers.length > 0}
                onClick={() => {
                  if (window.confirm(`Auftrag ${o.number} zur Übermittlung freigeben?`)) void act({ type: 'release' }, 'Zur Übermittlung freigegeben');
                }}
              >
                Zur Übermittlung freigeben
              </button>
            )
          ) : (
            <p className="os-muted os-small">Freigeben dürfen Rollen mit dem Recht „KFZ-API: Ereignisse zuordnen“.</p>
          )}
        </Panel>
        <Panel title="Übermittlung an kfz-api.de">
          <p className="os-muted os-small">
            Gesperrt: Es wird nichts automatisch übermittelt (keine Produktivfreigabe für kostenpflichtige Anträge). Nach der Freigabe den Vorgang beim
            Zulassungspartner einreichen und hier „Bei Zulassungsstelle“ setzen (Registerkarte Übersicht). Statusmeldungen kommen über den Webhook.
          </p>
          {o.data.plate.schilder ? (
            <p className="os-small">
              Schilder mitbestellen: <strong>{plateSummary(o.data.plate, plateSignCount(o.data.vehicle.art))}</strong> – beim Zulassungspartner genau diese
              Ausführung wählen.
            </p>
          ) : null}
        </Panel>
      </div>
    </div>
  );
}

/* ---------- Digitale Vollmacht (kfz-api.de / Nect) ---------- */

const POA_TONE: Record<PoaView['state'], string> = {
  erstellt: 'slate',
  link_versendet: 'blue',
  ausstehend: 'amber',
  unterschrieben: 'green',
  unvollstaendig: 'amber',
  abgelehnt: 'red',
  abgelaufen: 'red',
  fehler: 'red',
};
const POA_SERVICE_IDS = ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung'];

function PoaPanel({ data, done }: { data: OrderBundle; done: (ok: boolean, text: string) => Promise<void> }) {
  const o = data.order;
  const [busy, setBusy] = useState(false);
  const [birthPlace, setBirthPlace] = useState('');
  const poa = data.poas[0] ?? null;
  const needed = POA_SERVICE_IDS.includes(o.service);
  const release = data.poaTest.release;
  // Testaufträge: immer nur Inhaber mit Testfreigabe genau dieses Auftrags; echte Aufträge nur bei VOLLMACHT_DIGITAL=1
  const allowedMode =
    data.poaMode === 'aus' ? false : o.is_test ? data.poaTest.isInhaber && !!release?.active && release.orderId === o.id : data.poaMode === 'aktiv' && data.canWrite;
  const canRequest = allowedMode && needed && o.data.holder.typ === 'privat' && (!poa || ['abgelehnt', 'abgelaufen', 'fehler'].includes(poa.state));
  const [confirming, setConfirming] = useState(false);
  const run = async (path: string, success: string, confirmText?: string, body: Record<string, unknown> = {}) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await osFetch(`orders/${o.id}/${path}`, { method: 'POST', body });
      await done(true, success);
    } catch (e) {
      await done(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const steps: { label: string; on: boolean; tone?: string }[] = poa
    ? [
        { label: 'Vollmacht erstellt', on: !!poa.processId },
        { label: poa.sendEmail ? 'Unterschriftslink versendet (durch Partner)' : 'Unterschriftslink bereit', on: !!poa.signatureUrl && !poa.note },
        {
          label: poa.state === 'abgelehnt' ? 'Vollmacht abgelehnt' : poa.state === 'abgelaufen' ? 'Vollmacht abgelaufen' : poa.state === 'fehler' ? 'Technischer Fehler' : 'Vollmacht unterschrieben',
          on: ['unterschrieben', 'unvollstaendig', 'abgelehnt', 'abgelaufen', 'fehler'].includes(poa.state),
          tone: ['abgelehnt', 'abgelaufen', 'fehler'].includes(poa.state) ? 'red' : undefined,
        },
      ]
    : [];
  return (
    <Panel title="Digitale Vollmacht" actions={poa ? <Badge tone={POA_TONE[poa.state]}>{poa.label}</Badge> : <Badge tone="slate">{needed ? 'nicht angefordert' : 'nicht nötig'}</Badge>}>
      {!poa ? (
        <p className="os-muted os-small">
          {needed
            ? data.poaMode === 'aktiv'
              ? 'Noch kein Vollmachtsvorgang. Die Anforderung legt beim Partner einen kostenpflichtigen Unterschriftsvorgang an (Online-Unterschrift mit Ausweis).'
              : data.poaMode === 'test'
                ? 'Testmodus: Die digitale Vollmacht ist nicht für alle Aufträge freigeschaltet. Nur der Inhaber kann einen einzelnen, ausdrücklich freigegebenen eigenen Auftrag für einen echten Vorgang freigeben.'
                : 'Die digitale Vollmacht ist ausgeschaltet. Bis dahin gilt die Vollmacht im Original.'
            : 'Für diese Leistung ist keine Vollmacht nötig.'}
        </p>
      ) : (
        <>
          <ol className="os-milestones" role="list">
            {steps.map((s) => (
              <li key={s.label} className={`${s.on ? 'is-done' : ''}${s.tone ? ` is-${s.tone}` : ''}`}>
                <span>{s.label}</span>
              </li>
            ))}
          </ol>
          <dl className="os-dl os-small">
            <>
              <dt>Vorgang beim Partner</dt>
              <dd>
                {poa.processId ? `Nr. ${poa.processId}` : '–'} · Versuch {poa.attempt} · {poa.externalOrderId}
              </dd>
            </>
            <>
              <dt>Letzte bestätigte Änderung</dt>
              <dd>{poa.statusChangedAt ? dateTime(poa.statusChangedAt) : '–'}</dd>
            </>
            <>
              <dt>Zuletzt abgefragt</dt>
              <dd>
                {poa.checkedAt ? dateTime(poa.checkedAt) : '–'}
                {poa.checkError ? ` – ${poa.checkError}` : ''}
              </dd>
            </>
            {poa.validUntil ? (
              <>
                <dt>Unterschrift möglich bis</dt>
                <dd>{dateTime(poa.validUntil)}</dd>
              </>
            ) : null}
            <>
              <dt>SEPA-Mandat</dt>
              <dd>{poa.withSepa ? 'Kfz-Steuer-Mandat (Zoll) im selben Vorgang mit unterschrieben' : 'nicht enthalten – für die Zulassung separat einholen'}</dd>
            </>
          </dl>
          {poa.note ? <p className="os-flash is-warn">Hinweis des Partners: {poa.note}</p> : null}
          {poa.missingFields.length && poa.status === 'signiert' ? (
            <p className="os-flash is-warn">Nicht festgestellte Halterfelder: {poa.missingFields.join(', ')} – z. B. Ausweis ohne Anschrift (Reisepass); Meldebescheinigung prüfen.</p>
          ) : null}
          {poa.blockingIssues.length ? <p className="os-flash is-error">Mängel am Vorgang: {poa.blockingIssues.join(', ')}</p> : null}
          {poa.createError ? <p className="os-flash is-error">Anforderung: {poa.createError}</p> : null}
          {poa.signatureUrl && ['ausstehend', 'link_versendet', 'erstellt'].includes(poa.state) ? (
            <p className="os-small">
              Unterschriftslink:{' '}
              <button type="button" className="os-linkbtn" onClick={() => void navigator.clipboard?.writeText(poa.signatureUrl)}>
                kopieren
              </button>{' '}
              <span className="os-muted">(nur an den Halter weitergeben)</span>
            </p>
          ) : null}
          <p className="os-muted os-small">
            Maßgeblich ist der über die Partner-Schnittstelle bestätigte Stand – nie der Rücksprung des Kunden. Das unterschriebene Dokument liegt beim
            Partner (Dashboard › Vollmachten); die Schnittstelle gibt es aus Datenschutzgründen nicht heraus.
          </p>
          {data.poas.length > 1 ? (
            <details className="os-small">
              <summary>Frühere Versuche ({data.poas.length - 1})</summary>
              <ul className="os-plain">
                {data.poas.slice(1).map((p) => (
                  <li key={p.id}>
                    Versuch {p.attempt}: {p.label} · Nr. {p.processId ?? '–'} · {p.statusChangedAt ? dateTime(p.statusChangedAt) : dateTime(p.createdAt)}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </>
      )}
      {needed && data.canWrite && o.data.holder.typ === 'privat' && !o.data.holder.geburtsort && (!poa || ['abgelehnt', 'abgelaufen', 'fehler'].includes(poa.state)) ? (
        <form
          className="os-row"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              await osFetch(`orders/${o.id}/action`, { method: 'POST', body: { type: 'birthPlace', value: birthPlace } });
              setBirthPlace('');
              await done(true, 'Geburtsort gespeichert');
            } catch (err) {
              await done(false, (err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input placeholder="Geburtsort wie im Ausweis" aria-label="Geburtsort wie im Ausweis" maxLength={105} value={birthPlace} onChange={(e) => setBirthPlace(e.target.value)} />
          <button type="submit" className="os-btn os-btn--ghost" disabled={busy || !birthPlace.trim()}>
            Geburtsort speichern
          </button>
        </form>
      ) : null}
      <div className="os-row">
        {poa?.processId ? (
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => void run('vollmacht/abgleich', 'Stand beim Partner abgefragt')}>
            Stand jetzt abfragen
          </button>
        ) : null}
        {canRequest && !confirming ? (
          <button type="button" className="os-btn" disabled={busy} onClick={() => setConfirming(true)}>
            {poa ? 'Neuen Vorgang vorbereiten' : 'Digitale Vollmacht vorbereiten'}
          </button>
        ) : null}
      </div>
      {confirming && canRequest ? (
        <PoaConfirm
          orderId={o.id}
          onCancel={() => setConfirming(false)}
          onDone={async (ok, text) => {
            if (ok) setConfirming(false);
            await done(ok, text);
          }}
        />
      ) : null}
      {data.poaMode !== 'aus' && needed && data.order.is_test ? <PoaTestRelease data={data} busy={busy} run={run} /> : null}
      {needed && poa && poa.state === 'unterschrieben' ? <PoaEvidencePanel data={data} busy={busy} run={run} processId={poa.processId} /> : null}
    </Panel>
  );
}

/**
 * QES-Nachweis: signiertes PDF aus dem POWR-Dashboard (Kategorie „Vollmacht“) und Prüfbericht eines Validierungsdienstes
 * hochladen, hier zuordnen. Der Server prüft Vorgangsnummer, Unterzeichner und die Signatur im PDF technisch vor.
 */
function PoaEvidencePanel({
  data,
  busy,
  run,
  processId,
}: {
  data: OrderBundle;
  busy: boolean;
  run: (path: string, success: string, confirmText?: string, body?: Record<string, unknown>) => Promise<void>;
  processId: number | null;
}) {
  const pdfs = data.documents.filter((d) => d.mime === 'application/pdf');
  const valid = data.poaEvidence.find((e) => e.valid);
  const [f, setF] = useState({ processId: '', pdfDocId: '', reportDocId: '', validator: '', signerName: '', signedAt: '', ok: false });
  const name = (id: string) => {
    const d = data.documents.find((x) => x.id === id);
    return d ? d.display_name || d.original_name : 'nicht mehr vorhanden';
  };
  return (
    <div className="os-subpanel">
      <h4>QES-Nachweis (Freigabevoraussetzung)</h4>
      {valid ? (
        <p className="os-flash" role="status">
          Gültiger Nachweis: Vorgang {valid.processId}, Prüfbericht „{valid.validator}“, unterzeichnet von {valid.signerName}, erfasst von {valid.checkedBy} am{' '}
          {dateTime(valid.checkedAt)}. Vorprüfung: Signatur deckt die Datei ab, {valid.tech?.digestAlgorithm} stimmt, Zertifikat qualifiziert (QSCD).
        </p>
      ) : (
        <p className="os-muted os-small">
          Ohne gültigen Nachweis keine Freigabe. 1. Signiertes PDF des Vorgangs {processId ?? '–'} aus dem POWR-Dashboard laden und im Auftrag als
          Kategorie „Vollmacht“ hochladen. 2. Signatur mit einem Validierungsdienst bzw. einer Prüfsoftware prüfen (keine Kundendaten an öffentliche
          Demo-Dienste) und den Prüfbericht als PDF hochladen. 3. Hier zuordnen – ein bloßes PDF zählt nicht.
        </p>
      )}
      {data.canKfz && !valid ? (
        <div className="os-fields">
          <label className="os-field">
            <span className="os-field__label">Vorgangsnummer laut POWR-Dashboard</span>
            <input className="os-mono" value={f.processId} onChange={(e) => setF({ ...f, processId: e.target.value.replace(/\D/g, '') })} />
          </label>
          <label className="os-field">
            <span className="os-field__label">Signiertes PDF (Kategorie „Vollmacht“)</span>
            <select className="os-select" value={f.pdfDocId} onChange={(e) => setF({ ...f, pdfDocId: e.target.value })}>
              <option value="">– wählen –</option>
              {pdfs
                .filter((d) => d.category === 'Vollmacht')
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.display_name || d.original_name}
                  </option>
                ))}
            </select>
          </label>
          <label className="os-field">
            <span className="os-field__label">Prüfbericht (PDF)</span>
            <select className="os-select" value={f.reportDocId} onChange={(e) => setF({ ...f, reportDocId: e.target.value })}>
              <option value="">– wählen –</option>
              {pdfs
                .filter((d) => d.id !== f.pdfDocId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.display_name || d.original_name}
                  </option>
                ))}
            </select>
          </label>
          <label className="os-field">
            <span className="os-field__label">Validierungsdienst / Prüfsoftware</span>
            <input value={f.validator} onChange={(e) => setF({ ...f, validator: e.target.value })} maxLength={200} />
          </label>
          <label className="os-field">
            <span className="os-field__label">Unterzeichner laut Prüfbericht</span>
            <input value={f.signerName} onChange={(e) => setF({ ...f, signerName: e.target.value })} maxLength={200} />
          </label>
          <label className="os-field">
            <span className="os-field__label">Signaturzeitpunkt laut Prüfbericht</span>
            <input type="datetime-local" value={f.signedAt} onChange={(e) => setF({ ...f, signedAt: e.target.value })} />
          </label>
          <label className="os-check-field os-field--wide">
            <input type="checkbox" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} /> Prüfbericht gelesen: Ergebnis „gültig –
            qualifizierte elektronische Signatur“, Unterzeichner und Zeitpunkt wie angegeben
          </label>
          <button
            type="button"
            className="os-btn os-btn--sm"
            disabled={busy || !f.ok || !f.pdfDocId || !f.reportDocId}
            onClick={() =>
              void run('vollmacht/nachweis', 'QES-Nachweis erfasst', undefined, {
                processId: Number(f.processId),
                pdfDocId: f.pdfDocId,
                reportDocId: f.reportDocId,
                validator: f.validator,
                result: 'gueltig_qualifiziert',
                signerName: f.signerName,
                signedAt: f.signedAt ? new Date(f.signedAt).toISOString() : '',
                bestaetigt: true,
              })
            }
          >
            Nachweis prüfen und erfassen
          </button>
        </div>
      ) : null}
      {data.poaEvidence.length ? (
        <ul className="os-list os-small" role="list">
          {data.poaEvidence.map((e) => (
            <li key={e.id}>
              #{e.id} · Vorgang {e.processId} · {name(e.pdfDocId)} + {name(e.reportDocId)} · {e.validator} · {e.valid ? 'gültig' : `ungültig: ${e.invalidReason}`}
              {e.revokedAt ? ` (widerrufen von ${e.revokedBy}: ${e.revokeReason})` : ''}
              {data.canKfz && !e.revokedAt ? (
                <button
                  type="button"
                  className="os-btn os-btn--ghost os-btn--sm"
                  disabled={busy}
                  onClick={() => {
                    const grund = window.prompt('Grund für den Widerruf dieses Nachweises?') ?? '';
                    if (grund.trim()) void run('vollmacht/nachweis/widerruf', 'Nachweis widerrufen', undefined, { evidenceId: e.id, grund });
                  }}
                >
                  Widerrufen
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Testmodus: genau diesen Auftrag für einen echten Vorgang freigeben (nur Inhaber, einmalig, 24 Stunden) */
function PoaTestRelease({ data, busy, run }: { data: OrderBundle; busy: boolean; run: (path: string, success: string, confirmText?: string, body?: Record<string, unknown>) => Promise<void> }) {
  const o = data.order;
  const t = data.poaTest;
  const r = t.release;
  if (!t.canGrant) {
    return r?.active ? (
      <p className="os-muted os-small">Testfreigabe aktiv bis {dateTime(r.expiresAt)} – anfordern kann nur der Inhaber.</p>
    ) : null;
  }
  return (
    <div className="poa-test">
      <p className="os-small">
        <strong>Testmodus.</strong>{' '}
        {r?.active
          ? `Dieser Auftrag ist für einen echten Vorgang freigegeben – bis ${dateTime(r.expiresAt)}${r.attempt !== null ? `, gebunden an Versuch ${r.attempt}` : ', noch nicht genutzt'}.`
          : r
            ? `Die Testfreigabe ist abgelaufen (${dateTime(r.expiresAt)}).`
            : 'Für einen echten Test kann der Inhaber genau diesen Auftrag freigeben: einmal, 24 Stunden lang, nur mit seinen eigenen echten Angaben.'}
        {t.otherOrder ? ` Aktuell freigegeben ist ${t.otherOrder} – eine neue Freigabe ersetzt sie.` : ''}
      </p>
      <div className="os-row">
        {r?.active ? (
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => void run('vollmacht/testfreigabe', 'Testfreigabe zurückgezogen', undefined, { aktiv: false })}>
            Testfreigabe zurückziehen
          </button>
        ) : (
          <button
            type="button"
            className="os-btn os-btn--ghost"
            disabled={busy || o.data.holder.typ !== 'privat'}
            onClick={() =>
              void run(
                'vollmacht/testfreigabe',
                'Testfreigabe erteilt – jetzt die Vorschau prüfen',
                `${o.number} für genau einen echten, kostenpflichtigen Vollmachtsvorgang freigeben (24 Stunden)? Nur für einen eigenen Auftrag mit Ihren eigenen echten Angaben verwenden. Angefordert wird erst nach Vorschau und ausdrücklicher Bestätigung.`,
                { aktiv: true },
              )
            }
          >
            Testfreigabe für diesen Auftrag erteilen
          </button>
        )}
      </div>
    </div>
  );
}

/** Bestätigung vor dem Anlegen: Angaben, SEPA-Wahl, Kosten und Hinweise – angefordert wird nur genau dieser Stand (Prüfsumme) */
function PoaConfirm({ orderId, onCancel, onDone }: { orderId: number; onCancel: () => void; onDone: (ok: boolean, text: string) => Promise<void> }) {
  const [sepa, setSepa] = useState(false);
  const [preview, setPreview] = useState<PoaPreview | null>(null);
  const [error, setError] = useState<{ text: string; reasons: string[] } | null>(null);
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const load = async (withSepa: boolean) => {
    setPreview(null);
    setChecked(false);
    try {
      const r = await osFetch<{ ok: true; preview: PoaPreview }>(`orders/${orderId}/vollmacht/vorschau`, { method: 'POST', body: { sepa: withSepa } });
      setPreview(r.preview);
      setError(null);
    } catch (e) {
      const d = e instanceof OsError ? e.data : {};
      setError({ text: (e as Error).message, reasons: Array.isArray(d.reasons) ? d.reasons.map(String) : [] });
    }
  };
  useEffect(() => {
    void load(sepa);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, sepa]);
  const send = async () => {
    if (!preview || sending) return;
    setSending(true);
    try {
      const r = await osFetch<{ ok: true; reused: boolean; poa: PoaView }>(`orders/${orderId}/vollmacht`, {
        method: 'POST',
        body: { sepa: preview.sepa.chosen, fingerprint: preview.fingerprint, bestaetigt: true },
      });
      await onDone(true, r.reused ? 'Bestehender Vorgang verwendet – keine weiteren Kosten' : `Digitale Vollmacht angefordert (Vorgang ${r.poa.processId ?? '–'})`);
    } catch (e) {
      if (e instanceof OsError && e.status === 409) await load(sepa);
      await onDone(false, (e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="poa-confirm" aria-label="Digitale Vollmacht anfordern – Bestätigung">
      <h4>Vor dem Anfordern prüfen</h4>
      {error ? (
        <div className="os-flash is-error">
          {error.text}
          {error.reasons.length ? (
            <ul>
              {error.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : !preview ? (
        <p className="os-muted os-small">Vorschau wird erstellt …</p>
      ) : (
        <>
          {preview.mode === 'test' ? <p className="os-flash is-warn">Testmodus: Echter, rechtsverbindlicher und kostenpflichtiger Vorgang beim Partner – nur für diesen freigegebenen Auftrag.</p> : null}
          <dl className="os-dl os-small">
            {preview.details.map((d) => (
              <Fragment key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </Fragment>
            ))}
            <dt>Unterschriftslink</dt>
            <dd>{preview.sendEmail ? 'per E-Mail durch den Partner (in Ihrer Marke)' : 'keine E-Mail – Link im OS kopieren'}</dd>
            <dt>Kosten</dt>
            <dd>
              <strong>
                {euro(preview.costs.netCents)} netto ({euro(preview.costs.grossCents)} brutto)
              </strong>{' '}
              <span className="os-muted">laut {preview.costs.source}</span>
            </dd>
          </dl>
          <label className="os-check-field">
            <input type="checkbox" checked={sepa} disabled={!preview.sepa.available && !sepa} onChange={(e) => setSepa(e.target.checked)} /> SEPA-Lastschriftmandat für die Kfz-Steuer (Zoll)
            mit unterschreiben
            {preview.sepa.available ? ` – Konto ${preview.sepa.ibanMasked}, Inhaber ${preview.sepa.accountHolder}` : ` – nicht möglich: ${preview.sepa.reason}`}
          </label>
          <ul className="poa-confirm__notices">
            {preview.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <label className="os-check-field">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Ich habe Angaben, Kosten und Hinweise geprüft und fordere genau diesen
            kostenpflichtigen, rechtsverbindlichen Vorgang an.
          </label>
        </>
      )}
      <div className="os-row">
        <button type="button" className="os-btn os-btn--ghost" disabled={sending} onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="os-btn" disabled={!preview || !checked || sending || !!error} onClick={() => void send()}>
          {sending ? 'Wird angefordert …' : preview ? `Jetzt kostenpflichtig anfordern (${euro(preview.costs.netCents)} netto)` : 'Jetzt kostenpflichtig anfordern'}
        </button>
      </div>
    </section>
  );
}

/* ---------- Unterlagen ---------- */

function DocsTab({ data, busy, act, reload, flash }: { data: OrderBundle; busy: boolean; act: Act; reload: () => void; flash: (ok: boolean, t: string) => void }) {
  const o = data.order;
  const [preview, setPreview] = useState<{ url: string; mime: string; name: string } | null>(null);
  const [kind, setKind] = useState('');
  const [uploading, setUploading] = useState(false);
  const upload = async (files: File[]) => {
    setUploading(true);
    try {
      const r = await uploadFiles(o.id, files, { kind });
      const bad = r.filter((x) => !x.ok);
      flash(!bad.length, bad.length ? `${bad.length} Datei(en) abgelehnt: ${bad.map((b) => `${b.name}: ${b.error}`).join('; ')}` : `${r.length} Datei(en) hochgeladen`);
      reload();
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setUploading(false);
    }
  };
  const review = async (docId: string, state: string) => {
    try {
      await osFetch(`documents/${docId}`, { method: 'POST', body: { review_state: state } });
      flash(true, state ? 'Prüfvermerk gespeichert' : 'Prüfvermerk entfernt');
      reload();
    } catch (e) {
      flash(false, (e as Error).message);
    }
  };
  return (
    <div className="os-grid os-grid--detail">
      <Panel title={`Checkliste · ${data.checklistProgress.done}/${data.checklistProgress.total}`}>
        <ul className="os-checklist" role="list">
          {o.checklistItems.map((item) => {
            const st = o.checklist[item.key];
            const checked = st?.checked === true;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  className={checked ? 'is-checked' : ''}
                  aria-pressed={checked}
                  disabled={busy || !data.canWrite}
                  onClick={() => void act({ type: 'checklist', key: item.key, checked: !checked }, checked ? `„${item.label}“ offen` : `„${item.label}“ abgehakt`)}
                >
                  <span className="os-check" aria-hidden="true" />
                  <span>
                    {item.label}
                    {!item.required ? <span className="os-muted"> (optional)</span> : null}
                  </span>
                  {st ? <time className="os-muted">{dateTime(st.at)}</time> : null}
                </button>
              </li>
            );
          })}
        </ul>
      </Panel>
      <Panel title={`Dokumente (${data.documents.length})`}>
        {!data.canDocs ? (
          <p className="os-muted">Ihre Rolle darf Dokumente nicht öffnen.</p>
        ) : (
          <>
            {data.documents.length ? (
              <ul className="os-files" role="list">
                {data.documents.map((d) => (
                  <li key={d.id}>
                    <button type="button" className={preview?.url === d.url ? 'is-sel' : ''} onClick={() => setPreview({ url: d.url, mime: d.mime, name: d.display_name || d.original_name })}>
                      <Badge tone="blue">{DOCUMENTS[d.kind as keyof typeof DOCUMENTS]?.short ?? 'Datei'}</Badge>
                      <span className="os-files__name">{d.display_name || d.original_name}</span>
                      {d.version && d.version > 1 ? <span className="os-muted os-small">v{d.version}</span> : null}
                      <span className="os-muted os-small">{bytes(d.size)}</span>
                    </button>
                    {data.canDocsWrite ? (
                      <select className="os-select os-select--sm" value={d.review_state ?? ''} onChange={(e) => void review(d.id, e.target.value)} aria-label="Prüfvermerk">
                        <option value="">ungeprüft</option>
                        <option value="geprueft">geprüft ✓</option>
                        <option value="unleserlich">unleserlich</option>
                        <option value="abgelaufen">abgelaufen</option>
                        <option value="falsch">falsches Dokument</option>
                      </select>
                    ) : d.review_state ? (
                      <Badge tone={d.review_state === 'geprueft' ? 'green' : 'amber'}>{d.review_state}</Badge>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <Empty title="Keine Dokumente" />
            )}
            {data.canDocsWrite ? (
              <div className="os-stack">
                <label className="os-field os-field--inline">
                  <span className="os-field__label">Art</span>
                  <select className="os-select" value={kind} onChange={(e) => setKind(e.target.value)}>
                    <option value="">Sonstiges</option>
                    {DOCUMENT_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DOCUMENTS[k].label}
                      </option>
                    ))}
                  </select>
                </label>
                <DropZone onFiles={(f) => void upload(f)} disabled={uploading} label={uploading ? 'Wird hochgeladen …' : 'Dateien hierher ziehen oder klicken'} />
              </div>
            ) : null}
            {preview ? <Preview {...preview} /> : null}
          </>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Zahlung & Rechnung ---------- */

const PROVIDER_LABEL: Record<string, string> = { stripe: 'Stripe', mollie: 'Mollie', manuell: 'manuell' };
const ATTEMPT_TONE: Record<string, string> = {
  paid: 'green',
  open: 'blue',
  pending: 'amber',
  authorized: 'amber',
  failed: 'red',
  canceled: 'slate',
  expired: 'slate',
  '': 'slate',
};
const ATTEMPT_LABEL: Record<string, string> = {
  paid: 'bezahlt',
  open: 'offen',
  pending: 'wird bestätigt',
  authorized: 'autorisiert',
  failed: 'fehlgeschlagen',
  canceled: 'abgebrochen',
  expired: 'abgelaufen',
  '': 'nicht angelegt',
};

/** Online-Zahlung über Mollie: alle Versuche mit dem über die API bestätigten Stand */
function OnlinePaymentPanel({ data, reload, flash }: { data: OrderBundle; reload: () => void; flash: (ok: boolean, t: string) => void }) {
  const [busy, setBusy] = useState(false);
  const list = data.paymentAttempts;
  const o = data.order;
  const canTest = data.mollieTest.canStart && o.payment_status === 'offen' && o.status !== 'storniert' && o.total_cents > 0;
  if (!list.length && !canTest) return null;
  const startTest = async () => {
    const live = data.mollieMode === 'live';
    if (
      !window.confirm(
        `Testzahlung für ${o.number} im Mollie-Testmodus starten? Es wird kein echtes Geld bewegt.${live ? ' Der Auftrag bleibt „Zahlung offen“, es laufen keine Automatisierungen.' : ''} Der Testcheckout öffnet sich in einem neuen Tab – dort den gewünschten Status wählen.`,
      )
    )
      return;
    setBusy(true);
    try {
      const r = await osFetch<{ checkoutUrl: string; reused: boolean }>(`orders/${o.id}/zahlung/test`, { method: 'POST', body: {} });
      window.open(r.checkoutUrl, '_blank', 'noopener');
      flash(true, r.reused ? 'Offene Testzahlung fortgesetzt – Testcheckout geöffnet' : 'Testzahlung angelegt – Testcheckout geöffnet');
      reload();
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const sync = async () => {
    setBusy(true);
    try {
      const r = await osFetch<{ changed: boolean; attempt: AttemptView }>(`orders/${data.order.id}/zahlung/abgleich`, { method: 'POST', body: {} });
      flash(true, r.changed ? `Stand übernommen: ${ATTEMPT_LABEL[r.attempt.status]}` : 'Stand bei Mollie abgefragt – unverändert');
      reload();
    } catch (e) {
      flash(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel title="Online-Zahlung (Mollie)" actions={list.some((a) => a.mode === 'test') ? <Badge tone="amber">Testmodus</Badge> : null}>
      {!list.length ? <p className="os-muted os-small">Noch keine Online-Zahlung zu diesem Auftrag.</p> : null}
      {list.length ? (
        <table className="os-table os-table--compact">
          <tbody>
            {list.map((a) => (
              <tr key={a.id}>
                <td>
                  Versuch {a.attempt}
                  <span className="os-muted os-small"> · {a.paymentId ?? 'ohne Zahlungs-ID'}</span>
                </td>
                <td>
                  <Badge tone={ATTEMPT_TONE[a.status] ?? 'slate'}>{ATTEMPT_LABEL[a.status] ?? a.status}</Badge>
                  {a.method ? <span className="os-muted os-small"> · {a.method}</span> : null}
                </td>
                <td className="num">{euro(a.amountCents)}</td>
                <td className="os-muted os-small">{a.checkedAt ? `geprüft ${dateTime(a.checkedAt)}` : dateTime(a.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {list.map((a) =>
        a.mismatch ? (
          <p key={`m${a.id}`} className="os-flash is-error">
            Versuch {a.attempt}: {a.mismatch} – nicht als bezahlt übernommen.
          </p>
        ) : null,
      )}
      {list[0]?.createError ? <p className="os-flash is-warn">Anlage: {list[0].createError}</p> : null}
      {list[0]?.checkError ? <p className="os-flash is-warn">Letzte Abfrage: {list[0].checkError}</p> : null}
      <p className="os-muted os-small">Maßgeblich ist der über die Mollie-API bestätigte Stand. Webhook und Rückleitung stoßen nur einen Abgleich an.</p>
      <div className="os-row">
        {list.some((a) => a.paymentId) ? (
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => void sync()}>
            Stand bei Mollie abfragen
          </button>
        ) : null}
        {canTest ? (
          <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => void startTest()}>
            Testzahlung starten (Mollie-Testmodus)
          </button>
        ) : null}
      </div>
    </Panel>
  );
}

function PaymentTab({ data, busy, act, reload, flash }: { data: OrderBundle; busy: boolean; act: Act; reload: () => void; flash: (ok: boolean, t: string) => void }) {
  const o = data.order;
  const [pay, setPay] = useState<PaymentStatus>(o.payment_status);
  const [ref, setRef] = useState('');
  const [adj, setAdj] = useState<{ mode: 'voucher' | 'percent' | 'cents'; value: string; reason: string }>({ mode: 'voucher', value: '', reason: '' });
  useEffect(() => setPay(o.payment_status), [o.payment_status]);
  const invoice = async () => {
    try {
      const r = await osFetch<{ number: string }>('finance/invoices', { method: 'POST', body: { orderId: o.id } });
      flash(true, `Rechnung ${r.number} erstellt`);
      reload();
    } catch (e) {
      flash(false, (e as Error).message);
    }
  };
  const fees = data.payments.reduce((a, p) => a + (p.fee_cents ?? 0), 0);
  return (
    <div className="os-grid os-grid--detail">
      <div className="os-stack">
        <OnlinePaymentPanel data={data} reload={reload} flash={flash} />
        <Panel title="Preis" actions={<Badge tone={o.payment_status === 'bezahlt' ? 'green' : o.payment_status === 'erstattet' ? 'slate' : 'amber'}>{PAYMENT_STATUS_LABEL[o.payment_status]}</Badge>}>
          <table className="os-table os-table--compact">
            <tbody>
              {o.price.lines.map((l) => (
                <tr key={l.key}>
                  <td>{l.label}</td>
                  <td className="num">{euro(l.cents)}</td>
                </tr>
              ))}
              {data.payments
                .filter((p) => p.kind === 'preis_anpassung')
                .map((p) => (
                  <tr key={p.id}>
                    <td>{p.note}</td>
                    <td className="num">{euro(p.amount_cents)}</td>
                  </tr>
                ))}
              <tr>
                <th scope="row">Gesamt (brutto)</th>
                <th className="num">{euro(o.total_cents)}</th>
              </tr>
              {data.canFinance ? (
                <tr>
                  <td className="os-muted">Zahlungsgebühren (Ist)</td>
                  <td className="num os-muted">{data.payments.some((p) => p.fee_cents !== null) ? euro(fees) : 'noch nicht bekannt'}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
          {data.canPayment ? (
            <form
              className="os-inline"
              onSubmit={(e) => {
                e.preventDefault();
                void act({ type: 'payment', status: pay, ref }, `Zahlung: ${PAYMENT_STATUS_LABEL[pay]}`).then((ok) => ok && setRef(''));
              }}
            >
              <select className="os-select" value={pay} onChange={(e) => setPay(e.target.value as PaymentStatus)} aria-label="Zahlungsstatus">
                {PAYMENT_STATUS.map((s) => (
                  <option key={s} value={s}>
                    {PAYMENT_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Referenz (z. B. Überweisung)" maxLength={80} aria-label="Referenz" />
              <button type="submit" className="os-btn os-btn--sm" disabled={busy || pay === o.payment_status}>
                Buchen
              </button>
            </form>
          ) : null}
        </Panel>
        {data.canPayment && o.payment_status === 'offen' ? (
          <Panel title="Preis anpassen (Gutschein, Geschäftskunde, Kulanz)">
            <form
              className="os-form"
              onSubmit={(e) => {
                e.preventDefault();
                const body: Record<string, unknown> = { type: 'adjustPrice', reason: adj.reason };
                if (adj.mode === 'voucher') body.voucher = adj.value;
                if (adj.mode === 'percent') body.percent = Number(adj.value.replace(',', '.'));
                if (adj.mode === 'cents') body.cents = Math.round(Number(adj.value.replace(',', '.')) * 100);
                void act(body, 'Preis angepasst').then((ok) => ok && setAdj({ ...adj, value: '', reason: '' }));
              }}
            >
              <div className="os-inline">
                <select className="os-select" value={adj.mode} onChange={(e) => setAdj({ ...adj, mode: e.target.value as typeof adj.mode })}>
                  <option value="voucher">Gutscheincode</option>
                  <option value="percent">Rabatt in %</option>
                  <option value="cents">Betrag ± in €</option>
                </select>
                <input value={adj.value} onChange={(e) => setAdj({ ...adj, value: e.target.value })} placeholder={adj.mode === 'voucher' ? 'CODE' : adj.mode === 'percent' ? '10' : '-5,00'} aria-label="Wert" />
              </div>
              {adj.mode !== 'voucher' ? <input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} placeholder="Begründung (z. B. Geschäftskundenpreis, Mengenrabatt, Kulanz)" aria-label="Begründung" /> : null}
              <button type="submit" className="os-btn os-btn--sm" disabled={busy || !adj.value || (adj.mode !== 'voucher' && !adj.reason.trim())}>
                Anwenden
              </button>
            </form>
          </Panel>
        ) : null}
      </div>
      <div className="os-stack">
        {data.canFinance ? (
          <Panel
            title="Rechnungen"
            actions={
              data.canPayment && !data.invoices.some((i) => i.kind === 'rechnung' && !i.corrected) && o.status !== 'storniert' ? (
                <button type="button" className="os-btn os-btn--sm" onClick={() => void invoice()}>
                  Rechnung erstellen
                </button>
              ) : null
            }
          >
            {data.invoices.length ? (
              <ul className="os-plain" role="list">
                {data.invoices.map((i) => (
                  <li key={i.id} className="os-row">
                    <a className="os-link os-mono" href={`/admin/rechnungen/${i.id}`} target="_blank" rel="noopener">
                      {i.number}
                    </a>
                    <Badge tone={i.kind === 'gutschrift' ? 'amber' : i.corrected ? 'slate' : 'green'}>{i.kind === 'gutschrift' ? 'Gutschrift' : i.corrected ? 'korrigiert' : 'Rechnung'}</Badge>
                    <span className="os-muted os-small">
                      {dateOnly(i.issued_at)} · {euro(i.gross_cents)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="os-muted">Noch keine Rechnung.</p>
            )}
          </Panel>
        ) : null}
        {data.canFinance ? (
          <Panel title="Buchungen">
            {data.payments.length ? (
              <table className="os-table os-table--compact">
                <tbody>
                  {data.payments.map((p) => (
                    <tr key={p.id}>
                      <td>{dateTime(p.at)}</td>
                      <td>
                        {PROVIDER_LABEL[p.provider] ?? p.provider} · {p.kind.replace('_', ' ')} · {p.status}
                        {p.method ? ` · ${p.method}` : ''}
                        {p.note ? <span className="os-muted"> · {p.note}</span> : null}
                      </td>
                      <td className="num">{euro(p.amount_cents)}</td>
                      <td className="num os-muted">{p.fee_cents === null ? '' : `Gebühr ${euro(p.fee_cents)}`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="os-muted">Keine Buchungen.</p>
            )}
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

/* ---------- KFZ-API ---------- */

function KfzTab({ data, busy, act }: { data: OrderBundle; busy: boolean; act: Act }) {
  const { openApp } = useOs();
  const k = data.kfz;
  const [link, setLink] = useState(k?.kfzOrderId ?? '');
  const tx = k?.transaction ? BUSINESS_TRANSACTIONS[k.transaction as keyof typeof BUSINESS_TRANSACTIONS] : null;
  const timeline = useOsData<{ event_id: string; received_at: string; deliveries: number; outcome: string; status: string; derived_status: string; error: string }[]>(`kfz/order/${data.order.id}`);
  return (
    <div className="os-grid os-grid--detail">
      <Panel title="Zulassung über kfz-api.de" actions={<KfzState display={k?.display ?? ''} />}>
        {k && (k.kfzOrderId || k.status) ? (
          <dl className="os-dl">
            <dt>Vorgang</dt>
            <dd className="os-mono">{k.kfzOrderId || '–'}</dd>
            <dt>Vorgangsart</dt>
            <dd>{k.transaction ? `${k.transaction} · ${tx?.label ?? ''}` : '–'}</dd>
            <dt>Letzter Status</dt>
            <dd className="os-mono">{k.status || '–'}</dd>
            <dt>Aktualisiert</dt>
            <dd>{dateTime(k.updatedAt)}</dd>
          </dl>
        ) : (
          <p className="os-muted">Noch keine Meldung. Zuordnung über die Auftragsnummer (externalId) oder hier die Vorgangsnummer verknüpfen.</p>
        )}
        {data.canKfz ? (
          <form
            className="os-inline"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ type: 'kfzLink', kfzOrderId: link }, 'Vorgang verknüpft');
            }}
          >
            <input className="os-mono" value={link} onChange={(e) => setLink(e.target.value)} placeholder="Vorgangsnummer bei kfz-api.de" aria-label="Vorgangsnummer" maxLength={80} />
            <button type="submit" className="os-btn os-btn--sm" disabled={busy || !link.trim()}>
              Verknüpfen
            </button>
          </form>
        ) : null}
        <h4 className="os-subhead">Statusverlauf</h4>
        {timeline.data?.length ? (
          <ol className="os-log" role="list">
            {timeline.data.map((e) => (
              <li key={e.event_id}>
                <time>{dateTime(e.received_at)}</time>
                <span>
                  <span className="os-mono">{e.status || e.derived_status || 'PING'}</span> · {e.outcome}
                  {e.deliveries > 1 ? <span className="os-muted"> · {e.deliveries}× zugestellt</span> : null}
                  {e.error ? <span className="os-muted"> · {e.error}</span> : null}
                </span>
                <span />
              </li>
            ))}
          </ol>
        ) : (
          <p className="os-muted os-small">Keine Webhook-Meldungen zu diesem Auftrag.</p>
        )}
        <button type="button" className="os-linkbtn os-small" onClick={() => openApp('kfz')}>
          Im KFZ-API Center öffnen
        </button>
      </Panel>
      <div className="os-stack">
        <Panel title="Meldungen der Behörde">
          {k?.messages.length ? (
            <ul className="os-plain" role="list">
              {k.messages.map((m, i) => (
                <li key={i}>
                  {m.code ? <span className="os-mono">{m.code} </span> : null}
                  {m.text}
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-muted">Keine Meldungen.</p>
          )}
        </Panel>
        <Panel title="Belege / Bescheide">
          {k?.files.length ? (
            <ul className="os-plain" role="list">
              {k.files.map((f) => (
                <li key={f.fileAccessKey}>
                  <a className="os-link" href={`/api/admin/kfz-belege?auftrag=${data.order.id}&key=${encodeURIComponent(f.fileAccessKey)}`} target="_blank" rel="noopener">
                    {f.purposeType || 'Beleg'}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-muted">Keine Belege.</p>
          )}
        </Panel>
        <Panel title="Kundenbenachrichtigungen (automatisch)">
          {k?.notifications.length ? (
            <ul className="os-plain" role="list">
              {k.notifications.map((n, i) => (
                <li key={i}>
                  {dateTime(n.at)} · {n.subject}{' '}
                  <Badge tone={n.state === 'versendet' ? 'green' : n.state === 'fehler' ? 'red' : 'amber'}>{n.state === 'versendet' ? 'versendet' : n.state === 'fehler' ? 'Fehler' : 'nicht versendet'}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-muted">Keine.</p>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------- Kommunikation ---------- */

const MAIL_STATE: Record<string, { label: string; tone: string }> = {
  versendet: { label: 'versendet', tone: 'green' },
  entwurf: { label: 'Entwurf', tone: 'blue' },
  wartet: { label: 'wartet', tone: 'blue' },
  wird_versendet: { label: 'wird versendet', tone: 'blue' },
  zurueckgehalten: { label: 'zurückgehalten', tone: 'amber' },
  fehler: { label: 'Fehler – Wiederholung geplant', tone: 'red' },
  aufgegeben: { label: 'fehlgeschlagen', tone: 'red' },
  nicht_versendet: { label: 'nicht versendet', tone: 'amber' },
};

function CommTab({ data, reload }: { data: OrderBundle; reload: () => void }) {
  const { openApp } = useOs();
  const m = data.messages;
  const flash = useFlash();
  const [busy, setBusy] = useState(0);
  const release = async (id: number, label: string) => {
    if (!window.confirm(`${label}: Diese E-Mail jetzt an den Kunden senden?`)) return;
    setBusy(id);
    try {
      const r = await osFetch<{ state: string; providerId: string }>(`messages/${id}/senden`, { method: 'POST', body: {} });
      flash.show(true, `Versendet${r.providerId ? ` (Nachweis ${r.providerId})` : ''}`);
      reload();
    } catch (e) {
      flash.show(false, (e as Error).message);
    } finally {
      setBusy(0);
    }
  };
  return (
    <div className="os-stack">
      {flash.node}
      <div className="os-row">
        {data.canMessages ? (
          <button type="button" className="os-btn os-btn--sm" onClick={() => openApp('messages', { compose: data.order.id })}>
            Neue E-Mail an den Kunden
          </button>
        ) : null}
        <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={reload}>
          Aktualisieren
        </button>
        {m && !m.mailReady ? <span className="os-muted os-small">E-Mail-Versand ist nicht eingerichtet – Nachrichten bleiben Entwürfe.</span> : null}
      </div>
      <Panel title="Nachrichten">
        {m?.messages.length ? (
          <ul className="os-msglist" role="list">
            {m.messages.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => openApp('messages', { messageId: x.id })}>
                  <Badge tone={MAIL_STATE[x.state]?.tone ?? 'red'}>{MAIL_STATE[x.state]?.label ?? x.state}</Badge>
                  <strong>{x.subject}</strong>
                  <span className="os-muted os-small">
                    {dateTime(x.at)} · {x.author}
                    {x.source === 'automatisierung' ? ' · automatisch vorbereitet' : ''}
                    {x.automatic ? ` · automatisch${x.attempts ? ` · ${x.attempts} Versuch${x.attempts === 1 ? '' : 'e'}` : ''}` : ''}
                    {x.provider_id ? ` · Nachweis ${x.provider_id}` : ''}
                    {x.error ? ` · ${x.error}` : ''}
                  </span>
                </button>
                {x.automatic && data.canMessages && ['zurueckgehalten', 'fehler', 'aufgegeben', 'nicht_versendet'].includes(x.state) ? (
                  <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy === x.id} onClick={() => void release(x.id, x.state === 'zurueckgehalten' ? 'Freigeben' : 'Erneut senden')}>
                    {x.state === 'zurueckgehalten' ? 'Freigeben und senden' : 'Erneut senden'}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-muted">Keine eigenen Nachrichten.</p>
        )}
      </Panel>
      <Panel title="Statusmails (Kurzprotokoll kfz-api.de)">
        {m?.statusMails.length ? (
          <ul className="os-plain" role="list">
            {m.statusMails.map((x) => (
              <li key={x.id}>
                {dateTime(x.at)} · {x.subject} <Badge tone={x.state === 'versendet' ? 'green' : x.state === 'fehler' ? 'red' : 'amber'}>{x.state}</Badge>
                {x.error ? <span className="os-muted"> {x.error}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-muted">Keine.</p>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Aufgaben ---------- */

function TasksTab({ data, reload }: { data: OrderBundle; reload: () => void }) {
  const { openApp } = useOs();
  const staff = useStaff();
  const [title, setTitle] = useState('');
  const [assignee, setAssignee] = useState<number | null>(data.order.assignee_id);
  const [due, setDue] = useState('');
  const flash = useFlash();
  return (
    <div className="os-stack">
      {flash.node}
      <Panel title="Neue Aufgabe zu diesem Auftrag">
        <form
          className="os-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await osFetch('tasks', { method: 'POST', body: { title, assignee_id: assignee, order_id: data.order.id, due_at: fromDateInput(due) } });
              setTitle('');
              setDue('');
              flash.show(true, 'Aufgabe angelegt');
              reload();
            } catch (err) {
              flash.show(false, (err as Error).message);
            }
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Kunde wegen ZB II anrufen" aria-label="Titel" maxLength={200} />
          <StaffSelect value={assignee} onChange={setAssignee} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Fällig" />
          <button type="submit" className="os-btn os-btn--sm" disabled={title.trim().length < 2}>
            Anlegen
          </button>
        </form>
      </Panel>
      <Panel title="Aufgaben">
        {data.tasks.length ? (
          <ul className="os-msglist" role="list">
            {data.tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => openApp('tasks', { taskId: t.id })}>
                  <Badge tone={t.status === 'erledigt' ? 'green' : t.status === 'abgebrochen' ? 'slate' : 'blue'}>{t.status.replace('_', ' ')}</Badge>
                  <strong>{t.title}</strong>
                  <span className="os-muted os-small">
                    {staffName(staff, t.assignee_id)}
                    {t.due_at ? ` · fällig ${dateOnly(t.due_at)}` : ''}
                  </span>
                  <PriorityBadge value={t.priority} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-muted">Keine Aufgaben.</p>
        )}
      </Panel>
    </div>
  );
}

/* ---------- Notizen & Verlauf ---------- */

const OS_EVENT_LABEL: Record<string, string> = {
  'order.created': 'Auftrag eingegangen',
  'order.status': 'Status geändert',
  'order.assigned': 'Zugewiesen',
  'order.released': 'Zur Übermittlung freigegeben',
  'order.overdue': 'Frist überschritten',
  'order.followup': 'Wiedervorlage ausgelöst',
  'payment.paid': 'Zahlung eingegangen',
  'payment.failed': 'Zahlung fehlgeschlagen',
  'payment.refunded': 'Erstattet',
  'kfz.status': 'KFZ-API-Status',
  'kfz.problem': 'KFZ-API-Problem',
  'task.created': 'Aufgabe angelegt',
  'customer.returning': 'Bestandskunde erkannt',
  'customer.created': 'Kunde angelegt',
  'document.uploaded': 'Dokument hochgeladen',
  'document.reviewed': 'Dokument geprüft',
  'message.sent': 'E-Mail versendet',
  'message.failed': 'E-Mail fehlgeschlagen',
  'message.prepared': 'E-Mail vorbereitet',
  'invoice.issued': 'Rechnung erstellt',
};

function LogTab({ data, busy, act }: { data: OrderBundle; busy: boolean; act: Act }) {
  const [text, setText] = useState('');
  const [view, setView] = useState<'verlauf' | 'ereignisse'>('verlauf');
  const events = useMemo(() => [...data.events].sort((a, b) => b.at.localeCompare(a.at)), [data.events]);
  const o = data.order;
  return (
    <div className="os-grid os-grid--detail">
      <Panel title={`Interne Notizen (${data.notes.length})`}>
        {data.canWrite ? (
          <form
            className="os-form"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await act({ type: 'note', text }, 'Notiz gespeichert')) setText('');
            }}
          >
            <textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} placeholder="Nur intern sichtbar" aria-label="Neue Notiz" />
            <button type="submit" className="os-btn os-btn--sm" disabled={busy || !text.trim()}>
              Notiz speichern
            </button>
          </form>
        ) : null}
        <ul className="os-notes-list" role="list">
          {data.notes.map((n) => (
            <li key={n.id}>
              <p>{n.text}</p>
              <span className="os-notes-list__meta">
                <time className="os-muted os-small">
                  {dateTime(n.at)}
                  {n.author ? ` · ${n.author}` : ''}
                </time>
                {data.canWrite ? (
                  <button type="button" className="os-linkbtn os-small" disabled={busy} onClick={() => void act({ type: 'noteDelete', noteId: n.id }, 'Notiz in den Papierkorb verschoben')}>
                    In den Papierkorb
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel
        title="Änderungsverlauf"
        actions={
          <Tabs<'verlauf' | 'ereignisse'>
            value={view}
            onChange={setView}
            tabs={[
              { id: 'verlauf', label: 'Auftrag' },
              { id: 'ereignisse', label: 'Systemereignisse' },
            ]}
          />
        }
      >
        {view === 'verlauf' ? (
          <ol className="os-log" role="list">
            {events.map((ev) => (
              <li key={ev.id}>
                <time>{dateTime(ev.at)}</time>
                <span>
                  {ev.type === 'status' && ev.from_status && ev.to_status ? `${statusLabel(ev.from_status, o.service)} → ${statusLabel(ev.to_status, o.service)}` : ev.message}
                  {ev.type === 'status' && ev.message ? <span className="os-muted"> · {ev.message}</span> : null}
                  {ev.public_message ? <span className="os-log__public">An Kunden: {ev.public_message}</span> : null}
                </span>
                <span className="os-muted os-small">{ev.actor}</span>
              </li>
            ))}
          </ol>
        ) : (
          <ol className="os-log" role="list">
            {data.osEvents.map((ev) => (
              <li key={ev.id}>
                <time>{dateTime(ev.at)}</time>
                <span>{OS_EVENT_LABEL[ev.type] ?? ev.type}</span>
                <span className="os-muted os-small">{ev.actor}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </div>
  );
}
