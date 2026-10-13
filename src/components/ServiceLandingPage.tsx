import Link from 'next/link';
import '../styles/info.css';
import '../styles/seo.css';
import { Faq } from './home/Faq.tsx';
import { HeroQuickStart } from './home/HeroQuickStart.tsx';
import { ArrowRight, Check } from './icons.tsx';
import { PriceTag } from './Promo.tsx';
import { placeName, slugForCode } from '../lib/district-pages.ts';
import { formatEuro } from '../lib/format.ts';
import { OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_FINAL } from '../lib/pricing.config.ts';
import type { ServiceLanding } from '../lib/service-landings.ts';
import { DOCUMENTS, documentsFor, PLATE_CHOICES, SERVICES } from '../lib/services.ts';
import { PROVIDER, PROVIDER_NAME } from '../lib/site.ts';
import { publicBaseUrl } from '../server/payments.ts';

/** Große Zulassungsbezirke für die interne Verlinkung – nur Kürzel aus den verifizierten Daten */
const POPULAR = ['B', 'HH', 'M', 'K', 'F', 'S', 'D', 'HB', 'H', 'DO', 'E', 'L', 'DD', 'N'];

const STEPS = [
  { t: 'Online beauftragen', d: 'Leistung wählen, Fahrzeug- und Halterdaten eingeben, Unterlagen hochladen. Dauer: wenige Minuten.' },
  { t: 'Originale per Post', d: 'Unterschriebene Vollmacht und die benötigten Originale an uns senden – mit Ihrer Auftragsnummer.' },
  { t: 'Prüfung & Einreichung', d: 'Wir prüfen alles auf Vollständigkeit und reichen den Vorgang bei der zuständigen Zulassungsbehörde ein.' },
  { t: 'Zustellung', d: 'Papiere und ggf. Kennzeichen kommen per DHL oder UPS mit Sendungsverfolgung – oder Sie holen sie ab.' },
];

