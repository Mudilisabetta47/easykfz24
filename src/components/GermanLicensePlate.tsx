import type { CSSProperties } from 'react';
import { groupExtent, layoutPlate, PLATE, PLATE_VIEW, GLYPHS, scalePathX, type PlacedGlyph, type PlateGroup } from '../lib/plate.ts';

interface Props {
  cityCode: string;
  letters: string;
  numbers: string;
  /** Breite des Schilds: Zahl = px, Text = CSS-Wert (z. B. "clamp(280px, 60vw, 900px)") */
  size?: number | string;
  /** Neigung in Grad (0 = frontal) */
  perspective?: number;
  showEuroBand?: boolean;
  /** Neutraler Bereich für Plaketten – bewusst ohne Siegel-Imitation */
  showSealPlaceholder?: boolean;
  /** Eindeutiges Präfix für SVG-IDs, wenn mehrere Schilder auf einer Seite stehen */
  id?: string;
  className?: string;
  /** Umgebung: auf dunklen Bühnen spiegelt das Schild kühles Umgebungslicht. */
  tone?: 'light' | 'dark';
  /** "lite" für viele kleine Schilder (ohne Körnung und Mikroprismen) */
  detail?: 'full' | 'lite';
  /** Eingabemodus: diese Gruppen sind nur Platzhalter und erscheinen hellgrau statt geprägt */
  ghost?: Partial<Record<PlateGroup, boolean>>;
  /** Eingabemodus: blinkende Schreibmarke hinter dieser Gruppe */
  caret?: PlateGroup | null;
  /** Eingabemodus: Gruppen mit Fehler rot markieren */
  invalid?: PlateGroup | 'all' | null;
}

const { PAD_X, PAD_Y, PAD_B } = PLATE_VIEW;

function Glyphs({ list, scaleX }: { list: PlacedGlyph[]; scaleX: number }) {
  return (
    <>
      {list.map((g, i) =>
        g.glyph.d.map((d, j) => <path key={`${i}-${j}`} d={scalePathX(d, scaleX)} transform={`translate(${g.x.toFixed(2)} ${PLATE.CHAR_TOP})`} />),
      )}
    </>
  );
}

/**
 * Prägung wie bei echten Aluminiumschildern: Die Zeichen sind etwa 1 mm hochgedrückt, nur die Oberseite ist schwarz.
 * Ein einziger Filter erzeugt daraus die Flanken – unten rechts die Schattenseite, oben links eine helle Lichtkante –,
 * eine weiche Kontaktverschattung, die mattschwarze Farbe mit leicht gerundeten Ecken und eine feine Glanzkante.
 */
function Embossed({ id, children, part }: { id: string; children: React.ReactNode; part?: string }) {
  return (
    <g data-plate-part={part} className="lp__part">
      <g stroke="#000" filter={`url(#${id}-emboss)`}>
        {children}
      </g>
    </g>
  );
}

/** Markierung des aktiven (blau) oder fehlerhaften (rot) Eingabebereichs. */
function FieldMark({ layout, group, error }: { layout: ReturnType<typeof layoutPlate>; group: PlateGroup; error: boolean }) {
  const ext = groupExtent(layout, group);
  if (!ext) return null;
  const x = ext.x0 - 6;
  const w = Math.max(ext.x1 - ext.x0 + 12, 30);
  return (
    <rect
      className="lp__mark"
      x={x - (w - (ext.x1 - ext.x0 + 12)) / 2}
      y={PLATE.CHAR_TOP - 7}
      width={w}
      height={PLATE.CHAR_H + 14}
      rx={5}
      fill={error ? 'rgb(196 50 43 / 0.1)' : 'rgb(42 85 255 / 0.09)'}
      stroke={error ? 'rgb(196 50 43 / 0.55)' : 'rgb(42 85 255 / 0.4)'}
      strokeWidth={1.6}
    />
  );
}

