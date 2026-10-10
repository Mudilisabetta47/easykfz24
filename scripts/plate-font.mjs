// Übernimmt die Zeichen einer Kennzeichenschrift (z. B. FE-Schrift) als Vektorpfade in src/lib/plate-font.generated.ts.
// Die Schriftdatei selbst wird nie ausgeliefert; im Browser landen nur die Umrisse der Zeichen, ohne Schriftnamen.
//
//   npm run plate-font                      Zeichen aus assets-src/fonts/fe-schrift.* übernehmen
//   npm run plate-font -- <datei>           … aus einer bestimmten Datei (ttf/otf/woff/woff2)
//   npm run plate-font -- --encrypt         Schrift verschlüsselt als assets-src/fonts/fe-schrift.enc ablegen
//                                           (Schlüssel PLATE_FONT_KEY wird bei Bedarf in .env.local erzeugt)
//
// Im Repository liegt nur die verschlüsselte Datei. dev/build/test entschlüsseln sie im Speicher, wenn PLATE_FONT_KEY
// gesetzt ist (Umgebung oder .env.local) – ohne Schlüssel greift die eingebaute Nachzeichnung.
// Die Schrift wird so skaliert, dass die Zeichen 75 mm hoch sind (wie auf dem Schild).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'src/lib/plate-font.generated.ts');
const CHARS = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789?'];
const CAP_MM = 75;

const ENC = join(root, 'assets-src/fonts/fe-schrift.enc');
const MAGIC = Buffer.from('EKF1');
const candidates = [
  process.argv.slice(2).find((a) => !a.startsWith('--')),
  'assets-src/fonts/fe-schrift.woff2',
  'assets-src/fonts/fe-schrift.ttf',
  'assets-src/fonts/fe-schrift.otf',
].filter(Boolean);
const ENSURE = process.argv.includes('--ensure');
const plainFile = candidates.map((p) => (p.startsWith('/') ? p : join(root, p))).find((p) => existsSync(p));

if (process.argv.includes('--encrypt')) {
  if (!plainFile) {
    console.error('Keine Schriftdatei zum Verschlüsseln gefunden (assets-src/fonts/fe-schrift.ttf|otf|woff2).');
    process.exit(1);
  }
  let key = readKey();
  if (!key) {
    key = randomBytes(32);
    appendFileSync(join(root, '.env.local'), `\n# Schlüssel für assets-src/fonts/fe-schrift.enc (auch auf dem Server setzen)\nPLATE_FONT_KEY=${key.toString('base64')}\n`);
    console.log('→ Neuer Schlüssel PLATE_FONT_KEY in .env.local angelegt');
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(readFileSync(plainFile)), cipher.final()]);
  writeFileSync(ENC, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), Buffer.from(plainFile.split('.').pop().padEnd(5)), data]));
  console.log(`→ ${basename(plainFile)} verschlüsselt nach assets-src/fonts/fe-schrift.enc`);
  process.exit(0);
}

const key = readKey();
let file = plainFile ?? (existsSync(ENC) && key ? ENC : null);
if (!file && existsSync(ENC) && !key) console.warn('Hinweis: fe-schrift.enc vorhanden, aber PLATE_FONT_KEY fehlt – eingebaute Zeichen werden verwendet.');

let buf = file ? readFileSync(file) : null;
let format = file?.split('.').pop();
if (file === ENC) {
  try {
    if (!buf.subarray(0, 4).equals(MAGIC)) throw new Error('unbekanntes Format');
    const decipher = createDecipheriv('aes-256-gcm', key, buf.subarray(4, 16));
    decipher.setAuthTag(buf.subarray(16, 32));
    format = buf.subarray(32, 37).toString().trim();
    buf = Buffer.concat([decipher.update(buf.subarray(37)), decipher.final()]);
  } catch {
    console.warn('Hinweis: fe-schrift.enc ließ sich mit PLATE_FONT_KEY nicht entschlüsseln – eingebaute Zeichen werden verwendet.');
    file = null;
  }
}

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

if (format === 'woff2') {
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
// Bewusst ohne Schriftnamen und Metadaten: im Browser stehen nur die Umrisse der benötigten Zeichen.
writeFileSync(OUT, header(basename(file)) + `export const PLATE_FONT: PlateFont | null = ${JSON.stringify({ glyphs })};\n`);
console.log(
  `→ ${Object.keys(glyphs).length} Zeichen aus „${name}“ übernommen` +
    (composed.length ? `, zusammengesetzt: ${composed.join(' ')}` : '') +
    (missing.length ? `, fehlend (eingebaute Zeichen): ${missing.join(' ')}` : ''),
);

/** PLATE_FONT_KEY aus der Umgebung oder aus .env.local (Base64, 32 Byte). */
function readKey() {
  let v = process.env.PLATE_FONT_KEY;
  const envFile = join(root, '.env.local');
  if (!v && existsSync(envFile)) v = /^PLATE_FONT_KEY=(.+)$/m.exec(readFileSync(envFile, 'utf8'))?.[1]?.trim();
  if (!v) return null;
  const k = Buffer.from(v, 'base64');
  if (k.length !== 32) throw new Error('PLATE_FONT_KEY muss 32 Byte (Base64) lang sein');
  return k;
}

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
  /** Gefüllte Umrisse in mm: Zeichen von y = 0 bis 75, x ab der linken Tintenkante; w = Tintenbreite */
  glyphs: Record<string, { w: number; d: string }>;
}

`;
}
