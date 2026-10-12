'use client';

// Mitarbeiter- und Aufgabencenter: persönliche Aufgaben, offene (nicht zugewiesene) Aufgaben, Teamübersicht,
// Prioritäten, Fristen, Erinnerungen, Kommentare, Bezug zu Auftrag/Kunde. Ohne Team-Recht nur eigene Aufgaben.
// Datenschutz: keine Verhaltens- oder Leistungsüberwachung – nur Aufgabenstände.

import { useEffect, useState } from 'react';
import { dateTime, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh } from '../icons.tsx';
import { Chips, dateOnly, Dialog, fromDateTimeInput, isOverdue, PRIORITY_LABEL, PriorityBadge, StaffSelect, staffName, toDateTimeInput, useStaff } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Loading, Panel, useFlash } from '../ui.tsx';

interface TaskRow {
  id: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  due_at: string;
  remind_at: string;
  assignee_id: number | null;
  order_id: number | null;
  customer_id: number | null;
  source: string;
  created_by: string;
  created_at: string;
  done_at: string;
  order_number: string | null;
  customer_name: string | null;
  comments: number;
}

const STATUS_LABEL: Record<string, string> = { offen: 'Offen', in_arbeit: 'In Arbeit', wartet: 'Wartet', erledigt: 'Erledigt', abgebrochen: 'Abgebrochen' };
const STATUS_TONE: Record<string, string> = { offen: 'blue', in_arbeit: 'violet', wartet: 'amber', erledigt: 'green', abgebrochen: 'slate' };
type Scope = 'mine' | 'offen' | 'team';

