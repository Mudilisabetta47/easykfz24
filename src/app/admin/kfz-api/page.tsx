import Link from 'next/link';
import { AdminBar } from '../../../components/admin/AdminBar.tsx';
import { AutoRefresh } from '../../../components/AutoRefresh.tsx';
import { formatDateTime } from '../../../lib/format.ts';
import { BUSINESS_TRANSACTIONS, DISPLAY, displayFor, KFZ_STATUSES, KFZ_STATUS_TEXT } from '../../../lib/kfz-api.ts';
import { requireAdmin } from '../../../server/auth.ts';
import { kfzApiConfigured, kfzEventStats, kfzWebhookConfigured, kfzWebhookUrl, listKfzEvents } from '../../../server/kfz-api.ts';
import { mailConfigured } from '../../../server/mailer.ts';
import { kfzAssignAction, kfzCheckAction, kfzSelfTestAction } from '../actions.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'kfz-api.de' };

const OUTCOME: Record<string, { label: string; tone: string }> = {
  verarbeitet: { label: 'Verarbeitet', tone: 'green' },
  ping: { label: 'PING / Test', tone: 'blue' },
  nicht_zugeordnet: { label: 'Nicht zugeordnet', tone: 'amber' },
  fehler: { label: 'Fehler', tone: 'red' },
};

function Check({ ok, label, hint }: { ok: boolean; label: string; hint: string }) {
  return (
    <li className={`kfz-check ${ok ? 'is-ok' : 'is-missing'}`}>
      <span className={`badge badge--${ok ? 'green' : 'amber'}`}>{ok ? 'eingerichtet' : 'fehlt'}</span>
      <span>
        <strong>{label}</strong>
        <span className="muted"> – {hint}</span>
      </span>
    </li>
  );
}

