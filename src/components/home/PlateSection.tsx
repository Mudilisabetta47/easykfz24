import { Sparkle, Truck } from '../icons.tsx';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';
import { Split } from '../Split.tsx';

const OPTIONS = [
  { title: 'Wunschkennzeichen', text: 'Wir reservieren deine Wunschkombination – sofern sie verfügbar ist.', icon: Sparkle },
  { title: 'Kennzeichen bestellen', text: 'Geprägte Schilder passend zum Fahrzeug direkt mitbestellen.', icon: PlateIcon },
  { title: 'Versand oder Abholung', text: 'Papiere und Schilder kommen per Einschreiben – oder du holst sie ab.', icon: Truck },
];

function PlateIcon(p: { width?: number; height?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden="true" {...p}>
      <rect x="2.5" y="7" width="19" height="10" rx="2" />
      <path d="M6 7v10" />
      <path d="M9 12h3M14 12h4" />
    </svg>
  );
}

export function PlateSection() {
  return (
    <section className="kz" data-platescene aria-labelledby="kz-title">
      <div className="kz__track" data-track>
        <div className="kz__stage" data-stage>
          <div className="shell kz__head">
            <p className="label" data-reveal="fade">Kennzeichen</p>
            <Split id="kz-title" className="kz__title" text={'Dein Kennzeichen.\nStück für Stück.'} />
          </div>
          <div className="kz__plate-wrap" data-bigplate data-plate-scene>
            <div className="kz__plate-glow" aria-hidden="true" />
            <GermanLicensePlate id="sec-kz" cityCode="HB" letters="EZ" numbers="24" size="min(88vw, 940px)" showSealPlaceholder />
          </div>
          <p className="kz__note">Schematische Darstellung – kein amtliches Kennzeichen.</p>
          <ul className="shell kz__opts" role="list">
            {OPTIONS.map((o, i) => (
              <li key={o.title} className="kz__opt" data-opt={i}>
                <span className="kz__opt-icon">
                  <o.icon width={22} height={22} />
                </span>
                <h3>{o.title}</h3>
                <p>{o.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
