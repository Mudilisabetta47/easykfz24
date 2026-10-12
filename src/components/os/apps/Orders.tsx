'use client';

// Auftragscenter (ERP für Zulassungen): Liste mit erweiterten Filtern, Kanban nach Arbeitsphasen, Sammelaktionen,
// Export, Anlegen/Duplizieren, Auftragsakte. Jede Änderung geht über die serverseitig geprüfte Schnittstelle.

import { useEffect, useMemo, useState } from 'react';
import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { SERVICE_IDS, SERVICES } from '../../../lib/services.ts';
import { STATUS_IDS, STATUSES } from '../../../lib/status.ts';
import { SIDE_STAGES, STAGE_META, STAGES, type Stage } from '../../../lib/workflow.ts';
import type { OrderListRow } from '../../../server/os/order-query.ts';
import { dateTime, euro, osFetch, relTime, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh, ISearch } from '../icons.tsx';
import { Chips, dateOnly, ExportMenu, IssueDot, isOverdue, PRIORITY_LABEL, PriorityBadge, StaffSelect, StageBadge, staffName, useStaff } from '../shared.tsx';
import { Empty, ErrorBox, KfzState, Loading, StatusBadge, useFlash } from '../ui.tsx';
import { OrderDetailView } from './OrderDetail.tsx';
import { OrderForm } from './OrderForm.tsx';

export type { OrderBundle } from './OrderDetail.tsx';

interface Filters {
  q: string;
  status: string;
  stage: string;
  service: string;
  payment: string;
  assignee: string;
  priority: string;
  from: string;
  to: string;
  overdue: boolean;
  issues: boolean;
}
const EMPTY: Filters = { q: '', status: 'laufend', stage: '', service: '', payment: '', assignee: '', priority: '', from: '', to: '', overdue: false, issues: false };

function toQuery(f: Filters, extra: Record<string, string | number | undefined> = {}): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(f)) {
    if (typeof v === 'boolean') {
      if (v) p.set(k, '1');
    } else if (v) p.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) if (v !== undefined && v !== '') p.set(k, String(v));
  return p.toString();
}

