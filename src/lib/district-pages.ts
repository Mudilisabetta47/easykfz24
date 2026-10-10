// Daten für die SEO-Ortsseiten /kennzeichen/[kuerzel]: Adresse, Steckbrief, verwandte Kürzel.

import { DISTRICT_INFO } from './district-info.ts';
import { DISTRICTS } from './districts.ts';

/** Kürzel → URL-Teil: klein, Umlaute ausgeschrieben (WÜ → wue). */
export function slugForCode(code: string): string {
  return code.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue');
}

const BY_SLUG: ReadonlyMap<string, string> = new Map(Object.keys(DISTRICTS).map((c) => [slugForCode(c), c]));

/** URL-Teil → Kürzel; akzeptiert auch das Kürzel selbst (z. B. „WÜ“ oder „wü“). */
export function codeFromSlug(slug: string): string | null {
  const s = decodeURIComponent(slug).trim();
  return BY_SLUG.get(s.toLowerCase()) ?? BY_SLUG.get(slugForCode(s.toUpperCase().toLowerCase())) ?? null;
}

export function allCodes(): string[] {
  return Object.keys(DISTRICTS).sort((a, b) => a.localeCompare(b, 'de'));
}

export interface DistrictPage {
  code: string;
  slug: string;
  /** Zulassungsbezirk, z. B. „Landkreis Osterholz“ */
  district: string;
  /** Wovon das Kürzel abgeleitet ist, z. B. „Osterholz-Scharmbeck“ */
  origin: string | null;
  states: readonly string[];
  /** Weitere Kürzel desselben Zulassungsbezirks (Kennzeichenliberalisierung) */
  sameDistrict: string[];
  /** Alle Kürzel mit demselben Anfangsbuchstaben */
  sameLetter: string[];
  /** Kürzel im selben Bundesland (ohne die beiden Listen oben), alphabetisch */
  sameState: string[];
}

/** Nennt mehrere Bundesländer lesbar: „Bayern“, „Bayern und Hessen“. */
export function joinGerman(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} und ${items[items.length - 1]}`;
}

/** Teilt einen Bezirk wie „Ortenaukreis; Landkreis Rastatt“ in einzelne Kreise. */
function districtParts(name: string): string[] {
  return name.split(/;\s*/).map((s) => s.trim());
}

/** Für den Abgleich: „Stadt und Landkreis X“ → Stadt X, Landkreis X */
function matchParts(name: string): string[] {
  return districtParts(name).flatMap((p) => {
    const both = /^Stadt und Landkreis (.+)$/.exec(p) ?? /^Stadt (.+) und Landkreis \1$/.exec(p);
    return both ? [`Stadt ${both[1]}`, `Landkreis ${both[1]}`] : [p];
  });
}

export function districtPage(code: string): DistrictPage | null {
  const district = DISTRICTS[code];
  if (!district) return null;
  const info = DISTRICT_INFO[code];
  const codes = allCodes();
  const parts = matchParts(district);
  const sameDistrict = codes.filter((c) => c !== code && matchParts(DISTRICTS[c]).some((p) => parts.includes(p)));
  const letter = code[0];
  const sameLetter = codes.filter((c) => c !== code && c[0] === letter);
  const states = info?.s ?? [];
  const sameState = codes.filter(
    (c) => c !== code && !sameDistrict.includes(c) && !sameLetter.includes(c) && (DISTRICT_INFO[c]?.s ?? []).some((s) => states.includes(s)),
  );
  return {
    code,
    slug: slugForCode(code),
    district,
    origin: info?.o ?? null,
    states,
    sameDistrict,
    sameLetter,
    sameState,
  };
}

/** Deterministische Auswahl einer Textvariante je Kürzel – unterschiedliche Seiten, stabiler Inhalt. */
export function variant(code: string, salt: string, count: number): number {
  let h = 2166136261;
  for (const ch of `${salt}:${code}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % count;
}

/** Bezirk lesbar: „Landkreis Bayreuth, Landkreis Forchheim und Landkreis Kulmbach“. */
export function districtLabel(district: string): string {
  return joinGerman(districtParts(district));
}

function inPart(part: string): string {
  let m = /^Stadt (.+) und Landkreis (.+)$/.exec(part);
  if (m) return `in der Stadt ${m[1]} und im Landkreis ${m[2]}`;
  if (/^Stadt und Landkreis /.test(part)) return `in ${part}`;
  m = /^Freie und Hansestadt (.+)$/.exec(part);
  if (m) return `in der Freien und Hansestadt ${m[1]}`;
  if (/^(Stadt|Städteregion|Region|Gemeinde)\b/.test(part)) return `in der ${part}`;
  if (/^(Landkreis|Kreis|Regionalverband)\b/.test(part) || /kreis$/i.test(part)) return `im ${part}`;
  return `in ${part}`;
}

/** „in der Stadt Bremen“, „im Landkreis Osterholz“, „im Ostalbkreis“, „in Berlin“ – auch für mehrere Bezirke. */
export function inDistrict(district: string): string {
  return joinGerman(districtParts(district).map(inPart));
}
