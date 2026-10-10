import type { CSSProperties } from 'react';
import { plateGeometry, PLATE, PLATE_VIEW, GLYPHS, scalePathX, type Box, type PlacedGroup, type PlateFormat, type PlateGroup } from '../lib/plate.ts';

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
  /** Schildform: einzeilig (eu) oder zweizeilig für Motorrad, Leichtkraftrad, Traktor */
  format?: PlateFormat;
}

const { PAD_X, PAD_Y, PAD_B } = PLATE_VIEW;

function Glyphs({ group, only }: { group: PlacedGroup; only?: (char: string) => boolean }) {
  const t = (x: number) => `translate(${x.toFixed(2)} ${group.y.toFixed(2)})${group.s !== 1 ? ` scale(${group.s})` : ''}`;
  return (
    <>
      {group.glyphs
        .filter((g) => !only || only(g.char))
        .map((g, i) =>
          g.glyph.d.map((d, j) => (
            <path
              key={`${i}-${j}`}
              d={scalePathX(d, group.scaleX)}
              transform={t(g.x)}
              {...(g.glyph.fill ? { fill: 'currentColor', stroke: 'none' } : { fill: 'none', stroke: 'currentColor' })}
            />
          )),
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
      <g color="#000" stroke="#000" filter={`url(#${id}-emboss)`}>
        {children}
      </g>
    </g>
  );
}

/** Markierung des aktiven (blau) oder fehlerhaften (rot) Eingabebereichs. */
function FieldMark({ ext, error }: { ext: Box; error: boolean }) {
  const pad = 6 * Math.max((ext.y1 - ext.y0) / PLATE.CHAR_H, 0.7);
  const w = Math.max(ext.x1 - ext.x0 + 2 * pad, 30);
  const cx = (ext.x0 + ext.x1) / 2;
  return (
    <rect
      className="lp__mark"
      x={cx - w / 2}
      y={ext.y0 - pad}
      width={w}
      height={ext.y1 - ext.y0 + 2 * pad}
      rx={5}
      fill={error ? 'rgb(196 50 43 / 0.1)' : 'rgb(42 85 255 / 0.09)'}
      stroke={error ? 'rgb(196 50 43 / 0.55)' : 'rgb(42 85 255 / 0.4)'}
      strokeWidth={1.6}
    />
  );
}

/** Schreibmarke im Eingabemodus: hinter dem letzten Zeichen, bei Platzhaltern davor. */
function Caret({ ext, ghost }: { ext: Box; ghost: boolean }) {
  const x = ghost ? ext.x0 - 2 : ext.x1 + 2.6;
  return <rect className="lp__caret" x={x - 1.6} y={ext.y0 - 3} width={3.2} height={ext.y1 - ext.y0 + 6} rx={1.6} fill="#2a55ff" />;
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
 * Realistisches deutsches Kennzeichen als SVG – einzeilig 520 × 110 mm oder zweizeilig (Motorrad, Leichtkraftrad, Traktor): reflektierende Aluminiumfläche mit feiner Körnung,
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
  format = 'eu',
}: Props) {
  const G = plateGeometry(format, cityCode, letters, numbers, showEuroBand);
  const { W, H } = G;
  const { RADIUS } = PLATE;
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
  const B = G.band;

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
            <stop offset="0" stopColor="#eceef1" />
            <stop offset="1" stopColor="#cfd3da" />
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
          <rect x="14" y={H - 1} width={Math.max(W - 28, 10)} height="4" rx="2" fill="#000" opacity={tone === 'dark' ? 0.45 : 0.18} filter={`url(#${id}-soft)`} />

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

          {B ? (
            <g data-plate-part="band" className="lp__part lp__band">
              <path
                d={`M${B.x + bandR} ${B.y}H${B.x + B.w}V${B.y + B.h}${format === 'eu' ? `H${B.x + bandR}A${bandR} ${bandR} 0 0 1 ${B.x} ${B.y + B.h - bandR}` : `H${B.x}`}V${B.y + bandR}A${bandR} ${bandR} 0 0 1 ${B.x + bandR} ${B.y}Z`}
                fill={`url(#${id}-blue)`}
              />
              <path d={`M${B.x + B.w - 0.4} ${B.y}V${B.y + B.h}`} stroke="#000" strokeOpacity="0.25" strokeWidth="0.8" />
              {Array.from({ length: 12 }, (_, i) => {
                const ang = (i / 12) * Math.PI * 2 - Math.PI / 2;
                return <polygon key={i} points={star(B.starCx + Math.cos(ang) * B.starR, B.starCy + Math.sin(ang) * B.starR, B.starSize)} fill="#ffd200" />;
              })}
              <g color="#ffffff" strokeWidth={PLATE.STROKE} strokeLinejoin="miter" strokeMiterlimit={1.5}>
                {GLYPHS.D.d.map((d, k) => (
                  <path
                    key={k}
                    d={d}
                    transform={`translate(${B.dX.toFixed(2)} ${B.dY.toFixed(2)}) scale(${B.dScale.toFixed(4)})`}
                    {...(GLYPHS.D.fill ? { fill: 'currentColor', stroke: 'none' } : { fill: 'none', stroke: 'currentColor' })}
                  />
                ))}
              </g>
            </g>
          ) : null}

          {showSealPlaceholder ? (
            <g data-plate-part="seal" className="lp__part" aria-hidden="true">
              {G.seals.map(({ cx, cy, r }) => (
                <g key={`${cx}-${cy}`}>
                  <circle cx={cx} cy={cy} r={r} fill={`url(#${id}-seal)`} />
                  <circle cx={cx} cy={cy} r={r} fill="none" stroke="#000" strokeOpacity="0.12" strokeWidth="0.5" />
                  <path d={`M${cx - r * 0.69} ${cy - r * 0.72}A${r} ${r} 0 0 1 ${cx + r * 0.69} ${cy - r * 0.72}`} fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="0.5" />
                </g>
              ))}
            </g>
          ) : null}

          <g fill="none" strokeWidth={PLATE.STROKE} strokeLinejoin="miter" strokeMiterlimit={1.5} strokeLinecap="butt">
            {(
              [
                ['district', 'cityCode'],
                ['letters', 'letters'],
                ['digits', 'numbers'],
              ] as const
            ).map(([part, group]) => {
              const g = G.groups[group];
              const isGhost = !!ghost?.[group];
              const hasWild = g.glyphs.some((x) => x.char === '?');
              return (
                <g key={part}>
                  <Embossed id={id} part={part}>
                    {isGhost ? null : <Glyphs group={g} only={(c) => c !== '?'} />}
                  </Embossed>
                  {isGhost || hasWild ? (
                    <g color="#c3c9d4" className="lp__ghost">
                      <Glyphs group={g} only={isGhost ? undefined : (c) => c === '?'} />
                    </g>
                  ) : null}
                </g>
              );
            })}
          </g>
          {(['cityCode', 'letters', 'numbers'] as const).map((g) => {
            const ext = G.extents[g];
            return ext && (invalid === g || invalid === 'all' || caret === g) ? (
              <FieldMark key={g} ext={ext} error={invalid === g || invalid === 'all'} />
            ) : null;
          })}
          {caret && G.extents[caret] ? <Caret ext={G.extents[caret]!} ghost={!!ghost?.[caret]} /> : null}

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
