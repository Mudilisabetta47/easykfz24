// Verifizierte Orts- und Kennzeichendaten (KBA + Destatis), erzeugt von scripts/regions/build-regions.mjs.
// Nur serverseitig verwenden (rund 0,7 MB). Grundsatz: Ein Kürzel gilt für eine Gemeinde nur, wenn die Zuordnung
// „verifiziert“ ist. Alles andere ist „zu prüfen“ und wird nicht automatisch verwendet.

import { REGIONS_JSON, REGIONS_REVIEW_JSON } from '../data/regions.generated.ts';
import type { ValidatedOrder } from '../lib/order.ts';
import type { IssueInput } from '../lib/workflow.ts';

export type AssignmentStatus = 'verifiziert' | 'pruefen' | 'festgelegt' | 'auslaufend';

interface Kreis {
  name: string;
  type: string;
  land: string;
  codes: Record<string, AssignmentStatus>;
  authorities: string[];
  sources: string[];
  review: string[];
}
interface RegionsData {
  meta: { checked: string; sources: Record<string, { title: string; stand: string; url: string; sha256: string }>; specialCodesExcluded: string[]; counts: Record<string, number> };
  lands: Record<string, string>;
  kreise: Record<string, Kreis>;
  gemeindeCodes: Record<string, { codes: Record<string, AssignmentStatus>; authority: string; review: string[] }>;
  codes: Record<string, { kba: string | null; status: 'aktuell' | 'auslaufend' | 'aufgehoben'; bezirke: Record<string, AssignmentStatus>; aufgehoben?: string }>;
  gemeinden: [ags: string, name: string, plz: string, type: string][];
}

let cache: RegionsData | null = null;
export function regions(): RegionsData {
  return (cache ??= JSON.parse(REGIONS_JSON) as RegionsData);
}
export function regionsReview(): { kind: string; ref: string; text: string }[] {
  return JSON.parse(REGIONS_REVIEW_JSON);
}

export function kreisDisplay(key: string): string {
  const k = regions().kreise[key];
  if (!k) return key;
  const base = k.name.split(',')[0].trim();
  if (k.type === '41' || k.type === '42') return /^(Berlin|Hamburg|Bremen)$/.test(base) ? base : `Stadt ${base}`;
  if (/^(Region|Regionalverband|Städteregion|Kreis|Landkreis)\b/.test(base) || /kreis$/i.test(base)) return base;
  return k.type === '43' ? `Kreis ${base}` : `Landkreis ${base}`;
}

export interface Place {
  ags: string;
  /** amtlicher Name laut Destatis, z. B. „Osterholz-Scharmbeck, Stadt“ */
  officialName: string;
  /** Anzeigename ohne Zusatz, z. B. „Osterholz-Scharmbeck“ */
  name: string;
  /** Unterscheidung bei gleichnamigen Gemeinden im selben Kreis, z. B. „Eifel“ oder „PLZ 17392“ */
  zusatz?: string;
  plz: string;
  kreis: string;
  kreisName: string;
  land: string;
  /** alle Zuordnungen (inkl. zu prüfen/auslaufend) */
  assignments: { code: string; status: AssignmentStatus }[];
  /** nur verifizierte Kürzel – diese darf das System verwenden */
  codes: string[];
  authorities: string[];
  /** offene Prüfhinweise zu Gemeinde oder Bezirk */
  review: string[];
}

const ORDER: Record<AssignmentStatus, number> = { verifiziert: 0, festgelegt: 1, pruefen: 2, auslaufend: 3 };
// „Rosenheim (Landkreis Altenkirchen)“ → „Rosenheim“; der amtliche Name mit Zusatz bleibt in officialName erhalten
const placeName = (official: string) => official.split(',')[0].replace(/\s*\([^)]*\)\s*$/, '').trim();

