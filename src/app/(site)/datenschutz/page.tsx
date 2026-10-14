import type { Metadata } from 'next';
import { PRIVACY_SECTIONS, PRIVACY_STAND } from '../../../lib/privacy.ts';

// Footer (Widerrufslink) hängt von Laufzeit-Schaltern ab – nicht beim Build festschreiben
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Datenschutz',
  description: 'Datenschutzerklärung von EasyKFZ24: welche Daten wir zu welchem Zweck verarbeiten, Empfänger, Speicherdauer und Ihre Rechte.',
  alternates: { canonical: '/datenschutz' },
  robots: { index: false, follow: true },
};

/** Datenschutzerklärung (Fassung 3, Text in src/lib/privacy.ts) */
export default function DatenschutzPage() {
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Datenschutzerklärung</h1>
          <p className="lead">EasyKFZ24 – Online-Kfz-Zulassungsservice · {PRIVACY_STAND}</p>
        </div>
      </header>
      <div className="shell section-pad prose legal">
        {PRIVACY_SECTIONS.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.blocks.map((b, i) =>
              'h3' in b ? (
                <h3 key={i}>{b.h3}</h3>
              ) : (
                <p key={i}>
                  {b.lead ? <strong>{b.lead}: </strong> : null}
                  {b.p}
                </p>
              ),
            )}
          </section>
        ))}
      </div>
    </>
  );
}
