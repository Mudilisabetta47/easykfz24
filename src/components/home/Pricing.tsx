import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatEuro } from '../../lib/format.ts';
import { NEW_CUSTOMER_PROMO, OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_FINAL, PROMO_FINE_PRINT } from '../../lib/pricing.config.ts';
import { servicePrice } from '../../lib/pricing.ts';
import type { ServiceId } from '../../lib/services.ts';
import { ArrowRight, Check } from '../icons.tsx';
import { PriceTag, promoActive, promoUntilText } from '../Promo.tsx';
import { Split } from '../Split.tsx';

const PLANS: { title: string; text: string; services?: ServiceId[]; href?: string; soon?: boolean; extra?: 'plates'; featured?: boolean }[] = [
  { title: 'Zulassung', text: 'Neuzulassung inkl. Kennzeichen-Reservierung.', services: ['neuzulassung'], href: '/kfz-anmelden/auftrag?leistung=neuzulassung', featured: true },
  { title: 'Ummeldung', text: 'Halterwechsel oder neue Adresse nach Umzug.', services: ['halterwechsel', 'umzug'], href: '/kfz-anmelden/auftrag?leistung=ummeldung' },
  { title: 'Wiederzulassung', text: 'Abgemeldetes Fahrzeug zurück auf die Straße.', services: ['wiederzulassung'], href: '/kfz-anmelden/auftrag?leistung=wiederzulassung' },
  { title: 'Abmeldung', text: 'Außerbetriebsetzung inkl. Bestätigung.', services: ['abmeldung'], href: '/kfz-anmelden/auftrag?leistung=abmeldung' },
  { title: 'Kennzeichen', text: 'Geprägte Schilder direkt im Vorgang mitbestellen.', extra: 'plates' },
  { title: 'Express', text: 'Priorisierte Bearbeitung für eilige Vorgänge.', soon: true },
];

const PROMISES = ['Preis vor dem Absenden sichtbar', 'Keine versteckten Kosten', 'Amtliche Gebühren 1:1 nach Beleg'];

export function Pricing() {
  const promo = promoActive();
  const example = servicePrice('neuzulassung');
  return (
    <section className="price" id="preise" aria-labelledby="price-title">
      <div className="shell">
        <div className="price__top">
          <div className="price__head">
            <p className="label" data-reveal="fade">Preise</p>
            <Split id="price-title" className="price__title" text={promo ? 'Fair kalkuliert.\nJetzt 10 % günstiger.' : 'Transparent. Getrennt.\nNachvollziehbar.'} />
            <p className="lead" data-reveal="up">
              Digital heißt für dich: weniger Aufwand, schlanke Abläufe, faire Preise. Du zahlst eine klare Servicepauschale –
              die Gebühren der Zulassungsbehörde reichen wir ohne Aufschlag durch.
            </p>
          </div>

          {promo ? (
            <aside className="promo-panel on-dark" data-reveal="up" aria-label="Neukundenvorteil">
              <p className="promo-panel__kicker">Einführungsvorteil für Neukunden{promoUntilText()}</p>
              <p className="promo-panel__pct">
                −{NEW_CUSTOMER_PROMO.percent}
                <span>%</span>
              </p>
              <p className="promo-panel__text">auf die EasyKFZ24-Servicepauschale deiner ersten Beauftragung</p>
              <div className="promo-panel__example">
                <span>Beispiel Zulassung</span>
                <span>
                  <s>{formatEuro(example.regularCents)}</s> <strong>{formatEuro(example.promoCents)}</strong>
                </span>
              </div>
              <ul className="promo-panel__list" role="list">
                {PROMISES.map((p) => (
                  <li key={p}>
                    <Check width={14} height={14} /> {p}
                  </li>
                ))}
              </ul>
              <Link href="/kfz-anmelden/auftrag" className="btn btn--light" data-magnetic="0.2" data-cursor="Start">
                Vorteil sichern <ArrowRight className="btn__icon" />
              </Link>
            </aside>
          ) : null}
        </div>

        <ul className="price__grid" role="list">
          {PLANS.map((p, i) => (
            <li
              key={p.title}
              className={`price__card${p.soon ? ' price__card--soon' : ''}${p.featured ? ' price__card--featured' : ''}`}
              data-reveal="up"
              data-tilt={p.soon ? undefined : ''}
              style={{ '--rv-delay': `${(i % 3) * 80}ms` } as CSSProperties}
            >
              <div className="price__card-top">
                <h3>{p.title}</h3>
                {p.soon ? <span className="chip chip--soon">Bald verfügbar</span> : null}
              </div>
              <p className="price__text">{p.text}</p>
              <div className="price__amount">
                {p.services && PRICES_FINAL ? (
                  <>
                    <PriceTag services={p.services} from={p.services.length > 1} />
                    <span className="price__unit">Servicepauschale inkl. MwSt. – {promo ? 'Neukundenpreis' : 'zzgl. amtlicher Gebühren'}</span>
                  </>
                ) : p.extra === 'plates' && PRICES_FINAL ? (
                  <>
                    <span className="price-tag price-tag--lg">
                      <span className="price-tag__main">
                        <span className="price-tag__value">{formatEuro(PRICE_CONFIG.plateSignCents)}</span>
                      </span>
                    </span>
                    <span className="price__unit">je geprägtem Schild inkl. MwSt.</span>
                  </>
                ) : (
                  <span className="price__pending">{p.soon ? 'Noch nicht buchbar.' : 'Preis wird im Vorgang transparent angezeigt.'}</span>
                )}
              </div>
              {p.href ? (
                <Link href={p.href} className="link price__link">
                  Jetzt starten <ArrowRight className="btn__icon" width={18} height={18} />
                </Link>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="price__split" data-reveal="up">
          <div>
            <span className="price__split-k">EasyKFZ24</span>
            <p>Servicepauschale für Prüfung, Einreichung und Abwicklung – vor dem Absenden auf den Cent sichtbar.</p>
          </div>
          <div>
            <span className="price__split-k price__split-k--gov">Behörde</span>
            <p>{OFFICIAL_FEES_NOTE}</p>
          </div>
        </div>
        {promo ? <p className="price__fine">{PROMO_FINE_PRINT}</p> : null}
      </div>
    </section>
  );
}