// Gleichnamige Gemeinden im selben Kreis (z. B. zweimal Neuenkirchen im Landkreis Vorpommern-Greifswald)
let sameNameInKreis: Set<string> | null = null;
function zusatzOf(official: string, name: string, kreis: string, plz: string): string | undefined {
  if (!sameNameInKreis) {
    const seen = new Set<string>();
    sameNameInKreis = new Set();
    for (const g of regions().gemeinden) {
      const k = `${placeName(g[1])}|${g[0].slice(0, 5)}`;
      if (seen.has(k)) sameNameInKreis.add(k);
      seen.add(k);
    }
  }
  if (!sameNameInKreis.has(`${name}|${kreis}`)) return undefined;
  // Amtlicher Zusatz („Forst (Eifel)“, „Garding, Kirchspiel“), sonst die PLZ des Verwaltungssitzes
  const rest = official
    .slice(name.length)
    .replace(/^[\s,]+/, '')
    .replace(/^\((.*)\)$/, '$1')
    .trim();
  return rest || `PLZ ${plz}`;
}

export function placeByAgs(ags: string): Place | null {
  const d = regions();
  const g = d.gemeinden.find((x) => x[0] === ags);
  if (!g) return null;
  const key = ags.slice(0, 5);
  const k = d.kreise[key];
  const own = d.gemeindeCodes[ags];
  const codes = own?.codes ?? k?.codes ?? {};
  const assignments = Object.entries(codes)
    .map(([code, status]) => ({ code, status }))
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.code.localeCompare(b.code, 'de'));
  const zusatz = zusatzOf(g[1], placeName(g[1]), key, g[2]);
  return {
    ags,
    officialName: g[1],
    name: placeName(g[1]),
    ...(zusatz ? { zusatz } : {}),
    plz: g[2],
    kreis: key,
    kreisName: kreisDisplay(key),
    land: d.lands[ags.slice(0, 2)] ?? '',
    assignments,
    codes: assignments.filter((a) => a.status === 'verifiziert').map((a) => a.code),
    authorities: own?.authority ? [own.authority] : (k?.authorities ?? []),
    review: [...(own?.review ?? []), ...(k?.review ?? [])],
  };
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Ortssuche für Konfigurator und Verwaltung: Name (Anfang oder Wortanfang) oder Postleitzahl; gleichnamige Orte bleiben
 * getrennt. Zusätzliche Wörter grenzen über Kreis, Land oder PLZ ein („Neuenkirchen Diepholz“, „Neuenkirchen 49434“).
 */
export function searchPlaces(query: string, limit = 12): Place[] {
  const q = fold(query);
  if (q.length < 2) return [];
  const d = regions();
  const isPlz = /^\d{2,5}$/.test(q);
  const tokens = q.split(' ');
  const context = (g: RegionsData['gemeinden'][number]) => `${fold(kreisDisplay(g[0].slice(0, 5)))} ${fold(d.lands[g[0].slice(0, 2)] ?? '')} ${g[2]}`.split(' ');
  const scored: { g: RegionsData['gemeinden'][number]; score: number }[] = [];
  for (const g of d.gemeinden) {
    const n = fold(placeName(g[1]));
    let score = -1;
    if (isPlz) score = g[2].startsWith(q) ? 1 : -1;
    else if (n === q) score = 3;
    else if (n.startsWith(q)) score = 2;
    else if (n.split(' ').some((w) => w.startsWith(q))) score = 1;
    // Name + Eingrenzung: vordere Wörter = Ortsname, restliche Wörter passen auf Kreis, Land oder PLZ
    for (let k = tokens.length - 1; score < 0 && k >= 1; k--) {
      const head = tokens.slice(0, k).join(' ');
      if (n !== head && !n.startsWith(head)) continue;
      const ctx = context(g);
      if (tokens.slice(k).every((t) => ctx.some((w) => w.startsWith(t)))) score = n === head ? 2.5 : 1.5;
    }
    if (score >= 0) scored.push({ g, score });
  }
  return scored
    .sort((a, b) => b.score - a.score || placeName(a.g[1]).length - placeName(b.g[1]).length || a.g[1].localeCompare(b.g[1], 'de'))
    .slice(0, limit)
    .map((x) => placeByAgs(x.g[0]) as Place);
}

