'use client';

// Kundenverwaltung (CRM): Kundenstamm mit Privat- und Geschäftskunden, Standorten, Ansprechpartnern, Fahrzeugen,
// Auftrags-, Dokument-, Kommunikations- und Rechnungshistorie, Dubletten, DSGVO-Auskunft und -Löschung.

import { useEffect, useState } from 'react';
import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { SERVICES, type ServiceId } from '../../../lib/services.ts';
import type { StatusId } from '../../../lib/status.ts';
import { dateTime, euro, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IChevron, IRefresh, ISearch } from '../icons.tsx';
import { dateOnly, Dialog, downloadHref, ExportMenu, PriorityBadge, StaffSelect, staffName, useStaff } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Field, KfzState, Loading, Panel, StatusBadge, Tabs, useFlash } from '../ui.tsx';

interface CustomerListRow {
  id: number;
  number: string;
  type: 'privat' | 'firma';
  name: string;
  email: string;
  phone: string;
  city: string;
  category: string;
  owner_id: number | null;
  orders: number;
  open_orders: number;
  vehicles: number;
  revenue_cents: number;
  open_cents: number;
  last_order_at: string | null;
}

interface CustomerFull {
  customer: CustomerListRow & { first_name: string; last_name: string; company: string; register_no: string; street: string; house_no: string; zip: string; price_group: string; notes: string; created_at: string; anonymized_at: string };
  locations: { id: number; label: string; street: string; house_no: string; zip: string; city: string }[];
  contacts: { id: number; name: string; role: string; email: string; phone: string; location_id: number | null }[];
  vehicles: { id: number; fin: string; make: string; model: string; vehicle_type: string; plate: string; orders: number }[];
  orders: { id: number; number: string; service: ServiceId; status: StatusId; payment_status: string; total_cents: number; created_at: string; assigned_plate: string; fin: string; kfz_display: string; vehicle_id: number | null }[];
  documents: { id: string; order_id: number; number: string; kind: string; original_name: string; display_name: string; category: string; mime: string; size: number; created_at: string; expires_at: string }[];
  messages: { id: number; at: string; order_id: number | null; subject: string; state: string; author: string }[];
  invoices: { id: number; number: string; kind: string; order_id: number; issued_at: string; gross_cents: number }[];
  tasks: { id: number; title: string; status: string; priority: string; due_at: string; assignee_id: number | null; order_id: number | null }[];
  statusMails: { at: string; subject: string; state: string; number: string }[];
  canWrite: boolean;
  canFinance: boolean;
  canGdpr: boolean;
}

