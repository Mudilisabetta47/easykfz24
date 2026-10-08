import Link from 'next/link';
import type { CSSProperties } from 'react';
import { formatEuro } from '../../lib/format.ts';
import { OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_FINAL } from '../../lib/pricing.config.ts';
import type { ServiceId } from '../../lib/services.ts';
import { ArrowRight } from '../icons.tsx';
import { Split } from '../Split.tsx';

const PLANS: { title: string; text: string; service?: ServiceId; href?: string; soon?: boolean; extra?: 'plates' }[] = [
  { title: 'Zulassung', text: 'Neuzulassung inkl. Kennzeichen-Reservierung.', service: 'neuzulassung', href: '/kfz-anmelden/auftrag?leistung=neuzulassung' },
  { title: 'Ummeldung', text: 'Halterwechsel oder Adressänderung nach Umzug.', service: 'halterwechsel', href: '/kfz-anmelden/auftrag?leistung=ummeldung' },
  { title: 'Wiederzulassung', text: 'Abgemeldetes Fahrzeug wieder zulassen.', service: 'wiederzulassung', href: '/kfz-anmelden/auftrag?leistung=wiederzulassung' },
  { title: 'Abmeldung', text: 'Außerbetriebsetzung inkl. Bestätigung.', service: 'abmeldung', href: '/kfz-anmelden/auftrag?leistung=abmeldung' },
  { title: 'Kennzeichen', text: 'Geprägte Schilder als Zusatzleistung im Vorgang.', extra: 'plates' },
  { title: 'Express', text: 'Priorisierte Bearbeitung für eilige Vorgänge.', soon: true },
];

export function Pricing() {
  return (
    <section className="price" id="preise" aria-labelledby="price-title">
      <div className="shell">
        <div className="price__head">
          <p className="label" data-reveal="fade">Preise</p>
          <Split id="price-title" className="price__title" text="Transparent. Getrennt. Nachvollziehbar." />
          <p className="lead" data-reveal="up">
            Im Vorgang siehst du vor dem Absenden genau, was anfällt: unsere Servicekosten auf der einen Seite, die
            Gebühren der Zulassungsbehörde auf der anderen.
          </p>
        </div>
        <ul className="price__grid" role="list">
          {PLANS.map((p, i) => {
            const amount =
              PRICES_FINAL && p.service
                ? formatEuro(PRICE_CONFIG.serviceFeeCents[p.service])
                : PRICES_FINAL && p.extra === 'plates'
                  ? `${formatEuro(PRICE_CONFIG.plateSignCents)} / Stück`
                  : null;
            return (
              <li
                key={p.title}
                className={`price__card${p.soon ? ' price__card--soon' : ''}`}
                data-reveal="up"
                data-tilt={p.soon ? undefined : ''}
                style={{ '--rv-delay': `${(i % 3) * 80}ms` } as CSSProperties}
              >
                <div className="price__card-top">
                  <h3>{p.title}</h3>
                  {p.soon ? <span className="chip chip--soon">Bald verfügbar</span> : null}
                </div>
                <p className="price__text">{p.text}</p>
                <p className="price__amount">
                  {amount ? (
                    <>
                      <span className="price__value">{amount}</span>
                      <span className="price__unit">Servicekosten inkl. MwSt.</span>
                    </>
                  ) : (
                    <span className="price__pending">{p.soon ? 'Noch nicht buchbar.' : 'Preis wird im Vorgang transparent angezeigt.'}</span>
                  )}
                </p>
                {p.href ? (
                  <Link href={p.href} className="link price__link">
                    Vorgang starten <ArrowRight className="btn__icon" width={18} height={18} />
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="price__split" data-reveal="up">
          <div>
            <span className="price__split-k">EasyKFZ24</span>
            <p>Servicekosten für Prüfung, Einreichung, Kennzeichen und Versand – vor dem Absenden sichtbar.</p>
          </div>
          <div>
            <span className="price__split-k price__split-k--gov">Behörde</span>
            <p>{OFFICIAL_FEES_NOTE}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
