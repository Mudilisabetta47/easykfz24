import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AdminBar } from '../../../../components/admin/AdminBar.tsx';
import { OrderFacts } from '../../../../components/admin/OrderFacts.tsx';
import { StatusBadge } from '../../../../components/admin/StatusBadge.tsx';
import { checklistProgress, isChecklistComplete } from '../../../../lib/checklist.ts';
import { formatBytes, formatDateTime } from '../../../../lib/format.ts';
import { DOCUMENTS, SERVICES } from '../../../../lib/services.ts';
import { STATUSES, statusLabel, transitionOptions } from '../../../../lib/status.ts';
import { requireAdmin } from '../../../../server/auth.ts';
import { getOrder, listDocuments, listEvents, listNotes } from '../../../../server/orders.ts';
import { checklistAction, noteAction, plateAction, statusAction } from '../../actions.ts';

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return { title: `Auftrag ${id}` };
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ meldung?: string; fehler?: string }>;
}) {
  await requireAdmin();
  const { id: idRaw } = await params;
  const { meldung, fehler } = await searchParams;
  const id = Number(idRaw);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const order = getOrder(id);
  if (!order) notFound();

  const docs = listDocuments(id);
  const events = listEvents(id);
  const notes = listNotes(id);
  const complete = isChecklistComplete(order.checklistItems, order.checklist);
  const progress = checklistProgress(order.checklistItems, order.checklist);
  const options = transitionOptions(order.status, {
    service: order.service,
    delivery: order.delivery,
    checklistComplete: complete,
    hasAssignedPlate: order.assigned_plate !== '',
  });
  const forward = options.filter((o) => o.to !== 'storniert');
  const canCancel = options.some((o) => o.to === 'storniert');

  return (
    <>
      <AdminBar />
      <main className="admin-shell admin-main">
        <nav className="crumbs" aria-label="Brotkrumen">
          <Link href="/admin">Aufträge</Link> / <span>{order.number}</span>
        </nav>
        <header className="order-head">
          <div>
            <h1 className="admin-h1">{order.number}</h1>
            <p className="muted">
              {SERVICES[order.service].title} · {order.holder_name} · eingegangen {formatDateTime(order.created_at)}
            </p>
          </div>
          <div className="order-head__actions">
            <StatusBadge status={order.status} service={order.service} />
            <Link href={`/admin/auftraege/${id}/druck`} className="btn btn--ghost btn--sm" target="_blank">
              Druckansicht
            </Link>
          </div>
        </header>

        {meldung ? (
          <p className="alert alert--ok" role="status">
            {meldung}
          </p>
        ) : null}
        {fehler ? (
          <p className="alert alert--error" role="alert">
            {fehler}
          </p>
        ) : null}

        <div className="order-grid">
          <div className="order-grid__main">
            <section className="card panel" aria-labelledby="h-status">
              <h2 id="h-status">Status</h2>
              <ol className="flow" role="list">
                {(['neu', 'in_pruefung', 'bei_zulassungsstelle', 'zugelassen', order.delivery === 'versand' ? 'versendet' : 'abgeholt', 'abgeschlossen'] as const).map((s) => (
                  <li key={s} className={s === order.status ? 'is-current' : ''}>
                    {statusLabel(s, order.service)}
                  </li>
                ))}
              </ol>
              {forward.length ? (
                <form action={statusAction} className="status-change">
                  <input type="hidden" name="id" value={id} />
                  <div className="field">
                    <label htmlFor="publicMessage" className="field__label">
                      Nachricht an den Kunden <span className="field__opt">optional · sichtbar in der Statusabfrage</span>
                    </label>
                    <textarea id="publicMessage" name="publicMessage" rows={2} maxLength={1000} placeholder="z. B. Bitte ZB II im Original nachreichen." />
                  </div>
                  <div className="field">
                    <label htmlFor="internalMessage" className="field__label">
                      Interner Kommentar <span className="field__opt">optional</span>
                    </label>
                    <input id="internalMessage" name="internalMessage" maxLength={1000} />
                  </div>
                  <fieldset className="status-change__options">
                    <legend className="field__label">Nächster Schritt</legend>
                    {forward.map((o, i) => (
                      <label key={o.to} className={`status-change__opt${o.check.ok ? '' : ' is-disabled'}`}>
                        <input
                          type="radio"
                          name="to"
                          value={o.to}
                          disabled={!o.check.ok}
                          required
                          defaultChecked={o.check.ok && forward.findIndex((f) => f.check.ok) === i}
                        />
                        <span>
                          <strong>{statusLabel(o.to, order.service)}</strong>
                          {!o.check.ok ? <span className="status-change__why">{o.check.reason}</span> : null}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <button type="submit" className="btn btn--sm status-change__submit" disabled={!forward.some((o) => o.check.ok)}>
                    Status ändern
                  </button>
                </form>
              ) : (
                <p className="muted">Der Auftrag ist {STATUSES[order.status].label.toLowerCase()} – keine weiteren Schritte.</p>
              )}
              {canCancel ? (
                <details className="cancel">
                  <summary>Auftrag stornieren</summary>
                  <form action={statusAction} className="cancel__form">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="to" value="storniert" />
                    <div className="field">
                      <label htmlFor="cancel-msg" className="field__label">
                        Begründung für den Kunden
                      </label>
                      <textarea id="cancel-msg" name="publicMessage" rows={2} required maxLength={1000} />
                    </div>
                    <button type="submit" className="btn btn--sm btn--danger">
                      Endgültig stornieren
                    </button>
                  </form>
                </details>
              ) : null}
            </section>

            <section className="card panel" aria-labelledby="h-check">
              <div className="panel__head">
                <h2 id="h-check">Unterlagen-Checkliste</h2>
                <span className={`chip ${complete ? 'chip--ok' : ''}`}>
                  {progress.done} / {progress.total} {complete ? '· Pflicht vollständig' : ''}
                </span>
              </div>
              <ul className="checklist" role="list">
                {order.checklistItems.map((item) => {
                  const st = order.checklist[item.key];
                  const checked = st?.checked === true;
                  return (
                    <li key={item.key}>
                      <form action={checklistAction}>
                        <input type="hidden" name="id" value={id} />
                        <input type="hidden" name="key" value={item.key} />
                        <input type="hidden" name="checked" value={checked ? '0' : '1'} />
                        <button type="submit" className={`checkrow${checked ? ' is-checked' : ''}`} aria-pressed={checked}>
                          <span className="checkrow__box" aria-hidden="true" />
                          <span className="checkrow__label">
                            {item.label}
                            {!item.required ? <span className="field__opt">optional</span> : null}
                          </span>
                          {st ? <span className="checkrow__at">{formatDateTime(st.at)}</span> : null}
                        </button>
                      </form>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section className="card panel" aria-labelledby="h-docs">
              <h2 id="h-docs">Dokumente</h2>
              {docs.length ? (
                <ul className="doclist" role="list">
                  {docs.map((d) => (
                    <li key={d.id}>
                      <span className="chip chip--blue">{DOCUMENTS[d.kind]?.short ?? d.kind}</span>
                      <span className="doclist__name">{d.original_name}</span>
                      <span className="muted">
                        {d.mime.split('/')[1].toUpperCase()} · {formatBytes(d.size)}
                      </span>
                      <a href={`/api/admin/dokumente/${d.id}`} target="_blank" rel="noopener" className="link">
                        Ansehen
                      </a>
                      <a href={`/api/admin/dokumente/${d.id}?download=1`} className="link">
                        Download
                      </a>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">Keine Dokumente.</p>
              )}
            </section>

            <section className="card panel" aria-labelledby="h-data">
              <h2 id="h-data">Angaben</h2>
              <OrderFacts order={order} />
            </section>
          </div>

          <aside className="order-grid__side">
            <section className="card panel" aria-labelledby="h-plate">
              <h2 id="h-plate">Zugeteiltes Kennzeichen</h2>
              <form action={plateAction} className="inline-form">
                <input type="hidden" name="id" value={id} />
                <label htmlFor="plate" className="sr-only">
                  Kennzeichen
                </label>
                <input id="plate" name="plate" className="input--mono" defaultValue={order.assigned_plate} placeholder="z. B. HB-EZ 24" />
                <button type="submit" className="btn btn--sm">
                  Speichern
                </button>
              </form>
              {order.data.plate.wunschkennzeichen ? <p className="muted small">Wunsch des Kunden: {order.data.plate.wunschkennzeichen}</p> : null}
            </section>

            <section className="card panel" aria-labelledby="h-notes">
              <h2 id="h-notes">Interne Notizen</h2>
              <form action={noteAction} className="note-form">
                <input type="hidden" name="id" value={id} />
                <label htmlFor="note" className="sr-only">
                  Neue Notiz
                </label>
                <textarea id="note" name="text" rows={3} required maxLength={4000} placeholder="Nur intern sichtbar" />
                <button type="submit" className="btn btn--sm">
                  Notiz speichern
                </button>
              </form>
              <ul className="notes" role="list">
                {notes.map((n) => (
                  <li key={n.id}>
                    <p>{n.text}</p>
                    <span className="muted small">{formatDateTime(n.at)}</span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="card panel" aria-labelledby="h-log">
              <h2 id="h-log">Verlauf</h2>
              <ol className="log" role="list">
                {events.map((ev) => (
                  <li key={ev.id}>
                    <span className="log__at">{formatDateTime(ev.at)}</span>
                    <span className="log__text">
                      {ev.type === 'status' && ev.from_status && ev.to_status
                        ? `${statusLabel(ev.from_status, order.service)} → ${statusLabel(ev.to_status, order.service)}`
                        : ev.message}
                      {ev.type === 'status' && ev.message ? <span className="muted"> · {ev.message}</span> : null}
                      {ev.public_message ? <span className="log__public">An Kunden: {ev.public_message}</span> : null}
                    </span>
                    <span className="log__actor">{ev.actor}</span>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
