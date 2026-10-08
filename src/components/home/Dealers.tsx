import { Split } from '../Split.tsx';

type State = 'missing' | 'submitted' | 'done' | 'shipping' | 'review';

const STATE_LABEL: Record<State, string> = {
  missing: 'Unterlagen fehlen',
  submitted: 'Eingereicht',
  done: 'Abgeschlossen',
  shipping: 'Versand',
  review: 'In Prüfung',
};

const QUEUE: { car: string; kind: string; state: State }[] = [
  { car: 'Audi A3 Sportback', kind: 'Neuzulassung', state: 'missing' },
  { car: 'BMW X3', kind: 'Halterwechsel', state: 'submitted' },
  { car: 'Mercedes C-Klasse', kind: 'Neuzulassung', state: 'done' },
  { car: 'VW Golf', kind: 'Neuzulassung', state: 'shipping' },
  { car: 'Skoda Octavia Combi', kind: 'Halterwechsel', state: 'review' },
  { car: 'Opel Corsa', kind: 'Neuzulassung', state: 'submitted' },
  { car: 'Ford Kuga', kind: 'Wiederzulassung', state: 'done' },
  { car: 'Hyundai Kona', kind: 'Neuzulassung', state: 'review' },
  { car: 'Seat Leon', kind: 'Abmeldung', state: 'done' },
  { car: 'Toyota Yaris', kind: 'Neuzulassung', state: 'shipping' },
  { car: 'Kia Sportage', kind: 'Halterwechsel', state: 'submitted' },
  { car: 'Renault Clio', kind: 'Neuzulassung', state: 'missing' },
];

export function Dealers() {
  return (
    <section className="b2b on-dark" id="haendler" data-b2b aria-labelledby="b2b-title">
      <div className="b2b__track" data-track>
        <div className="b2b__stage" data-stage>
          <div className="shell b2b__grid">
            <div className="b2b__copy">
              <p className="label b2b__label" data-reveal="fade">Für Autohäuser &amp; Flotten</p>
              <Split id="b2b-title" className="b2b__title" text={'Zulassung für 1 Fahrzeug.\nOder 1.000.'} />
              <p className="b2b__lead" data-reveal="up">
                Ein Händlerzugang mit Sammelaufträgen, gemeinsamer Statusübersicht und Hinweisen zu fehlenden Unterlagen
                je Fahrzeug ist in Vorbereitung.
              </p>
              <div className="b2b__cta" data-reveal="up">
                <button type="button" className="btn btn--lg" aria-disabled="true" aria-describedby="b2b-soon">
                  Händlerzugang anfragen
                </button>
                <span id="b2b-soon" className="chip chip--soon">
                  Bald verfügbar
                </span>
              </div>
              <p className="b2b__fine" data-reveal="fade">
                Bis dahin kannst du jedes Fahrzeug als eigenen Vorgang beauftragen.
              </p>
            </div>

            <div className="b2b__visual" aria-hidden="true">
              <div className="dash">
                <div className="dash__top">
                  <span className="dash__title">Händler-Dashboard</span>
                  <span className="dash__tag">Produktvisualisierung</span>
                </div>
                <div className="dash__kpi">
                  <span className="dash__count" data-qcount>
                    1
                  </span>
                  <span className="dash__kpi-label">Fahrzeuge in der Ansicht</span>
                </div>
                <div className="dash__head">
                  <span>Fahrzeug</span>
                  <span>Vorgang</span>
                  <span>Status</span>
                </div>
                <div className="dash__viewport">
                  <ul className="dash__list" role="list" data-qlist>
                    {QUEUE.map((q, i) => (
                      <li key={q.car} className="dash__row" data-qrow={i}>
                        <span className="dash__car">{q.car}</span>
                        <span className="dash__kind">{q.kind}</span>
                        <span className={`dash__pill dash__pill--${q.state}`}>{STATE_LABEL[q.state]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