export function CustomersApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { can } = useOs();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [category, setCategory] = useState('');
  const [type, setType] = useState('');
  const [sel, setSel] = useState<number | null>((params?.customerId as number) ?? null);
  const [mode, setMode] = useState<'liste' | 'dubletten'>('liste');
  const [creating, setCreating] = useState(false);
  const staff = useStaff();
  useEffect(() => {
    if (typeof params?.customerId === 'number') {
      setSel(params.customerId);
      setMode('liste');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);
  const qs = new URLSearchParams({ ...(debounced ? { q: debounced } : {}), ...(category ? { category } : {}), ...(type ? { type } : {}) }).toString();
  const { data, error, loading, reload } = useOsData<{ items: CustomerListRow[]; categories: string[]; canWrite: boolean }>(`customers${qs ? `?${qs}` : ''}`);

  return (
    <div className="os-app os-app--fill">
      <div className={`os-split os-split--wide${sel ? ' has-detail' : ''}`}>
        <section className="os-split__list" aria-label="Kundenliste">
          <div className="os-toolbar os-toolbar--wrap">
            <label className="os-searchbox">
              <ISearch width={16} height={16} />
              <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" title="Name, Kundennr., E-Mail, Telefon, FIN, Kennzeichen, Auftrag, Ansprechpartner" aria-label="Kunden durchsuchen" />
            </label>
            <select className="os-select" value={type} onChange={(e) => setType(e.target.value)} aria-label="Art">
              <option value="">Alle</option>
              <option value="privat">Privat</option>
              <option value="firma">Geschäftskunden</option>
            </select>
            <select className="os-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
              <option value="">Jede Kategorie</option>
              {(data?.categories ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
              <IRefresh width={16} height={16} />
            </button>
          </div>
          <div className="os-toolbar os-toolbar--wrap os-toolbar--sub">
            <button type="button" className={`os-btn os-btn--ghost os-btn--sm${mode === 'dubletten' ? ' is-on' : ''}`} onClick={() => setMode(mode === 'dubletten' ? 'liste' : 'dubletten')}>
              Dublettenprüfung
            </button>
            <ExportMenu base="customers/export" />
            {can('customers.write') ? (
              <button type="button" className="os-btn os-btn--sm" onClick={() => setCreating(true)}>
                + Neuer Kunde
              </button>
            ) : null}
          </div>
          {loading && !data ? (
            <Loading />
          ) : error && !data ? (
            <ErrorBox message={error} onRetry={() => void reload()} />
          ) : data?.items.length ? (
            <ul className="os-list" role="listbox" aria-label="Kunden">
              {data.items.map((x) => (
                <li key={x.id} role="option" aria-selected={sel === x.id}>
                  <button type="button" className={sel === x.id ? 'is-sel' : ''} onClick={() => (setSel(x.id), setMode('liste'))}>
                    <span className="os-list__top">
                      <strong>{x.name}</strong>
                      <span className="os-row os-row--tight">
                        {x.category ? <Badge tone={x.category === 'Gesperrt' ? 'red' : 'violet'}>{x.category}</Badge> : null}
                        <Badge tone={x.type === 'firma' ? 'blue' : 'slate'}>{x.type === 'firma' ? 'Firma' : 'Privat'}</Badge>
                      </span>
                    </span>
                    <span className="os-list__sub">
                      {x.number} · {x.email || 'ohne E-Mail'}
                      {x.city ? ` · ${x.city}` : ''}
                    </span>
                    <span className="os-list__meta">
                      <span className="os-muted">
                        {x.orders} Auftrag/Aufträge{x.open_orders ? ` (${x.open_orders} laufend)` : ''} · {x.vehicles} Fahrzeug(e) · {staffName(staff, x.owner_id)}
                      </span>
                      {can('finance.read') ? <span className={x.open_cents ? 'os-overdue' : 'os-muted'}>{x.open_cents ? `${euro(x.open_cents)} offen` : euro(x.revenue_cents)}</span> : null}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Keine Kunden" text={debounced ? 'Keine Treffer.' : 'Kunden entstehen mit dem ersten Auftrag oder über „Neuer Kunde“.'} />
          )}
          {data?.items.length ? <p className="os-listfoot">{data.items.length} Kunde(n)</p> : null}
        </section>
        <section className="os-split__detail" aria-label="Kundenakte">
          {mode === 'dubletten' ? (
            <Duplicates onOpen={(id) => (setSel(id), setMode('liste'))} onMerged={() => void reload(true)} />
          ) : sel ? (
            <CustomerDetail id={sel} onBack={() => setSel(null)} onChanged={() => void reload(true)} />
          ) : (
            <Empty title="Kein Kunde ausgewählt" text="Links einen Kunden wählen." />
          )}
        </section>
      </div>
      {creating ? (
        <CustomerDialog
          categories={data?.categories ?? []}
          onClose={() => setCreating(false)}
          onSaved={(id) => {
            setCreating(false);
            setSel(id);
            void reload(true);
          }}
        />
      ) : null}
    </div>
  );
}

/* ---------- Anlegen / Bearbeiten ---------- */

type CustomerInput = {
  type: 'privat' | 'firma';
  first_name: string;
  last_name: string;
  company: string;
  register_no: string;
  email: string;
  phone: string;
  street: string;
  house_no: string;
  zip: string;
  city: string;
  category: string;
  owner_id: number | null;
  price_group: string;
  notes: string;
};

function CustomerDialog({ initial, id, categories, onClose, onSaved }: { initial?: CustomerInput; id?: number; categories: string[]; onClose: () => void; onSaved: (id: number) => void }) {
  const [c, setC] = useState<CustomerInput>(
    initial ?? { type: 'privat', first_name: '', last_name: '', company: '', register_no: '', email: '', phone: '', street: '', house_no: '', zip: '', city: '', category: '', owner_id: null, price_group: '', notes: '' },
  );
  const [error, setError] = useState<string | null>(null);
  const [dups, setDups] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const field = (k: keyof CustomerInput, label: string, type = 'text') => (
    <Field label={label}>
      <input type={type} value={String(c[k] ?? '')} onChange={(e) => setC({ ...c, [k]: e.target.value })} />
    </Field>
  );
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      if (id) {
        await osFetch(`customers/${id}`, { method: 'POST', body: c });
        onSaved(id);
      } else {
        const r = await osFetch<{ id: number; duplicates: number[] }>('customers', { method: 'POST', body: c });
        if (r.duplicates.length) {
          setDups(r.duplicates);
          setBusy(false);
          // Kunde ist angelegt – Hinweis zeigen, dann öffnen
          window.setTimeout(() => onSaved(r.id), 2500);
          return;
        }
        onSaved(r.id);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={id ? 'Kunde bearbeiten' : 'Neuer Kunde'}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? <p className="os-flash is-error">{error}</p> : dups.length ? <p className="os-flash is-error">Angelegt – mögliche Dublette(n): Kunde #{dups.join(', #')}. Bitte in der Dublettenprüfung zusammenführen.</p> : <span />}
          <span className="os-row">
            <button type="button" className="os-btn os-btn--ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="os-btn" onClick={() => void save()} disabled={busy || dups.length > 0}>
              Speichern
            </button>
          </span>
        </>
      }
    >
      <div className="os-chipset" role="radiogroup">
        {(['privat', 'firma'] as const).map((t) => (
          <button key={t} type="button" role="radio" aria-checked={c.type === t} className={c.type === t ? 'is-on' : ''} onClick={() => setC({ ...c, type: t })}>
            {t === 'privat' ? 'Privatkunde' : 'Geschäftskunde'}
          </button>
        ))}
      </div>
      <div className="os-fields">
        {c.type === 'firma' ? (
          <>
            {field('company', 'Firmenname')}
            {field('register_no', 'Registernummer')}
          </>
        ) : null}
        {field('first_name', c.type === 'firma' ? 'Vorname (Inhaber)' : 'Vorname')}
        {field('last_name', c.type === 'firma' ? 'Nachname (Inhaber)' : 'Nachname')}
        {field('email', 'E-Mail', 'email')}
        {field('phone', 'Telefon', 'tel')}
        {field('street', 'Straße')}
        {field('house_no', 'Hausnummer')}
        {field('zip', 'PLZ')}
        {field('city', 'Ort')}
        <Field label="Kategorie">
          <input list="os-cust-cats" value={c.category} onChange={(e) => setC({ ...c, category: e.target.value })} />
          <datalist id="os-cust-cats">
            {categories.map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
        </Field>
        <Field label="Verantwortlich">
          <StaffSelect value={c.owner_id} onChange={(v) => setC({ ...c, owner_id: v })} />
        </Field>
        {field('price_group', 'Preisgruppe (z. B. Händler, Flotte)')}
        <label className="os-field os-field--wide">
          <span className="os-field__label">Kundennotiz (intern)</span>
          <textarea rows={3} value={c.notes} onChange={(e) => setC({ ...c, notes: e.target.value })} maxLength={4000} />
        </label>
      </div>
    </Dialog>
  );
}

/* ---------- Kundenakte ---------- */

type CTab = 'uebersicht' | 'kontakte' | 'fahrzeuge' | 'auftraege' | 'dokumente' | 'kommunikation' | 'finanzen' | 'aufgaben' | 'dsgvo';

function CustomerDetail({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged: () => void }) {
  const { openApp } = useOs();
  const staff = useStaff();
  const { data, error, loading, reload } = useOsData<CustomerFull>(`customers/${id}`);
  const [tab, setTab] = useState<CTab>('uebersicht');
  const [edit, setEdit] = useState(false);
  const flash = useFlash();
  useEffect(() => setTab('uebersicht'), [id]);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const c = data.customer;
  const openOrders = data.orders.filter((o) => !['abgeschlossen', 'storniert', 'versendet', 'abgeholt'].includes(o.status));
  const openCents = data.orders.filter((o) => o.payment_status === 'offen' && o.status !== 'storniert').reduce((a, o) => a + o.total_cents, 0);

  const save = async (path: string, body: Record<string, unknown>, msg: string) => {
    try {
      await osFetch(`customers/${id}/${path}`, { method: 'POST', body });
      flash.show(true, msg);
      await reload(true);
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };

  return (
    <div className="os-detail">
      <header className="os-detail__head">
        <button type="button" className="os-iconbtn os-detail__back" onClick={onBack} aria-label="Zurück">
          <IChevron width={18} height={18} style={{ transform: 'rotate(180deg)' }} />
        </button>
        <div className="os-detail__title">
          <h2>{c.name}</h2>
          <p className="os-muted">
            {c.number} · {c.type === 'firma' ? 'Geschäftskunde' : 'Privatkunde'} · seit {dateOnly(c.created_at)} · verantwortlich: {staffName(staff, c.owner_id)}
          </p>
        </div>
        <div className="os-detail__badges">
          {c.anonymized_at ? <Badge tone="slate">anonymisiert</Badge> : null}
          {c.category ? <Badge tone="violet">{c.category}</Badge> : null}
          {c.price_group ? <Badge tone="blue">Preisgruppe {c.price_group}</Badge> : null}
        </div>
        <div className="os-row os-row--tight">
          {data.canWrite && !c.anonymized_at ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => setEdit(true)}>
              Bearbeiten
            </button>
          ) : null}
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('orders', { customer: c.id, status: 'alle' })}>
            Aufträge im Auftragscenter
          </button>
        </div>
      </header>
      {flash.node}
      <Tabs<CTab>
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'uebersicht', label: 'Übersicht' },
          { id: 'kontakte', label: `Ansprechpartner & Standorte (${data.contacts.length + data.locations.length})` },
          { id: 'fahrzeuge', label: `Fahrzeuge (${data.vehicles.length})` },
          { id: 'auftraege', label: `Aufträge (${data.orders.length})` },
          { id: 'dokumente', label: `Dokumente (${data.documents.length})` },
          { id: 'kommunikation', label: 'Kommunikation' },
          ...(data.canFinance ? [{ id: 'finanzen' as CTab, label: 'Rechnungen & Zahlungen' }] : []),
          { id: 'aufgaben', label: `Wiedervorlagen & Aufgaben (${data.tasks.filter((t) => t.status !== 'erledigt').length})` },
          { id: 'dsgvo', label: 'DSGVO' },
        ]}
      />
      <div className="os-detail__body os-scroll">
        {tab === 'uebersicht' ? (
          <div className="os-grid os-grid--2">
            <Panel title="Stammdaten">
              <dl className="os-dl">
                {c.type === 'firma' ? (
                  <>
                    <dt>Firma</dt>
                    <dd>{c.company}</dd>
                    <dt>Register</dt>
                    <dd>{c.register_no || '–'}</dd>
                  </>
                ) : null}
                <dt>Name</dt>
                <dd>{`${c.first_name} ${c.last_name}`.trim() || '–'}</dd>
                <dt>E-Mail</dt>
                <dd>{c.email ? <a className="os-link" href={`mailto:${c.email}`}>{c.email}</a> : '–'}</dd>
                <dt>Telefon</dt>
                <dd>{c.phone ? <a className="os-link" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> : '–'}</dd>
                <dt>Anschrift</dt>
                <dd>{[`${c.street} ${c.house_no}`.trim(), `${c.zip} ${c.city}`.trim()].filter(Boolean).join(', ') || '–'}</dd>
              </dl>
              {c.notes ? <p className="os-note-box">{c.notes}</p> : null}
            </Panel>
            <Panel title="Kennzahlen">
              <dl className="os-dl">
                <dt>Aufträge</dt>
                <dd>
                  {data.orders.length} gesamt · {openOrders.length} laufend
                </dd>
                <dt>Fahrzeuge</dt>
                <dd>{data.vehicles.length}</dd>
                {data.canFinance ? (
                  <>
                    <dt>Umsatz</dt>
                    <dd>{euro(data.orders.filter((o) => o.status !== 'storniert').reduce((a, o) => a + o.total_cents, 0))}</dd>
                    <dt>Offene Zahlungen</dt>
                    <dd className={openCents ? 'os-overdue' : ''}>{euro(openCents)}</dd>
                  </>
                ) : null}
                <dt>Letzte Nachricht</dt>
                <dd>{data.messages[0] ? `${dateTime(data.messages[0].at)} · ${data.messages[0].subject}` : '–'}</dd>
              </dl>
            </Panel>
            <Panel title="Laufende Aufträge">
              {openOrders.length ? <OrderTable orders={openOrders} /> : <p className="os-muted">Keine laufenden Aufträge.</p>}
            </Panel>
          </div>
        ) : null}
        {tab === 'kontakte' ? <ContactsTab data={data} save={save} /> : null}
        {tab === 'fahrzeuge' ? <VehiclesTab data={data} save={save} /> : null}
        {tab === 'auftraege' ? (
          <Panel title="Auftragshistorie">
            <OrderTable orders={data.orders} />
          </Panel>
        ) : null}
        {tab === 'dokumente' ? (
          <Panel title="Dokumente aller Aufträge" actions={<button type="button" className="os-linkbtn" onClick={() => openApp('documents', { customerId: c.id })}>Im Dokumentenmanager</button>}>
            {data.documents.length ? (
              <table className="os-table">
                <thead>
                  <tr>
                    <th scope="col">Datei</th>
                    <th scope="col">Auftrag</th>
                    <th scope="col">Kategorie</th>
                    <th scope="col">Hochgeladen</th>
                    <th scope="col">Ablauf</th>
                  </tr>
                </thead>
                <tbody>
                  {data.documents.map((d) => (
                    <tr key={d.id}>
                      <td>
                        <a className="os-link" href={`/api/admin/dokumente/${d.id}`} target="_blank" rel="noopener">
                          {d.display_name || d.original_name}
                        </a>
                      </td>
                      <td className="os-mono">{d.number}</td>
                      <td>{d.category || d.kind}</td>
                      <td>{dateOnly(d.created_at)}</td>
                      <td>{d.expires_at ? dateOnly(d.expires_at) : '–'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="os-muted">Keine Dokumente.</p>
            )}
          </Panel>
        ) : null}
        {tab === 'kommunikation' ? (
          <div className="os-stack">
            <Panel title="Nachrichten">
              {data.messages.length ? (
                <ul className="os-msglist" role="list">
                  {data.messages.map((m) => (
                    <li key={m.id}>
                      <button type="button" onClick={() => openApp('messages', { messageId: m.id })}>
                        <Badge tone={m.state === 'versendet' ? 'green' : m.state === 'entwurf' ? 'blue' : 'red'}>{m.state}</Badge>
                        <strong>{m.subject}</strong>
                        <span className="os-muted os-small">
                          {dateTime(m.at)} · {m.author}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="os-muted">Keine Nachrichten.</p>
              )}
            </Panel>
            <Panel title="Automatische Statusmails">
              {data.statusMails.length ? (
                <ul className="os-plain">
                  {data.statusMails.map((m, i) => (
                    <li key={i}>
                      {dateTime(m.at)} · {m.number} · {m.subject} <Badge tone={m.state === 'versendet' ? 'green' : 'amber'}>{m.state}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="os-muted">Keine.</p>
              )}
            </Panel>
          </div>
        ) : null}
        {tab === 'finanzen' ? (
          <div className="os-grid os-grid--2">
            <Panel title="Rechnungen & Gutschriften">
              {data.invoices.length ? (
                <ul className="os-plain">
                  {data.invoices.map((i) => (
                    <li key={i.id}>
                      <a className="os-link os-mono" href={`/admin/rechnungen/${i.id}`} target="_blank" rel="noopener">
                        {i.number}
                      </a>{' '}
                      · {dateOnly(i.issued_at)} · {euro(i.gross_cents)} {i.kind === 'gutschrift' ? <Badge tone="amber">Gutschrift</Badge> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="os-muted">Keine Rechnungen.</p>
              )}
            </Panel>
            <Panel title="Offene Zahlungen">
              {data.orders.filter((o) => o.payment_status === 'offen' && o.status !== 'storniert').length ? (
                <OrderTable orders={data.orders.filter((o) => o.payment_status === 'offen' && o.status !== 'storniert')} />
              ) : (
                <p className="os-muted">Keine offenen Zahlungen.</p>
              )}
            </Panel>
          </div>
        ) : null}
        {tab === 'aufgaben' ? <CustomerTasks data={data} reload={() => void reload(true)} /> : null}
        {tab === 'dsgvo' ? <Gdpr data={data} onDone={() => (onChanged(), void reload(true))} /> : null}
      </div>
      {edit ? (
        <CustomerDialog
          id={c.id}
          categories={[]}
          initial={{
            type: c.type,
            first_name: c.first_name,
            last_name: c.last_name,
            company: c.company,
            register_no: c.register_no,
            email: c.email,
            phone: c.phone,
            street: c.street,
            house_no: c.house_no,
            zip: c.zip,
            city: c.city,
            category: c.category,
            owner_id: c.owner_id,
            price_group: c.price_group,
            notes: c.notes,
          }}
          onClose={() => setEdit(false)}
          onSaved={() => {
            setEdit(false);
            flash.show(true, 'Kunde gespeichert');
            void reload(true);
            onChanged();
          }}
        />
      ) : null}
    </div>
  );
}

function OrderTable({ orders }: { orders: CustomerFull['orders'] }) {
  const { openApp } = useOs();
  return (
    <div className="os-tablewrap">
      <table className="os-table">
        <thead>
          <tr>
            <th scope="col">Auftrag</th>
            <th scope="col">Leistung</th>
            <th scope="col">Status</th>
            <th scope="col">KFZ-API</th>
            <th scope="col">Zahlung</th>
            <th scope="col">Eingang</th>
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="is-link" onClick={() => openApp('orders', { orderId: o.id })}>
              <td className="os-mono">
                <button type="button" className="os-rowbtn" onClick={() => openApp('orders', { orderId: o.id })}>
                  {o.number}
                </button>
              </td>
              <td>{SERVICES[o.service]?.title}</td>
              <td>
                <StatusBadge status={o.status} service={o.service} />
              </td>
              <td>
                <KfzState display={o.kfz_display} />
              </td>
              <td>{PAYMENT_STATUS_LABEL[o.payment_status as keyof typeof PAYMENT_STATUS_LABEL]}</td>
              <td>{dateOnly(o.created_at)}</td>
              <td className="num">{euro(o.total_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ContactsTab({ data, save }: { data: CustomerFull; save: (path: string, body: Record<string, unknown>, msg: string) => Promise<void> }) {
  const [contact, setContact] = useState({ name: '', role: '', email: '', phone: '', location_id: null as number | null });
  const [loc, setLoc] = useState({ label: '', street: '', house_no: '', zip: '', city: '' });
  return (
    <div className="os-grid os-grid--2">
      <Panel title="Ansprechpartner">
        {data.contacts.length ? (
          <ul className="os-plain" role="list">
            {data.contacts.map((p) => (
              <li key={p.id} className="os-row">
                <span>
                  <strong>{p.name}</strong>
                  {p.role ? ` · ${p.role}` : ''}
                  <br />
                  <span className="os-muted os-small">
                    {[p.email, p.phone, data.locations.find((l) => l.id === p.location_id)?.label].filter(Boolean).join(' · ') || '–'}
                  </span>
                </span>
                {data.canWrite ? (
                  <button type="button" className="os-linkbtn os-small" style={{ marginLeft: 'auto' }} onClick={() => window.confirm(`${p.name} entfernen?`) && void save('contacts', { id: p.id, delete: true }, 'Ansprechpartner entfernt')}>
                    Entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-muted">Keine Ansprechpartner.</p>
        )}
        {data.canWrite ? (
          <form
            className="os-fields os-fields--2"
            onSubmit={(e) => {
              e.preventDefault();
              void save('contacts', { data: contact }, 'Ansprechpartner gespeichert').then(() => setContact({ name: '', role: '', email: '', phone: '', location_id: null }));
            }}
          >
            <input value={contact.name} onChange={(e) => setContact({ ...contact, name: e.target.value })} placeholder="Name" aria-label="Name" />
            <input value={contact.role} onChange={(e) => setContact({ ...contact, role: e.target.value })} placeholder="Funktion (z. B. Fuhrparkleitung)" aria-label="Funktion" />
            <input type="email" value={contact.email} onChange={(e) => setContact({ ...contact, email: e.target.value })} placeholder="E-Mail" aria-label="E-Mail" />
            <input value={contact.phone} onChange={(e) => setContact({ ...contact, phone: e.target.value })} placeholder="Telefon" aria-label="Telefon" />
            <select className="os-select" value={contact.location_id ?? ''} onChange={(e) => setContact({ ...contact, location_id: e.target.value ? Number(e.target.value) : null })} aria-label="Standort">
              <option value="">kein Standort</option>
              {data.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.label}
                </option>
              ))}
            </select>
            <button type="submit" className="os-btn os-btn--sm" disabled={!contact.name.trim()}>
              Hinzufügen
            </button>
          </form>
        ) : null}
      </Panel>
      <Panel title="Standorte">
        {data.locations.length ? (
          <ul className="os-plain" role="list">
            {data.locations.map((l) => (
              <li key={l.id} className="os-row">
                <span>
                  <strong>{l.label}</strong>
                  <br />
                  <span className="os-muted os-small">{[`${l.street} ${l.house_no}`.trim(), `${l.zip} ${l.city}`.trim()].filter(Boolean).join(', ') || '–'}</span>
                </span>
                {data.canWrite ? (
                  <button type="button" className="os-linkbtn os-small" style={{ marginLeft: 'auto' }} onClick={() => window.confirm(`${l.label} entfernen?`) && void save('locations', { id: l.id, delete: true }, 'Standort entfernt')}>
                    Entfernen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="os-muted">Keine weiteren Standorte.</p>
        )}
        {data.canWrite ? (
          <form
            className="os-fields os-fields--2"
            onSubmit={(e) => {
              e.preventDefault();
              void save('locations', { data: loc }, 'Standort gespeichert').then(() => setLoc({ label: '', street: '', house_no: '', zip: '', city: '' }));
            }}
          >
            <input value={loc.label} onChange={(e) => setLoc({ ...loc, label: e.target.value })} placeholder="Bezeichnung (z. B. Filiale Nord)" aria-label="Bezeichnung" />
            <input value={loc.street} onChange={(e) => setLoc({ ...loc, street: e.target.value })} placeholder="Straße" aria-label="Straße" />
            <input value={loc.house_no} onChange={(e) => setLoc({ ...loc, house_no: e.target.value })} placeholder="Nr." aria-label="Hausnummer" />
            <input value={loc.zip} onChange={(e) => setLoc({ ...loc, zip: e.target.value })} placeholder="PLZ" aria-label="PLZ" />
            <input value={loc.city} onChange={(e) => setLoc({ ...loc, city: e.target.value })} placeholder="Ort" aria-label="Ort" />
            <button type="submit" className="os-btn os-btn--sm" disabled={!loc.label.trim()}>
              Hinzufügen
            </button>
          </form>
        ) : null}
      </Panel>
    </div>
  );
}

function VehiclesTab({ data, save }: { data: CustomerFull; save: (path: string, body: Record<string, unknown>, msg: string) => Promise<void> }) {
  const { openApp } = useOs();
  const [v, setV] = useState({ fin: '', make: '', model: '', plate: '' });
  return (
    <Panel title="Fahrzeuge">
      {data.vehicles.length ? (
        <table className="os-table">
          <thead>
            <tr>
              <th scope="col">Fahrzeug</th>
              <th scope="col">FIN</th>
              <th scope="col">Kennzeichen</th>
              <th scope="col">Aufträge</th>
            </tr>
          </thead>
          <tbody>
            {data.vehicles.map((x) => (
              <tr key={x.id}>
                <td>{`${x.make} ${x.model}`.trim() || '–'}</td>
                <td className="os-mono">{x.fin}</td>
                <td className="os-mono">{x.plate || '–'}</td>
                <td>
                  <button type="button" className="os-linkbtn" onClick={() => openApp('orders', { status: 'alle', customer: data.customer.id })}>
                    {x.orders}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="os-muted">Keine Fahrzeuge.</p>
      )}
      {data.canWrite ? (
        <form
          className="os-inline"
          onSubmit={(e) => {
            e.preventDefault();
            void save('vehicles', { data: v }, 'Fahrzeug gespeichert').then(() => setV({ fin: '', make: '', model: '', plate: '' }));
          }}
        >
          <input className="os-mono" value={v.fin} onChange={(e) => setV({ ...v, fin: e.target.value.toUpperCase() })} placeholder="FIN" aria-label="FIN" maxLength={17} />
          <input value={v.make} onChange={(e) => setV({ ...v, make: e.target.value })} placeholder="Hersteller" aria-label="Hersteller" />
          <input value={v.model} onChange={(e) => setV({ ...v, model: e.target.value })} placeholder="Modell" aria-label="Modell" />
          <input className="os-mono" value={v.plate} onChange={(e) => setV({ ...v, plate: e.target.value.toUpperCase() })} placeholder="Kennzeichen" aria-label="Kennzeichen" />
          <button type="submit" className="os-btn os-btn--sm" disabled={v.fin.length !== 17}>
            Fahrzeug hinzufügen
          </button>
        </form>
      ) : null}
    </Panel>
  );
}

function CustomerTasks({ data, reload }: { data: CustomerFull; reload: () => void }) {
  const { openApp } = useOs();
  const staff = useStaff();
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [assignee, setAssignee] = useState<number | null>(data.customer.owner_id);
  const flash = useFlash();
  return (
    <div className="os-stack">
      {flash.node}
      <Panel title="Wiedervorlage / Aufgabe zum Kunden">
        <form
          className="os-inline"
          onSubmit={async (e) => {
            e.preventDefault();
            try {
              await osFetch('tasks', { method: 'POST', body: { title, customer_id: data.customer.id, assignee_id: assignee, due_at: due ? new Date(`${due}T09:00:00`).toISOString() : '', remind_at: due ? new Date(`${due}T08:00:00`).toISOString() : '' } });
              setTitle('');
              setDue('');
              flash.show(true, 'Wiedervorlage angelegt');
              reload();
            } catch (err) {
              flash.show(false, (err as Error).message);
            }
          }}
        >
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z. B. Flottenangebot nachfassen" aria-label="Titel" />
          <StaffSelect value={assignee} onChange={setAssignee} />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Datum" />
          <button type="submit" className="os-btn os-btn--sm" disabled={title.trim().length < 2}>
            Anlegen
          </button>
        </form>
      </Panel>
      <Panel title="Aufgaben">
        {data.tasks.length ? (
          <ul className="os-msglist">
            {data.tasks.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => openApp('tasks', { taskId: t.id })}>
                  <Badge tone={t.status === 'erledigt' ? 'green' : 'blue'}>{t.status}</Badge>
                  <strong>{t.title}</strong>
                  <span className="os-muted os-small">
                    {staffName(staff, t.assignee_id)}
                    {t.due_at ? ` · ${dateOnly(t.due_at)}` : ''}
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

function Gdpr({ data, onDone }: { data: CustomerFull; onDone: () => void }) {
  const check = useOsData<{ blockers: string[]; retained: string[]; erasable: string[] }>(data.canGdpr ? `customers/${data.customer.id}/erasure` : null);
  const [confirm, setConfirm] = useState('');
  const flash = useFlash();
  return (
    <div className="os-grid os-grid--2">
      <Panel title="Auskunft (Art. 15 DSGVO)">
        <p className="os-muted os-small">Alle gespeicherten Daten zum Kunden als Datei (Kundenstamm, Aufträge, Fahrzeuge, Nachrichten, Rechnungen, Dateiliste). Der Abruf wird protokolliert.</p>
        <a className="os-btn os-btn--ghost os-btn--sm" href={downloadHref(`customers/${data.customer.id}/gdpr-export`)} download>
          Auskunft herunterladen (JSON)
        </a>
      </Panel>
      <Panel title="Löschung (Art. 17 DSGVO)">
        {!data.canGdpr ? (
          <p className="os-muted">Nur mit dem Recht „Systemeinstellungen ändern“.</p>
        ) : data.customer.anonymized_at ? (
          <p>Anonymisiert am {dateTime(data.customer.anonymized_at)}.</p>
        ) : check.data ? (
          <>
            {flash.node}
            {check.data.blockers.length ? (
              <p className="os-flash is-error">Nicht möglich: {check.data.blockers.join('; ')}</p>
            ) : null}
            <h4 className="os-subhead">Wird gelöscht bzw. unkenntlich gemacht</h4>
            <ul className="os-plain os-small">
              {check.data.erasable.map((x) => (
                <li key={x}>• {x}</li>
              ))}
            </ul>
            <h4 className="os-subhead">Bleibt wegen Aufbewahrungspflichten</h4>
            <ul className="os-plain os-small">
              {check.data.retained.length ? check.data.retained.map((x) => <li key={x}>• {x}</li>) : <li>– nichts –</li>}
            </ul>
            <p className="os-muted os-small">Vor der Durchführung rechtlich prüfen lassen. Nicht umkehrbar.</p>
            <div className="os-inline">
              <input value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="ANONYMISIEREN eingeben" aria-label="Bestätigung" />
              <button
                type="button"
                className="os-btn os-btn--danger os-btn--sm"
                disabled={confirm !== 'ANONYMISIEREN' || check.data.blockers.length > 0}
                onClick={async () => {
                  try {
                    await osFetch(`customers/${data.customer.id}/anonymize`, { method: 'POST', body: { confirm } });
                    flash.show(true, 'Kunde anonymisiert');
                    onDone();
                  } catch (e) {
                    flash.show(false, (e as Error).message);
                  }
                }}
              >
                Endgültig anonymisieren
              </button>
            </div>
          </>
        ) : (
          <Loading />
        )}
      </Panel>
    </div>
  );
}

/* ---------- Dubletten ---------- */

function Duplicates({ onOpen, onMerged }: { onOpen: (id: number) => void; onMerged: () => void }) {
  const { can } = useOs();
  const { data, loading, reload } = useOsData<{ reason: string; ids: number[]; names: string[] }[]>('customers/duplicates');
  const flash = useFlash();
  const merge = async (target: number, source: number) => {
    if (!window.confirm(`Kunde #${source} in #${target} zusammenführen? Aufträge, Fahrzeuge, Ansprechpartner und Nachrichten wandern mit, #${source} wird entfernt.`)) return;
    try {
      await osFetch('customers/merge', { method: 'POST', body: { target, source } });
      flash.show(true, 'Zusammengeführt');
      void reload(true);
      onMerged();
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };
  return (
    <div className="os-detail">
      <header className="os-detail__head">
        <div className="os-detail__title">
          <h2>Dublettenprüfung</h2>
          <p className="os-muted">Gleiche E-Mail, Telefonnummer, Firmenname oder gleicher Name mit gleicher PLZ.</p>
        </div>
      </header>
      {flash.node}
      <div className="os-detail__body os-scroll">
        {loading && !data ? (
          <Loading />
        ) : data?.length ? (
          <ul className="os-stack" role="list">
            {data.map((g, k) => (
              <li key={k} className="os-panel">
                <strong>{g.reason}</strong>
                <ul className="os-plain">
                  {g.ids.map((id, i) => (
                    <li key={id} className="os-row">
                      <button type="button" className="os-linkbtn" onClick={() => onOpen(id)}>
                        #{id} {g.names[i]}
                      </button>
                      {can('customers.write') && i > 0 ? (
                        <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void merge(g.ids[0], id)}>
                          in #{g.ids[0]} zusammenführen
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Keine Dubletten gefunden" />
        )}
      </div>
    </div>
  );
}
