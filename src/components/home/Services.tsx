import Link from 'next/link';
import type { CSSProperties } from 'react';
import { ArrowRight, Car, PowerOff, Restart, Swap } from '../icons.tsx';
import { Split } from '../Split.tsx';

const CARDS = [
  {
    n: '01',
    kicker: 'Neuzulassung',
    title: 'Fahrzeug zulassen',
    text: 'Neuzulassung bequem online erledigen.',
    cta: 'Zulassung starten',
    href: '/kfz-anmelden/auftrag?leistung=neuzulassung',
    icon: Car,
    tags: ['Neufahrzeug', 'Import', 'Wunschkennzeichen'],
  },
  {
    n: '02',
    kicker: 'Ummeldung',
    title: 'Ummelden',
    text: 'Halter, Adresse oder Fahrzeug bequem ändern.',
    cta: 'Ummeldung starten',
    href: '/kfz-anmelden/auftrag?leistung=ummeldung',
    icon: Swap,
    tags: ['Halterwechsel', 'Umzug', 'Kennzeichen behalten'],
  },
  {
    n: '03',
    kicker: 'Wiederzulassung',
    title: 'Wiederzulassen',
    text: 'Abgemeldetes Fahrzeug wieder auf die Straße bringen.',
    cta: 'Wiederzulassung starten',
    href: '/kfz-anmelden/auftrag?leistung=wiederzulassung',
    icon: Restart,
    tags: ['Nach Stilllegung', 'Altes Kennzeichen', 'Saisonstart'],
  },
  {
    n: '04',
    kicker: 'Abmeldung',
    title: 'Abmelden',
    text: 'Fahrzeug digital außer Betrieb setzen.',
    cta: 'Abmeldung starten',
    href: '/kfz-anmelden/auftrag?leistung=abmeldung',
    icon: PowerOff,
    tags: ['Verkauf', 'Stilllegung', 'Export'],
  },
];

export function Services() {
  return (
    <section className="svc" data-services aria-labelledby="svc-title">
      <div className="svc__track" data-track>
        <div className="svc__stage" data-stage>
          <div className="shell svc__head">
            <div>
              <p className="label" data-reveal="fade">Leistungen</p>
              <Split id="svc-title" className="svc__title" text="Was möchtest du erledigen?" />
            </div>
            <div className="svc__meter" aria-hidden="true">
              <span className="svc__meter-fill" data-meter />
            </div>
          </div>
          <div className="svc__viewport">
            <ul className="svc__rail" role="list" data-rail>
              {CARDS.map((c, i) => (
                <li key={c.n} className="svc__item" data-card={i}>
                  <div className="svc__reveal" data-reveal="up" style={{ '--rv-delay': `${i * 90}ms` } as CSSProperties}>
                  <article className="svc-card" data-tilt>
                    <div className="svc-card__top">
                      <span className="svc-card__n">{c.n}</span>
                      <span className="svc-card__icon" data-card-art>
                        <c.icon width={26} height={26} />
                      </span>
                    </div>
                    <p className="label">{c.kicker}</p>
                    <h3 className="svc-card__title">{c.title}</h3>
                    <p className="svc-card__text">{c.text}</p>
                    <ul className="svc-card__tags" role="list">
                      {c.tags.map((t) => (
                        <li key={t} className="chip">
                          {t}
                        </li>
                      ))}
                    </ul>
                    <Link href={c.href} className="btn svc-card__cta" data-cursor="Start">
                      {c.cta}
                      <ArrowRight className="btn__icon" />
                    </Link>
                  </article>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
