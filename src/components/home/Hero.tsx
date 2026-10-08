import Link from 'next/link';
import type { CSSProperties } from 'react';
import { CarSvg } from '../CarSvg.tsx';
import { ArrowRight, Check, Doc, Receipt, Shield } from '../icons.tsx';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';
import { Split } from '../Split.tsx';
import { PromoBadge, promoActive } from '../Promo.tsx';
import { formatEuro } from '../../lib/format.ts';
import { servicePrice } from '../../lib/pricing.ts';

const ABMELDUNG = servicePrice('abmeldung');

const ACTS = [
  { n: '01', text: 'Dein Fahrzeug.' },
  { n: '02', text: 'Deine Daten.' },
  { n: '03', text: 'Alles digital.' },
  { n: '04', text: 'Wir kümmern uns um den Rest.' },
  { n: '05', text: 'Bereit.' },
];

const CHIPS = [
  { label: 'Fahrzeug', value: 'Audi A5 Coupé' },
  { label: 'FIN', value: 'geprüft' },
  { label: 'Versicherung', value: 'eVB vorhanden' },
  { label: 'Halter', value: 'bestätigt' },
];

const DOCS = [
  { title: 'Fahrzeugschein', meta: 'Zulassungsbescheinigung Teil I', icon: Doc },
  { title: 'eVB-Nummer', meta: 'Versicherungsbestätigung', icon: Shield },
  { title: 'SEPA-Mandat', meta: 'Kfz-Steuer', icon: Receipt },
  { title: 'Kennzeichen', meta: 'Wunsch oder neu', icon: Doc },
];

const FLOW = ['EasyKFZ24', 'Digitale Übermittlung', 'Zulassung', 'Kennzeichen'];

export function Hero() {
  return (
    <section className="hero on-dark" data-hero aria-labelledby="hero-title">
      <div className="hero__track" data-track>
        <div className="hero__stage" data-stage>
          <div className="hero__bg" aria-hidden="true">
            <div className="hero__grid" data-grid />
            <div className="hero__aurora" data-aurora />
            <div className="hero__horizon" />
          </div>

          <div className="hero__intro shell" data-intro>
            <p className="hero__eyebrow" data-reveal="fade">
              <span className="hero__live" aria-hidden="true" />
              Digitaler Zulassungsservice
            </p>
            <Split as="h1" id="hero-title" className="hero__title" text={'Einfach.\nZugelassen.'} reveal="mask" delay={120} />
            <p className="hero__sub" data-reveal="up" style={{ '--rv-delay': '380ms' } as CSSProperties}>
              Zulassen, ummelden oder abmelden – digital, schnell und deutschlandweit.
            </p>
            <div className="hero__ctas" data-reveal="up" style={{ '--rv-delay': '500ms' } as CSSProperties}>
              <Link href="/kfz-anmelden/auftrag" className="btn btn--lg" data-magnetic="0.22" data-cursor="Start">
                Jetzt Zulassung starten
                <ArrowRight className="btn__icon" />
              </Link>
              <Link href="#ablauf" className="btn btn--glass btn--lg">
                So funktioniert&apos;s
              </Link>
            </div>
            {promoActive() ? (
              <p className="hero__promo" data-reveal="up" style={{ '--rv-delay': '640ms' } as CSSProperties}>
                <PromoBadge tone="dark" />
                <span>
                  auf die Servicepauschale – Abmeldung schon ab <strong>{formatEuro(ABMELDUNG.promoCents)}</strong>
                </span>
              </p>
            ) : null}
          </div>

          <ol className="hero__acts" role="list" aria-label="Ablauf in fünf Schritten">
            {ACTS.map((a, i) => (
              <li key={a.n} className="hero__act" data-act={i}>
                <span className="hero__act-n">{a.n}</span>
                <span className="hero__act-text">{a.text}</span>
                {i === ACTS.length - 1 ? (
                  <div className="hero__ready" data-ready>
                    <div className="hero__plate" data-plate data-plate-scene aria-hidden="true">
                      <GermanLicensePlate id="hero-kz" cityCode="HB" letters="EZ" numbers="24" size="clamp(270px, 31vw, 480px)" perspective={10} tone="dark" showSealPlaceholder />
                    </div>
                    <Link href="/kfz-anmelden/auftrag" className="btn btn--lg btn--light" data-magnetic="0.22" data-cursor="Start">
                      Jetzt Fahrzeug zulassen
                      <ArrowRight className="btn__icon" />
                    </Link>
                    <PromoBadge tone="dark" label="auf die Servicepauschale" />
                  </div>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="hero__scene" aria-hidden="true">
            <div className="hero__car" data-car data-cursor="Entdecken">
              <div className="hero__glow" data-glow />
              <CarSvg id="hero-car" />
              <div className="hero__scan" data-scan />
              {CHIPS.map((c, i) => (
                <div key={c.label} className={`hero__chip hero__chip--${i}`} data-chip={i}>
                  <span className="hero__chip-check">
                    <Check width={12} height={12} />
                  </span>
                  <span>
                    <span className="hero__chip-label">{c.label}</span>
                    <span className="hero__chip-value">{c.value}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="hero__docs" aria-hidden="true">
            <div className="hero__core" data-core>
              <span className="hero__core-ring" />
              <span className="hero__core-label">Vorgang digital</span>
            </div>
            {DOCS.map((d, i) => (
              <div key={d.title} className="hero__doc" data-doc={i}>
                <d.icon width={18} height={18} />
                <span className="hero__doc-title">{d.title}</span>
                <span className="hero__doc-meta">{d.meta}</span>
                <span className="hero__doc-lines">
                  <i />
                  <i />
                </span>
              </div>
            ))}
          </div>

          <div className="hero__flow" data-flow aria-hidden="true">
            <div className="hero__flow-line">
              <span className="hero__flow-fill" data-flow-fill />
            </div>
            {FLOW.map((f, i) => (
              <div key={f} className="hero__node" data-node={i}>
                <span className="hero__node-dot" />
                <span className="hero__node-label">{f}</span>
              </div>
            ))}
          </div>

          <div className="hero__progress" aria-hidden="true">
            {ACTS.map((a, i) => (
              <span key={a.n} className="hero__seg">
                <span className="hero__seg-fill" data-seg={i} />
              </span>
            ))}
          </div>
          <div className="hero__hint" data-hint aria-hidden="true">
            <span className="hero__hint-line" />
            Scrollen
          </div>
        </div>
      </div>
    </section>
  );
}
