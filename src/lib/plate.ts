// Deutsches Kennzeichen als Vektorgrafik: Maße in Millimetern (Schild 520 × 110 mm),
// Zeichen nach dem Raster der FE-Mittelschrift (Höhe 75 mm, Buchstaben 47,5 mm, Ziffern 44,5 mm breit),
// eigene Nachzeichnung als Mittellinien-Pfade mit 10 mm Strichstärke.

/** Rand um das Schild in der SVG-Ansicht (Schatten, Kantenlicht), in mm */
export const PLATE_VIEW = { PAD_X: 6, PAD_Y: 4, PAD_B: 12 } as const;

export const PLATE = {
  W: 520,
  H: 110,
  RADIUS: 5.5,
  BORDER_INSET: 1.25,
  BORDER_W: 1.9,
  BAND_X: 3.2,
  BAND_W: 41,
  CHAR_H: 75,
  CHAR_TOP: 17.5,
  STROKE: 11.6,
  LETTER_W: 47.5,
  DIGIT_W: 44.5,
  /** Abstand zwischen Zeichen einer Gruppe */
  GAP: 5.5,
  /** Freiraum für die Plaketten zwischen Unterscheidungszeichen und Erkennungsbuchstaben */
  SEAL_W: 50,
  /** Abstand zwischen Buchstaben und Ziffern */
  GROUP_GAP: 23,
  /** Rand rechts und neben dem Eurofeld */
  MARGIN: 10,
} as const;

import { PLATE_FONT } from './plate-font.generated.ts';

export interface Glyph {
  w: number;
  /** true: gefüllte Umrisse aus der Kennzeichenschrift; sonst Mittellinien mit Strichstärke STROKE */
  fill?: boolean;
  /** Mittellinien-Pfade, Koordinaten 0..w × 0..75 inkl. halber Strichstärke */
  d: string[];
}

const LW = PLATE.LETTER_W;
const DW = PLATE.DIGIT_W;

function a(t: number): string[] {
  const cb = t + (70 - t) * 0.66;
  const xl = 5 + 14 * ((70 - cb) / (70 - t));
  const xr = 42.5 - 14 * ((70 - cb) / (70 - t));
  return [`M5 70L19 ${t}H28.5L42.5 70`, `M${xl.toFixed(2)} ${cb.toFixed(2)}H${xr.toFixed(2)}`];
}
function o(t: number): string[] {
  return [`M18 ${t}H29.5A13 13 0 0 1 42.5 ${t + 13}V57A13 13 0 0 1 29.5 70H18A13 13 0 0 1 5 57V${t + 13}A13 13 0 0 1 18 ${t}Z`];
}
function u(t: number): string[] {
  return [`M5 ${t}V57A13 13 0 0 0 18 70H29.5A13 13 0 0 0 42.5 57V${t}`];
}
const DOTS = ['M14 2V10', 'M33.5 2V10'];

const P_BOWL = 'M5 70V5H28.5A14 14 0 0 1 42.5 19V25A14 14 0 0 1 28.5 39H5';
const C_ARC = 'A13 13 0 0 0 29.5 5H18A13 13 0 0 0 5 18V57A13 13 0 0 0 18 70H29.5A13 13 0 0 0 42.5 57';
const LOWER_BOWL = (top: number) =>
  `M17.5 ${top}H27A12.5 12.5 0 0 1 39.5 ${top + 12.5}V57.5A12.5 12.5 0 0 1 27 70H17.5A12.5 12.5 0 0 1 5 57.5V${top + 12.5}A12.5 12.5 0 0 1 17.5 ${top}Z`;

