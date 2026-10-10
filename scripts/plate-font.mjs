// Übernimmt die Zeichen einer Kennzeichenschrift (z. B. FE-Schrift) als Vektorpfade in src/lib/plate-font.generated.ts.
// Aufruf: npm run plate-font -- <pfad/zur/schrift.(woff2|woff|ttf|otf)>
// Ohne Pfad wird public/fonts/fe-schrift.woff2 bzw. assets-src/fonts/fe-schrift.* gesucht.
// Die Schrift wird so skaliert, dass Großbuchstaben 75 mm hoch sind (wie auf dem Schild).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/lib/plate-font.generated.ts');
const CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789?'];
const CAP_MM = 75;

const candidates = [
  process.argv.slice(2).find((a) => !a.startsWith('--')),
  'public/fonts/fe-schrift.woff2',
  'assets-src/fonts/fe-schrift.woff2',
  'assets-src/fonts/fe-schrift.ttf',
  'assets-src/fonts/fe-schrift.otf',
].filter(Boolean);
const ENSURE = process.argv.includes('--ensure');
const file = candidates.map((p) => (p.startsWith('/') ? p : join(root, p))).find((p) => existsSync(p));

if (process.argv.includes('--ensure')) {
  // Vor dev/build/test: generieren, wenn eine Schrift vorliegt; sonst mindestens die leere Vorlage anlegen.
  if (!file && existsSync(OUT)) process.exit(0);
}
if (process.argv.includes('--reset') || !file) {
  if (!file && !ENSURE && !process.argv.includes('--reset')) console.error(`Keine Schriftdatei gefunden (gesucht: ${candidates.join(', ')}).`);
  writeFileSync(OUT, header('keine – es werden die eingebauten Strichzeichen verwendet') + 'export const PLATE_FONT: PlateFont | null = null;\n');
  console.log(`→ ${OUT} zurückgesetzt`);
  process.exit(file || ENSURE || process.argv.includes('--reset') ? 0 : 1);
}

let buf = readFileSync(file);
if (file.endsWith('.woff2')) {
  const { decompress } = await import('wawoff2');
  buf = Buffer.from(await decompress(buf));
}
const font = opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

// Zeichenhöhe: Die Kennzeichenschrift reicht teils unter die Grundlinie – maßgeblich ist die volle Höhe des „H“.
const hBox = font.charToGlyph('H').getBoundingBox();
const top = hBox.y2;
const scale = CAP_MM / (hBox.y2 - hBox.y1);

/** Umriss in Schild-Millimeter: y nach unten, Zeichen von 0 bis 75, x ab der linken Tintenkante. */
function outline(glyph, { sy = 1, dy = 0 } = {}) {
  const bb = glyph.getBoundingBox();
  const X = (x) => r((x - bb.x1) * scale);
  const Y = (y) => r(dy + (top - y) * scale * sy);
  const d = glyph.path.commands
    .map((c) => {
      switch (c.type) {
        case 'M':
        case 'L':
          return `${c.type}${X(c.x)} ${Y(c.y)}`;
        case 'Q':
          return `Q${X(c.x1)} ${Y(c.y1)} ${X(c.x)} ${Y(c.y)}`;
        case 'C':
          return `C${X(c.x1)} ${Y(c.y1)} ${X(c.x2)} ${Y(c.y2)} ${X(c.x)} ${Y(c.y)}`;
        default:
          return 'Z';
      }
    })
    .join('');
  return { w: r((bb.x2 - bb.x1) * scale), d };
}

const glyphs = {};
const missing = [];
for (const c of CHARS) {
  const g = font.charToGlyph(c);
  if (g && g.index !== 0 && g.path?.commands?.length) glyphs[c] = outline(g);
  else missing.push(c);
}

// Umlaute fehlen in vielen Kennzeichenschriften: Grundbuchstabe niedriger, darüber zwei Punkte (wie auf dem Schild).
const UMLAUT = { Ä: 'A', Ö: 'O', Ü: 'U' };
const composed = [];
for (const [u, base] of Object.entries(UMLAUT)) {
  if (glyphs[u] || !glyphs[base]) continue;
  const sy = 0.8;
  const body = outline(font.charToGlyph(base), { sy, dy: CAP_MM * (1 - sy) });
  const w = body.w;
  const dot = (cx) => roundedSquare(cx - 5, 0, 10, 10, 2.2);
  glyphs[u] = { w, d: body.d + dot(w * 0.3) + dot(w * 0.7) };
  composed.push(u);
  missing.splice(missing.indexOf(u), 1);
}

const name = font.names?.fullName?.en ?? basename(file);
writeFileSync(
  OUT,
  header(`${name} (${basename(file)})`) +
    `export const PLATE_FONT: PlateFont | null = ${JSON.stringify({ name, glyphs }, null, 2)};\n`,
);
console.log(
  `→ ${Object.keys(glyphs).length} Zeichen aus „${name}“ übernommen` +
    (composed.length ? `, zusammengesetzt: ${composed.join(' ')}` : '') +
    (missing.length ? `, fehlend (eingebaute Zeichen): ${missing.join(' ')}` : ''),
);

function r(n) {
  return Math.round(n * 100) / 100;
}
function roundedSquare(x, y, w, h, k) {
  return `M${r(x + k)} ${r(y)}H${r(x + w - k)}Q${r(x + w)} ${r(y)} ${r(x + w)} ${r(y + k)}V${r(y + h - k)}Q${r(x + w)} ${r(y + h)} ${r(x + w - k)} ${r(y + h)}H${r(x + k)}Q${r(x)} ${r(y + h)} ${r(x)} ${r(y + h - k)}V${r(y + k)}Q${r(x)} ${r(y)} ${r(x + k)} ${r(y)}Z`;
}
function header(source) {
  return `// Automatisch erzeugt von scripts/plate-font.mjs – nicht von Hand bearbeiten.
// Quelle: ${source}

export interface PlateFont {
  name: string;
  /** Gefüllte Umrisse in mm: Zeichen von y = 0 bis 75, x ab der linken Tintenkante; w = Tintenbreite */
  glyphs: Record<string, { w: number; d: string }>;
}

`;
}
