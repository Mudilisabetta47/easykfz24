import type { Metadata } from 'next';
import Link from 'next/link';
import type { CSSProperties } from 'react';
import '../../../styles/info.css';
import { Faq } from '../../../components/home/Faq.tsx';
import { HOME_FAQ } from '../../../components/home/faq-content.ts';
import { ArrowRight, Check } from '../../../components/icons.tsx';
import { Split } from '../../../components/Split.tsx';
import { formatEuro } from '../../../lib/format.ts';
import { OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_FINAL, PROMO_FINE_PRINT } from '../../../lib/pricing.config.ts';
import { servicePrice } from '../../../lib/pricing.ts';
import { PriceTag, PromoBadge, promoActive } from '../../../components/Promo.tsx';
import { DOCUMENTS, documentsFor, PLATE_CHOICES, SERVICE_IDS, SERVICES, type ServiceId } from '../../../lib/services.ts';

export const metadata: Metadata = {
  title: 'Kfz anmelden – Leistungen, Unterlagen, Ablauf',
  description:
    'Neuzulassung, Ummeldung bei Halterwechsel oder Umzug, Wiederzulassung und Abmeldung: welche Unterlagen Sie brauchen, wie der Ablauf ist und was es kostet.',
};

const ANCHOR: Record<ServiceId, string> = {
  neuzulassung: 'neuzulassung',
  halterwechsel: 'ummeldung',
  umzug: 'umzug',
  wiederzulassung: 'wiederzulassung',
  abmeldung: 'abmeldung',
};

const STEPS = [
  { t: 'Online beauftragen', d: 'Leistung wählen, Fahrzeug- und Halterdaten eingeben, Unterlagen hochladen. Dauer: wenige Minuten.' },
  { t: 'Originale per Post', d: 'Unterschriebene Vollmacht und die benötigten Originale an uns senden – mit Ihrer Auftragsnummer.' },
  { t: 'Prüfung & Einreichung', d: 'Wir prüfen alles auf Vollständigkeit und reichen den Vorgang bei der zuständigen Behörde ein.' },
  { t: 'Zustellung', d: 'Papiere und ggf. Kennzeichen kommen per DHL oder UPS mit Sendungsverfolgung – oder Sie holen sie ab. Den Stand sehen Sie jederzeit online.' },
];

