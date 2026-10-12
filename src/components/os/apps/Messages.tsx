'use client';

// Kommunikationszentrale: Kunden-E-Mails zu Aufträgen mit Vorlagen, Entwürfe (auch von Automatisierungen),
// Versandstatus, fehlgeschlagene Nachrichten, automatische Statusmails. Eingehende E-Mails brauchen eine echte
// E-Mail-Anbindung – bis dahin gibt es keinen (simulierten) Posteingang.

import { useEffect, useState } from 'react';
import type { OrderListRow } from '../../../server/os/order-query.ts';
import { dateTime, osFetch, useOsData } from '../api.ts';
import { useOs } from '../context.ts';
import { IRefresh, ISearch } from '../icons.tsx';
import { Chips } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Loading, Panel, Tabs, useFlash } from '../ui.tsx';

interface Msg {
  id: number;
  at: string;
  order_id: number | null;
  number: string | null;
  customer_id: number | null;
  to_addr: string;
  subject: string;
  body: string;
  state: string;
  error: string;
  author: string;
  sent_at: string;
  template_id: string;
  source: string;
}
interface Template {
  id: string;
  name: string;
  subject: string;
  body: string;
  custom: boolean;
}

type Tab = 'verlauf' | 'verfassen' | 'vorlagen' | 'posteingang';
type Filter = 'alle' | 'entwurf' | 'versendet' | 'fehler';
const STATE_TONE: Record<string, string> = { versendet: 'green', entwurf: 'blue', fehler: 'red', nicht_versendet: 'amber' };

export function MessagesApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { can } = useOs();
  const [tab, setTab] = useState<Tab>('verlauf');
  const [filter, setFilter] = useState<Filter>('alle');
  const [compose, setCompose] = useState<{ orderId: number | null; templateId: string; draft: Msg | null }>({ orderId: null, templateId: '', draft: null });
  const [sel, setSel] = useState<number | null>(null);
  useEffect(() => {
    if (typeof params?.compose === 'number') {
      setCompose({ orderId: params.compose, templateId: (params.template as string) ?? '', draft: null });
      setTab('verfassen');
    }
    if (typeof params?.messageId === 'number') {
      setSel(params.messageId);
      setTab('verlauf');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  const list = useOsData<{ messages: Msg[]; statusMails: { id: number; at: string; order_id: number; number: string; subject: string; state: string; error: string; topic: string }[]; mailReady: boolean; canSend: boolean }>(
    `messages${filter !== 'alle' ? `?state=${filter}` : ''}`,
    { pollMs: 30_000 },
  );
  const msg = list.data?.messages.find((m) => m.id === sel) ?? null;

  return (
    <div className="os-app os-app--fill">
      <div className="os-toolbar os-toolbar--wrap">
        <Tabs<Tab>
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'verlauf', label: 'Nachrichten' },
            ...(can('messages.send') ? [{ id: 'verfassen' as Tab, label: 'Verfassen' }] : []),
            { id: 'vorlagen', label: 'Vorlagen' },
            { id: 'posteingang', label: 'Posteingang' },
          ]}
        />
        <button type="button" className="os-iconbtn" onClick={() => void list.reload()} aria-label="Aktualisieren">
          <IRefresh width={16} height={16} />
        </button>
        {list.data && !list.data.mailReady ? <Badge tone="amber">E-Mail-Versand nicht eingerichtet</Badge> : null}
      </div>
      {tab === 'verlauf' ? (
        <div className={`os-split os-split--wide${sel ? ' has-detail' : ''}`}>
          <section className="os-split__list">
            <div className="os-toolbar">
              <Chips<Filter>
                value={filter}
                onChange={setFilter}
                options={[
                  { id: 'alle', label: 'Alle' },
                  { id: 'entwurf', label: 'Entwürfe' },
                  { id: 'versendet', label: 'Versendet' },
                  { id: 'fehler', label: 'Fehlgeschlagen' },
                ]}
              />
            </div>
            {list.loading && !list.data ? (
              <Loading />
            ) : list.error && !list.data ? (
              <ErrorBox message={list.error} onRetry={() => void list.reload()} />
            ) : list.data?.messages.length || list.data?.statusMails.length ? (
              <ul className="os-list">
                {list.data.messages.map((m) => (
                  <li key={m.id}>
                    <button type="button" className={sel === m.id ? 'is-sel' : ''} onClick={() => setSel(m.id)}>
                      <span className="os-list__top">
                        <strong>{m.subject}</strong>
                        <Badge tone={STATE_TONE[m.state] ?? 'slate'}>{m.state}</Badge>
                      </span>
                      <span className="os-list__sub">
                        {m.number ?? '–'} · an {m.to_addr || '–'}
                      </span>
                      <span className="os-list__meta">
                        <span className="os-muted">
                          {m.author}
                          {m.source === 'automatisierung' ? ' · automatisch vorbereitet' : ''}
                        </span>
                        <span className="os-muted">{dateTime(m.at)}</span>
                      </span>
                    </button>
                  </li>
                ))}
                {filter === 'alle' || filter === 'fehler'
                  ? list.data.statusMails.map((m) => (
                      <li key={`s${m.id}`}>
                        <div className="os-list__static">
                          <span className="os-list__top">
                            <span>{m.subject}</span>
                            <Badge tone={STATE_TONE[m.state] ?? 'slate'}>{m.state}</Badge>
                          </span>
                          <span className="os-list__sub">
                            {m.number} · automatische Statusmail · {dateTime(m.at)}
                            {m.error ? ` · ${m.error}` : ''}
                          </span>
                        </div>
                      </li>
                    ))
                  : null}
              </ul>
            ) : (
              <Empty title="Keine Nachrichten" />
            )}
          </section>
          <section className="os-split__detail">
            {msg ? (
              <MessageView
                msg={msg}
                canSend={!!list.data?.canSend}
                onEdit={() => {
                  setCompose({ orderId: msg.order_id, templateId: msg.template_id, draft: msg });
                  setTab('verfassen');
                }}
                onChanged={() => {
                  setSel(null);
                  void list.reload(true);
                }}
              />
            ) : (
              <Empty title="Keine Nachricht ausgewählt" />
            )}
          </section>
        </div>
      ) : null}
      {tab === 'verfassen' ? (
        <Compose
          initial={compose}
          mailReady={!!list.data?.mailReady}
          onSent={() => {
            setCompose({ orderId: null, templateId: '', draft: null });
            setTab('verlauf');
            void list.reload(true);
          }}
        />
      ) : null}
      {tab === 'vorlagen' ? <Templates canEdit={can('messages.send')} /> : null}
      {tab === 'posteingang' ? (
        <div className="os-app__pad">
          <Panel title="Posteingang">
            <p>Für eingehende Kundenantworten ist noch keine E-Mail-Anbindung eingerichtet. Es werden deshalb keine Eingänge angezeigt – auch keine Beispiele.</p>
            <p className="os-muted os-small">
              Möglich z. B. über Cloudflare Email Routing (Weiterleitung an einen Worker) oder ein Postfach mit IMAP-Abruf über einen Server-Dienst. Antworten der Kunden gehen bis
              dahin an die Antwort-Adresse aus den Unternehmenseinstellungen.
            </p>
          </Panel>
        </div>
      ) : null}
    </div>
  );
}

