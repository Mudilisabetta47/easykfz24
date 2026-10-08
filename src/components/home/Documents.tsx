import { Check } from '../icons.tsx';
import { Split } from '../Split.tsx';

const DOCS = [
  { k: 'ZB I', title: 'Fahrzeugschein', rows: ['Kennzeichen', 'FIN', 'Halter'] },
  { k: 'eVB', title: 'eVB-Nummer', rows: ['Versicherer', 'Nummer', 'Gültig ab'] },
  { k: 'SEPA', title: 'SEPA-Mandat', rows: ['Kontoinhaber', 'IBAN', 'Kfz-Steuer'] },
  { k: 'ID', title: 'Ausweis / Identifikation', rows: ['Name', 'Anschrift', 'je nach Vorgang'] },
  { k: 'KZ', title: 'Kennzeichen', rows: ['Wunsch oder neu', 'Schilder', 'Versand'] },
];

export function Documents() {
  return (
    <section className="docs" data-docs aria-labelledby="docs-title">
      <div className="docs__track" data-track>
        <div className="docs__stage" data-stage>
          <div className="shell docs__head">
            <p className="label" data-reveal="fade">Unterlagen</p>
            <Split id="docs-title" className="docs__title" text="Alles, was wir brauchen." />
            <p className="lead" data-reveal="up">
              Je nach Vorgang fragen wir genau die Unterlagen ab, die die Zulassungsbehörde verlangt – nicht mehr.
            </p>
          </div>

          <div className="docs__table">
            {DOCS.map((d, i) => (
              <article key={d.k} className="dcard" data-dcard={i}>
                <header className="dcard__head">
                  <span className="dcard__k">{d.k}</span>
                  <span className="dcard__ok">
                    <Check width={12} height={12} /> geprüft
                  </span>
                </header>
                <h3 className="dcard__title">{d.title}</h3>
                <dl className="dcard__rows">
                  {d.rows.map((r) => (
                    <div key={r}>
                      <dt>{r}</dt>
                      <dd>
                        <i />
                      </dd>
                    </div>
                  ))}
                </dl>
              </article>
            ))}
            <div className="docs__complete" data-complete>
              <span className="docs__complete-icon">
                <Check width={22} height={22} />
              </span>
              <span>
                <strong>Vorgang vollständig</strong>
                <span className="docs__complete-sub">Bereit zur Einreichung</span>
              </span>
            </div>
          </div>

          <p className="docs__count" aria-hidden="true">
            <span data-count>0 / 5</span> Unterlagen
          </p>
        </div>
      </div>
    </section>
  );
}