/** Schreibmarke im Eingabemodus: hinter dem letzten Zeichen, bei Platzhaltern davor. */
function Caret({ layout, group, ghost }: { layout: ReturnType<typeof layoutPlate>; group: PlateGroup; ghost: boolean }) {
  const ext = groupExtent(layout, group);
  if (!ext) return null;
  const x = ghost ? ext.x0 - 2 : ext.x1 + 2.6;
  return <rect className="lp__caret" x={x - 1.6} y={PLATE.CHAR_TOP - 3} width={3.2} height={PLATE.CHAR_H + 6} rx={1.6} fill="#2a55ff" />;
}

function star(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.4;
    const ang = -Math.PI / 2 + (i * Math.PI) / 5;
    pts.push(`${(cx + Math.cos(ang) * rad).toFixed(2)},${(cy + Math.sin(ang) * rad).toFixed(2)}`);
  }
  return pts.join(' ');
}

/**
 * Realistisches deutsches Kennzeichen (520 × 110 mm) als SVG: reflektierende Aluminiumfläche mit feiner Körnung,
 * geprägter schwarzer Rand und geprägte Zeichen, Eurofeld mit 12 Sternen. Einzelne Bestandteile tragen
 * data-plate-part (body, band, district, letters, digits, seal), die Lichtreflexion data-plate-sweep.
 */
