'use client';

// Benachrichtigungscenter: gespeicherte Ereignis-Benachrichtigungen (keine Doppelungen bei Webhook-Neuzustellung),
// je Benutzer gelesen/ungelesen, Kategorien, Prioritäten, Verlauf, Sprung zum betroffenen Auftrag/Kunden/Aufgabe.

import { useMemo, useState } from 'react';
import { dateTime, osFetch, relTime, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { Chips } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Loading } from '../ui.tsx';

export interface OsNotification {
  id: number;
  at: string;
  kind: string;
  priority: 'info' | 'normal' | 'wichtig' | 'kritisch';
  title: string;
  text: string;
  order_id: number | null;
  customer_id: number | null;
  task_id: number | null;
  read: boolean;
}

export interface NotificationList {
  items: OsNotification[];
  unread: number;
  kinds: Record<string, { label: string; priority: string; group: string }>;
}

type Group = 'alle' | 'auftraege' | 'zahlung' | 'api' | 'team' | 'system';
const PRIO_TONE: Record<string, string> = { kritisch: 'red', wichtig: 'amber', normal: 'blue', info: 'slate' };

export function openTarget(n: Pick<OsNotification, 'order_id' | 'task_id' | 'customer_id' | 'kind'>, openApp: (a: never, p?: Record<string, unknown>) => void) {
  const open = openApp as (a: string, p?: Record<string, unknown>) => void;
  if (n.task_id) open('tasks', { taskId: n.task_id });
  else if (n.order_id) open('orders', { orderId: n.order_id, tab: n.kind.startsWith('zahlung') ? 'zahlung' : n.kind === 'kfz_status' || n.kind.includes('zulassung') || n.kind === 'behoerde_rueckfrage' ? 'kfz' : undefined });
  else if (n.customer_id) open('customers', { customerId: n.customer_id });
  else if (n.kind === 'webhook_fehler') open('kfz', { filter: 'probleme' });
}

export function NotificationsApp() {
  const { openApp } = useOs();
  const { data, error, loading, reload, setData } = useOsData<NotificationList>('notifications?limit=300', { pollMs: 30_000 });
  const [group, setGroup] = useState<Group>('alle');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [prio, setPrio] = useState('');

  const list = useMemo(
    () =>
      (data?.items ?? []).filter(
        (n) => (group === 'alle' || data?.kinds[n.kind]?.group === group) && (!unreadOnly || !n.read) && (!prio || n.priority === prio),
      ),
    [data, group, unreadOnly, prio],
  );

  const markRead = async (ids: number[]) => {
    if (!ids.length || !data) return;
    setData({ ...data, items: data.items.map((n) => (ids.includes(n.id) ? { ...n, read: true } : n)), unread: Math.max(0, data.unread - ids.length) });
    await osFetch('notifications/read', { method: 'POST', body: { ids } }).catch(() => undefined);
    window.dispatchEvent(new CustomEvent('os:notifications-read'));
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Chips<Group>
          value={group}
          onChange={setGroup}
          options={[
            { id: 'alle', label: 'Alle' },
            { id: 'auftraege', label: 'Aufträge' },
            { id: 'zahlung', label: 'Zahlungen' },
            { id: 'api', label: 'KFZ-API' },
            { id: 'team', label: 'Aufgaben & Fristen' },
            { id: 'system', label: 'System' },
          ]}
        />
        <select className="os-select" value={prio} onChange={(e) => setPrio(e.target.value)} aria-label="Priorität">
          <option value="">Jede Priorität</option>
          <option value="kritisch">Kritisch</option>
          <option value="wichtig">Wichtig</option>
          <option value="normal">Normal</option>
          <option value="info">Info</option>
        </select>
        <label className="os-check-field">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} /> nur ungelesene ({data?.unread ?? 0})
        </label>
        <button
          type="button"
          className="os-btn os-btn--ghost os-btn--sm"
          onClick={async () => {
            await osFetch('notifications/read-all', { method: 'POST', body: {} }).catch(() => undefined);
            window.dispatchEvent(new CustomEvent('os:notifications-read'));
            void reload(true);
          }}
          disabled={!data?.unread}
        >
          Alle als gelesen markieren
        </button>
        <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('settings', { tab: 'benachrichtigungen' })}>
          Einstellungen
        </button>
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
      </div>
      <div className="os-scroll">
        {list.length ? (
          <ul className="os-notelist" role="list">
            {list.map((n) => (
              <li key={n.id} className={n.read ? '' : 'is-unread'}>
                <button
                  type="button"
                  onClick={() => {
                    void markRead([n.id]);
                    openTarget(n, openApp as never);
                  }}
                >
                  <span className={`os-notes__dot os-notes__dot--${n.priority}`} aria-hidden="true" />
                  <span className="os-notelist__body">
                    <strong>{n.title}</strong>
                    <span>
                      {n.text}
                      {data?.kinds[n.kind] ? <span className="os-muted"> · {data.kinds[n.kind].label}</span> : null}
                    </span>
                  </span>
                  <span className="os-notelist__side">
                    {n.priority === 'kritisch' || n.priority === 'wichtig' ? <Badge tone={PRIO_TONE[n.priority]}>{n.priority}</Badge> : null}
                    <time title={dateTime(n.at)}>{relTime(n.at)}</time>
                  </span>
                </button>
                {!n.read ? (
                  <button type="button" className="os-linkbtn os-small os-notelist__read" onClick={() => void markRead([n.id])}>
                    gelesen
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <Empty title="Keine Benachrichtigungen" text="Neue Bestellungen, Zahlungen, KFZ-API-Meldungen, Fristen und Aufgaben erscheinen hier." />
        )}
      </div>
    </div>
  );
}
