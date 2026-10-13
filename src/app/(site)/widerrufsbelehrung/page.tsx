import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { siteUrl } from '../../../lib/site-url.ts';
import { REVIEW_ITEMS, WITHDRAW_LABEL, WITHDRAW_PATH, WITHDRAWAL_FORM, WITHDRAWAL_META, withdrawalNotice } from '../../../lib/withdrawal.ts';
import { withdrawalMode } from '../../../server/withdrawal.ts';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Widerrufsbelehrung', robots: { index: false, follow: true } };

/** Widerrufsbelehrung und Muster-Widerrufsformular (Wortlaut vom Inhaber) – nur mit WIDERRUF_AKTIV=1 öffentlich */
export default function WiderrufsbelehrungPage() {
  const mode = withdrawalMode();
  if (mode === 'aus') notFound();
  const sections = withdrawalNotice(siteUrl());
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Widerrufsbelehrung</h1>
          <p className="lead">
            {WITHDRAWAL_META.subtitle}
            <br />
            <span className="muted">{WITHDRAWAL_META.stand}</span>
          </p>
          {mode === 'vorschau' ? (
            <p className="lead">
              <mark className="placeholder">Entwurf – nicht veröffentlicht. Vor der Freischaltung durch eine spezialisierte Kanzlei bzw. eRecht24 prüfen lassen.</mark>
            </p>
          ) : null}
        </div>
      </header>
      <div className="shell section-pad prose legal">
        {sections.map((s) => (
          <section key={s.heading} aria-labelledby={`wb-${s.heading}`}>
            <h2 id={`wb-${s.heading}`}>{s.heading}</h2>
            {s.paragraphs.map((p) => (
              <p key={p.slice(0, 40)}>{p}</p>
            ))}
          </section>
        ))}

        <section aria-labelledby="wb-online">
          <h2 id="wb-online">Online widerrufen</h2>
          <p>
            <Link href={WITHDRAW_PATH} className="btn">
              {WITHDRAW_LABEL}
            </Link>
          </p>
        </section>

        <section aria-labelledby="wb-formular" className="print-doc">
          <h2 id="wb-formular">Muster-Widerrufsformular</h2>
          <p>{WITHDRAWAL_FORM.intro}</p>
          <p>– {WITHDRAWAL_FORM.addressee}</p>
          {WITHDRAWAL_FORM.lines.map((l) => (
            <p key={l}>– {l}</p>
          ))}
          {WITHDRAWAL_FORM.footnote ? <p className="muted">{WITHDRAWAL_FORM.footnote}</p> : null}
        </section>

        {mode === 'vorschau' ? (
          <section aria-labelledby="wb-pruefung">
            <h2 id="wb-pruefung">Zur rechtlichen Prüfung (nicht Teil der Belehrung)</h2>
            <ul>
              {REVIEW_ITEMS.map((r) => (
                <li key={r.topic}>
                  <strong>{r.topic}:</strong> {r.note}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </>
  );
}
