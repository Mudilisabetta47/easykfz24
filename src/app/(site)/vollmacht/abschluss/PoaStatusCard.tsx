'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Check, Close, Doc, Flag, Restart } from '../../../../components/icons.tsx';
import { CUSTOMER_TEXT, type CustomerView } from '../../../../lib/power-of-attorney.ts';
import { PROVIDER, telHref } from '../../../../lib/site.ts';

interface State {
  view: CustomerView;
  verifiedAt: string;
  checkFailed: boolean;
  known: boolean;
}

const ICON = { ok: Check, wait: Restart, warn: Flag, error: Close, neutral: Doc } as const;
// Nachprüfung, solange die Unterschrift noch verarbeitet wird: wachsende Abstände, insgesamt rund drei Minuten
const DELAYS = [4000, 6000, 9000, 12000, 15000, 20000, 25000, 30000, 30000, 30000];

const time = (iso: string) => (iso ? new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'medium', timeStyle: 'short' }) : '');

export function PoaStatusCard({ processId, initial }: { processId: number | null; initial: State }) {
  const [state, setState] = useState<State>(initial);
  const [checking, setChecking] = useState(false);
  const [exhausted, setExhausted] = useState(false);
  const round = useRef(0);
  const t = CUSTOMER_TEXT[state.view];
  const Icon = ICON[t.tone];
  const waiting = state.known && state.view === 'pending';

  useEffect(() => {
    if (!waiting || !processId) return;
    if (round.current >= DELAYS.length) {
      setExhausted(true);
      return;
    }
    const timer = window.setTimeout(async () => {
      round.current += 1;
      setChecking(true);
      try {
        const r = await fetch(`/api/vollmacht/status?powerOfAttorneyId=${processId}`, { cache: 'no-store' });
        if (r.ok) {
          const j = (await r.json()) as State & { ok: boolean };
          if (j.ok) setState({ view: j.view, verifiedAt: j.verifiedAt, checkFailed: j.checkFailed, known: j.known });
        }
      } catch {
        /* nächster Versuch */
      } finally {
        setChecking(false);
      }
    }, DELAYS[round.current]);
    return () => window.clearTimeout(timer);
  }, [waiting, processId, state]);

  return (
    <section className={`card confirm__card poa poa--${t.tone}`} aria-labelledby="poa-title">
      <span className={`confirm__icon poa__icon`} aria-hidden="true">
        <Icon width={28} height={28} />
      </span>
      <p className="label">Digitale Vollmacht</p>
      <h1 id="poa-title" aria-live="polite">
        {t.title}
      </h1>
      <p>{t.text}</p>

      {waiting ? (
        <p className="poa__check" role="status">
          {checking ? 'Stand wird geprüft …' : exhausted ? 'Die Bestätigung dauert länger als üblich. Sie können diese Seite später erneut öffnen.' : 'Wir prüfen den Stand automatisch erneut.'}
          {state.checkFailed ? ' Der Stand konnte gerade nicht abgerufen werden.' : ''}
        </p>
      ) : null}
      {state.verifiedAt && state.view !== 'unknown' ? <p className="muted poa__meta">Bestätigt über unseren Vollmachtspartner: {time(state.verifiedAt)}</p> : null}

      <h2>So geht es weiter</h2>
      <ul className="confirm__steps">
        {t.next.map((n) => (
          <li key={n}>{n}</li>
        ))}
      </ul>

      <div className="confirm__actions">
        <Link href="/status" className="btn">
          Status abrufen
        </Link>
        {PROVIDER.phone ? (
          <a href={telHref(PROVIDER.phone)} className="btn btn--ghost">
            {PROVIDER.phone}
          </a>
        ) : null}
        <a href={`mailto:${PROVIDER.email}`} className="btn btn--ghost">
          E-Mail schreiben
        </a>
      </div>
      <p className="muted poa__privacy">Aus Datenschutzgründen zeigt diese Seite nur den bestätigten Stand Ihrer Vollmacht, keine Auftrags- oder Personendaten.</p>
    </section>
  );
}