function MessageView({ msg, canSend, onEdit, onChanged }: { msg: Msg; canSend: boolean; onEdit: () => void; onChanged: () => void }) {
  const { openApp } = useOs();
  const flash = useFlash();
  return (
    <div className="os-detail">
      <header className="os-detail__head">
        <div className="os-detail__title">
          <h2>{msg.subject}</h2>
          <p className="os-muted">
            an {msg.to_addr || '–'} · {msg.state === 'versendet' ? `versendet ${dateTime(msg.sent_at || msg.at)}` : `erstellt ${dateTime(msg.at)}`} · {msg.author}
          </p>
        </div>
        <div className="os-row os-row--tight">
          {msg.order_id ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => openApp('orders', { orderId: msg.order_id, tab: 'kommunikation' })}>
              Auftrag {msg.number}
            </button>
          ) : null}
          {canSend && msg.state !== 'versendet' ? (
            <button type="button" className="os-btn os-btn--sm" onClick={onEdit}>
              {msg.state === 'entwurf' ? 'Prüfen & senden' : 'Erneut senden'}
            </button>
          ) : null}
          {canSend && msg.state === 'entwurf' ? (
            <button
              type="button"
              className="os-btn os-btn--ghost os-btn--sm"
              onClick={async () => {
                try {
                  await osFetch(`messages/${msg.id}/discard`, { method: 'POST', body: {} });
                  onChanged();
                } catch (e) {
                  flash.show(false, (e as Error).message);
                }
              }}
            >
              Verwerfen
            </button>
          ) : null}
        </div>
      </header>
      {flash.node}
      <div className="os-detail__body os-scroll">
        {msg.error ? <p className="os-flash is-error">{msg.error}</p> : null}
        <pre className="os-mailbody">{msg.body || '(Inhalt nach Anonymisierung entfernt)'}</pre>
      </div>
    </div>
  );
}

