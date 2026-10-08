import type { Metadata } from 'next';
import { Ph } from '../../../components/Ph.tsx';
import { SITE } from '../../../lib/site.ts';

export const metadata: Metadata = { title: 'Impressum', robots: { index: false, follow: true } };

export default function ImpressumPage() {
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Impressum</h1>
          <p className="lead">
            <mark className="placeholder">Entwurf: Alle markierten Angaben sind Platzhalter und müssen vor dem Livegang ergänzt und rechtlich geprüft werden.</mark>
          </p>
        </div>
      </header>
      <div className="shell section-pad prose">
        <h2>Angaben gemäß § 5 DDG</h2>
        <p>
          <Ph>{SITE.company}</Ph>
          <br />
          <Ph>{SITE.street}</Ph>
          <br />
          <Ph>{SITE.city}</Ph>
        </p>
        <h2>Vertreten durch</h2>
        <p>
          <Ph>{SITE.owner}</Ph>
        </p>
        <h2>Kontakt</h2>
        <p>
          Telefon: <Ph>{SITE.phone}</Ph>
          <br />
          E-Mail: <Ph>{SITE.email}</Ph>
        </p>
        <h2>Registereintrag</h2>
        <p>
          <Ph>{SITE.register}</Ph>
        </p>
        <h2>Umsatzsteuer-ID</h2>
        <p>
          <Ph>{SITE.vatId}</Ph>
        </p>
        <h2>Aufsichtsbehörde</h2>
        <p>
          <Ph>{SITE.supervisory}</Ph>
        </p>
        <h2>Hinweis</h2>
        <p>EasyKFZ24 ist ein privater Dienstleister und keine Behörde. Über Zulassungsvorgänge entscheidet die jeweils zuständige Zulassungsbehörde.</p>
        <h2>Verbraucherstreitbeilegung</h2>
        <p>
          <mark className="placeholder">[PLATZHALTER: Angabe zur Teilnahme an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle]</mark>
        </p>
      </div>
    </>
  );
}