/** Eingebaute Nachzeichnung (Mittellinien) – Rückfall, wenn keine Schriftdatei vorliegt. */
export const STROKE_GLYPHS: Record<string, Glyph> = {
  A: { w: LW, d: a(5) },
  B: {
    w: LW,
    d: ['M5 70V5H28A9.5 9.5 0 0 1 37.5 14.5V26A9.5 9.5 0 0 1 28 35.5H5', 'M28 35.5H29.5A13 13 0 0 1 42.5 48.5V57A13 13 0 0 1 29.5 70H5'],
  },
  C: { w: LW, d: [`M42.5 19V18${C_ARC}V56`] },
  D: { w: LW, d: ['M5 5H26A16.5 16.5 0 0 1 42.5 21.5V53.5A16.5 16.5 0 0 1 26 70H5Z'] },
  E: { w: LW, d: ['M42.5 5H5V70H42.5', 'M5 37.5H38'] },
  F: { w: LW, d: ['M42.5 5H5V70', 'M5 38.5H38'] },
  G: { w: LW, d: [`M42.5 19V18${C_ARC}V40H25`] },
  H: { w: LW, d: ['M5 5V70', 'M42.5 5V70', 'M5 37.5H42.5'] },
  // Das I ist in der FE-Schrift schmal (nur ein Strich).
  I: { w: 11.6, d: ['M5.8 5V70'] },
  J: { w: LW, d: ['M37.5 5V57A13 13 0 0 1 24.5 70H18A13 13 0 0 1 5 57V51'] },
  K: { w: LW, d: ['M5 5V70', 'M42.5 5L15 41', 'M22.6 31L42.5 70'] },
  L: { w: LW, d: ['M5 5V70H42.5'] },
  M: { w: LW, d: ['M5 70V5L23.75 45L42.5 5V70'] },
  N: { w: LW, d: ['M5 70V5L42.5 70V5'] },
  O: { w: LW, d: o(5) },
  P: { w: LW, d: [P_BOWL] },
  Q: { w: LW, d: [...o(5), 'M29 53L42.5 70'] },
  R: { w: LW, d: [P_BOWL, 'M27 39L42.5 70'] },
  S: {
    w: LW,
    d: ['M42.5 15V14A9 9 0 0 0 33.5 5H14A9 9 0 0 0 5 14V26.5A9.5 9.5 0 0 0 14.5 36H33A9.5 9.5 0 0 1 42.5 45.5V61A9 9 0 0 1 33.5 70H14A9 9 0 0 1 5 61V60'],
  },
  T: { w: LW, d: ['M5 5H42.5', 'M23.75 5V70'] },
  U: { w: LW, d: u(5) },
  V: { w: LW, d: ['M5 5L20 70H27.5L42.5 5'] },
  W: { w: LW, d: ['M5 5L11.5 70L23.75 26L36 70L42.5 5'] },
  X: { w: LW, d: ['M5 5L42.5 70', 'M42.5 5L5 70'] },
  Y: { w: LW, d: ['M5 5L23.75 38L42.5 5', 'M23.75 38V70'] },
  Z: { w: LW, d: ['M5 5H42.5L5 70H42.5'] },
  Ä: { w: LW, d: [...a(19), ...DOTS] },
  Ö: { w: LW, d: [...o(19), ...DOTS] },
  Ü: { w: LW, d: [...u(19), ...DOTS] },
  // Platzhalter für „beliebiges Zeichen“ in der Wunschkennzeichen-Suche (kein Zeichen der FE-Schrift)
  '?': { w: LW, d: ['M7 19A14 14 0 0 1 21 5H27.5A14 14 0 0 1 41.5 19V21A13 13 0 0 1 34.5 32.5L23.75 39V51', 'M23.75 60V70'] },
  '0': { w: DW, d: ['M17 5H27.5A12 12 0 0 1 39.5 17V58A12 12 0 0 1 27.5 70H17A12 12 0 0 1 5 58V17A12 12 0 0 1 17 5Z'] },
  // Die 1 der FE-Schrift hat keinen Fuß, nur Fahne und Stamm.
  '1': { w: DW, d: ['M8 22L27.5 5V70'] },
  '2': { w: DW, d: ['M5 18A13 13 0 0 1 18 5H26.5A13 13 0 0 1 39.5 18V22A14 14 0 0 1 35.3 32L5 65.5V70H39.5'] },
  '3': { w: DW, d: ['M5 5H39.5L20 32H26A13.5 13.5 0 0 1 39.5 45.5V56.5A13.5 13.5 0 0 1 26 70H18A13 13 0 0 1 5 57'] },
  '4': { w: DW, d: ['M30 70V5L5 49H39.5'] },
  '5': { w: DW, d: ['M38 5H7.5L6.5 36H26A13.5 13.5 0 0 1 39.5 49.5V56.5A13.5 13.5 0 0 1 26 70H18A13 13 0 0 1 5 57'] },
  '6': { w: DW, d: [LOWER_BOWL(35), 'M33 5L8 41'] },
  '7': { w: DW, d: ['M5 5H39.5L16 70'] },
  '8': {
    w: DW,
    d: ['M17 5H27.5A10.5 10.5 0 0 1 38 15.5V24.5A10.5 10.5 0 0 1 27.5 35H17A10.5 10.5 0 0 1 6.5 24.5V15.5A10.5 10.5 0 0 1 17 5Z', LOWER_BOWL(35)],
  },
  '9': {
    w: DW,
    d: ['M17.5 5H27A12.5 12.5 0 0 1 39.5 17.5V27.5A12.5 12.5 0 0 1 27 40H17.5A12.5 12.5 0 0 1 5 27.5V17.5A12.5 12.5 0 0 1 17.5 5Z', 'M36.5 34L11.5 70'],
  },
};

