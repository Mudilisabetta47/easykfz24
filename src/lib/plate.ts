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

// ---------------------------------------------------------------------------------------------------------------
// Schildformen je Fahrzeugkategorie

/**
 * eu: einzeilig 520 × 110 (Pkw, Lkw, E/H), motorrad: zweizeilig 220 × 200, leichtkraftrad: zweizeilig 255 × 130,
 * traktor: zweizeilig 340 × 200 (land- und forstwirtschaftliche Zugmaschinen).
 */
export type PlateFormat = 'eu' | 'motorrad' | 'leichtkraftrad' | 'traktor';

interface TwoLineSpec {
  W: number;
  H: number;
  /** Zeichenhöhe relativ zu 75 mm */
  s: number;
  /** Breite des Eurofelds */
  bandW: number;
  /** Plaketten rechts neben dem Ortskennzeichen (gestapelt) oder als eigene Reihe zwischen den Zeilen */
  seals: 'right' | 'middle';
  /** Abstand zwischen den Zeilen (bzw. um die Plakettenreihe) */
  lineGap: number;
}

const TWO_LINE: Record<Exclude<PlateFormat, 'eu'>, TwoLineSpec> = {
  motorrad: { W: 220, H: 200, s: 0.74, bandW: 30, seals: 'middle', lineGap: 6 },
  leichtkraftrad: { W: 255, H: 130, s: 0.62, bandW: 30, seals: 'right', lineGap: 9 },
  traktor: { W: 340, H: 200, s: 0.9, bandW: 40, seals: 'right', lineGap: 16 },
};

export const PLATE_FORMAT_SIZE: Record<PlateFormat, { W: number; H: number }> = {
  eu: { W: PLATE.W, H: PLATE.H },
  motorrad: { W: TWO_LINE.motorrad.W, H: TWO_LINE.motorrad.H },
  leichtkraftrad: { W: TWO_LINE.leichtkraftrad.W, H: TWO_LINE.leichtkraftrad.H },
  traktor: { W: TWO_LINE.traktor.W, H: TWO_LINE.traktor.H },
};

/** Schildform zur Fahrzeugart aus dem Auftrag (pkw, motorrad, leichtkraftrad, traktor …). */
export function plateFormatFor(vehicleType: string): PlateFormat {
  return vehicleType === 'motorrad' || vehicleType === 'leichtkraftrad' || vehicleType === 'traktor' ? vehicleType : 'eu';
}

export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface PlacedGroup {
  glyphs: PlacedGlyph[];
  /** Oberkante der Zeichen */
  y: number;
  /** Zeichenhöhe relativ zu 75 mm */
  s: number;
  /** Stauchung in x (Engschrift) */
  scaleX: number;
}

export interface PlateGeometry {
  format: PlateFormat;
  W: number;
  H: number;
  band: { x: number; y: number; w: number; h: number; starCx: number; starCy: number; starR: number; starSize: number; dX: number; dY: number; dScale: number } | null;
  seals: { cx: number; cy: number; r: number }[];
  groups: Record<PlateGroup, PlacedGroup>;
  /** Tintenausdehnung je Gruppe (null bei leerer Gruppe) */
  extents: Record<PlateGroup, Box | null>;
  /** Tippbereiche je Gruppe für die Eingabe – zusammen decken sie das Schild ab */
  zones: Record<PlateGroup, Box>;
}

type RowItem = { chars: string } | { gap: number };

/** Ordnet eine Zeile aus Zeichengruppen und Lücken zentriert zwischen start und end an. */
function layoutRow(items: RowItem[], start: number, end: number, s: number) {
  const width = (str: string) =>
    [...str].reduce((sum, c, i, all) => sum + GLYPHS[c].w + (i > 0 ? charGap(GLYPHS[all[i - 1]], GLYPHS[c]) : 0), 0);
  const total = items.reduce((t, it) => t + ('chars' in it ? width(it.chars) : it.gap), 0) * s;
  const avail = end - start;
  const scaleX = total > avail ? avail / total : 1;
  let x = start + (avail - total * scaleX) / 2;
  const out: (PlacedGlyph[] | { x0: number; x1: number })[] = [];
  for (const it of items) {
    if ('chars' in it) {
      const arr: PlacedGlyph[] = [];
      [...it.chars].forEach((c, i, all) => {
        if (i > 0) x += charGap(GLYPHS[all[i - 1]], GLYPHS[c]) * s * scaleX;
        arr.push({ char: c, x, glyph: GLYPHS[c] });
        x += GLYPHS[c].w * s * scaleX;
      });
      out.push(arr);
    } else {
      out.push({ x0: x, x1: x + it.gap * s * scaleX });
      x += it.gap * s * scaleX;
    }
  }
  return { out, scaleX };
}

function extentOf(g: PlacedGroup): Box | null {
  if (!g.glyphs.length) return null;
  const last = g.glyphs[g.glyphs.length - 1];
  return { x0: g.glyphs[0].x, x1: last.x + last.glyph.w * g.s * g.scaleX, y0: g.y, y1: g.y + PLATE.CHAR_H * g.s };
}

function bandFor(x: number, y: number, w: number, h: number): NonNullable<PlateGeometry['band']> {
  const k = w / PLATE.BAND_W;
  const dScale = 0.3 * k;
  const starCx = x + w / 2;
  return {
    x,
    y,
    w,
    h,
    starCx,
    starCy: y + Math.min(h * 0.36, 27 * k),
    starR: 12.4 * k,
    starSize: 2.75 * k,
    dScale,
    dX: starCx - (GLYPHS.D.w * dScale) / 2,
    dY: y + h - PLATE.CHAR_H * dScale - Math.min(h * 0.1, 10 * k),
  };
}