export function TasksApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { can, session } = useOs();
  const staff = useStaff();
  const [scope, setScope] = useState<Scope>('mine');
  const [status, setStatus] = useState('aktiv');
  const [assignee, setAssignee] = useState('');
  const [sel, setSel] = useState<number | null>((params?.taskId as number) ?? null);
  const [creating, setCreating] = useState(false);
  useEffect(() => {
    if (typeof params?.taskId === 'number') setSel(params.taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  const qs = new URLSearchParams({ scope, status, ...(scope === 'team' && assignee ? { assignee } : {}) }).toString();
  const { data, error, loading, reload } = useOsData<{ items: TaskRow[]; canTeam: boolean }>(`tasks?${qs}`, { pollMs: 30_000 });
  const team = useOsData<{ assignee_id: number | null; open: number; overdue: number; done7: number }[]>(can('tasks.team') ? 'tasks/team' : null);

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Chips<Scope>
          value={scope}
          onChange={setScope}
          options={[{ id: 'mine', label: 'Meine Aufgaben' }, ...(data?.canTeam ? [{ id: 'offen' as Scope, label: 'Nicht zugewiesen' }, { id: 'team' as Scope, label: 'Team' }] : [])]}
        />
        <select className="os-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="aktiv">Aktiv (offen, in Arbeit, wartet)</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {scope === 'team' ? (
          <select className="os-select" value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Mitarbeiter">
            <option value="">Alle Mitarbeiter</option>
            {staff.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name}
              </option>
            ))}
          </select>
        ) : null}
        <button type="button" className="os-iconbtn" onClick={() => void reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
        <button type="button" className="os-btn os-btn--sm" onClick={() => setCreating(true)}>
          + Neue Aufgabe
        </button>
      </div>
      <div className={`os-split os-split--wide${sel ? ' has-detail' : ''}`}>
        <section className="os-split__list" aria-label="Aufgaben">
          {scope === 'team' && team.data?.length ? (
            <div className="os-teamstrip">
              {team.data.map((t) => (
                <button key={String(t.assignee_id)} type="button" className={assignee === String(t.assignee_id ?? '') ? 'is-sel' : ''} onClick={() => setAssignee(t.assignee_id === null ? '' : String(t.assignee_id))}>
                  <strong>{t.assignee_id === null ? 'Nicht zugewiesen' : staffName(staff, t.assignee_id)}</strong>
                  <span className="os-small">
                    {t.open} offen{t.overdue ? <span className="os-overdue"> · {t.overdue} überfällig</span> : null} · {t.done7} erledigt (7 Tage)
                  </span>
                </button>
              ))}
            </div>
          ) : null}
          {loading && !data ? (
            <Loading />
          ) : error && !data ? (
            <ErrorBox message={error} onRetry={() => void reload()} />
          ) : data?.items.length ? (
            <ul className="os-list" role="listbox" aria-label="Aufgaben">
              {data.items.map((t) => (
                <li key={t.id} role="option" aria-selected={sel === t.id}>
                  <div className={`os-list__row${sel === t.id ? ' is-sel' : ''}`}>
                    <input
                      type="checkbox"
                      className="os-list__check"
                      checked={t.status === 'erledigt'}
                      onChange={async (e) => {
                        await osFetch(`tasks/${t.id}`, { method: 'POST', body: { status: e.target.checked ? 'erledigt' : 'offen' } }).catch(() => undefined);
                        void reload(true);
                      }}
                      aria-label={`${t.title} erledigt`}
                    />
                    <button type="button" onClick={() => setSel(t.id)}>
                      <span className="os-list__top">
                        <strong className={t.status === 'erledigt' ? 'os-done' : ''}>{t.title}</strong>
                        <span className="os-row os-row--tight">
                          <PriorityBadge value={t.priority} />
                          <Badge tone={STATUS_TONE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                        </span>
                      </span>
                      <span className="os-list__sub">
                        {[t.order_number, t.customer_name].filter(Boolean).join(' · ') || 'ohne Bezug'}
                        {t.source === 'automatisierung' ? ' · automatisch' : ''}
                        {t.comments ? ` · ${t.comments} Kommentar(e)` : ''}
                      </span>
                      <span className="os-list__meta">
                        <span className="os-muted">{staffName(staff, t.assignee_id)}</span>
                        <span className={isOverdue(t.due_at) && t.status !== 'erledigt' ? 'os-overdue' : 'os-muted'}>{t.due_at ? `fällig ${dateOnly(t.due_at)}` : 'ohne Frist'}</span>
                      </span>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Empty title="Keine Aufgaben" text={scope === 'mine' ? `Für ${session.user.displayName} liegt nichts an.` : 'In dieser Ansicht gibt es keine Aufgaben.'} />
          )}
        </section>
        <section className="os-split__detail" aria-label="Aufgabe">
          {sel ? <TaskDetail id={sel} onBack={() => setSel(null)} onChanged={() => void reload(true)} /> : <Empty title="Keine Aufgabe ausgewählt" />}
        </section>
      </div>
      {creating ? (
        <TaskDialog
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

function TaskDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (id: number) => void }) {
  const { session, can } = useOs();
  const [t, setT] = useState({ title: '', description: '', priority: 'normal', due_at: '', remind_at: '', assignee_id: session.user.id as number | null });
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog
      title="Neue Aufgabe"
      onClose={onClose}
      footer={
        <>
          {error ? <p className="os-flash is-error">{error}</p> : <span />}
          <button
            type="button"
            className="os-btn"
            disabled={t.title.trim().length < 2}
            onClick={async () => {
              try {
                const r = await osFetch<{ id: number }>('tasks', { method: 'POST', body: { ...t, due_at: fromDateTimeInput(t.due_at), remind_at: fromDateTimeInput(t.remind_at) } });
                onSaved(r.id);
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            Anlegen
          </button>
        </>
      }
    >
      <div className="os-fields os-fields--2">
        <label className="os-field os-field--wide">
          <span className="os-field__label">Titel</span>
          <input value={t.title} onChange={(e) => setT({ ...t, title: e.target.value })} maxLength={200} />
        </label>
        <label className="os-field os-field--wide">
          <span className="os-field__label">Beschreibung</span>
          <textarea rows={3} value={t.description} onChange={(e) => setT({ ...t, description: e.target.value })} maxLength={4000} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Zuständig</span>
          {can('tasks.team') ? <StaffSelect value={t.assignee_id} onChange={(v) => setT({ ...t, assignee_id: v })} /> : <input value={session.user.displayName} disabled />}
        </label>
        <label className="os-field">
          <span className="os-field__label">Priorität</span>
          <select className="os-select" value={t.priority} onChange={(e) => setT({ ...t, priority: e.target.value })}>
            {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="os-field">
          <span className="os-field__label">Fällig</span>
          <input type="datetime-local" value={t.due_at} onChange={(e) => setT({ ...t, due_at: e.target.value })} />
        </label>
        <label className="os-field">
          <span className="os-field__label">Erinnerung</span>
          <input type="datetime-local" value={t.remind_at} onChange={(e) => setT({ ...t, remind_at: e.target.value })} />
        </label>
      </div>
    </Dialog>
  );
}

function TaskDetail({ id, onBack, onChanged }: { id: number; onBack: () => void; onChanged: () => void }) {
  const { openApp, can } = useOs();
  const staff = useStaff();
  const { data, error, loading, reload } = useOsData<{ task: TaskRow; comments: { id: number; at: string; author: string; text: string }[] }>(`tasks/${id}`);
  const [comment, setComment] = useState('');
  const flash = useFlash();
  const patch = async (body: Record<string, unknown>, msg: string) => {
    try {
      await osFetch(`tasks/${id}`, { method: 'POST', body });
      flash.show(true, msg);
      await reload(true);
      onChanged();
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const t = data.task;
  return (
    <div className="os-detail">
      <header className="os-detail__head">
        <button type="button" className="os-iconbtn os-detail__back" onClick={onBack} aria-label="Zurück">
          ‹
        </button>
        <div className="os-detail__title">
          <h2>{t.title}</h2>
          <p className="os-muted">
            angelegt {dateTime(t.created_at)} von {t.created_by || '–'}
            {t.source === 'automatisierung' ? ' (Automatisierung)' : ''}
            {t.done_at ? ` · erledigt ${dateTime(t.done_at)}` : ''}
          </p>
        </div>
        <div className="os-row os-row--tight">
          {t.order_id ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('orders', { orderId: t.order_id })}>
              Auftrag {t.order_number}
            </button>
          ) : null}
          {t.customer_id ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('customers', { customerId: t.customer_id })}>
              Kunde
            </button>
          ) : null}
        </div>
      </header>
      {flash.node}
      <div className="os-detail__body os-scroll">
        <div className="os-grid os-grid--detail">
          <div className="os-stack">
            <Panel title="Beschreibung">
              <p className="os-prewrap">{t.description || <span className="os-muted">–</span>}</p>
            </Panel>
            <Panel title={`Kommentare (${data.comments.length})`}>
              <ul className="os-notes-list">
                {data.comments.map((c) => (
                  <li key={c.id}>
                    <p>{c.text}</p>
                    <span className="os-muted os-small">
                      {dateTime(c.at)} · {c.author}
                    </span>
                  </li>
                ))}
              </ul>
              <form
                className="os-form"
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await osFetch(`tasks/${id}/comment`, { method: 'POST', body: { text: comment } });
                    setComment('');
                    await reload(true);
                    onChanged();
                  } catch (err) {
                    flash.show(false, (err as Error).message);
                  }
                }}
              >
                <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Kommentar" aria-label="Kommentar" />
                <button type="submit" className="os-btn os-btn--sm" disabled={!comment.trim()}>
                  Kommentieren
                </button>
              </form>
            </Panel>
          </div>
          <Panel title="Bearbeitung">
            <div className="os-fields">
              <label className="os-field">
                <span className="os-field__label">Status</span>
                <select className="os-select" value={t.status} onChange={(e) => void patch({ status: e.target.value }, `Status: ${STATUS_LABEL[e.target.value]}`)}>
                  {Object.entries(STATUS_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="os-field">
                <span className="os-field__label">Priorität</span>
                <select className="os-select" value={t.priority} onChange={(e) => void patch({ priority: e.target.value }, 'Priorität geändert')}>
                  {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <label className="os-field">
                <span className="os-field__label">Zuständig</span>
                <StaffSelect value={t.assignee_id} disabled={!can('tasks.team')} onChange={(v) => void patch({ assignee_id: v }, `Zugewiesen: ${staffName(staff, v)}`)} />
              </label>
              <label className="os-field">
                <span className="os-field__label">Fällig</span>
                <input type="datetime-local" value={toDateTimeInput(t.due_at)} onChange={(e) => void patch({ due_at: fromDateTimeInput(e.target.value) }, 'Frist geändert')} />
              </label>
              <label className="os-field">
                <span className="os-field__label">Erinnerung</span>
                <input type="datetime-local" value={toDateTimeInput(t.remind_at)} onChange={(e) => void patch({ remind_at: fromDateTimeInput(e.target.value) }, 'Erinnerung gesetzt')} />
              </label>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