export function ServiceLandingPage({ page }: { page: ServiceLanding }) {
  const base = publicBaseUrl();
  const jsonLd = [
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Start', item: `${base}/` },
        { '@type': 'ListItem', position: 2, name: page.h1, item: `${base}${page.path}` },
      ],
    },
    {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: page.h1,
      serviceType: 'Kfz-Zulassungsservice',
      description: page.description,
      areaServed: { '@type': 'Country', name: 'Deutschland' },
      provider: {
        '@type': 'Organization',
        name: 'EasyKFZ24',
        legalName: PROVIDER_NAME,
        url: `${base}/`,
        email: PROVIDER.email,
        ...(PROVIDER.phone ? { telephone: PROVIDER.phone } : {}),
      },
      url: `${base}${page.path}`,
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: page.faq.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
    },
  ];
  const first = page.services[0];

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }} />
      <header className="page-head seo-head">
        <div className="shell seo-head__grid">
          <div className="seo-head__copy">
            <nav className="crumbs" aria-label="Brotkrumen">
              <ol>
                <li>
                  <Link href="/">Start</Link>
                </li>
                <li aria-current="page">{page.label}</li>
              </ol>
            </nav>
            <h1>{page.h1}</h1>
            <p className="lead">{page.lead}</p>
            <ul className="ticks seo-head__ticks" role="list">
              <li>
                <Check width={18} height={18} /> Online beauftragen, ohne Termin bei der Zulassungsstelle
              </li>
              <li>
                <Check width={18} height={18} /> Für alle Zulassungsbezirke in Deutschland
              </li>
              <li>
                <Check width={18} height={18} /> Bearbeitungsstand jederzeit in der Statusabfrage
              </li>
            </ul>
          </div>
          <div className="seo-head__quick">
            <HeroQuickStart initialMode={page.quickMode} />
          </div>
        </div>
      </header>

      <section className="shell section-pad seo-text" aria-labelledby="ueberblick">
        <h2 id="ueberblick" className="info-h2">
          {page.wish ? 'So funktioniert die Reservierung' : `${page.label}: das Wichtigste`}
        </h2>
        {page.intro.map((t) => (
          <p key={t} className="seo-text__p">
            {t}
          </p>
        ))}
      </section>

      <section className="info-band" aria-labelledby="leistungen">
        <div className="shell section-pad">
          <h2 id="leistungen" className="info-h2">
            {page.wish ? 'Bei diesen Leistungen wählbar' : 'Unterlagen und Originale'}
          </h2>
          <div className="info-services">
            {page.services.map((id) => {
              const def = SERVICES[id];
              return (
                <article key={id} className="info-service card">
                  <div className="info-service__head">
                    <h3>{def.title}</h3>
                    <PriceTag services={[id]} size="sm" />
                  </div>
                  <p className="muted">{def.description}</p>
                  {page.wish ? null : (
                    <div className="info-service__cols">
                      <div>
                        <p className="label">Hochladen</p>
                        <ul className="ticks" role="list">
                          {documentsFor(id).map((d) => (
                            <li key={d.kind}>
                              <Check width={14} height={14} />
                              <span>
                                {DOCUMENTS[d.kind].label}
                                {d.requirement === 'optional' ? <span className="muted"> (falls vorhanden)</span> : null}
                              </span>
                            </li>
                          ))}
                          {def.evb !== 'nein' ? (
                            <li>
                              <Check width={14} height={14} />
                              <span>
                                eVB-Nummer der Versicherung
                                {def.evb === 'bei_kennzeichenwechsel' ? <span className="muted"> (bei Kennzeichenwechsel)</span> : null}
                              </span>
                            </li>
                          ) : null}
                          {def.sepa ? (
                            <li>
                              <Check width={14} height={14} />
                              <span>SEPA-Mandat für die Kfz-Steuer (im Formular)</span>
                            </li>
                          ) : null}
                        </ul>
                      </div>
                      <div>
                        <p className="label">Per Post im Original</p>
                        <ul className="ticks" role="list">
                          {def.originals.map((o) => (
                            <li key={o}>
                              <Check width={14} height={14} />
                              <span>{o}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                  {def.plateChoices.length ? (
                    <p className="info-service__plates">Kennzeichen: {def.plateChoices.map((c) => PLATE_CHOICES[c].label).join(' · ')}</p>
                  ) : null}
                  {page.wish
                    ? null
                    : def.notes.map((n) => (
                        <p key={n} className="info-service__note">
                          {n}
                        </p>
                      ))}
                  <Link href={`/kfz-anmelden/auftrag?leistung=${id}`} className="btn info-service__cta">
                    {def.title} beauftragen <ArrowRight className="btn__icon" />
                  </Link>
                </article>
              );
            })}
          </div>
          {page.wish && PRICES_FINAL ? (
            <p className="info-prices__note">
              Bearbeitungspauschale Wunschkennzeichen: {formatEuro(PRICE_CONFIG.wishPlateHandlingCents)}. {OFFICIAL_FEES_NOTE}
            </p>
          ) : (
            <p className="info-prices__note">{OFFICIAL_FEES_NOTE}</p>
          )}
        </div>
      </section>

      <section className="shell section-pad" aria-labelledby="ablauf">
        <h2 id="ablauf" className="info-h2">
          Ablauf
        </h2>
        <ol className="info-steps seo-steps" role="list">
          {STEPS.map((s, i) => (
            <li key={s.t}>
              <span className="info-steps__n">0{i + 1}</span>
              <h3>{s.t}</h3>
              <p>{s.d}</p>
            </li>
          ))}
        </ol>
        <p>
          <Link href={`/kfz-anmelden/auftrag?leistung=${first}`} className="btn">
            Jetzt online beauftragen <ArrowRight className="btn__icon" />
          </Link>
        </p>
      </section>

      <section className="info-band" aria-labelledby="orte">
        <div className="shell section-pad">
          <h2 id="orte" className="info-h2">
            {page.wish ? 'Wunschkennzeichen nach Ort' : 'In Ihrem Zulassungsbezirk'}
          </h2>
          <p className="seo-text__p">
            Wir sind ein privater Zulassungsservice und übernehmen Vorgänge für alle Zulassungsbezirke in Deutschland – ohne eigene Filiale vor Ort. Auf den
            Kennzeichenseiten finden Sie Kürzel, Zulassungsbezirk und die zugehörigen Städte und Gemeinden.
          </p>
          <ul className="code-links" role="list">
            {POPULAR.filter((c) => placeName(c)).map((c) => (
              <li key={c}>
                <Link href={`/kennzeichen/${slugForCode(c)}`}>
                  <strong>{c}</strong>
                  <span>{placeName(c)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <p className="seo-all">
            <Link href="/kennzeichen">Alle Kennzeichen von A bis Z</Link>
          </p>
        </div>
      </section>

      <section className="shell section-pad info-faq" aria-labelledby="faq">
        <h2 id="faq" className="info-h2">
          Häufige Fragen
        </h2>
        <Faq items={page.faq} />
      </section>
    </>
  );
}
