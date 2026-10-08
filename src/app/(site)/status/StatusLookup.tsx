'use client';

import { useActionState } from 'react';
import { formatDateTime } from '../../../lib/format.ts';
import { SERVICES } from '../../../lib/services.ts';
import { STATUSES, statusLabel } from '../../../lib/status.ts';
import { ArrowRight } from '../../../components/icons.tsx';
import { GermanLicensePlate } from '../../../components/GermanLicensePlate.tsx';
import { splitPlate } from '../../../lib/plate.ts';
import { lookupAction, type StatusState } from './actions.ts';

export function StatusLookup({ initialNr }: { initialNr: string }) {
  const [state, action, pending] = useActionState<StatusState, FormData>(lookupAction, { nr: initialNr });
  const r = state.result;
  const plateParts = r?.assignedPlate ? splitPlate(r.assignedPlate) : null;

  return (
    <div className="status-grid">
      <form action={action} className="card status-form" noValidate>
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
            {plateParts ? (
              <div className="status-result__plate">
                <p className="label">Zugeteiltes Kennzeichen</p>
                <GermanLicensePlate id="status-kz" {...plateParts} size={300} showSealPlaceholder />
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