/**
 * Gemeinde zu einer Halteranschrift. Destatis führt je Gemeinde nur die PLZ des Verwaltungssitzes – daher Abgleich über
 * den Ortsnamen; bei gleichnamigen Gemeinden entscheidet die PLZ. Nicht eindeutig → null (keine Vermutung).
 */
let byName: Map<string, RegionsData['gemeinden']> | null = null;
export function placeForAddress(plz: string, ort: string): Place | null {
  const want = fold(ort.replace(/\s*\(.*?\)\s*/g, ' '));
  if (!want) return null;
  if (!byName) {
    byName = new Map();
    for (const g of regions().gemeinden) {
      const k = fold(placeName(g[1]));
      byName.set(k, [...(byName.get(k) ?? []), g]);
    }
  }
  const hits = byName.get(want) ?? [];
  if (hits.length === 1) return placeByAgs(hits[0][0]);
  const byPlz = hits.filter((g) => g[2] === plz);
  return byPlz.length === 1 ? placeByAgs(byPlz[0][0]) : null;
}

/** Darf das Kürzel für diese Gemeinde verwendet werden? ja | nein | unklar (zu prüfen bzw. Ort unbekannt) */
export function codeAllowedFor(code: string, place: Place | null): 'ja' | 'nein' | 'unklar' {
  if (!place) return 'unklar';
  const a = place.assignments.find((x) => x.code === code.toUpperCase());
  if (!a) return 'nein';
  return a.status === 'verifiziert' ? 'ja' : a.status === 'auslaufend' ? 'nein' : 'unklar';
}

/** Im Konfigurator gewählter Ort eines Auftrags mit Abgleich gegen das Wunsch-Kürzel (für Verwaltung und Druckansicht) */
export function orderWishPlace(data: ValidatedOrder): { ags: string; name: string; kreis: string; land: string; codes: string[]; fits: boolean } | null {
  // name enthält ggf. den Zusatz gleichnamiger Gemeinden („Neuenkirchen (PLZ 17392)“)
  const ags = data.plate.wunschort;
  if (!ags || data.plate.wahl !== 'wunsch') return null;
  const p = placeByAgs(ags);
  const code = data.plate.wunschkennzeichen.split('-')[0];
  if (!p) return { ags, name: `unbekannter Ort (${ags})`, kreis: '', land: '', codes: [], fits: false };
  return { ags, name: p.zusatz ? `${p.name} (${p.zusatz})` : p.name, kreis: p.kreisName, land: p.land, codes: p.codes, fits: p.codes.includes(code) };
}

/** Wunschkennzeichen-Kürzel gegen den Wohnort (Halteranschrift) – nur amtliche Zuordnung, keine Vermutung. */
export function wishCodeCheck(data: ValidatedOrder): IssueInput['wishCode'] {
  if (data.plate.wahl !== 'wunsch' || !data.plate.wunschkennzeichen) return undefined;
  const code = data.plate.wunschkennzeichen.split('-')[0];
  // Maßgeblich ist der Wohnsitz. Ist der Ortsname mehrdeutig, entscheidet der im Konfigurator ausdrücklich gewählte
  // gleichnamige Ort – sonst bleibt es „unklar“.
  const chosen = data.plate.wunschort ? placeByAgs(data.plate.wunschort) : null;
  const place = placeForAddress(data.holder.plz, data.holder.ort) ?? (chosen && fold(chosen.name) === fold(data.holder.ort) ? chosen : null);
  return { code, result: codeAllowedFor(code, place), place: place ? `${place.name} (${place.kreisName})` : null, allowed: place?.codes ?? [] };
}