export function OrdersApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { can } = useOs();
  const [view, setView] = useState<'liste' | 'kanban'>('liste');
  const [f, setF] = useState<Filters>(() => ({ ...EMPTY, status: typeof params?.status === 'string' ? params.status : EMPTY.status }));
  const [debouncedQ, setDebouncedQ] = useState('');
  const [selected, setSelected] = useState<number | null>((params?.orderId as number) ?? null);
  const [tab, setTab] = useState<string | undefined>(params?.tab as string | undefined);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [form, setForm] = useState<{ initial: Record<string, unknown> | null } | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const flash = useFlash();
  const staff = useStaff();

  useEffect(() => {
    if (typeof params?.orderId === 'number') {
      setSelected(params.orderId);
      setTab(params.tab as string | undefined);
      setView('liste');
    }
    if (typeof params?.status === 'string' || typeof params?.stage === 'string' || params?.overdue || params?.customer) {
      setF({ ...EMPTY, status: (params.status as string) ?? (params.stage ? 'laufend' : 'alle'), stage: (params.stage as string) ?? '', overdue: !!params.overdue, issues: !!params.issues });
      if (!params.orderId) setSelected(null);
    }
    if (params?.create) setForm({ initial: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQ(f.q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [f.q]);

  const query = toQuery({ ...f, q: debouncedQ }, { customer: params?.customer as number | undefined, limit: view === 'kanban' ? 2000 : 500 });
  const list = useOsData<OrderListRow[]>(`orders?${query}`, { pollMs: 30_000 });
  const rows = list.data ?? [];
  const active = Object.entries(f).filter(([k, v]) => k !== 'q' && k !== 'status' && v).length;

  const bulk = async (action: Record<string, unknown>, label: string) => {
    try {
      const r = await osFetch<{ done: number; failed: { id: number; error: string }[] }>('orders/bulk', { method: 'POST', body: { ids: [...checked], action } });
      flash.show(!r.failed.length, `${label}: ${r.done} erledigt${r.failed.length ? `, ${r.failed.length} nicht möglich (${r.failed[0].error})` : ''}`);
      setChecked(new Set());
      void list.reload(true);
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };

  const filterBar = (
    <div className="os-filterbar">
      <div className="os-toolbar os-toolbar--wrap">
        <label className="os-searchbox">
          <ISearch width={16} height={16} />
          <input value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} placeholder="Suchen …" title="Nummer, Name, E-Mail, FIN, Kennzeichen, Vorgangsnummer" aria-label="Aufträge durchsuchen" type="search" />
        </label>
        <select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status" className="os-select">
          <option value="laufend">Laufend</option>
          <option value="offen">Alle offenen</option>
          <option value="alle">Alle</option>
          {STATUS_IDS.map((s) => (
            <option key={s} value={s}>
              {STATUSES[s].label}
            </option>
          ))}
        </select>
        <button type="button" className={`os-btn os-btn--ghost os-btn--sm${showFilters || active ? ' is-on' : ''}`} onClick={() => setShowFilters((v) => !v)} aria-expanded={showFilters}>
          Filter{active ? ` (${active})` : ''}
        </button>
        <Chips
          value={view}
          onChange={setView}
          options={[
            { id: 'liste', label: 'Liste' },
            { id: 'kanban', label: 'Kanban' },
          ]}
        />
        <button type="button" className="os-iconbtn" onClick={() => void list.reload()} aria-label="Aktualisieren" title="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
        <ExportMenu base="orders/export" query={query} />
        {can('orders.write') ? (
          <button type="button" className="os-btn os-btn--sm" onClick={() => setForm({ initial: null })}>
            + Neuer Auftrag
          </button>
        ) : null}
      </div>
      {showFilters ? (
        <div className="os-toolbar os-toolbar--wrap os-toolbar--sub">
          <select className="os-select" value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value })} aria-label="Phase">
            <option value="">Alle Phasen</option>
            {[...STAGES, ...SIDE_STAGES].map((s) => (
              <option key={s} value={s}>
                {STAGE_META[s].label}
              </option>
            ))}
          </select>
          <select className="os-select" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })} aria-label="Leistung">
            <option value="">Alle Leistungen</option>
            {SERVICE_IDS.map((s) => (
              <option key={s} value={s}>
                {SERVICES[s].title}
              </option>
            ))}
          </select>
          <select className="os-select" value={f.payment} onChange={(e) => setF({ ...f, payment: e.target.value })} aria-label="Zahlung">
            <option value="">Jede Zahlung</option>
            {Object.entries(PAYMENT_STATUS_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select className="os-select" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} aria-label="Zuständig">
            <option value="">Alle Mitarbeiter</option>
            <option value="ich">Mir zugewiesen</option>
            <option value="niemand">Nicht zugewiesen</option>
            {staff.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
          <select className="os-select" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })} aria-label="Priorität">
            <option value="">Jede Priorität</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <label className="os-field os-field--inline">
            <span className="os-field__label">von</span>
            <input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          </label>
          <label className="os-field os-field--inline">
            <span className="os-field__label">bis</span>
            <input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
          </label>
          <label className="os-check-field">
            <input type="checkbox" checked={f.overdue} onChange={(e) => setF({ ...f, overdue: e.target.checked })} /> Frist überschritten
          </label>
          <label className="os-check-field">
            <input type="checkbox" checked={f.issues} onChange={(e) => setF({ ...f, issues: e.target.checked })} /> Nur mit Problemen
          </label>
          <button type="button" className="os-linkbtn" onClick={() => setF({ ...EMPTY, q: f.q })}>
            Zurücksetzen
          </button>
        </div>
      ) : null}
      {checked.size ? (
        <div className="os-bulkbar">
          <strong>{checked.size} ausgewählt</strong>
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void bulk({ type: 'status', to: 'in_pruefung' }, 'In Prüfung')}>
            → In Prüfung
          </button>
          <span className="os-row os-row--tight">
            <span className="os-small">Zuweisen:</span>
            <StaffSelect value={null} onChange={(v) => void bulk({ type: 'assign', assigneeId: v }, `Zuständig: ${staffName(staff, v)}`)} />
          </span>
          <select className="os-select" value="" onChange={(e) => e.target.value && void bulk({ type: 'priority', priority: e.target.value }, 'Priorität')} aria-label="Priorität setzen">
            <option value="">Priorität …</option>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <button type="button" className="os-linkbtn" onClick={() => setChecked(new Set())}>
            Auswahl aufheben
          </button>
        </div>
      ) : null}
    </div>
  );

  const content = list.loading && !list.data ? <Loading /> : list.error && !list.data ? <ErrorBox message={list.error} onRetry={() => void list.reload()} /> : null;

  return (
    <div className="os-app os-app--fill">
      {flash.node ? <div className="os-app__flash">{flash.node}</div> : null}
      {view === 'kanban' ? (
        <>
          {filterBar}
          {content ?? <Kanban rows={rows} onOpen={(id) => (setSelected(id), setView('liste'))} onChanged={() => void list.reload(true)} />}
        </>
      ) : (
        <div className={`os-split os-split--wide${selected ? ' has-detail' : ''}`}>
          <section className="os-split__list" aria-label="Auftragsliste">
            {filterBar}
            {content ??
              (rows.length ? (
                <ul className="os-list" role="listbox" aria-label="Aufträge" aria-multiselectable="true">
                  {rows.map((o) => (
                    <li key={o.id} role="option" aria-selected={selected === o.id}>
                      <div className={`os-list__row${selected === o.id ? ' is-sel' : ''}`}>
                        {can('orders.write') ? (
                          <input
                            type="checkbox"
                            className="os-list__check"
                            checked={checked.has(o.id)}
                            onChange={(e) => {
                              const n = new Set(checked);
                              if (e.target.checked) n.add(o.id);
                              else n.delete(o.id);
                              setChecked(n);
                            }}
                            aria-label={`${o.number} auswählen`}
                          />
                        ) : null}
                        <button type="button" onClick={() => (setSelected(o.id), setTab(undefined))}>
                          <span className="os-list__top">
                            <span className="os-mono">{o.number}</span>
                            <span className="os-row os-row--tight">
                              <PriorityBadge value={o.priority} />
                              <IssueDot issues={o.issues} />
                              <StageBadge stage={o.stage} />
                            </span>
                          </span>
                          <span className="os-list__main">{o.holder_name}</span>
                          <span className="os-list__sub">
                            {SERVICES[o.service]?.title} · {dateTime(o.created_at)}
                            {o.assigned_plate ? ` · ${o.assigned_plate}` : ''}
                          </span>
                          <span className="os-list__meta">
                            <span className="os-muted">
                              {staffName(staff, o.assignee_id)}
                              {o.due_at ? <span className={isOverdue(o.due_at) ? 'os-overdue' : ''}> · Frist {dateOnly(o.due_at)}</span> : null}
                            </span>
                            <span className="os-muted">
                              {euro(o.total_cents)} · {PAYMENT_STATUS_LABEL[o.payment_status as keyof typeof PAYMENT_STATUS_LABEL]}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty title="Keine Aufträge" text={debouncedQ || active ? 'Keine Treffer für diese Filter.' : 'In diesem Status gibt es keine Aufträge.'} />
              ))}
            {rows.length ? (
              <p className="os-listfoot">
                {rows.length} Auftrag/Aufträge
                {can('orders.write') ? (
                  <button type="button" className="os-linkbtn os-small" onClick={() => setChecked(checked.size === rows.length ? new Set() : new Set(rows.map((r) => r.id)))}>
                    {checked.size === rows.length ? 'Keine auswählen' : 'Alle auswählen'}
                  </button>
                ) : null}
              </p>
            ) : null}
          </section>
          <section className="os-split__detail" aria-label="Auftragsakte">
            {selected ? (
              <OrderDetailView id={selected} initialTab={tab} onBack={() => setSelected(null)} onChanged={() => void list.reload(true)} onDuplicate={(t) => setForm({ initial: t })} />
            ) : (
              <Empty title="Kein Auftrag ausgewählt" text="Links einen Auftrag wählen – oder mit Strg/⌘+K suchen." />
            )}
          </section>
        </div>
      )}
      {form ? (
        <OrderForm
          initial={form.initial}
          onClose={() => setForm(null)}
          onCreated={(id, number, warnings) => {
            setForm(null);
            flash.show(!warnings.length, `Auftrag ${number} angelegt${warnings.length ? ` – ${warnings.join(' ')}` : ''}`);
            setSelected(id);
            setView('liste');
            void list.reload(true);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- Kanban ---------- */

/** Welche Aktion ein Ziehen in eine Spalte auslöst (abgeleitete Spalten sind keine Ziele). */
const DROP: Partial<Record<Stage, { label: string; body: Record<string, unknown> }>> = {
  dokumente: { label: 'In Prüfung', body: { type: 'status', to: 'in_pruefung' } },
  bereit: { label: 'Freigabe', body: { type: 'release' } },
  beim_partner: { label: 'Bei Zulassungsstelle', body: { type: 'status', to: 'bei_zulassungsstelle' } },
  abgeschlossen: { label: 'Zugelassen', body: { type: 'status', to: 'zugelassen' } },
  rueckfrage: { label: 'Unterlagen fehlen', body: { type: 'status', to: 'unterlagen_fehlen' } },
};

function Kanban({ rows, onOpen, onChanged }: { rows: OrderListRow[]; onOpen: (id: number) => void; onChanged: () => void }) {
  const { can } = useOs();
  const staff = useStaff();
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<Stage | null>(null);
  const flash = useFlash();
  const columns: Stage[] = [...STAGES.filter((s) => s !== 'abgeschlossen'), 'rueckfrage', 'fehler'];
  const grouped = useMemo(() => Object.fromEntries(columns.map((c) => [c, rows.filter((r) => r.stage === c)])) as Record<Stage, OrderListRow[]>, [rows]);

  const drop = async (stage: Stage) => {
    setOver(null);
    const id = drag;
    setDrag(null);
    if (!id) return;
    const row = rows.find((r) => r.id === id);
    if (!row || row.stage === stage) return;
    const d = DROP[stage];
    if (!d) return flash.show(false, `„${STAGE_META[stage].label}“ ergibt sich automatisch (Zahlung, Checkliste bzw. Meldung von kfz-api.de)`);
    if (stage === 'bereit' && !can('kfz.write')) return flash.show(false, 'Freigeben darf Ihre Rolle nicht');
    try {
      await osFetch(`orders/${id}/action`, { method: 'POST', body: d.body });
      flash.show(true, `${row.number}: ${d.label}`);
      onChanged();
    } catch (e) {
      flash.show(false, `${row.number}: ${(e as Error).message}`);
    }
  };

  return (
    <>
      {flash.node ? <div className="os-app__flash">{flash.node}</div> : null}
      <div className="os-board">
        {columns.map((col) => (
          <section
            key={col}
            className={`os-board__col os-board__col--${col}${over === col ? ' is-over' : ''}${drag && !DROP[col] ? ' is-locked' : ''}`}
            aria-label={STAGE_META[col].label}
            onDragOver={(e) => {
              if (!can('orders.write')) return;
              e.preventDefault();
              setOver(col);
            }}
            onDragLeave={() => setOver((o) => (o === col ? null : o))}
            onDrop={(e) => {
              e.preventDefault();
              void drop(col);
            }}
          >
            <header title={STAGE_META[col].hint}>
              <strong>{STAGE_META[col].label}</strong>
              <span className="os-count">{grouped[col]?.length ?? 0}</span>
            </header>
            <ul role="list">
              {(grouped[col] ?? []).map((o) => (
                <li key={o.id}>
                  <button
                    type="button"
                    className={`os-card${drag === o.id ? ' is-dragging' : ''}`}
                    draggable={can('orders.write')}
                    onDragStart={(e) => {
                      setDrag(o.id);
                      e.dataTransfer.effectAllowed = 'move';
                    }}
                    onDragEnd={() => (setDrag(null), setOver(null))}
                    onClick={() => onOpen(o.id)}
                  >
                    <span className="os-card__top">
                      <span className="os-mono">{o.number}</span>
                      <span className="os-row os-row--tight">
                        <PriorityBadge value={o.priority} />
                        <IssueDot issues={o.issues} />
                      </span>
                    </span>
                    <strong>{o.holder_name}</strong>
                    <span className="os-muted os-small">
                      {SERVICES[o.service]?.title}
                      {o.assigned_plate ? ` · ${o.assigned_plate}` : o.previous_plate ? ` · ${o.previous_plate}` : ''}
                    </span>
                    <span className="os-card__foot">
                      <span className="os-muted os-small">{staffName(staff, o.assignee_id)}</span>
                      {o.due_at ? <span className={`os-small ${isOverdue(o.due_at) ? 'os-overdue' : 'os-muted'}`}>Frist {dateOnly(o.due_at)}</span> : <span className="os-muted os-small">{relTime(o.updated_at)}</span>}
                    </span>
                    {o.stage === 'dokumente' ? (
                      <span className="os-card__meta">
                        <span className="os-small">
                          Checkliste {o.checklist.done}/{o.checklist.total}
                        </span>
                        <span className="os-small">{o.payment_status === 'bezahlt' ? 'bezahlt' : 'Zahlung offen'}</span>
                      </span>
                    ) : null}
                    {o.kfz_display ? <KfzState display={o.kfz_display} /> : null}
                    <StatusBadge status={o.status} service={o.service} />
                  </button>
                </li>
              ))}
              {!(grouped[col] ?? []).length ? <li className="os-board__empty">{DROP[col] ? 'hierher ziehen' : 'leer'}</li> : null}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
