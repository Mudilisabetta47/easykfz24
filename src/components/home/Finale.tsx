import Link from 'next/link';
import { CarSvg } from '../CarSvg.tsx';
import { ArrowRight } from '../icons.tsx';
import { Split } from '../Split.tsx';
import { PromoBadge, promoActive } from '../Promo.tsx';

export function Finale() {
  return (
    <section className="finale on-dark" data-finale aria-labelledby="finale-title">
      <div className="finale__track" data-track>
        <div className="finale__stage" data-stage>
          <div className="finale__bg" aria-hidden="true">
            <span className="finale__edge" data-edge />
          </div>
          <div className="finale__car" data-fcar aria-hidden="true">
            <CarSvg id="finale-car" />
          </div>
          <div className="shell finale__copy">
            <Split as="h2" id="finale-title" className="finale__title" text={'Bereit für die\neinfachere Zulassung?'} />
            <div className="finale__cta" data-reveal="up">
              <Link href="/kfz-anmelden/auftrag" className="btn btn--lg" data-magnetic="0.22" data-cursor="Start">
                Jetzt starten
                <ArrowRight className="btn__icon" />
              </Link>
              <p>In wenigen Minuten online beginnen.</p>
              {promoActive() ? (
                <p className="finale__promo">
                  <PromoBadge tone="dark" /> Als Neukunde sparst du 10 % auf die Servicepauschale.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
