// Wunschkennzeichen: Eingabe prüfen, Platzhalter „?“ auflösen, Vorschläge erzeugen.
// Ob ein Kennzeichen tatsächlich frei ist, weiß nur die zuständige Zulassungsbehörde – siehe server/plate-availability.ts.

import { DISTRICTS } from './districts.ts';

export interface WishInput {
  cityCode: string;
  letters: string;
  numbers: string;
}

export type WishCheck =
  | { ok: true; pattern: WishInput; districtName: string; openSlots: number }
  | { ok: false; field: 'cityCode' | 'letters' | 'numbers' | 'all'; error: string };

/** Bundesweit nicht zugeteilte Buchstabenkombinationen (Verstoß gegen die guten Sitten). Regional gibt es weitere. */
export const BLOCKED_LETTERS = ['HJ', 'KZ', 'NS', 'SA', 'SS'];

export function lookupDistrict(code: string): string | null {
  return DISTRICTS[code.toUpperCase()] ?? null;
}

/** Vorschläge für die Autovervollständigung des Ortskennzeichens. */
export function searchDistricts(query: string, limit = 8): { code: string; name: string }[] {
  const q = query.trim().toUpperCase();
  if (!q) return [];
  const entries = Object.entries(DISTRICTS);
  const byCode = entries.filter(([c]) => c.startsWith(q));
  const byName = entries.filter(([c, n]) => !c.startsWith(q) && n.toUpperCase().includes(q) && q.length >= 3);
  return [...byCode.sort(([a], [b]) => a.length - b.length || a.localeCompare(b)), ...byName]
    .slice(0, limit)
    .map(([code, name]) => ({ code, name }));
}

/** Zerlegt Freitext wie „ohz ?? ??“, „OHZ-AB 123“ oder „OHZ AB123“. */
export function parseWishText(text: string): WishInput {
  const t = text.toUpperCase().replace(/[^A-ZÄÖÜ0-9?\s-]/g, ' ').trim();
  const m = /^([A-ZÄÖÜ?]{1,3})[\s-]+([A-Z?]{0,2})\s*([0-9?]{0,4})$/.exec(t.replace(/\s+/g, ' '));
  if (m) return { cityCode: m[1], letters: m[2], numbers: m[3] };
  const parts = t.split(/[\s-]+/).filter(Boolean);
  return { cityCode: parts[0] ?? '', letters: parts[1] ?? '', numbers: parts.slice(2).join('') };
}

export function normalizeWish(input: WishInput): WishInput {
  return {
    cityCode: input.cityCode.toUpperCase().replace(/[^A-ZÄÖÜ]/g, '').slice(0, 3),
    letters: input.letters.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 2),
    numbers: input.numbers.toUpperCase().replace(/[^0-9?]/g, '').slice(0, 4),
  };
}

export function checkWish(raw: WishInput): WishCheck {
  const w = normalizeWish(raw);
  if (!w.cityCode) return { ok: false, field: 'cityCode', error: 'Bitte das Ortskennzeichen eingeben, z. B. OHZ' };
  const districtName = lookupDistrict(w.cityCode);
  if (!districtName) return { ok: false, field: 'cityCode', error: `„${w.cityCode}“ ist kein vergebenes Ortskennzeichen` };
  if (!w.letters) return { ok: false, field: 'letters', error: 'Ein oder zwei Buchstaben – oder „??“ für Vorschläge' };
  if (!w.numbers) return { ok: false, field: 'numbers', error: 'Ein bis vier Ziffern – oder „??“ für Vorschläge' };
  if (w.numbers[0] === '0') return { ok: false, field: 'numbers', error: 'Die Zahl darf nicht mit 0 beginnen' };
  if (!w.letters.includes('?') && BLOCKED_LETTERS.includes(w.letters)) {
    return { ok: false, field: 'letters', error: `„${w.letters}“ wird nicht zugeteilt` };
  }
  if (w.cityCode.length + w.letters.length + w.numbers.length > 8) {
    return { ok: false, field: 'all', error: 'Ein Kennzeichen hat höchstens 8 Zeichen (ohne Bindestrich)' };
  }
  const openSlots = (w.letters + w.numbers).split('').filter((c) => c === '?').length;
  return { ok: true, pattern: w, districtName, openSlots };
}

export function formatWish(w: WishInput): string {
  return `${w.cityCode}-${w.letters} ${w.numbers}`;
}

/** Deterministischer Zufall (mulberry32), damit „Neue Vorschläge“ reproduzierbar ist. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}

const LETTERS = 'ABCDEFGHIJKLMNOPRSTUVWXYZ'; // Q wird in Erkennungsnummern nicht vergeben
const DIGITS = '0123456789';

/**
 * Füllt „?“ mit gültigen Zeichen. Ohne Platzhalter kommt genau die Eingabe zurück.
 * Ergebnisse sind eindeutig, ohne gesperrte Buchstabenkombinationen und ohne führende Null.
 */
export function suggestPlates(pattern: WishInput, count = 12, seed = 0): WishInput[] {
  const w = normalizeWish(pattern);
  if (!(w.letters + w.numbers).includes('?')) return [w];
  const rand = rng(hash(formatWish(w)) + seed * 7919);
  const seen = new Set<string>();
  const out: WishInput[] = [];
  for (let attempt = 0; attempt < count * 40 && out.length < count; attempt++) {
    const letters = [...w.letters].map((c) => (c === '?' ? LETTERS[Math.floor(rand() * LETTERS.length)] : c)).join('');
    const numbers = [...w.numbers]
      .map((c, i) => (c === '?' ? (i === 0 ? DIGITS[1 + Math.floor(rand() * 9)] : DIGITS[Math.floor(rand() * 10)]) : c))
      .join('');
    if (BLOCKED_LETTERS.includes(letters)) continue;
    const candidate = { cityCode: w.cityCode, letters, numbers };
    const key = formatWish(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
