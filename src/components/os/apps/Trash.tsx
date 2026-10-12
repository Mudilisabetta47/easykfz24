'use client';

// Papierkorb: gelöschte interne Notizen und Dokumente. Wiederherstellen mit Bearbeitungsrecht, endgültig löschen
// nur mit „Einstellungen verwalten“. Aufträge, Rechnungen und das Protokoll sind nie löschbar.

import { useState } from 'react';
import { dateTime, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { Chips } from '../shared.tsx';
import { Empty, ErrorBox, Loading, useFlash } from '../ui.tsx';

interface TrashData {
  notes: { id: number; order_id: number; number: string; holder_name: string; at: string; text: string; author: string; deleted_at: string; deleted_by: string }[];
  documents: { id: string; order_id: number; number: string; label: string; deleted_at: string; deleted_by: string; url: string; mime: string }[];
  canRestore: boolean;
  canRestoreDocs: boolean;
  canPurge: boolean;
}

export function TrashApp() {
  const { openApp } = useOs();
  const { data, error, loading, reload } = useOsData<TrashData>('trash');
  const [kind, setKind] = useState<'notizen' | 'dokumente'>('notizen');
  const [busy, setBusy] = useState(false);
  const flash = useFlash();

  const run = async (path: string, ok: string, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await osFetch(path, { method: 'POST', body: {} });
      flash.show(true, ok);
      await reload(true);
      window.dispatchEvent(new CustomEvent('os:refresh'));
    } catch (e) {
      flash.show(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Chips
          value={kind}
          onChange={setKind}
          options={[
            { id: 'notizen', label: `Notizen (${data.notes.length})` },
            { id: 'dokumente', label: `Dokumente (${data.documents.length})` },
          ]}
        />
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
        {data.canPurge && kind === 'notizen' ? (
          <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy || !data.notes.length} onClick={() => void run('trash/empty', 'Notizen endgültig gelöscht', `Alle ${data.notes.length} Notizen endgültig löschen?`)}>
            Notizen endgültig löschen
          </button>
        ) : null}
      </div>
      <div className="os-scroll os-app__pad">
        {flash.node}
        {kind === 'notizen' ? (
          data.notes.length ? (
            <ul className="os-trash" role="list">
              {data.notes.map((n) => (
                <li key={n.id} className="os-panel">
                  <div className="os-trash__head">
                    <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: n.order_id, tab: 'verlauf' })}>
                      {n.number}
                    </button>
                    <span className="os-muted os-small">{n.holder_name}</span>
                    <span className="os-muted os-small os-trash__meta">
                      gelöscht {dateTime(n.deleted_at)} von {n.deleted_by || '–'}
                    </span>
                  </div>
                  <p className="os-trash__text">{n.text}</p>
                  <div className="os-row">
                    <span className="os-muted os-small">
                      Notiz vom {dateTime(n.at)}
                      {n.author ? ` · ${n.author}` : ''}
                    </span>
                    <span className="os-row os-row--tight" style={{ marginLeft: 'auto' }}>
                      {data.canRestore ? (
                        <button type="button" className="os-btn os-btn--sm" disabled={busy} onClick={() => void run(`trash/${n.id}/restore`, 'Notiz wiederhergestellt')}>
                          Wiederherstellen
                        </button>
                      ) : null}
                      {data.canPurge ? (
                        <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void run(`trash/${n.id}/purge`, 'Endgültig gelöscht', 'Diese Notiz endgültig löschen?')}>
                          Endgültig löschen
                        </button>
                      ) : null}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Keine gelöschten Notizen" />
          )
        ) : data.documents.length ? (
          <ul className="os-trash" role="list">
            {data.documents.map((d) => (
              <li key={d.id} className="os-panel">
                <div className="os-trash__head">
                  <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: d.order_id, tab: 'unterlagen' })}>
                    {d.number}
                  </button>
                  <strong>{d.label}</strong>
                  <span className="os-muted os-small os-trash__meta">
                    gelöscht {dateTime(d.deleted_at)} von {d.deleted_by || '–'}
                  </span>
                </div>
                <div className="os-row">
                  {data.canRestoreDocs ? (
                    <a className="os-link os-small" href={d.url} target="_blank" rel="noopener">
                      Ansehen
                    </a>
                  ) : null}
                  <span className="os-row os-row--tight" style={{ marginLeft: 'auto' }}>
                    {data.canRestoreDocs ? (
                      <button type="button" className="os-btn os-btn--sm" disabled={busy} onClick={() => void run(`documents/${d.id}/restore`, 'Dokument wiederhergestellt')}>
                        Wiederherstellen
                      </button>
                    ) : null}
                    {data.canPurge ? (
                      <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void run(`documents/${d.id}/purge`, 'Dokument endgültig gelöscht', 'Datei endgültig aus dem Speicher löschen?')}>
                        Endgültig löschen
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Keine gelöschten Dokumente" />
        )}
        <p className="os-muted os-small">Aufträge, Rechnungen, Zahlungsbuchungen und das Protokoll können nicht gelöscht werden.</p>
      </div>
    </div>
  );
}