export function GermanLicensePlate({
  cityCode,
  letters,
  numbers,
  size = 320,
  perspective = 0,
  showEuroBand = true,
  showSealPlaceholder = false,
  id = 'kz',
  className = '',
  tone = 'light',
  detail = 'full',
  ghost,
  caret = null,
  invalid = null,
}: Props) {
  const L = layoutPlate(cityCode, letters, numbers, showEuroBand);
  const { W, H, RADIUS } = PLATE;
  const bi = PLATE.BORDER_INSET;
  const label = `Kennzeichen ${[cityCode, letters, numbers].filter(Boolean).join(' ')}`;
  const vbW = W + PAD_X * 2;
  const vbH = H + PAD_Y + PAD_B;
  const width = typeof size === 'number' ? `${(size * vbW) / W}px` : `calc(${size} * ${(vbW / W).toFixed(4)})`;
  const style = {
    '--lp-w': width,
    '--lp-tilt': `${perspective}deg`,
  } as CSSProperties;
  const bandR = RADIUS - bi - 0.6;
  const bx = PLATE.BAND_X;
  const bw = PLATE.BAND_W;
  const bh = H - bx * 2;
  const starCx = bx + bw / 2;
  const sealCx = L.sealX + L.sealW / 2;
  // Zeichen für "D" im Eurofeld (Kennzeichenschrift, verkleinert)
  const dScale = 0.3;
  const dX = starCx - (GLYPHS.D.w * dScale) / 2;
  const dY = 72;

  return (
    <span className={`lp${perspective ? ' lp--tilt' : ''} ${className}`} style={style} role="img" aria-label={label}>
      <svg viewBox={`${-PAD_X} ${-PAD_Y} ${vbW} ${vbH}`} className="lp__svg" aria-hidden="true">
        <defs>
          <clipPath id={`${id}-clip`}>
            <rect width={W} height={H} rx={RADIUS} />
          </clipPath>
          {/* Reflexfolie: gebrochenes Weiß, leicht metallisch */}
          <linearGradient id={`${id}-base`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fafbf9" />
            <stop offset="0.5" stopColor="#f3f4f1" />
            <stop offset="1" stopColor="#e9eae6" />
          </linearGradient>
          <linearGradient id={`${id}-sheen`} x1="0" y1="0" x2="1" y2="0.6">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.55" />
            <stop offset="0.35" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.62" stopColor="#dfe6ef" stopOpacity="0.22" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.06" />
          </linearGradient>
          <linearGradient id={`${id}-relief`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0.5" />
            <stop offset="0.08" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.9" stopColor="#000000" stopOpacity="0" />
            <stop offset="1" stopColor="#000000" stopOpacity="0.1" />
          </linearGradient>
          <linearGradient id={`${id}-ink`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={H}>
            <stop offset="0" stopColor="#1e1e20" />
            <stop offset="0.5" stopColor="#0a0a0b" />
            <stop offset="1" stopColor="#000000" />
          </linearGradient>
          <linearGradient id={`${id}-blue`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#1d47ad" />
            <stop offset="1" stopColor="#0d2f86" />
          </linearGradient>
          <radialGradient id={`${id}-seal`} cx="0.4" cy="0.35" r="0.7">
            <stop offset="0" stopColor="#f4f4ef" />
            <stop offset="1" stopColor="#dcdcd4" />
          </radialGradient>
          <linearGradient id={`${id}-sweep-soft`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#dce6ff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#eef3ff" stopOpacity="0.32" />
            <stop offset="1" stopColor="#dce6ff" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${id}-env`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.55" stopColor="#7f9bff" stopOpacity="0" />
            <stop offset="1" stopColor="#5d7dff" stopOpacity="0.16" />
          </linearGradient>
          <linearGradient id={`${id}-sweep`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="0.38" stopColor="#e8f0ff" stopOpacity="0.18" />
            <stop offset="0.5" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="0.62" stopColor="#fff6e6" stopOpacity="0.18" />
            <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          {/* Mikroprismen der Reflexfolie */}
          <pattern id={`${id}-beads`} width="2.4" height="2.08" patternUnits="userSpaceOnUse">
            <circle cx="0.6" cy="0.52" r="0.42" fill="#000" fillOpacity="0.025" />
            <circle cx="1.8" cy="1.56" r="0.42" fill="#000" fillOpacity="0.025" />
          </pattern>
          <filter id={`${id}-grain`} x="0" y="0" width="100%" height="100%">
            <feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="7" stitchTiles="stitch" />
            <feColorMatrix type="matrix" values="0 0 0 0 0.3  0 0 0 0 0.3  0 0 0 0 0.28  0 0 0 0.09 0" />
          </filter>
          <filter id={`${id}-soft`} x="-10%" y="-10%" width="120%" height="120%">
            <feGaussianBlur stdDeviation="0.45" />
          </filter>
          <filter id={`${id}-emboss`} filterUnits="userSpaceOnUse" x={-4} y={-4} width={W + 8} height={H + 8} colorInterpolationFilters="sRGB">
            {/* Weiche Ecken wie bei der Kennzeichenschrift: kurz weichzeichnen, dann wieder scharf schwellen */}
            <feGaussianBlur in="SourceAlpha" stdDeviation="0.85" result="b" />
            <feComponentTransfer in="b" result="shape">
              <feFuncA type="linear" slope="12" intercept="-5.2" />
            </feComponentTransfer>
            {/* Flanken der Prägung */}
            <feMorphology in="shape" operator="dilate" radius="0.55" result="wall" />
            <feGaussianBlur in="wall" stdDeviation="0.75" result="wallSoft" />
            <feOffset in="wallSoft" dx="0.75" dy="1" result="shOff" />
            <feFlood floodColor="#0c1222" floodOpacity={tone === 'dark' ? 0.55 : 0.42} />
            <feComposite in2="shOff" operator="in" result="shadow" />
            <feOffset in="wallSoft" dx="-0.55" dy="-0.75" result="hlOff" />
            <feFlood floodColor="#ffffff" floodOpacity="1" />
            <feComposite in2="hlOff" operator="in" result="highlight" />
            {/* Kontaktverschattung rund um das Zeichen */}
            <feGaussianBlur in="shape" stdDeviation="1.6" result="ao" />
            <feFlood floodColor="#0c1222" floodOpacity="0.1" />
            <feComposite in2="ao" operator="in" result="aoShade" />
            {/* Mattschwarze Farbe mit feiner Glanzkante oben links */}
            <feFlood floodColor="#131314" />
            <feComposite in2="shape" operator="in" result="ink" />
            <feOffset in="shape" dx="0.5" dy="0.65" result="shapeOff" />
            <feComposite in="shape" in2="shapeOff" operator="out" result="edge" />
            <feGaussianBlur in="edge" stdDeviation="0.3" result="edgeSoft" />
            <feFlood floodColor="#ffffff" floodOpacity="0.2" />
            <feComposite in2="edgeSoft" operator="in" />
            <feComposite in2="shape" operator="in" result="gloss" />
            <feMerge>
              <feMergeNode in="aoShade" />
              <feMergeNode in="highlight" />
              <feMergeNode in="shadow" />
              <feMergeNode in="ink" />
              <feMergeNode in="gloss" />
            </feMerge>
          </filter>
          <filter id={`${id}-shadow`} x="-10%" y="-30%" width="120%" height="180%">
            <feGaussianBlur stdDeviation="3.2" />
          </filter>
        </defs>

        <g className={perspective ? 'lp__tilt' : undefined}>
          {/* Schatten unter dem Schild */}
          <rect x="6" y="9" width={W - 12} height={H - 2} rx={RADIUS} fill={tone === 'dark' ? '#000' : '#0a1433'} opacity={tone === 'dark' ? 0.55 : 0.3} filter={`url(#${id}-shadow)`} />
          <rect x="14" y={H - 1} width={W - 28} height="4" rx="2" fill="#000" opacity={tone === 'dark' ? 0.45 : 0.18} filter={`url(#${id}-soft)`} />

          <g data-plate-part="body" className="lp__part">
            <rect width={W} height={H} rx={RADIUS} fill={`url(#${id}-base)`} />
            <g clipPath={`url(#${id}-clip)`}>
              {detail === 'full' ? (
                <>
                  <rect width={W} height={H} fill={`url(#${id}-beads)`} />
                  <rect width={W} height={H} filter={`url(#${id}-grain)`} />
                </>
              ) : null}
              <rect width={W} height={H} fill={`url(#${id}-sheen)`} />
            </g>
            {/* Blechkante: oben Licht, unten Abschattung */}
            <rect x="0.25" y="0.25" width={W - 0.5} height={H - 0.5} rx={RADIUS - 0.2} fill="none" stroke="#8a8a83" strokeWidth="0.5" />
            <path d={`M${RADIUS} 0.7H${W - RADIUS}`} stroke="#ffffff" strokeOpacity="0.95" strokeWidth="0.6" />
            <path d={`M${RADIUS} ${H - 0.7}H${W - RADIUS}`} stroke="#000000" strokeOpacity="0.18" strokeWidth="0.7" />
            {/* Geprägter Rand */}
            <Embossed id={id}>
              <rect
                x={bi + PLATE.BORDER_W / 2}
                y={bi + PLATE.BORDER_W / 2}
                width={W - 2 * bi - PLATE.BORDER_W}
                height={H - 2 * bi - PLATE.BORDER_W}
                rx={RADIUS - bi}
                fill="none"
                strokeWidth={PLATE.BORDER_W}
              />
            </Embossed>
            {/* Innere Lichtkante */}
            <rect
              x={bi + PLATE.BORDER_W + 0.45}
              y={bi + PLATE.BORDER_W + 0.45}
              width={W - 2 * (bi + PLATE.BORDER_W + 0.45)}
              height={H - 2 * (bi + PLATE.BORDER_W + 0.45)}
              rx={RADIUS - bi - 1.2}
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.85"
              strokeWidth="0.55"
            />
          </g>

          {showEuroBand ? (
            <g data-plate-part="band" className="lp__part lp__band">
              <path
                d={`M${bx + bandR} ${bx}H${bx + bw}V${bx + bh}H${bx + bandR}A${bandR} ${bandR} 0 0 1 ${bx} ${bx + bh - bandR}V${bx + bandR}A${bandR} ${bandR} 0 0 1 ${bx + bandR} ${bx}Z`}
                fill={`url(#${id}-blue)`}
              />
              <path d={`M${bx + bw - 0.4} ${bx}V${bx + bh}`} stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
              {Array.from({ length: 12 }, (_, i) => {
                const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
                return <polygon key={i} points={star(starCx + Math.cos(ang) * 12.4, 30 + Math.sin(ang) * 12.4, 2.75)} fill="#ffd200" />;
              })}
              <g stroke="#ffffff" strokeWidth={PLATE.STROKE} fill="none" strokeLinejoin="miter" strokeMiterlimit={1.5}>
                <path d={GLYPHS.D.d[0]} transform={`translate(${dX.toFixed(2)} ${dY}) scale(${dScale})`} />
              </g>
            </g>
          ) : null}

          {showSealPlaceholder ? (
            <g data-plate-part="seal" className="lp__part" aria-hidden="true">
              {[37, 73].map((cy) => (
                <g key={cy}>
                  <circle cx={sealCx} cy={cy} r="14.5" fill={`url(#${id}-seal)`} fillOpacity="0.55" />
                  <circle cx={sealCx} cy={cy} r="14.5" fill="none" stroke="#000" strokeOpacity="0.07" strokeWidth="0.45" />
                  <path d={`M${sealCx - 10} ${cy - 10.4}A14.5 14.5 0 0 1 ${sealCx + 10} ${cy - 10.4}`} fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="0.5" />
                </g>
              ))}
            </g>
          ) : null}

          <g fill="none" strokeWidth={PLATE.STROKE} strokeLinejoin="miter" strokeMiterlimit={1.5} strokeLinecap="butt">
            {(
              [
                ['district', 'cityCode', L.district],
                ['letters', 'letters', L.letters],
                ['digits', 'numbers', L.digits],
              ] as const
            ).map(([part, group, list]) => {
              const real = ghost?.[group] ? [] : list.filter((g) => g.char !== '?');
              const flat = ghost?.[group] ? list : list.filter((g) => g.char === '?');
              return (
                <g key={part}>
                  <Embossed id={id} part={part}>
                    <Glyphs list={real} scaleX={L.scaleX} />
                  </Embossed>
                  {flat.length ? (
                    <g stroke="#c3c9d4" className="lp__ghost">
                      <Glyphs list={flat} scaleX={L.scaleX} />
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          {(['cityCode', 'letters', 'numbers'] as const).map((g) =>
            invalid === g || invalid === 'all' || caret === g ? (
              <FieldMark key={g} layout={L} group={g} error={invalid === g || invalid === 'all'} />
            ) : null,
          )}
          {caret ? <Caret layout={L} group={caret} ghost={!!ghost?.[caret]} /> : null}

          {/* Plastik: oben Licht, unten leichte Abschattung */}
          <rect width={W} height={H} rx={RADIUS} fill={`url(#${id}-relief)`} pointerEvents="none" />
          {tone === 'dark' ? <rect width={W} height={H} rx={RADIUS} fill={`url(#${id}-env)`} pointerEvents="none" /> : null}

          {/* Lichtreflexion – Position und Deckkraft steuert die Szene */}
          <g clipPath={`url(#${id}-clip)`} className="lp__sweep-clip">
            <g data-plate-sweep className="lp__sweep" opacity="0">
              <rect x="-150" y="-30" width="270" height={H + 60} fill={`url(#${id}-sweep-soft)`} transform="skewX(-18)" />
              <rect x="-62" y="-30" width="94" height={H + 60} fill={`url(#${id}-sweep)`} transform="skewX(-18)" />
            </g>
          </g>
        </g>
      </svg>
    </span>
  );
}
