import { Check, Cloud, Doc } from '../icons.tsx';
import { Split } from '../Split.tsx';

const STEPS = [
  { n: '01', title: 'Vorgang auswählen', text: 'Zulassung, Ummeldung, Wiederzulassung oder Abmeldung – du wählst, wir zeigen, was gebraucht wird.' },
  { n: '02', title: 'Daten & Unterlagen übermitteln', text: 'Fahrzeug, Halter, eVB und SEPA-Mandat eingeben, Dokumente sicher hochladen.' },
  { n: '03', title: 'Wir erledigen die Abwicklung', text: 'Wir prüfen alles, reichen bei der zuständigen Behörde ein und halten dich per Status auf dem Laufenden.' },
];

export function Process() {
  return (
    <section className="proc" id="ablauf" data-process aria-labelledby="proc-title">
      <div className="proc__track" data-track>
        <div className="proc__stage shell" data-stage data-cursor="Scroll">
          <div className="proc__copy">
            <p className="label" data-reveal="fade">So funktioniert&apos;s</p>
            <Split id="proc-title" className="proc__title" text={'Einfacher geht\nZulassung nicht.'} />
            <ol className="proc__steps" role="list">
              <span className="proc__route" aria-hidden="true">
                <span className="proc__route-fill" data-route />
              </span>
              {STEPS.map((s, i) => (
                <li key={s.n} className="proc__step" data-step={i}>
                  <span className="proc__step-n">
                    <span>{s.n}</span>
                    <Check className="proc__step-check" width={14} height={14} />
                  </span>
                  <div>
                    <h3>{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <div className="proc__device" aria-hidden="true" data-device>
            <div className="device">
              <div className="device__bar">
                <span />
                <span />
                <span />
                <em>easykfz24.de/vorgang</em>
              </div>
              <div className="device__screens">
                <div className="screen" data-screen={0}>
                  <p className="screen__label">Schritt 1 von 6 · Leistung</p>
                  <p className="screen__title">Was möchtest du erledigen?</p>
                  {['Neuzulassung', 'Ummeldung – Halterwechsel', 'Ummeldung – Umzug', 'Abmeldung'].map((t, i) => (
                    <div key={t} className={`screen__opt${i === 1 ? ' screen__opt--picked' : ''}`} data-pick={i === 1 ? '' : undefined}>
                      <span className="screen__radio" />
                      {t}
                    </div>
                  ))}
                </div>
                <div className="screen" data-screen={1}>
                  <p className="screen__label">Schritt 4 von 6 · Unterlagen</p>
                  <p className="screen__title">Dokumente hochladen</p>
                  {['Personalausweis', 'Fahrzeugschein (ZB I)', 'Fahrzeugbrief (ZB II)', 'HU-Bericht'].map((t, i) => (
                    <div key={t} className="screen__upload">
                      <Doc width={16} height={16} />
                      <span className="screen__upload-name">{t}</span>
                      <span className="screen__bar">
                        <span data-bar={i} />
                      </span>
                    </div>
                  ))}
                  <p className="screen__note">
                    <Cloud width={14} height={14} /> Übertragung verschlüsselt
                  </p>
                </div>
                <div className="screen" data-screen={2}>
                  <p className="screen__label">Vorgang EK-2026-00417</p>
                  <p className="screen__title">Bei der Zulassungsstelle</p>
                  <div className="screen__status">
                    <span className="screen__pulse" />
                    In Bearbeitung durch EasyKFZ24
                  </div>
                  <ul className="screen__timeline" role="list">
                    {['Auftrag eingegangen', 'Unterlagen geprüft', 'Eingereicht'].map((t) => (
                      <li key={t}>
                        <Check width={12} height={12} /> {t}
                      </li>
                    ))}
                  </ul>
                  <p className="screen__note">Beispielansicht</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
