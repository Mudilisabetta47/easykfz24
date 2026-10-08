import type { CSSProperties } from 'react';
import { Cloud, Flag, Headset, Pulse, Receipt, Shield } from '../icons.tsx';
import { Split } from '../Split.tsx';

const ITEMS = [
  { title: 'Sichere Datenübertragung', text: 'Verschlüsselte Verbindung, Uploads nur für die Sachbearbeitung abrufbar.', icon: Shield },
  { title: 'Transparenter Status', text: 'Jeder Schritt ist mit Auftragsnummer und E-Mail-Adresse abrufbar.', icon: Pulse },
  { title: 'Klare Preise', text: 'Unsere Servicekosten und die amtlichen Gebühren werden getrennt ausgewiesen.', icon: Receipt },
  { title: 'Digitale Abwicklung', text: 'Formular statt Wartemarke: Daten und Unterlagen online übermitteln.', icon: Cloud },
  { title: 'Persönlicher Support', text: 'Fehlt etwas, melden wir uns konkret – mit Hinweis direkt im Status.', icon: Headset },
  { title: 'Deutsches Unternehmen', text: 'Betrieb und Ansprechpartner in Deutschland, Verarbeitung nach DSGVO.', icon: Flag },
];

export function Trust() {
  return (
    <section className="trust" aria-labelledby="trust-title">
      <div className="shell">
        <div className="trust__head">
          <p className="label" data-reveal="fade">Darauf kannst du dich verlassen</p>
          <Split id="trust-title" className="trust__title" text={'Vertrauen entsteht\ndurch Klarheit.'} />
        </div>
        <ul className="trust__grid" role="list">
          {ITEMS.map((it, i) => (
            <li key={it.title} className="trust__item" data-reveal="up" style={{ '--rv-delay': `${(i % 3) * 80}ms` } as CSSProperties}>
              <span className="trust__icon">
                <it.icon width={22} height={22} />
              </span>
              <h3>{it.title}</h3>
              <p>{it.text}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
