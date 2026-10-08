import Link from 'next/link';
import { ArrowRight, Check } from '../icons.tsx';
import { Split } from '../Split.tsx';

const ROWS = ['Antrag erhalten', 'Daten geprüft', 'In Bearbeitung', 'Zulassung abgeschlossen', 'Kennzeichen versendet'];

export function StatusDemo() {
  return (
    <section className="sdemo" data-statusdemo aria-labelledby="sdemo-title">
      <div className="sdemo__track" data-track>
        <div className="sdemo__stage shell" data-stage>
          <div className="sdemo__copy">
            <p className="label" data-reveal="fade">Status in Echtzeit</p>
            <Split id="sdemo-title" className="sdemo__title" text={'Immer wissen,\nwo dein Vorgang steht.'} />
            <p className="lead" data-reveal="up">
              Mit Auftragsnummer und E-Mail-Adresse siehst du jederzeit, in welchem Schritt dein Vorgang ist – und ob wir
              noch etwas von dir brauchen.
            </p>
            <Link href="/status" className="link" data-reveal="up">
              Status abrufen <ArrowRight className="btn__icon" width={18} height={18} />
            </Link>
          </div>

          <div className="sdemo__visual" aria-hidden="true">
            <div className="browser" data-mock>
              <div className="browser__bar">
                <span />
                <span />
                <span />
                <em>easykfz24.de/status</em>
              </div>
              <div className="browser__body">
                <div className="browser__top">
                  <span className="sdemo__brand">EasyKFZ24</span>
                  <span className="chip chip--blue">Beispielansicht</span>
                </div>
                <p className="sdemo__label">Vorgang</p>
                <p className="sdemo__nr">EK-2026-00417</p>
                <p className="sdemo__car">Audi A5 Coupé · Ummeldung</p>
                <ol className="sdemo__rows" role="list">
                  <span className="sdemo__line" aria-hidden="true">
                    <span data-line />
                  </span>
                  {ROWS.map((r, i) => (
                    <li key={r} className="sdemo__row" data-row={i} data-state="pending">
                      <span className="sdemo__mark">
                        <Check width={12} height={12} />
                      </span>
                      <span className="sdemo__row-label">{r}</span>
                      <span className="sdemo__row-state" data-row-state />
                    </li>
                  ))}
                </ol>
              </div>
            </div>
            <div className="sdemo__float" data-float>
              <span className="sdemo__float-dot" />
              <span>
                <span className="sdemo__float-label">Aktueller Schritt</span>
                <strong data-current>Antrag erhalten</strong>
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
