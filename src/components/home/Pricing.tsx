import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatEuro } from '../../lib/format.ts';
import { BUNDLE_NAMES, NEW_CUSTOMER_PROMO, OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_FINAL, PROMO_FINE_PRINT } from '../../lib/pricing.config.ts';
import { bundleInfo, servicePrice } from '../../lib/pricing.ts';
import { CarrierMarks, PaymentMarks } from '../Brands.tsx';
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

const BUNDLES: { service: ServiceId; title: string; short: string; highlight?: boolean }[] = [
  { service: 'neuzulassung', title: BUNDLE_NAMES.neuzulassung, short: 'Neuzulassung', highlight: true },
  { service: 'halterwechsel', title: BUNDLE_NAMES.halterwechsel, short: 'Halterwechsel' },
  { service: 'wiederzulassung', title: BUNDLE_NAMES.wiederzulassung, short: 'Wiederzulassung' },
];

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

        {PRICES_FINAL ? (
          <div className="bundles" data-reveal="up">
            <div className="bundles__head">
              <h3>Komplett-Pakete</h3>
              <p>Leistung, Wunschkennzeichen, zwei geprägte Schilder und Versand – zum Paketpreis.</p>
            </div>
            <ul className="bundles__grid" role="list">
              {BUNDLES.map((b) => {
                const info = bundleInfo(b.service);
                if (!info) return null;
                return (
                  <li key={b.service} className={`bundle${b.highlight ? ' bundle--highlight' : ''}`}>
                    <div className="bundle__top">
                      <h4>{b.title}</h4>
                    </div>
                    <ul className="bundle__items" role="list">
                      {['Servicepauschale ' + b.short, 'Wunschkennzeichen-Reservierung', '2 geprägte Kennzeichenschilder', 'Versand mit DHL oder UPS'].map((t) => (
                        <li key={t}>
                          <Check width={14} height={14} /> {t}
                        </li>
                      ))}
                    </ul>
                    <p className="bundle__price">
                      <span className="price-tag__from">nur</span>
                      <strong>{formatEuro(info.promoCents)}</strong>
                      <s>{formatEuro(info.singleCents)}</s>
                    </p>
                    <span className="price-tag__save">Du sparst {formatEuro(info.savingCents)}</span>
                    <Link href={`/kfz-anmelden/auftrag?leistung=${b.service}&paket=1`} className="btn bundle__cta" data-cursor="Start">
                      Paket wählen <ArrowRight className="btn__icon" />
                    </Link>
                  </li>
                );
              })}
            </ul>
            <p className="bundles__fine">
              Paketpreise inkl. MwSt., zzgl. amtlicher Gebühren. {promo ? 'Mit Neukundenvorteil; regulärer Paketpreis ' : 'Paketpreis '}
              {BUNDLES.map((b) => `${b.title} ${formatEuro(PRICE_CONFIG.bundleCents[b.service] ?? 0)}`).join(' · ')}.
            </p>
          </div>
        ) : null}

        <div className="price__partners" data-reveal="up">
          <PaymentMarks />
          <CarrierMarks />
        </div>

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