/** Abstand zwischen den Tintenkanten zweier Zeichen bei gefüllten Schriftzeichen (mm) */
const FONT_GAP = 6;

/**
 * Zeichen fürs Schild: aus der Kennzeichenschrift (scripts/plate-font.mjs → plate-font.generated.ts),
 * fehlende Zeichen aus der eingebauten Nachzeichnung.
 */
export const GLYPHS: Record<string, Glyph> = {
  ...STROKE_GLYPHS,
  ...Object.fromEntries(Object.entries(PLATE_FONT?.glyphs ?? {}).map(([c, g]) => [c, { w: g.w, d: [g.d], fill: true }])),
};
export const PLATE_FONT_NAME = PLATE_FONT?.name ?? null;

/** Abstand zwischen zwei Zeichen: Rechteck-Raster der Nachzeichnung bzw. Tintenabstand der Schrift */
function charGap(a: Glyph, b: Glyph): number {
  if (a.fill && b.fill) return FONT_GAP;
  if (!a.fill && !b.fill) return PLATE.GAP;
  return (PLATE.GAP + FONT_GAP) / 2;
}

/**
 * Staucht einen Glyphen-Pfad waagerecht (Engschrift), ohne die Strichstärke zu verändern –
 * anders als ein scale()-Transform, der senkrechte Striche dünner machen würde.
 * Unterstützt die absoluten Befehle M, L, H, V, A, Q, C und Z.
 */
export function scalePathX(d: string, sx: number): string {
  if (sx === 1) return d;
  const tokens = d.match(/[MLHVAQCZ]|-?\d*\.?\d+/g) ?? [];
  const out: string[] = [];
  const f = (n: number) => String(Math.round(n * 1000) / 1000);
  let i = 0;
  let cmd = '';
  while (i < tokens.length) {
    if (/[MLHVAQCZ]/.test(tokens[i])) {
      cmd = tokens[i++];
      out.push(cmd);
      if (cmd === 'Z') continue;
    }
    const n = () => Number(tokens[i++]);
    switch (cmd) {
      case 'M':
      case 'L':
        out.push(f(n() * sx), f(n()));
        break;
      case 'H':
        out.push(f(n() * sx));
        break;
      case 'V':
        out.push(f(n()));
        break;
      case 'Q':
        out.push(f(n() * sx), f(n()), f(n() * sx), f(n()));
        break;
      case 'C':
        out.push(f(n() * sx), f(n()), f(n() * sx), f(n()), f(n() * sx), f(n()));
        break;
      case 'A': {
        const rx = n() * sx;
        const ry = n();
        const rot = n();
        const large = n();
        const sweep = n();
        out.push(f(rx), f(ry), f(rot), String(large), String(sweep), f(n() * sx), f(n()));
        break;
      }
      default:
        throw new Error(`Pfadbefehl ${cmd} wird nicht unterstützt`);
    }
  }
  return out.join(' ');
}