function Compose({ initial, mailReady, onSent }: { initial: { orderId: number | null; templateId: string; draft: Msg | null }; mailReady: boolean; onSent: () => void }) {
  const templates = useOsData<Template[]>('messages/templates');
  const [orderId, setOrderId] = useState<number | null>(initial.orderId);
  const [orderQ, setOrderQ] = useState('');
  const [hits, setHits] = useState<OrderListRow[]>([]);
  const [templateId, setTemplateId] = useState(initial.templateId);
  const [missing, setMissing] = useState('');
  const [m, setM] = useState({ to: initial.draft?.to_addr ?? '', subject: initial.draft?.subject ?? '', body: initial.draft?.body ?? '' });
  const [busy, setBusy] = useState(false);
  const flash = useFlash();
  const order = useOsData<{ order: { number: string; holder_name: string; email: string } }>(orderId ? `orders/${orderId}` : null);

  useEffect(() => {
    if (orderQ.trim().length < 2) return setHits([]);
    const t = window.setTimeout(() => {
      osFetch<OrderListRow[]>(`orders?status=alle&limit=8&q=${encodeURIComponent(orderQ)}`).then(setHits, () => setHits([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [orderQ]);

  const render = async () => {
    if (!orderId || !templateId) return;
    try {
      const r = await osFetch<{ subject: string; body: string; to: string }>('messages/preview', { method: 'POST', body: { orderId, templateId, missing } });
      setM({ to: r.to, subject: r.subject, body: r.body });
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };
  useEffect(() => {
    if (!initial.draft) void render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, templateId]);
  useEffect(() => {
    if (!m.to && order.data?.order.email) setM((x) => ({ ...x, to: order.data!.order.email }));
  }, [order.data, m.to]);

  return (
    <div className="os-scroll os-app__pad">
      {flash.node}
      <div className="os-grid os-grid--detail">
        <Panel title="Nachricht">
          <div className="os-fields">
            <label className="os-field">
              <span className="os-field__label">Auftrag</span>
              {orderId ? (
                <span className="os-row">
                  <strong className="os-mono">{order.data?.order.number ?? `#${orderId}`}</strong> {order.data?.order.holder_name}
                  {!initial.draft ? (
                    <button type="button" className="os-linkbtn" onClick={() => setOrderId(null)}>
                      ändern
                    </button>
                  ) : null}
                </span>
              ) : (
                <>
                  <span className="os-searchbox">
                    <ISearch width={16} height={16} />
                    <input value={orderQ} onChange={(e) => setOrderQ(e.target.value)} placeholder="Auftrag suchen (Nummer, Name, E-Mail)" />
                  </span>
                  {hits.length ? (
                    <ul className="os-plain">
                      {hits.map((h) => (
                        <li key={h.id}>
                          <button type="button" className="os-linkbtn" onClick={() => (setOrderId(h.id), setOrderQ(''), setHits([]))}>
                            {h.number} · {h.holder_name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </>
              )}
            </label>
            <label className="os-field">
              <span className="os-field__label">Vorlage</span>
              <select className="os-select" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                <option value="">– ohne Vorlage –</option>
                {(templates.data ?? []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            {templateId === 'unterlagen_anfordern' ? (
              <label className="os-field">
                <span className="os-field__label">Fehlende Unterlagen (für die Vorlage)</span>
                <textarea rows={2} value={missing} onChange={(e) => setMissing(e.target.value)} onBlur={() => void render()} placeholder="z. B. Zulassungsbescheinigung Teil II im Original" />
              </label>
            ) : null}
            <label className="os-field">
              <span className="os-field__label">An</span>
              <input type="email" value={m.to} onChange={(e) => setM({ ...m, to: e.target.value })} />
            </label>
            <label className="os-field">
              <span className="os-field__label">Betreff</span>
              <input value={m.subject} onChange={(e) => setM({ ...m, subject: e.target.value })} maxLength={200} />
            </label>
            <label className="os-field">
              <span className="os-field__label">Text</span>
              <textarea rows={14} value={m.body} onChange={(e) => setM({ ...m, body: e.target.value })} />
            </label>
          </div>
          <div className="os-row">
            <button
              type="button"
              className="os-btn"
              disabled={busy || !orderId || !m.to || !m.subject || !m.body || !mailReady}
              onClick={async () => {
                if (/\[Bitte .*eintragen\]/.test(m.body) && !window.confirm('Der Text enthält noch einen Platzhalter in eckigen Klammern. Trotzdem senden?')) return;
                setBusy(true);
                try {
                  await osFetch('messages/send', { method: 'POST', body: { orderId, to: m.to, subject: m.subject, body: m.body, templateId, draftId: initial.draft?.id ?? null } });
                  flash.show(true, 'E-Mail versendet');
                  onSent();
                } catch (e) {
                  flash.show(false, (e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? 'Wird gesendet …' : 'Senden'}
            </button>
            {!mailReady ? <span className="os-muted os-small">Versand erst nach Einrichtung (RESEND_API_KEY, MAIL_FROM) möglich.</span> : null}
          </div>
        </Panel>
        <Panel title="Hinweise">
          <ul className="os-plain os-small">
            <li>Platzhalter werden ausschließlich mit echten Auftragsdaten gefüllt.</li>
            <li>Der Versand wird mit echtem Status gespeichert (versendet/Fehler) und erscheint im Auftrag und beim Kunden.</li>
            <li>Automatisch vorbereitete Nachrichten (z. B. nach der Zulassung) werden nie ohne Prüfung versendet.</li>
          </ul>
        </Panel>
      </div>
    </div>
  );
}

function Templates({ canEdit }: { canEdit: boolean }) {
  const { data, loading, reload } = useOsData<Template[]>('messages/templates');
  const [edit, setEdit] = useState<Template | null>(null);
  const flash = useFlash();
  if (loading && !data) return <Loading />;
  return (
    <div className="os-scroll os-app__pad">
      {flash.node}
      <div className="os-grid os-grid--detail">
        <Panel title="Vorlagen">
          <ul className="os-msglist">
            {(data ?? []).map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setEdit(t)} className={edit?.id === t.id ? 'is-sel' : ''}>
                  <strong>{t.name}</strong>
                  <span className="os-muted os-small">{t.subject}</span>
                  {t.custom ? <Badge tone="violet">angepasst</Badge> : null}
                </button>
              </li>
            ))}
          </ul>
          {canEdit ? (
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => setEdit({ id: '', name: '', subject: '', body: '', custom: true })}>
              + Neue Vorlage
            </button>
          ) : null}
          <p className="os-muted os-small">
            Platzhalter: {'{{auftrag}} {{anrede_name}} {{leistung}} {{status}} {{status_link}} {{zahlung_link}} {{betrag}} {{kennzeichen}} {{firma}} {{fehlende_unterlagen}}'}
          </p>
        </Panel>
        {edit ? (
          <Panel title={edit.id ? `Vorlage „${edit.name}“` : 'Neue Vorlage'}>
            <div className="os-fields">
              <label className="os-field">
                <span className="os-field__label">Kennung</span>
                <input className="os-mono" value={edit.id} onChange={(e) => setEdit({ ...edit, id: e.target.value })} disabled={!!data?.some((t) => t.id === edit.id && !t.custom) || !canEdit} placeholder="z. B. termin_info" />
              </label>
              <label className="os-field">
                <span className="os-field__label">Name</span>
                <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} disabled={!canEdit} />
              </label>
              <label className="os-field">
                <span className="os-field__label">Betreff</span>
                <input value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} disabled={!canEdit} />
              </label>
              <label className="os-field">
                <span className="os-field__label">Text</span>
                <textarea rows={14} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} disabled={!canEdit} />
              </label>
            </div>
            {canEdit ? (
              <div className="os-row">
                <button
                  type="button"
                  className="os-btn os-btn--sm"
                  onClick={async () => {
                    try {
                      await osFetch('messages/templates', { method: 'POST', body: edit });
                      flash.show(true, 'Vorlage gespeichert');
                      void reload(true);
                    } catch (e) {
                      flash.show(false, (e as Error).message);
                    }
                  }}
                >
                  Speichern
                </button>
                {edit.custom && edit.id ? (
                  <button
                    type="button"
                    className="os-btn os-btn--ghost os-btn--sm"
                    onClick={async () => {
                      await osFetch(`messages/templates/${edit.id}/reset`, { method: 'POST', body: {} });
                      flash.show(true, 'Auf Standard zurückgesetzt');
                      setEdit(null);
                      void reload(true);
                    }}
                  >
                    Zurücksetzen
                  </button>
                ) : null}
              </div>
            ) : null}
          </Panel>
        ) : (
          <Empty title="Vorlage wählen" />
        )}
      </div>
    </div>
  );
}
