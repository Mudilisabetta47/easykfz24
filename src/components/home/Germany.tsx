import { Split } from '../Split.tsx';

// Grobe Außengrenze Deutschlands (Länge, Breite) – abstrahiert, nicht maßstabsgetreu.
const BORDER: [number, number][] = [
  [7.2, 53.25], [7.0, 53.55], [7.6, 53.7], [8.2, 53.55], [8.5, 53.85], [8.95, 53.9], [8.85, 54.25], [8.6, 54.5],
  [8.65, 54.9], [9.4, 54.83], [9.95, 54.78], [10.15, 54.42], [10.9, 54.38], [11.1, 54.52], [10.85, 53.98],
  [11.5, 54.05], [12.1, 54.2], [12.5, 54.47], [13.35, 54.68], [13.75, 54.3], [14.2, 53.92], [14.4, 53.3],
  [14.12, 52.85], [14.62, 52.58], [14.72, 52.1], [14.6, 51.6], [15.02, 51.12], [14.82, 50.87], [14.3, 50.95],
  [13.5, 50.65], [12.95, 50.4], [12.32, 50.2], [12.5, 49.95], [12.4, 49.7], [12.75, 49.38], [13.4, 48.98],
  [13.83, 48.77], [13.45, 48.55], [13.0, 48.28], [12.85, 48.05], [13.02, 47.6], [12.75, 47.66], [12.2, 47.7],
  [11.6, 47.52], [10.98, 47.4], [10.45, 47.55], [10.18, 47.28], [9.95, 47.54], [9.55, 47.54], [8.9, 47.66],
  [8.6, 47.78], [8.4, 47.6], [7.6, 47.58], [7.55, 48.05], [7.85, 48.6], [8.22, 48.98], [7.6, 49.08],
  [7.05, 49.15], [6.4, 49.45], [6.38, 49.8], [6.12, 50.1], [6.4, 50.32], [6.05, 50.65], [6.0, 50.78],
  [5.88, 51.05], [6.2, 51.4], [5.95, 51.8], [6.75, 51.92], [6.85, 52.12], [7.05, 52.25], [7.05, 52.62],
  [6.72, 52.65], [7.05, 52.88], [7.2, 53.25],
];

const CITIES: { name: string; lon: number; lat: number }[] = [
  { name: 'Hamburg', lon: 10.0, lat: 53.55 },
  { name: 'Berlin', lon: 13.4, lat: 52.52 },
  { name: 'Köln', lon: 6.96, lat: 50.94 },
  { name: 'München', lon: 11.58, lat: 48.14 },
  { name: 'Frankfurt', lon: 8.68, lat: 50.11 },
  { name: 'Bremen', lon: 8.8, lat: 53.08 },
  { name: 'Leipzig', lon: 12.37, lat: 51.34 },
  { name: 'Stuttgart', lon: 9.18, lat: 48.78 },
  { name: 'Hannover', lon: 9.73, lat: 52.37 },
  { name: 'Dresden', lon: 13.74, lat: 51.05 },
  { name: 'Dortmund', lon: 7.47, lat: 51.51 },
  { name: 'Nürnberg', lon: 11.08, lat: 49.45 },
  { name: 'Kiel', lon: 10.13, lat: 54.32 },
  { name: 'Rostock', lon: 12.1, lat: 54.09 },
  { name: 'Saarbrücken', lon: 7.0, lat: 49.23 },
  { name: 'Freiburg', lon: 7.85, lat: 48.0 },
  { name: 'Erfurt', lon: 11.03, lat: 50.98 },
  { name: 'Münster', lon: 7.63, lat: 51.96 },
  { name: 'Regensburg', lon: 12.1, lat: 49.02 },
  { name: 'Magdeburg', lon: 11.63, lat: 52.13 },
];

const HUB = { lon: 10.2, lat: 51.15 };
const W = 520;
const H = 640;
const LON0 = 5.6;
const LAT0 = 55.2;
const KX = 0.63; // cos(51°)
const SCALE = 61;

function proj(lon: number, lat: number): [number, number] {
  return [Math.round(((lon - LON0) * KX * SCALE + 24) * 10) / 10, Math.round(((LAT0 - lat) * SCALE + 18) * 10) / 10];
}

const OUTLINE = 'M' + BORDER.map(([lon, lat]) => proj(lon, lat).join(' ')).join('L') + 'Z';
const [HX, HY] = proj(HUB.lon, HUB.lat);

export function Germany() {
  return (
    <section className="de" data-map aria-labelledby="de-title">
      <div className="shell de__grid">
        <div className="de__copy">
          <p className="label" data-reveal="fade">Bundesweit beauftragen</p>
          <Split id="de-title" className="de__title" text={'Digital.\nDeutschlandweit.'} />
          <p className="lead" data-reveal="up">EasyKFZ24 ist nicht an einen Schalter gebunden.</p>
          <p className="de__text" data-reveal="up">
            Du beauftragst online, egal wo du wohnst. Eingereicht wird immer bei der Zulassungsbehörde, die für den
            Halterwohnsitz zuständig ist. Je nach Vorgang und Behörde können Abläufe und Bearbeitungszeiten regional
            abweichen – das klären wir, bevor wir loslegen.
          </p>
        </div>
        <div className="de__map" data-map-stage aria-hidden="true">
          <svg viewBox={`0 0 ${W} ${H}`} className="de__svg">
            <defs>
              <radialGradient id="de-fill" cx="0.5" cy="0.45" r="0.7">
                <stop offset="0" stopColor="#e4ecff" />
                <stop offset="1" stopColor="#f4f7ff" />
              </radialGradient>
            </defs>
            <path d={OUTLINE} className="de__land" fill="url(#de-fill)" data-land />
            <path d={OUTLINE} className="de__outline" pathLength={1} data-outline />
            {CITIES.map((c, i) => {
              const [x, y] = proj(c.lon, c.lat);
              const mx = (x + HX) / 2 + (y - HY) * 0.12;
              const my = (y + HY) / 2 - (x - HX) * 0.12;
              return <path key={c.name} d={`M${HX} ${HY}Q${mx} ${my} ${x} ${y}`} className="de__link" pathLength={1} data-link={i} />;
            })}
            {CITIES.map((c, i) => {
              const [x, y] = proj(c.lon, c.lat);
              return (
                <g key={c.name} data-city={i} className="de__city">
                  <circle cx={x} cy={y} r="9" className="de__city-halo" />
                  <circle cx={x} cy={y} r="3.6" className="de__city-dot" />
                </g>
              );
            })}
            <g className="de__hub" data-hub>
              <circle cx={HX} cy={HY} r="26" className="de__hub-halo" />
              <circle cx={HX} cy={HY} r="11" className="de__hub-dot" />
            </g>
          </svg>
          <span className="de__badge" data-badge>
            <span className="chip__dot" /> Online beauftragt
          </span>
        </div>
      </div>
    </section>
  );
}