export default function KfzAnmeldenPage() {
  return (
    <>
      <header className="page-head">
        <div className="shell">
          <p className="label">Kfz anmelden</p>
          <h1>Zulassung, Ummeldung, Abmeldung.</h1>
          <p className="lead">
            Alle Leistungen auf einen Blick: was wir für Sie erledigen, welche Unterlagen nötig sind und wie der Ablauf aussieht.
          </p>
          <div className="info-jump">
            {SERVICE_IDS.map((id) => (
              <a key={id} href={`#${ANCHOR[id]}`} className="chip">
                {SERVICES[id].title}
              </a>
            ))}
          </div>
        </div>
      </header>

      <section className="shell section-pad" aria-labelledby="leistungen">
        <h2 id="leistungen" className="info-h2">
          Leistungen
        </h2>
        <div className="info-services">
          {SERVICE_IDS.map((id, i) => {
            const def = SERVICES[id];
            return (
              <article key={id} id={ANCHOR[id]} className="info-service card" data-reveal="up" style={{ '--rv-delay': `${(i % 2) * 80}ms` } as CSSProperties}>
                <div className="info-service__head">
                  <h3>{def.title}</h3>
                  <PriceTag services={[id]} size="sm" />
                </div>
                <p className="muted">{def.description}</p>
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
                          <span>eVB-Nummer der Versicherung{def.evb === 'bei_kennzeichenwechsel' ? <span className="muted"> (bei Kennzeichenwechsel)</span> : null}</span>
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
                {def.plateChoices.length ? (
                  <p className="info-service__plates">
                    Kennzeichen: {def.plateChoices.map((c) => PLATE_CHOICES[c].label).join(' · ')}
                  </p>
                ) : null}
                {def.notes.map((n) => (
                  <p key={n} className="info-service__note">
                    {n}
                  </p>
                ))}
                <Link href={`/kfz-anmelden/auftrag?leistung=${id}`} className="btn info-service__cta" data-cursor="Start">
                  {def.title} beauftragen <ArrowRight className="btn__icon" />
                </Link>
              </article>
            );
          })}
        </div>
      </section>

      <section className="info-band" aria-labelledby="ablauf-h">
        <div className="shell section-pad">
          <Split id="ablauf-h" className="info-h2" text="Ablauf" />
          <ol className="info-steps" role="list">
            {STEPS.map((s, i) => (
              <li key={s.t} data-reveal="up" style={{ '--rv-delay': `${i * 80}ms` } as CSSProperties}>
                <span className="info-steps__n">0{i + 1}</span>
                <h3>{s.t}</h3>
                <p>{s.d}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="shell section-pad" aria-labelledby="preise-h" id="preise">
        <h2 id="preise-h" className="info-h2">
          Preise
        </h2>
        {promoActive() ? (
          <p className="info-promo">
            <PromoBadge /> Fair kalkuliert, digital abgewickelt – und für Neukunden jetzt 10 % günstiger auf die Servicepauschale.
          </p>
        ) : null}
        <div className="info-prices card">
          <table>
            <caption className="sr-only">Servicekosten je Leistung</caption>
            <thead>
              <tr>
                <th scope="col">Leistung</th>
                <th scope="col">Servicepauschale</th>
                {promoActive() ? <th scope="col">Neukundenpreis</th> : null}
              </tr>
            </thead>
            <tbody>
              {SERVICE_IDS.map((id) => (
                <tr key={id}>
                  <th scope="row">{SERVICES[id].title}</th>
                  <td>{PRICES_FINAL ? formatEuro(PRICE_CONFIG.serviceFeeCents[id]) : 'wird im Vorgang transparent angezeigt'}</td>
                  {promoActive() ? (
                    <td className="info-prices__promo">
                      <strong>{formatEuro(servicePrice(id).promoCents)}</strong> <span>−{formatEuro(servicePrice(id).savingCents)}</span>
                    </td>
                  ) : null}
                </tr>
              ))}
              <tr>
                <th scope="row">Wunschkennzeichen (Bearbeitung)</th>
                <td>{PRICES_FINAL ? formatEuro(PRICE_CONFIG.wishPlateHandlingCents) : 'wird im Vorgang transparent angezeigt'}</td>
                {promoActive() ? <td className="muted">–</td> : null}
              </tr>
              <tr>
                <th scope="row">Kennzeichenschild je Stück</th>
                <td>{PRICES_FINAL ? formatEuro(PRICE_CONFIG.plateSignCents) : 'wird im Vorgang transparent angezeigt'}</td>
                {promoActive() ? <td className="muted">–</td> : null}
              </tr>
              <tr>
                <th scope="row">Versand per Einschreiben</th>
                <td>{PRICES_FINAL ? formatEuro(PRICE_CONFIG.shippingCents) : 'wird im Vorgang transparent angezeigt'}</td>
                {promoActive() ? <td className="muted">–</td> : null}
              </tr>
            </tbody>
          </table>
          <p className="info-prices__note">{OFFICIAL_FEES_NOTE}</p>
          {promoActive() ? <p className="info-prices__note">{PROMO_FINE_PRINT}</p> : null}
        </div>
      </section>

      <section className="info-band" aria-labelledby="faq-h">
        <div className="shell section-pad info-faq">
          <h2 id="faq-h" className="info-h2">
            Häufige Fragen
          </h2>
          <Faq items={HOME_FAQ} />
        </div>
      </section>
    </>
  );
}
