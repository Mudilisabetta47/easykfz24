'use client';

import { useActionState, useEffect, useRef } from 'react';
import { DISPLAY, type DisplayStatus } from '../../../lib/kfz-status.ts';
import { formatDateTime } from '../../../lib/format.ts';
import { SERVICES } from '../../../lib/services.ts';
import { STATUSES, statusLabel } from '../../../lib/status.ts';
import { ArrowRight } from '../../../components/icons.tsx';
import { GermanLicensePlate } from '../../../components/GermanLicensePlate.tsx';
import { splitPlate } from '../../../lib/plate.ts';
import { lookupAction, type StatusState } from './actions.ts';
import { formatEuro } from '../../../lib/format.ts';
import { PAYMENT_STATUS_LABEL } from '../../../lib/payment.ts';
import { CARRIERS } from '../../../lib/shipping.ts';

export function StatusLookup({ initialNr }: { initialNr: string }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(lookupAction, { nr: initialNr });
  const r = state.result;
  const plateParts = r?.assignedPlate ? splitPlate(r.assignedPlate) : null;
  const formRef = useRef<HTMLFormElement>(null);

  // Stand alle drei Minuten selbst aktualisieren, solange die Seite sichtbar ist (schont das Abfragelimit).
  useEffect(() => {
    if (!r) return;
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible' && !pending) formRef.current?.requestSubmit();
    }, 180_000);
    return () => window.clearInterval(t);
  }, [r, pending]);

  return (
    <div className="status-grid">
      <form action={action} className="card status-form" noValidate ref={formRef}>
        <h2>Vorgang abrufen</h2>
        <div className="field">
          <label htmlFor="st-nr" className="field__label">
            Auftragsnummer
          </label>
          <input id="st-nr" name="nr" className="input--mono" placeholder="EK-2026-00001" defaultValue={state.nr} autoComplete="off" required />
        </div>
        <div className="field">
          <label htmlFor="st-email" className="field__label">
            E-Mail-Adresse
          </label>
          <input id="st-email" name="email" type="email" defaultValue={state.email} autoComplete="email" required />
        </div>
        {state.error ? (
          <p className="alert alert--error" role="alert">
            {state.error}
          </p>
        ) : null}
        <button type="submit" className="btn" disabled={pending} aria-busy={pending}>
          {pending ? 'Wird abgerufen …' : 'Status anzeigen'}
          {!pending ? <ArrowRight className="btn__icon" /> : null}
        </button>
      </form>

      <div aria-live="polite">
        {r ? (
          <div className="card status-result">
            <div className="status-result__head">
              <div>
                <p className="label">Vorgang</p>
                <p className="status-result__nr">{r.number}</p>
                <p className="muted">
                  {SERVICES[r.service].title} · eingegangen am {formatDateTime(r.createdAt)}
                </p>
              </div>
              <span className={`badge badge--${STATUSES[r.status].tone}`}>{statusLabel(r.status, r.service, 'kunde')}</span>
            </div>
            <p className="status-result__text">{STATUSES[r.status].publicText}</p>
            {r.express ? <ExpressSteps express={r.express} /> : null}
            {r.vollmacht ? (
              <div className={`status-poa status-poa--${r.vollmacht.view}`}>
                <p className="label">Digitale Vollmacht</p>
                <p className="status-poa__title">{r.vollmacht.title}</p>
                {r.vollmacht.verifiedAt ? <p className="muted status-poa__meta">Bestätigt über unseren Vollmachtspartner: {formatDateTime(r.vollmacht.verifiedAt)}</p> : null}
                {r.vollmacht.signatureUrl ? (
                  <a className="btn btn--sm" href={r.vollmacht.signatureUrl} rel="noopener noreferrer">
                    Jetzt online unterschreiben
                  </a>
                ) : null}
              </div>
            ) : null}
            <ProcessSteps display={(r.kfzDisplay || 'eingegangen') as DisplayStatus} timeline={r.kfzTimeline} />
            <dl className="status-facts">
              <div>
                <dt>Servicekosten</dt>
                <dd>
                  {formatEuro(r.totalCents)} · <span className={`pay-status pay-status--${r.paymentStatus}`}>{PAYMENT_STATUS_LABEL[r.paymentStatus]}</span>
                  {r.paymentStatus === 'offen' && state.payOnline ? (
                    <>
                      {' '}
                      · <a href={`/zahlung/${r.number}?t=${encodeURIComponent(r.paymentToken)}`}>Jetzt bezahlen</a>
                    </>
                  ) : null}
                </dd>
              </div>
              {r.paymentStatus === 'offen' && state.bankTransfer ? (
                <div>
                  <dt>Zahlung per Überweisung</dt>
                  <dd>
                    {state.bankTransfer.recipient} · IBAN {state.bankTransfer.iban}
                    {state.bankTransfer.bic ? ` · BIC ${state.bankTransfer.bic}` : ''} · Betrag {formatEuro(state.bankTransfer.amountCents)} · Verwendungszweck{' '}
                    {state.bankTransfer.reference} · zahlbar bis {state.bankTransfer.dueDate.split('-').reverse().join('.')}
                  </dd>
                </div>
              ) : null}
              {r.delivery === 'versand' && r.carrier ? (
                <div>
                  <dt>Versand</dt>
                  <dd>
                    {CARRIERS[r.carrier].name}
                    {r.trackingNumber ? (
                      <>
                        {' '}
                        ·{' '}
                        <a href={CARRIERS[r.carrier].trackingUrl(r.trackingNumber)} target="_blank" rel="noopener noreferrer">
                          Sendung {r.trackingNumber} verfolgen
                        </a>
                      </>
                    ) : (
                      ' · Sendungsnummer folgt beim Versand'
                    )}
                  </dd>
                </div>
              ) : null}
            </dl>
            {plateParts ? (
              <div className="status-result__plate">
                <p className="label">Zugeteiltes Kennzeichen</p>
                <GermanLicensePlate id="status-kz" {...plateParts} size={300} />
              </div>
            ) : null}
            <ol className="timeline" role="list">
              {[...r.timeline].reverse().map((t, i) => (
                <li key={i} className={i === 0 ? 'is-current' : ''}>
                  <span className="timeline__dot" aria-hidden="true" />
                  <div>
                    <p className="timeline__title">{statusLabel(t.status, r.service, 'kunde')}</p>
                    <p className="timeline__at">{formatDateTime(t.at)}</p>
                    {t.message ? <p className="timeline__msg">{t.message}</p> : null}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="status-empty">
            <p>Ihre Auftragsnummer finden Sie auf der Bestätigungsseite nach dem Absenden. Sie hat das Format EK-JJJJ-NNNNN.</p>
          </div>
        )}
      </div>
    </div>
  );
}

/** Express: Meilensteine mit tatsächlichen Zeitpunkten – keine Fristen, keine geschätzten Zeiten. */
function ExpressSteps({ express }: { express: NonNullable<StatusState['result']>['express'] & object }) {
  const reached = express.milestones.filter((m) => m.at).length;
  return (
    <section className="process process--express" aria-label="Express-Auftragsstatus">
      <p className="label">{express.label}-Auftragsstatus</p>
      <ol className="xsteps" role="list">
        {express.milestones.map((m, i) => (
          <li key={m.key} className={`xsteps__item${m.at ? ' is-done' : ''}${i === reached && !m.at ? ' is-next' : ''}${m.tone ? ` is-${m.tone}` : ''}`}>
            <span className="xsteps__dot" aria-hidden="true" />
            <span className="xsteps__label">{m.label}</span>
            <span className="xsteps__at">{m.at ? formatDateTime(m.at) : 'noch nicht erreicht'}</span>
            {m.note ? <span className="xsteps__note">{m.note}</span> : null}
          </li>
        ))}
      </ol>
      <p className="process__text muted">
        Angezeigt werden nur tatsächlich eingetretene Schritte. Die Bearbeitungsdauer der Zulassungsbehörde können wir nicht beeinflussen.
      </p>
    </section>
  );
}

/** Bearbeitungsstand bei der Zulassung: eingegangen → in Bearbeitung → abgeschlossen (mit Sonderfällen). */
function ProcessSteps({ display, timeline }: { display: DisplayStatus; timeline: { at: string; label: string }[] }) {
  const middle: DisplayStatus = display === 'angaben_erforderlich' ? 'angaben_erforderlich' : 'in_bearbeitung';
  const last: DisplayStatus = display === 'fehlgeschlagen' ? 'fehlgeschlagen' : 'abgeschlossen';
  const steps: DisplayStatus[] = ['eingegangen', middle, last];
  const current = display === 'eingegangen' ? 0 : display === 'in_bearbeitung' || display === 'angaben_erforderlich' ? 1 : 2;
  const lastAt = timeline.length ? timeline[timeline.length - 1].at : null;
  return (
    <section className="process" aria-label="Bearbeitungsstatus bei der Zulassung">
      <p className="label">Bearbeitungsstatus</p>
      <ol className="process__steps" role="list">
        {steps.map((s, i) => (
          <li
            key={s}
            className={`process__step process__step--${DISPLAY[s].tone}${i < current ? ' is-done' : ''}${i === current ? ' is-current' : ''}`}
            aria-current={i === current ? 'step' : undefined}
          >
            <span className="process__dot" aria-hidden="true" />
            <span className="process__label">{DISPLAY[s].label}</span>
          </li>
        ))}
      </ol>
      <p className="process__text">
        {DISPLAY[display].text}
        {lastAt ? <span className="muted"> · Stand {formatDateTime(lastAt)}</span> : null}
      </p>
    </section>
  );
}