export default async function KfzApiPage({ searchParams }: { searchParams: Promise<{ meldung?: string; fehler?: string }> }) {
  await requireAdmin();
  const { meldung, fehler } = await searchParams;
  const events = await listKfzEvents(100);
  const stats = await kfzEventStats();
  const url = kfzWebhookUrl();
  const https = url.startsWith('https://');

  return (
    <>
      <AdminBar />
      <AutoRefresh seconds={20} />
      <main className="admin-shell admin-main">
        <nav className="crumbs" aria-label="Brotkrumen">
          <Link href="/admin">Aufträge</Link> / <span>kfz-api.de</span>
        </nav>
        <h1 className="admin-h1">kfz-api.de</h1>
        <p className="muted">Statusmeldungen der Zulassungsschnittstelle (KBA-Großkundenschnittstelle) per Webhook.</p>

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
            <section className="card panel" aria-labelledby="h-setup">
              <h2 id="h-setup" className="panel__title">
                Einrichtung
              </h2>
              <p>Webhook-Adresse für das kfz-api.de-Dashboard (Webhooks):</p>
              <p className="kfz-url mono">{url}</p>
              {!https ? (
                <p className="alert alert--error">
                  Die Adresse ist nicht öffentlich (kein HTTPS). Auf dem Server <code>PUBLIC_BASE_URL</code> auf die echte Domain setzen.
                </p>
              ) : null}
              <ul className="kfz-checks" role="list">
                <Check ok={kfzWebhookConfigured()} label="KFZ_API_WEBHOOK_SECRET" hint="Signaturschlüssel des Webhooks aus dem Dashboard" />
                <Check ok={kfzApiConfigured()} label="KFZ_API_BASE_URL / KFZ_API_LOGIN / KFZ_API_PASSWORD" hint="lesender API-Zugang für Verbindungstest und Belege" />
                <Check ok={mailConfigured()} label="RESEND_API_KEY / MAIL_FROM" hint="E-Mail-Benachrichtigung der Kunden (auf Cloudflare nur per HTTP-API)" />
                <Check ok={https} label="PUBLIC_BASE_URL" hint="öffentliche HTTPS-Adresse der Website" />
              </ul>
              <div className="kfz-actions">
                <form action={kfzSelfTestAction}>
                  <button type="submit" className="btn btn--sm">
                    Eigenen Endpunkt testen (signierter PING)
                  </button>
                </form>
                <form action={kfzCheckAction}>
                  <button type="submit" className="btn btn--ghost btn--sm">
                    API-Verbindung prüfen (nur lesend)
                  </button>
                </form>
              </div>
              <p className="muted small">
                Es werden keine Anträge an kfz-api.de gesendet. Laut Anbieter gibt es keine Testumgebung – jeder gültige Antrag geht
                produktiv an das KBA.
              </p>
            </section>

            <section className="card panel" aria-labelledby="h-events">
              <h2 id="h-events" className="panel__title">
                Webhook-Protokoll <span className="muted">({stats.total} gesamt{stats.problems ? `, ${stats.problems} zu prüfen` : ''})</span>
              </h2>
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th scope="col">Eingang</th>
                      <th scope="col">Ergebnis</th>
                      <th scope="col">Vorgang</th>
                      <th scope="col">Status</th>
                      <th scope="col">Auftrag</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="table__empty">
                          Noch keine Meldungen eingegangen.
                        </td>
                      </tr>
                    ) : (
                      events.map((e) => {
                        const o = OUTCOME[e.outcome] ?? { label: e.outcome, tone: 'slate' };
                        const d = displayFor(e.status || null, e.derived_status || null, null);
                        return (
                          <tr key={e.event_id}>
                            <td>
                              {formatDateTime(e.received_at)}
                              {e.deliveries > 1 ? <span className="muted small"> · {e.deliveries}× zugestellt</span> : null}
                              <div className="muted small mono">{e.event_id}</div>
                            </td>
                            <td>
                              <span className={`badge badge--${o.tone}`}>{o.label}</span>
                              {e.error ? <div className="muted small">{e.error}</div> : null}
                            </td>
                            <td className="mono">
                              {e.kfz_order_id || '–'}
                              {e.business_transaction ? <div className="muted small">{e.business_transaction}</div> : null}
                            </td>
                            <td>
                              {e.status || e.derived_status || '–'}
                              {d ? <div className="muted small">{DISPLAY[d].label}</div> : null}
                            </td>
                            <td>
                              {e.order_id && e.order_number ? (
                                <Link href={`/admin/auftraege/${e.order_id}`}>{e.order_number}</Link>
                              ) : e.outcome === 'nicht_zugeordnet' || (e.outcome === 'fehler' && e.kfz_order_id) ? (
                                <form action={kfzAssignAction} className="admin-mini-form">
                                  <input type="hidden" name="eventId" value={e.event_id} />
                                  <label className="sr-only" htmlFor={`n-${e.event_id}`}>
                                    Auftragsnummer
                                  </label>
                                  <input id={`n-${e.event_id}`} name="number" placeholder="EK-2026-…" className="input--mono" required />
                                  <button type="submit" className="btn btn--ghost btn--sm">
                                    Zuordnen
                                  </button>
                                </form>
                              ) : (
                                <span className="muted">{e.external_id || '–'}</span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <aside className="order-grid__side">
            <section className="card panel" aria-labelledby="h-map">
              <h2 id="h-map" className="panel__title">
                Statuszuordnung
              </h2>
              <table className="table table--compact">
                <tbody>
                  {KFZ_STATUSES.map((s) => {
                    const d = displayFor(s, null, false);
                    return (
                      <tr key={s}>
                        <th scope="row" className="mono small">
                          {s}
                        </th>
                        <td className="small">
                          {d ? DISPLAY[d].label : '–'}
                          <div className="muted">{KFZ_STATUS_TEXT[s]}</div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="muted small">
                FAILED mit retryable = true gilt als vorübergehend („In Bearbeitung“). Ohne Status entscheidet derivedStatus (PENDING,
                SUCCESS, FAILURE). Zuordnung zum Auftrag über order.externalId = Auftragsnummer oder die verknüpfte Vorgangsnummer.
              </p>
            </section>
            <section className="card panel" aria-labelledby="h-bt">
              <h2 id="h-bt" className="panel__title">
                Vorgangsarten
              </h2>
              <ul className="muted small kfz-bt" role="list">
                {Object.entries(BUSINESS_TRANSACTIONS).map(([k, v]) => (
                  <li key={k}>
                    <strong className="mono">{k}</strong> {v.label}
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
