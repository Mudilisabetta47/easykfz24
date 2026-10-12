'use client';

// Dokumentenmanager (Datei-Explorer). Alle Dateien liegen im privaten Speicher (R2) und kommen nur über die
// geschützte Route – jeder Abruf wird protokolliert. Ordner = Aufträge (+ Unterordner), Kategorien, Versionen,
// Ablaufdaten, Prüfvermerk, Archiv, Papierkorb mit Wiederherstellung (endgültig löschen nur mit Recht).

import { useEffect, useMemo, useState } from 'react';
import { DOCUMENT_KINDS, DOCUMENTS } from '../../../lib/services.ts';
import { dateTime, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IDoc, IFolder, IRefresh, ISearch } from '../icons.tsx';
import { Chips, dateOnly, Dialog, DropZone, isOverdue, toDateInput, uploadFiles } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Loading, useFlash } from '../ui.tsx';
import { Preview } from './Preview.tsx';

interface Tree {
  orders: { order_id: number; number: string; holder_name: string; customer_id: number | null; files: number; size: number; expiring: number }[];
  folders: { order_id: number; path: string }[];
  totals: { files: number; bytes: number };
  categories: string[];
  reviewStates: string[];
  canWrite: boolean;
  canPurge: boolean;
}

interface FileRow {
  id: string;
  order_id: number;
  number: string;
  holder_name: string;
  kind: string;
  kindLabel: string;
  label: string;
  original_name: string;
  display_name: string;
  category: string;
  categoryLabel: string;
  folder: string;
  mime: string;
  size: number;
  version: number;
  expires_at: string;
  archived_at: string;
  deleted_at: string;
  deleted_by: string;
  uploaded_by: string;
  review_state: string;
  review_note: string;
  created_at: string;
  url: string;
}

type View = 'aktiv' | 'archiv' | 'papierkorb';
type Layout = 'liste' | 'kacheln' | 'details';

const bytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`);
const REVIEW: Record<string, { label: string; tone: string }> = {
  geprueft: { label: 'geprüft', tone: 'green' },
  unleserlich: { label: 'unleserlich', tone: 'amber' },
  abgelaufen: { label: 'abgelaufen', tone: 'red' },
  falsch: { label: 'falsches Dokument', tone: 'red' },
};

export function DocumentsApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { openApp } = useOs();
  const [view, setView] = useState<View>('aktiv');
  const [layout, setLayout] = useState<Layout>('details');
  const [order, setOrder] = useState<number | null>((params?.orderId as number) ?? null);
  const [customer, setCustomer] = useState<number | null>((params?.customerId as number) ?? null);
  const [folder, setFolder] = useState('');
  const [category, setCategory] = useState('');
  const [expiring, setExpiring] = useState(false);
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState<FileRow | null>(null);
  const [edit, setEdit] = useState<FileRow | null>(null);
  const [busy, setBusy] = useState(false);
  const flash = useFlash();

  useEffect(() => {
    if (typeof params?.orderId === 'number') {
      setOrder(params.orderId);
      setCustomer(null);
    }
    if (typeof params?.customerId === 'number') {
      setCustomer(params.customerId);
      setOrder(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 220);
    return () => window.clearTimeout(t);
  }, [q]);
  useEffect(() => {
    setSel(new Set());
    setFolder('');
  }, [order, view]);

  const tree = useOsData<Tree>(`documents?view=${view}${debounced && !order ? `&q=${encodeURIComponent(debounced)}` : ''}`);
  const qs = new URLSearchParams({ view, ...(order ? { order: String(order) } : {}), ...(customer ? { customer: String(customer) } : {}), ...(debounced ? { q: debounced } : {}), ...(category ? { category } : {}), ...(expiring ? { expiring: '1' } : {}) }).toString();
  const files = useOsData<FileRow[]>(`documents/files?${qs}`);
  const refresh = () => {
    void tree.reload(true);
    void files.reload(true);
  };

  const shown = useMemo(() => (files.data ?? []).filter((f) => !folder || f.folder === folder || f.folder.startsWith(`${folder}/`)), [files.data, folder]);
  const subfolders = useMemo(() => {
    if (!order) return [];
    const set = new Set<string>();
    for (const f of tree.data?.folders ?? []) if (f.order_id === order) set.add(f.path);
    for (const f of files.data ?? []) if (f.folder) set.add(f.folder);
    return [...set].sort();
  }, [order, tree.data, files.data]);
  const current = tree.data?.orders.find((o) => o.order_id === order);
  const canWrite = !!tree.data?.canWrite;

  const bulk = async (action: 'delete' | 'restore' | 'archive' | 'unarchive' | 'purge') => {
    if (!sel.size) return;
    if (action === 'purge' && !window.confirm(`${sel.size} Datei(en) endgültig löschen? Die Dateien werden aus dem Speicher entfernt.`)) return;
    setBusy(true);
    let done = 0;
    const errors: string[] = [];
    for (const id of sel) {
      try {
        await osFetch(`documents/${id}/${action}`, { method: 'POST', body: {} });
        done++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    setBusy(false);
    flash.show(!errors.length, `${done} Datei(en) bearbeitet${errors.length ? ` · ${errors.length} Fehler: ${errors[0]}` : ''}`);
    setSel(new Set());
    setFocus(null);
    refresh();
  };

  const upload = async (list: File[]) => {
    if (!order) return flash.show(false, 'Erst einen Auftragsordner wählen');
    setBusy(true);
    try {
      const r = await uploadFiles(order, list, { folder, category });
      const bad = r.filter((x) => !x.ok);
      flash.show(!bad.length, bad.length ? `${bad.length} abgelehnt: ${bad.map((b) => `${b.name} (${b.error})`).join('; ')}` : `${r.length} Datei(en) hochgeladen`);
      refresh();
    } catch (e) {
      flash.show(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = (id: string, multi: boolean) => {
    const n = new Set(multi ? sel : []);
    if (n.has(id) && multi) n.delete(id);
    else n.add(id);
    setSel(n);
  };

  if (tree.loading && !tree.data) return <Loading />;
  if (tree.error && !tree.data) return <ErrorBox message={tree.error} onRetry={() => void tree.reload()} />;

  return (
    <div className="os-explorer">
      <aside className="os-explorer__tree" aria-label="Ordner">
        <Chips<View>
          value={view}
          onChange={(v) => (setView(v), setFocus(null))}
          options={[
            { id: 'aktiv', label: 'Dateien' },
            { id: 'archiv', label: 'Archiv' },
            { id: 'papierkorb', label: 'Papierkorb' },
          ]}
        />
        <label className="os-searchbox">
          <ISearch width={16} height={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Suchen …" title="Auftrag, Halter, Dateiname, Bezeichnung, Prüfvermerk" aria-label="Dateien durchsuchen" />
        </label>
        <button type="button" className={`os-tree__item${!order && !customer ? ' is-sel' : ''}`} onClick={() => (setOrder(null), setCustomer(null))}>
          <IFolder width={18} height={18} /> Alle Aufträge <span className="os-count">{tree.data?.totals.files ?? 0}</span>
        </button>
        {customer ? (
          <button type="button" className="os-tree__item is-sel">
            <IFolder width={18} height={18} /> Kunde #{customer}
          </button>
        ) : null}
        <ul role="list">
          {(tree.data?.orders ?? []).map((f) => (
            <li key={f.order_id}>
              <button type="button" className={`os-tree__item${order === f.order_id ? ' is-sel' : ''}`} onClick={() => (setOrder(f.order_id), setCustomer(null))} title={f.holder_name}>
                <IFolder width={18} height={18} />
                <span className="os-tree__label">
                  <span className="os-mono">{f.number}</span>
                  <span className="os-muted os-small">{f.holder_name}</span>
                </span>
                {f.expiring ? <span className="os-issue-dot is-warnung" title="Dokumente laufen in 30 Tagen ab">!</span> : null}
                <span className="os-count">{f.files}</span>
              </button>
              {order === f.order_id && subfolders.length ? (
                <ul role="list" className="os-tree__sub">
                  <li>
                    <button type="button" className={`os-tree__item${!folder ? ' is-sel' : ''}`} onClick={() => setFolder('')}>
                      <IFolder width={16} height={16} /> (alle)
                    </button>
                  </li>
                  {subfolders.map((p) => (
                    <li key={p}>
                      <button type="button" className={`os-tree__item${folder === p ? ' is-sel' : ''}`} onClick={() => setFolder(p)}>
                        <IFolder width={16} height={16} /> {p}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
        <p className="os-muted os-small">
          {tree.data?.totals.files ?? 0} Dateien · {bytes(tree.data?.totals.bytes ?? 0)} · privat in {view === 'papierkorb' ? 'Papierkorb' : 'R2'}
        </p>
      </aside>

      <section className="os-explorer__files" aria-label="Dateien">
        <div className="os-toolbar os-toolbar--wrap">
          <span className="os-crumbs">
            {view === 'aktiv' ? 'Dateien' : view === 'archiv' ? 'Archiv' : 'Papierkorb'} ›{' '}
            {current ? (
              <>
                <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: current.order_id })}>
                  {current.number}
                </button>{' '}
                {current.holder_name}
                {folder ? ` › ${folder}` : ''}
              </>
            ) : customer ? (
              `Kunde #${customer}`
            ) : (
              'Alle Aufträge'
            )}
          </span>
          <select className="os-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Kategorie">
            <option value="">Alle Kategorien</option>
            {(tree.data?.categories ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <label className="os-check-field">
            <input type="checkbox" checked={expiring} onChange={(e) => setExpiring(e.target.checked)} /> läuft ab (30 Tage)
          </label>
          <Chips<Layout>
            value={layout}
            onChange={setLayout}
            options={[
              { id: 'details', label: 'Details' },
              { id: 'liste', label: 'Liste' },
              { id: 'kacheln', label: 'Kacheln' },
            ]}
          />
          <button type="button" className="os-iconbtn" onClick={refresh} aria-label="Aktualisieren">
            <IRefresh width={16} height={16} />
          </button>
        </div>
        {sel.size ? (
          <div className="os-bulkbar">
            <strong>{sel.size} ausgewählt</strong>
            {canWrite && view === 'aktiv' ? (
              <>
                <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void bulk('archive')}>
                  Archivieren
                </button>
                <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void bulk('delete')}>
                  In den Papierkorb
                </button>
              </>
            ) : null}
            {canWrite && view === 'archiv' ? (
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void bulk('unarchive')}>
                Aus dem Archiv holen
              </button>
            ) : null}
            {canWrite && view === 'papierkorb' ? (
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void bulk('restore')}>
                Wiederherstellen
              </button>
            ) : null}
            {tree.data?.canPurge && view === 'papierkorb' ? (
              <button type="button" className="os-btn os-btn--danger os-btn--sm" disabled={busy} onClick={() => void bulk('purge')}>
                Endgültig löschen
              </button>
            ) : null}
            <button type="button" className="os-linkbtn" onClick={() => setSel(new Set())}>
              Auswahl aufheben
            </button>
          </div>
        ) : null}
        {flash.node}
        <div className="os-scroll os-explorer__list">
          {files.loading && !files.data ? (
            <Loading />
          ) : shown.length ? (
            layout === 'kacheln' ? (
              <ul className="os-tiles" role="listbox" aria-multiselectable="true">
                {shown.map((f) => (
                  <li key={f.id} role="option" aria-selected={sel.has(f.id)}>
                    <button type="button" className={sel.has(f.id) ? 'is-sel' : ''} onClick={(e) => (toggle(f.id, e.metaKey || e.ctrlKey || e.shiftKey), setFocus(f))} onDoubleClick={() => window.open(f.url, '_blank', 'noopener')}>
                      {f.mime.startsWith('image/') && f.mime !== 'image/heic' ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={f.url} alt="" loading="lazy" />
                      ) : (
                        <span className="os-tiles__icon">
                          <IDoc width={34} height={34} />
                          <span>{f.mime === 'application/pdf' ? 'PDF' : f.mime.split('/')[1]?.toUpperCase()}</span>
                        </span>
                      )}
                      <span className="os-tiles__name">{f.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <table className={`os-table${layout === 'liste' ? ' os-table--compact' : ''}`}>
                <thead>
                  <tr>
                    <th scope="col">
                      <input type="checkbox" aria-label="Alle auswählen" checked={sel.size === shown.length && shown.length > 0} onChange={(e) => setSel(e.target.checked ? new Set(shown.map((f) => f.id)) : new Set())} />
                    </th>
                    <th scope="col">Name</th>
                    {layout === 'details' ? (
                      <>
                        <th scope="col">Kategorie</th>
                        {!order ? <th scope="col">Auftrag</th> : null}
                        <th scope="col">Prüfung</th>
                        <th scope="col">Größe</th>
                        <th scope="col">Ablauf</th>
                        <th scope="col">{view === 'papierkorb' ? 'Gelöscht' : 'Hochgeladen'}</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((f) => (
                    <tr key={f.id} className={`is-link${sel.has(f.id) ? ' is-sel' : ''}`} onClick={(e) => (toggle(f.id, e.metaKey || e.ctrlKey || e.shiftKey), setFocus(f))} onDoubleClick={() => window.open(f.url, '_blank', 'noopener')}>
                      <td onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={sel.has(f.id)} onChange={() => toggle(f.id, true)} aria-label={`${f.label} auswählen`} />
                      </td>
                      <td>
                        <span className="os-rowbtn">
                          <IDoc width={16} height={16} /> {f.label}
                          {f.version > 1 ? <span className="os-muted os-small"> v{f.version}</span> : null}
                          {f.folder ? <span className="os-muted os-small"> · {f.folder}</span> : null}
                        </span>
                      </td>
                      {layout === 'details' ? (
                        <>
                          <td>
                            <Badge tone="blue">{f.categoryLabel}</Badge>
                          </td>
                          {!order ? <td className="os-mono">{f.number}</td> : null}
                          <td>{f.review_state ? <Badge tone={REVIEW[f.review_state]?.tone ?? 'slate'}>{REVIEW[f.review_state]?.label ?? f.review_state}</Badge> : <span className="os-muted">–</span>}</td>
                          <td>{bytes(f.size)}</td>
                          <td className={isOverdue(f.expires_at) ? 'os-overdue' : ''}>{f.expires_at ? dateOnly(f.expires_at) : '–'}</td>
                          <td>{view === 'papierkorb' ? `${dateTime(f.deleted_at)} · ${f.deleted_by}` : dateTime(f.created_at)}</td>
                        </>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <Empty title={view === 'papierkorb' ? 'Papierkorb ist leer' : 'Keine Dateien'} text={order ? 'Dateien hierher ziehen, um sie hochzuladen.' : 'Uploads der Kunden und eigene Dokumente erscheinen hier.'} />
          )}
        </div>
        {canWrite && view === 'aktiv' ? (
          <div className="os-explorer__upload">
            {order ? (
              <>
                <DropZone onFiles={(l) => void upload(l)} disabled={busy} label={busy ? 'Wird hochgeladen …' : `In ${current?.number ?? 'Auftrag'}${folder ? ` › ${folder}` : ''} hochladen`} />
                <button
                  type="button"
                  className="os-btn os-btn--ghost os-btn--sm"
                  onClick={async () => {
                    const path = window.prompt('Name des neuen Unterordners', folder ? `${folder}/` : '');
                    if (!path) return;
                    try {
                      await osFetch('documents/folder', { method: 'POST', body: { orderId: order, path } });
                      refresh();
                      setFolder(path.replace(/\/+$/, ''));
                    } catch (e) {
                      flash.show(false, (e as Error).message);
                    }
                  }}
                >
                  Neuer Unterordner
                </button>
              </>
            ) : (
              <p className="os-muted os-small">Zum Hochladen links einen Auftragsordner wählen.</p>
            )}
          </div>
        ) : null}
      </section>

      <aside className="os-explorer__preview" aria-label="Vorschau und Eigenschaften">
        {focus ? (
          <FileInfo file={focus} canWrite={canWrite} view={view} onEdit={() => setEdit(focus)} onChanged={refresh} />
        ) : (
          <Empty title="Vorschau" text="Datei anklicken. Strg/⌘-Klick für Mehrfachauswahl, Doppelklick öffnet die Datei." />
        )}
      </aside>

      {edit ? (
        <EditDialog
          file={edit}
          categories={tree.data?.categories ?? []}
          folders={subfolders}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            flash.show(true, 'Gespeichert');
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function FileInfo({ file, canWrite, view, onEdit, onChanged }: { file: FileRow; canWrite: boolean; view: View; onEdit: () => void; onChanged: () => void }) {
  const { can } = useOs();
  const versions = useOsData<{ id: string; version: number; label: string; created_at: string; uploaded_by: string; url: string; superseded_at: string }[]>(`documents/${file.id}/versions`);
  const log = useOsData<{ at: string; username: string; action: string }[]>(`documents/${file.id}/log`);
  const [replacing, setReplacing] = useState(false);
  const flash = useFlash();
  return (
    <div className="os-stack">
      <Preview url={file.url} mime={file.mime} name={file.label} />
      {flash.node}
      <dl className="os-dl os-small">
        <dt>Name</dt>
        <dd>{file.label}</dd>
        {file.display_name ? (
          <>
            <dt>Originalname</dt>
            <dd>{file.original_name}</dd>
          </>
        ) : null}
        <dt>Art</dt>
        <dd>{file.kindLabel || 'Sonstiges'}</dd>
        <dt>Kategorie</dt>
        <dd>{file.categoryLabel}</dd>
        <dt>Version</dt>
        <dd>{file.version}</dd>
        <dt>Hochgeladen</dt>
        <dd>
          {dateTime(file.created_at)}
          {file.uploaded_by ? ` · ${file.uploaded_by}` : ' · Kunde'}
        </dd>
        <dt>Ablauf</dt>
        <dd>{file.expires_at ? dateOnly(file.expires_at) : '–'}</dd>
        <dt>Prüfung</dt>
        <dd>
          {file.review_state ? REVIEW[file.review_state]?.label ?? file.review_state : 'ungeprüft'}
          {file.review_note ? ` · ${file.review_note}` : ''}
        </dd>
      </dl>
      {canWrite && view === 'aktiv' ? (
        <div className="os-row">
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={onEdit}>
            Umbenennen & Eigenschaften
          </button>
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => setReplacing((v) => !v)}>
            Neue Version
          </button>
        </div>
      ) : null}
      {replacing ? (
        <DropZone
          label="Neue Version hierher ziehen"
          onFiles={async (l) => {
            try {
              const r = await uploadFiles(file.order_id, l.slice(0, 1), { replaces: file.id });
              flash.show(r[0]?.ok ?? false, r[0]?.ok ? 'Neue Version gespeichert' : r[0]?.error ?? 'Fehler');
              setReplacing(false);
              onChanged();
            } catch (e) {
              flash.show(false, (e as Error).message);
            }
          }}
        />
      ) : null}
      {(versions.data?.length ?? 0) > 1 ? (
        <>
          <h4 className="os-subhead">Versionen</h4>
          <ul className="os-plain os-small">
            {versions.data!.map((v) => (
              <li key={v.id}>
                <a className="os-link" href={v.url} target="_blank" rel="noopener">
                  v{v.version}
                </a>{' '}
                · {dateTime(v.created_at)} · {v.uploaded_by || 'Kunde'}
                {v.superseded_at ? '' : ' · aktuell'}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {can('audit.read') || log.data?.length ? (
        <>
          <h4 className="os-subhead">Zugriffe</h4>
          {log.data?.length ? (
            <ul className="os-plain os-small">
              {log.data.slice(0, 15).map((l, i) => (
                <li key={i}>
                  {dateTime(l.at)} · {l.username} · {l.action === 'dokument.heruntergeladen' ? 'heruntergeladen' : 'geöffnet'}
                </li>
              ))}
            </ul>
          ) : (
            <p className="os-muted os-small">Noch keine Zugriffe protokolliert.</p>
          )}
        </>
      ) : null}
    </div>
  );
}

function EditDialog({ file, categories, folders, onClose, onSaved }: { file: FileRow; categories: string[]; folders: string[]; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    display_name: file.display_name || file.original_name,
    category: file.category || file.categoryLabel,
    folder: file.folder,
    expires_at: toDateInput(file.expires_at),
    review_state: file.review_state,
    review_note: file.review_note,
    kind: file.kind,
  });
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="Eigenschaften"
      onClose={onClose}
      footer={
        <>
          {error ? <p className="os-flash is-error">{error}</p> : <span />}
          <span className="os-row">
            <button type="button" className="os-btn os-btn--ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button
              type="button"
              className="os-btn"
              onClick={async () => {
                try {
                  await osFetch(`documents/${file.id}`, { method: 'POST', body: { ...v, expires_at: v.expires_at ? new Date(`${v.expires_at}T12:00:00`).toISOString() : '' } });
                  onSaved();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Speichern
            </button>
          </span>
        </>
      }
    >
      <div className="os-fields os-fields--2">
        <label className="os-field os-field--wide">
          <span className="os-field__label">Name</span>
          <input value={v.display_name} onChange={(e) => setV({ ...v, display_name: e.target.value })} maxLength={160} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Art</span>
          <select className="os-select" value={v.kind} onChange={(e) => setV({ ...v, kind: e.target.value })}>
            {DOCUMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {DOCUMENTS[k].label}
              </option>
            ))}
            <option value="sonstiges">Sonstiges</option>
          </select>
        </label>
        <label className="os-field">
          <span className="os-field__label">Kategorie</span>
          <select className="os-select" value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })}>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="os-field">
          <span className="os-field__label">Unterordner</span>
          <input list="os-doc-folders" value={v.folder} onChange={(e) => setV({ ...v, folder: e.target.value })} placeholder="z. B. Belege/2026" />
          <datalist id="os-doc-folders">
            {folders.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
        <label className="os-field">
          <span className="os-field__label">Gültig bis / erneut prüfen am</span>
          <input type="date" value={v.expires_at} onChange={(e) => setV({ ...v, expires_at: e.target.value })} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Prüfung</span>
          <select className="os-select" value={v.review_state} onChange={(e) => setV({ ...v, review_state: e.target.value })}>
            <option value="">ungeprüft</option>
            {Object.entries(REVIEW).map(([k, x]) => (
              <option key={k} value={k}>
                {x.label}
              </option>
            ))}
          </select>
        </label>
        <label className="os-field">
          <span className="os-field__label">Prüfvermerk</span>
          <input value={v.review_note} onChange={(e) => setV({ ...v, review_note: e.target.value })} maxLength={500} />
        </label>
      </div>
    </Dialog>
  );
}
