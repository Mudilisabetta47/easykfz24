import type { Metadata } from 'next';
import { BRAND, BRAND_NOTE, PROVIDER, PROVIDER_NAME, sentence, telHref } from '../../../lib/site.ts';

// Footer (Widerrufslink) hängt von Laufzeit-Schaltern ab – nicht beim Build festschreiben
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Impressum', description: `${BRAND_NOTE} Anbieterkennzeichnung nach § 5 DDG.`, alternates: { canonical: '/impressum' }, robots: { index: false, follow: true } };

/** Impressum: Marke (EasyKFZ24) und rechtlicher Anbieter (MONVEX) klar getrennt; nur nachgewiesene Angaben. */
export default function ImpressumPage() {
  const p = PROVIDER;
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Impressum</h1>
          <p className="lead">
            {BRAND_NOTE} {sentence(`Anbieter dieser Website und Ihr Vertragspartner ist die ${PROVIDER_NAME}`)}
          </p>
        </div>
      </header>
      <div className="shell section-pad prose legal">
        <section aria-labelledby="imp-anbieter">
          <h2 id="imp-anbieter">Angaben gemäß § 5 DDG</h2>
          <address className="legal__address">
            <strong>{PROVIDER_NAME}</strong>
            <br />
            {p.street}
            <br />
            {p.zip} {p.city}
            <br />
            {p.country}
          </address>
        </section>

        <section aria-labelledby="imp-recht">
          <h2 id="imp-recht">Rechtsform und Vertretung</h2>
          <dl className="legal__facts">
            <div>
              <dt>Rechtsform</dt>
              <dd>Unternehmergesellschaft (haftungsbeschränkt){p.register ? '' : ' in Gründung'}</dd>
            </div>
            <div>
              <dt>Sitz der Gesellschaft</dt>
              <dd>{p.seat}</dd>
            </div>
            <div>
              <dt>Vertretungsberechtigt</dt>
              <dd>{p.managingDirector} (Geschäftsführer)</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="imp-kontakt">
          <h2 id="imp-kontakt">Kontakt</h2>
          <dl className="legal__facts">
            <div>
              <dt>E-Mail</dt>
              <dd>
                <a href={`mailto:${p.email}`}>{p.email}</a>
              </dd>
            </div>
            {p.phone ? (
              <div>
                <dt>Telefon</dt>
                <dd>
                  <a href={telHref(p.phone)}>{p.phone}</a>
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section aria-labelledby="imp-register">
          <h2 id="imp-register">Handelsregister</h2>
          {p.register ? (
            <dl className="legal__facts">
              <div>
                <dt>Registergericht</dt>
                <dd>{p.register.court}</dd>
              </div>
              <div>
                <dt>Registernummer</dt>
                <dd>{p.register.number}</dd>
              </div>
            </dl>
          ) : (
            <>
              <dl className="legal__facts">
                <div>
                  <dt>Registergericht</dt>
                  <dd>{p.registerCourt}</dd>
                </div>
                <div>
                  <dt>Registernummer</dt>
                  <dd>wird nachgereicht</dd>
                </div>
              </dl>
              <p>Die Gesellschaft befindet sich in Gründung und ist noch nicht im Handelsregister eingetragen.</p>
            </>
          )}
        </section>

        {p.vatId || p.economicId ? (
          <section aria-labelledby="imp-steuer">
            <h2 id="imp-steuer">Steuerliche Angaben</h2>
            <dl className="legal__facts">
              {p.vatId ? (
                <div>
                  <dt>Umsatzsteuer-Identifikationsnummer gemäß § 27a UStG</dt>
                  <dd>{p.vatId}</dd>
                </div>
              ) : null}
              {p.economicId ? (
                <div>
                  <dt>Wirtschafts-Identifikationsnummer</dt>
                  <dd>{p.economicId}</dd>
                </div>
              ) : null}
            </dl>
          </section>
        ) : null}

        <section aria-labelledby="imp-marke">
          <h2 id="imp-marke">Marke und Vertragspartner</h2>
          <p>
            {BRAND_NOTE} {BRAND} ist keine eigenständige Gesellschaft. Verträge über die auf dieser Website angebotenen Leistungen kommen
            ausschließlich mit der {PROVIDER_NAME} zustande.
          </p>
          <p>
            {BRAND} ist ein privater Zulassungsservice und keine Behörde. Über Zulassungsvorgänge entscheidet die jeweils zuständige
            Zulassungsbehörde. Soweit wir für die Übermittlung oder Durchführung einzelner Vorgänge externe Dienstleister einsetzen, werden diese
            in unserem Auftrag tätig; {sentence(`Ihr Vertragspartner bleibt die ${PROVIDER_NAME}`)}
          </p>
        </section>

        <section aria-labelledby="imp-inhalt">
          <h2 id="imp-inhalt">Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
          <p>
            {p.managingDirector}, {p.street}, {p.zip} {p.city}
          </p>
        </section>

        <section aria-labelledby="imp-vsbg">
          <h2 id="imp-vsbg">Verbraucherstreitbeilegung</h2>
          <p>Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer Verbraucherschlichtungsstelle teilzunehmen.</p>
        </section>
      </div>
    </>
  );
}