/** Vollständige Geometrie eines Schilds in mm – Grundlage für Darstellung und Eingabe. */
export function plateGeometry(format: PlateFormat, cityCode: string, letters: string, numbers: string, euroBand = true): PlateGeometry {
  const parts = normalizePlateParts(cityCode, letters, numbers);
  const inner = PLATE.BORDER_INSET + PLATE.BORDER_W;

  if (format === 'eu') {
    const L = layoutPlate(cityCode, letters, numbers, euroBand);
    const group = (glyphs: PlacedGlyph[]): PlacedGroup => ({ glyphs, y: PLATE.CHAR_TOP, s: 1, scaleX: L.scaleX });
    const groups = { cityCode: group(L.district), letters: group(L.letters), numbers: group(L.digits) };
    const extents = { cityCode: extentOf(groups.cityCode), letters: extentOf(groups.letters), numbers: extentOf(groups.numbers) };
    const sealCx = L.sealX + L.sealW / 2;
    const start = euroBand ? PLATE.BAND_X + PLATE.BAND_W : 0;
    const c = extents.cityCode;
    const l = extents.letters;
    const n = extents.numbers;
    const cut1 = c && l ? (c.x1 + l.x0) / 2 : sealCx;
    const cut2 = l && n ? (l.x1 + n.x0) / 2 : (cut1 + PLATE.W) / 2;
    return {
      format,
      W: PLATE.W,
      H: PLATE.H,
      band: euroBand ? bandFor(PLATE.BAND_X, PLATE.BAND_X, PLATE.BAND_W, PLATE.H - PLATE.BAND_X * 2) : null,
      seals: [37, 73].map((cy) => ({ cx: sealCx, cy, r: 14.5 })),
      groups,
      extents,
      zones: {
        cityCode: { x0: start, x1: cut1, y0: 0, y1: PLATE.H },
        letters: { x0: cut1, x1: cut2, y0: 0, y1: PLATE.H },
        numbers: { x0: cut2, x1: PLATE.W, y0: 0, y1: PLATE.H },
      },
    };
  }

  const spec = TWO_LINE[format];
  const { W, H, s } = spec;
  const ch = PLATE.CHAR_H * s;
  const r = 14.5 * Math.max(s, 0.7);
  const middle = spec.seals === 'middle';
  const blockH = 2 * ch + (middle ? 2 * spec.lineGap + 2 * r : spec.lineGap);
  const y1 = (H - blockH) / 2;
  const y2 = y1 + blockH - ch;
  const mid1 = y1 + ch + (middle ? spec.lineGap + r : spec.lineGap / 2);
  const bandX = PLATE.BAND_X;
  const bandBottom = middle ? y1 + ch + spec.lineGap / 2 : mid1;
  const band = euroBand ? bandFor(bandX, bandX, spec.bandW, bandBottom - bandX) : null;
  const margin = 11 * Math.max(s, 0.7);
  const line1Start = (band ? band.x + band.w : inner) + margin;
  const lineEnd = W - inner - margin;

  // Zeile 1: Ortskennzeichen (+ Plaketten rechts daneben)
  const sealGap = (2 * r + 10) / s;
  const row1 = layoutRow(middle ? [{ chars: parts.cityCode }] : [{ chars: parts.cityCode }, { gap: sealGap }], line1Start, lineEnd, s);
  const district = row1.out[0] as PlacedGlyph[];
  // Zeile 2: Erkennungsbuchstaben und -zahl über die ganze Breite
  const row2 = layoutRow(
    [{ chars: parts.letters }, { gap: parts.numbers ? PLATE.GROUP_GAP : 0 }, { chars: parts.numbers }],
    inner + margin,
    lineEnd,
    s,
  );

  let seals: PlateGeometry['seals'];
  if (middle) {
    const cx = W / 2;
    seals = [{ cx: cx - r - 3, cy: mid1, r }, { cx: cx + r + 3, cy: mid1, r }];
  } else {
    const gapBox = row1.out[1] as { x0: number; x1: number };
    const cx = (gapBox.x0 + gapBox.x1) / 2 + 2;
    const cy = y1 + ch / 2;
    seals = [{ cx, cy: cy - r - 1.5, r }, { cx, cy: cy + r + 1.5, r }];
  }

  const groups: Record<PlateGroup, PlacedGroup> = {
    cityCode: { glyphs: district, y: y1, s, scaleX: row1.scaleX },
    letters: { glyphs: row2.out[0] as PlacedGlyph[], y: y2, s, scaleX: row2.scaleX },
    numbers: { glyphs: row2.out[2] as PlacedGlyph[], y: y2, s, scaleX: row2.scaleX },
  };
  const extents = { cityCode: extentOf(groups.cityCode), letters: extentOf(groups.letters), numbers: extentOf(groups.numbers) };
  const split = y2 - (middle ? r : spec.lineGap / 2);
  const l = extents.letters;
  const n = extents.numbers;
  const cut = l && n ? (l.x1 + n.x0) / 2 : W / 2;
  return {
    format,
    W,
    H,
    band,
    seals,
    groups,
    extents,
    zones: {
      cityCode: { x0: band ? band.x + band.w : 0, x1: W, y0: 0, y1: split },
      letters: { x0: 0, x1: cut, y0: split, y1: H },
      numbers: { x0: cut, x1: W, y0: split, y1: H },
    },
  };
}