export interface PlacedGlyph {
  char: string;
  x: number;
  glyph: Glyph;
}

export interface PlateLayout {
  /** < 1, wenn die Kombination zu lang ist (wie Engschrift: Zeichen werden schmaler). */
  scaleX: number;
  district: PlacedGlyph[];
  letters: PlacedGlyph[];
  digits: PlacedGlyph[];
  /** Linke Kante des Plakettenbereichs */
  sealX: number;
  sealW: number;
  textStart: number;
  textEnd: number;
}

export function normalizePlateParts(cityCode: string, letters: string, numbers: string) {
  const clean = (s: string, re: RegExp) => [...s.toUpperCase()].filter((c) => re.test(c) && GLYPHS[c]).join('');
  return {
    cityCode: clean(cityCode, /[A-ZÄÖÜ]/).slice(0, 3),
    letters: clean(letters, /[A-Z?]/).slice(0, 2),
    numbers: clean(numbers, /[0-9EH?]/).slice(0, 5),
  };
}

/** Ordnet die Zeichengruppen zentriert im Schriftfeld an. */
export function layoutPlate(cityCode: string, letters: string, numbers: string, euroBand = true): PlateLayout {
  const parts = normalizePlateParts(cityCode, letters, numbers);
  const textStart = (euroBand ? PLATE.BAND_X + PLATE.BAND_W : PLATE.BORDER_INSET + PLATE.BORDER_W) + PLATE.MARGIN;
  const textEnd = PLATE.W - PLATE.BORDER_INSET - PLATE.BORDER_W - PLATE.MARGIN;
  const avail = textEnd - textStart;

  const width = (s: string) =>
    [...s].reduce((sum, c, i) => sum + GLYPHS[c].w + (i > 0 ? charGap(GLYPHS[s[i - 1]], GLYPHS[c]) : 0), 0);
  // Saisons-/E-/H-Zusatz steht mit kleinem Abstand hinter den Ziffern – gleiche Mechanik wie GAP.
  const total =
    width(parts.cityCode) + PLATE.SEAL_W + width(parts.letters) + (parts.numbers ? PLATE.GROUP_GAP + width(parts.numbers) : 0);
  const scaleX = total > avail ? avail / total : 1;
  let x = textStart + (avail - total * scaleX) / 2;

  const place = (s: string): PlacedGlyph[] =>
    [...s].map((char, i, all) => {
      if (i > 0) x += charGap(GLYPHS[all[i - 1]], GLYPHS[char]) * scaleX;
      const placed = { char, x, glyph: GLYPHS[char] };
      x += GLYPHS[char].w * scaleX;
      return placed;
    });

  const district = place(parts.cityCode);
  const sealX = x;
  x += PLATE.SEAL_W * scaleX;
  const lettersPlaced = place(parts.letters);
  if (parts.numbers) x += PLATE.GROUP_GAP * scaleX;
  const digits = place(parts.numbers);
  return { scaleX, district, letters: lettersPlaced, digits, sealX, sealW: PLATE.SEAL_W * scaleX, textStart, textEnd };
}

/** "HB-EZ 24" → Bestandteile; null, wenn das Format nicht passt. */
export function splitPlate(plate: string): { cityCode: string; letters: string; numbers: string } | null {
  const m = /^([A-ZÄÖÜ]{1,3})-([A-Z]{1,2}) (\d{1,4}[EH]?)$/.exec(plate.trim());
  return m ? { cityCode: m[1], letters: m[2], numbers: m[3] } : null;
}

export type PlateGroup = 'cityCode' | 'letters' | 'numbers';

/** Horizontale Ausdehnung einer Zeichengruppe (mm, Schild-Koordinaten); null bei leerer Gruppe. */
export function groupExtent(layout: PlateLayout, group: PlateGroup): { x0: number; x1: number } | null {
  const list = group === 'cityCode' ? layout.district : group === 'letters' ? layout.letters : layout.digits;
  if (!list.length) return null;
  const last = list[list.length - 1];
  return { x0: list[0].x, x1: last.x + last.glyph.w * layout.scaleX };
}
