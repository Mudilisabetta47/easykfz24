// Erzeugt die verifizierte Datenbasis für Zulassungsbezirke, Kennzeichenkürzel und Gemeinden aus amtlichen Quellen:
//   1. KBA-Faltblatt „Kfz-Kennzeichen und auslaufende Kennzeichen in Deutschland“ (aktuelle + auslaufende Kürzel)
//   2. KBA „Anschriftenverzeichnis der Zulassungsbehörden“ AV 1 (Kürzel je Verwaltungsbezirk mit Kreisschlüssel,
//      Zulassungsbehörden, „A:“ = auslaufend im Bezirk)
//   3. Destatis Gemeindeverzeichnis „Alle politisch selbständigen Gemeinden mit ausgewählten Merkmalen“ (XLSX)
// Verknüpfung ausschließlich über den amtlichen Kreisschlüssel (5 Stellen). Nichts wird geraten: Was sich nicht eindeutig
// aus den Quellen ergibt, wird zur manuellen Prüfung markiert.
//
// Vorbereitung (Texte aus den PDFs mit Apples PDFKit, XLSX entpackt):
//   node scripts/regions/build-regions.mjs --faltblatt faltblatt.txt --av1 av1.txt --destatis <entpacktes-xlsx-verzeichnis> \
//     --meta meta.json [--checked 2026-10-12]
// meta.json: { "kba-faltblatt": { "stand": "16.04.2026", "url": "...", "sha256": "..." }, "kba-av1": {...}, "destatis-gv": {...} }

import fs from 'node:fs';
import path from 'node:path';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const FALTBLATT = arg('faltblatt');
const AV1 = arg('av1');
const DESTATIS = arg('destatis');
const META = JSON.parse(fs.readFileSync(arg('meta'), 'utf8'));
const CHECKED = arg('checked') ?? new Date().toISOString().slice(0, 10);
const OUT = arg('out') ?? 'src/data/regions.generated.ts';
const REPORT = arg('report') ?? 'test-results/regions-report.json';
const CODE = '[A-ZÄÖÜ]{1,3}';

/* ===================== 1. KBA-Faltblatt ===================== */
const flyer = fs.readFileSync(FALTBLATT, 'utf8');
const parts = flyer.split(/=== Seite (\d+) ===/);
const page = {};
for (let i = 1; i < parts.length; i += 2) page[Number(parts[i])] = parts[i + 1];
const lastTablePage = Number(Object.keys(page).find((p) => /Aufgehobene Unterscheidungszeichen/.test(page[p]))) - 1;

const kbaCurrent = {};
{
  let last = null;
  let inFootnotes = false;
  for (let p = 3; p <= lastTablePage; p++) {
    for (const raw of page[p].split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      if (/^1\) Stadt- und Landkreis/.test(line)) inFootnotes = true;
      if (inFootnotes) continue;
      if (/^(Festgelegte|Seit dem|mit Zustimmung|keit besteht|benkombinationen|wenn neue|Diese Veröffentlichung|bewilligten|Unter-|scheidungs-|zeichen$|Stadt \/ Kreis)/.test(line)) continue;
      const m = new RegExp(`^(${CODE}) (\\S.*)$`).exec(line);
      if (m && !/^\d/.test(m[2])) {
        kbaCurrent[m[1]] = { name: m[2], notes: [] };
        last = m[1];
      } else if (last) {
        if (/^\d\)$|^[a-f]\)$/.test(line)) kbaCurrent[last].notes.push(line);
        else if (/^(auslaufend|behörde)/.test(line)) kbaCurrent[last].notes.push(line);
        else kbaCurrent[last].name += ` ${line}`;
      }
    }
  }
  for (const v of Object.values(kbaCurrent)) v.name = v.name.replace(/\s*\d\)\s*/g, ' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/(\p{Ll})- (\p{Ll})/gu, '$1$2').trim();
}
const kbaExpiring = {};
for (let p = lastTablePage + 1; p <= lastTablePage + 3; p++) {
  if (!page[p]) continue;
  let cur = null;
  for (const raw of page[p].split('\n')) {
    const line = raw.trim();
    if (!line || /^(Unter-|scheidungs-|zeichen|Aufgehobene|Fahrzeuges|Die folgenden|„auslaufende|schluss|berücksichtigt|Raum für|\d+$)/.test(line)) continue;
    const m = new RegExp(`^(${CODE}) (.+)$`).exec(line);
    if (m) {
      cur = m[1];
      kbaExpiring[cur] = m[2];
    } else if (cur) kbaExpiring[cur] += ` ${line}`;
  }
}

/* ===================== 2. KBA AV 1 ===================== */
const av1 = fs.readFileSync(AV1, 'utf8');
const stbaStart = av1.indexOf('Statistische Kennziffer der Verwaltungsbezirke\nSTBA-Nr.');
const addrStart = av1.indexOf('Anschriften der Zulassungsbehörden', stbaStart + 100);
const stbaRows = [];
const stbaSpecial = [];
for (const raw of av1.slice(stbaStart, addrStart).split('\n')) {
  const line = raw.trim();
  if (!/^\d\d \d\d\d-/.test(line)) continue;
  const m = new RegExp(`^(\\d\\d) (\\d\\d\\d)-(\\S*) (.+?) (${CODE})$`).exec(line);
  if (m) stbaRows.push({ kreis: m[1] + m[2], sub: m[3], authority: m[4], code: m[5] });
  else stbaSpecial.push(line); // z. B. „0“ (Bundesbehörden, Diplomaten)
}
// Adressteil: „A:“-Kürzel gehören zur zuletzt gelesenen Kennziffer (Einträge über Seitenumbrüche ohne Trennlinie!)
const avExpiring = []; // { kreis, code }
{
  let kreis = null;
  for (const raw of av1.slice(addrStart).split('\n')) {
    const line = raw.trim();
    if (/^_{20,}$/.test(line) || /^=== Seite/.test(line)) kreis = null;
    const st = /^(\d\d) (\d\d\d)-(\S*)/.exec(line);
    if (st) kreis = st[1] + st[2];
    if (!kreis) continue;
    for (const m of line.matchAll(new RegExp(`A:(${CODE})(?![A-ZÄÖÜ])`, 'g'))) avExpiring.push({ kreis, code: m[1] });
  }
}

/* ===================== 3. Destatis ===================== */
const ss = fs.readFileSync(path.join(DESTATIS, 'xl/sharedStrings.xml'), 'utf8');
const dec = (s) => s.replace(/&amp;/g, '&').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
const strings = [...ss.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
const sheetFile = fs.readdirSync(path.join(DESTATIS, 'xl/worksheets')).filter((f) => f.endsWith('.xml')).sort().at(-1);
const sheet = fs.readFileSync(path.join(DESTATIS, 'xl/worksheets', sheetFile), 'utf8');
const lands = {};
const kreise = {};
const gemeinden = [];
for (const r of sheet.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)) {
  const c = {};
  for (const cell of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const v = /<v>([\s\S]*?)<\/v>/.exec(cell[3] ?? '')?.[1];
    c[cell[1]] = v === undefined ? '' : /t="s"/.test(cell[2]) ? strings[Number(v)] : dec(v);
  }
  if (c.A === '10') lands[c.C] = c.H;
  if (c.A === '40') kreise[`${c.C}${c.D}${c.E}`] = { name: c.H, type: c.B, land: c.C };
  // Gemeinden ohne gemeindefreie Gebiete (Textkennzeichen 65/66)
  if (c.A === '60' && c.B !== '65' && c.B !== '66') gemeinden.push([`${c.C}${c.D}${c.E}${c.G}`, c.H, c.N ?? '', c.B]);
}

/* ===================== 4. Verknüpfen ===================== */
// Status je (Kürzel, Bezirk bzw. Gemeinde):
//   verifiziert – AV 1 (Behörde gibt das Kürzel aus) und KBA-Bezeichnung stimmen überein
//   pruefen     – Quellen widersprechen sich oder nur eine Quelle → manuelle Prüfung, wird bis zur Bestätigung nicht genutzt
//   festgelegt  – laut Faltblatt festgelegt, aber im AV 1 noch keiner Behörde zugeordnet → manuelle Prüfung
//   auslaufend  – im Bezirk auslaufend (AV 1 „A:“) bzw. bundesweit aufgehoben – nie für neue Kennzeichen
const review = [];
const flag = (kind, ref, text) => review.push({ kind, ref, text });
const norm = (s) => s.toLowerCase().replace(/ß/g, 'ss').replace(/[^a-zäöü0-9]+/g, ' ').trim();
const strip = (s) => norm(s).replace(/\b(landkreis|kreis|stadtkreis|region|regionalverband|städteregion|stadt|freie|und|hansestadt|landeshauptstadt|kreisfreie|zulassungsstelle|zweckverband|universitätsstadt|große|kreisstadt|wissenschaftsstadt|land)\b/g, ' ').replace(/\s+/g, ' ').trim();
const kreisBase = (k) => strip(k.name.split(',')[0]);
function lev(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
const same = (a, b) => a && b && (a === b || (Math.min(a.length, b.length) >= 5 && lev(a, b) <= 2));
// Bezeichnungsteile des Faltblatts („München, Rosenheim“, „Trier, Stadt und Trier-Saarburg“)
const labelParts = (label) => label.split(/,|\sund\s/).map(strip).filter(Boolean);
const labelMentions = (code, name) => labelParts(kbaCurrent[code]?.name ?? '').some((p) => same(p, strip(name.split(',')[0])));

const specialCodes = new Set();
const rowsByKreis = {};
for (const r of stbaRows) {
  if (!kbaCurrent[r.code]) {
    specialCodes.add(r.code); // Behörden-, Polizei-, Bundeskennzeichen (z. B. BD, BP, THW, NRW)
    continue;
  }
  if (!kreise[r.kreis]) {
    flag('kreis_unbekannt', r.kreis, `AV 1 nennt Kennziffer ${r.kreis} (${r.authority}, ${r.code}) – nicht im Gemeindeverzeichnis`);
    continue;
  }
  (rowsByKreis[r.kreis] ??= []).push(r);
}

const K = {}; // kreis -> { codes: {code: status}, authorities: Set, sources: Set }
const G = {}; // ags -> { codes: {code: status}, authority, note }
const put = (obj, code, status) => {
  const prev = obj[code];
  const rank = { verifiziert: 3, festgelegt: 2, pruefen: 2, auslaufend: 1 };
  if (!prev || rank[status] > rank[prev]) obj[code] = status;
};
const gemeindenByKreis = {};
for (const g of gemeinden) (gemeindenByKreis[g[0].slice(0, 5)] ??= []).push(g);

for (const [key, rows] of Object.entries(rowsByKreis)) {
  const e = (K[key] ??= { codes: {}, authorities: new Set(), sources: new Set(['kba-av1', 'kba-faltblatt', 'destatis-gv']) });
  const main = rows.filter((r) => !r.sub);
  const mainCodes = new Set(main.map((r) => r.code));
  for (const r of rows) e.authorities.add(r.authority);
  for (const code of mainCodes) {
    const ok = labelMentions(code, kreise[key].name);
    put(e.codes, code, ok ? 'verifiziert' : 'pruefen');
    if (!ok) flag('bezeichnung', `${code}@${key}`, `${code} in ${kreise[key].name} (${key}): AV 1 – Behörde(n) ${main.filter((r) => r.code === code).map((r) => r.authority).join(', ')}; KBA-Faltblatt nennt „${kbaCurrent[code].name}“ – bestätigen`);
  }
  // Zulassungsbehörden mit Zusatzziffer, die zu einer Gemeinde gehören (z. B. Völklingen, Stralsund, Göttingen-Stadt)
  const subAuth = {};
  for (const r of rows.filter((x) => x.sub)) (subAuth[r.authority] ??= new Set()).add(r.code);
  for (const [authority, codeSet] of Object.entries(subAuth)) {
    const base = strip(authority.replace(/\(.*?\)/g, ''));
    const hits = (gemeindenByKreis[key] ?? []).filter((g) => same(strip(g[1].split(',')[0]), base));
    const onlySub = [...codeSet].filter((c) => !mainCodes.has(c));
    if (hits.length === 1 && (onlySub.length || codeSet.size < mainCodes.size)) {
      const ags = hits[0][0];
      const gc = (G[ags] ??= { codes: {}, authority, note: 'Gemeinde mit eigener Zulassungsbehörde' });
      for (const c of codeSet) put(gc.codes, c, labelMentions(c, kreise[key].name) || labelMentions(c, hits[0][1]) ? 'verifiziert' : 'pruefen');
      for (const c of mainCodes) if (!codeSet.has(c)) put(gc.codes, c, 'pruefen');
      const plus = [...mainCodes].filter((c) => !codeSet.has(c));
      if (plus.length) flag('teilbehoerde', ags, `${hits[0][1]} (${ags}): eigene Zulassungsbehörde gibt ${[...codeSet].join(', ')} aus; ob auch ${plus.join(', ')} des Kreises zulässig sind, ist nicht belegt – bestätigen`);
    } else if (onlySub.length) {
      for (const c of onlySub) put(e.codes, c, 'pruefen');
      flag('teilbehoerde', key, `${kreise[key].name} (${key}): Behörde „${authority}“ gibt ${onlySub.join(', ')} aus, keine eindeutige Gemeinde zuordenbar – bestätigen`);
    }
  }
}
// KBA nennt ausdrücklich eine Gemeinde (z. B. BÜS: „Konstanz, Gemeinde Büsingen am Hochrhein“) → nur für diese Gemeinde
for (const [code, v] of Object.entries(kbaCurrent)) {
  const m = /Gemeinde ([^,]+)/.exec(v.name);
  if (!m) continue;
  const want = strip(m[1]);
  const kreisKeys = Object.entries(K).filter(([, e]) => e.codes[code]).map(([k]) => k);
  const hits = gemeinden.filter((g) => kreisKeys.includes(g[0].slice(0, 5)) && same(strip(g[1].split(',')[0]), want));
  if (hits.length === 1) {
    const [ags, name] = hits[0];
    const key = ags.slice(0, 5);
    const gc = (G[ags] ??= { codes: {}, authority: '', note: `Kürzel ${code} laut KBA nur für diese Gemeinde` });
    gc.codes[code] = 'verifiziert';
    for (const [c, st] of Object.entries(K[key].codes)) if (c !== code && st !== 'auslaufend') put(gc.codes, c, 'pruefen');
    delete K[key].codes[code];
    flag('gemeinde_kuerzel', ags, `${name} (${ags}): ${code} laut KBA nur für diese Gemeinde; ob auch die Kreiskürzel zulässig sind, ist nicht belegt – bestätigen`);
  } else flag('nicht_zuordenbar', code, `${code}: KBA nennt „Gemeinde ${m[1]}“ – Gemeinde nicht eindeutig gefunden`);
}
// Kürzel laut Faltblatt ohne Behörde im AV 1 → Bezirk nur über die KBA-Bezeichnung (eindeutig) → festgelegt, prüfen
const inAv1 = new Set(stbaRows.map((r) => r.code));
for (const [code, v] of Object.entries(kbaCurrent)) {
  if (inAv1.has(code)) continue;
  const wantsLand = /^Landkreis /.test(v.name);
  const cands = Object.entries(kreise).filter(([, k]) => labelParts(v.name).some((p) => same(p, kreisBase(k))) && (wantsLand ? k.type !== '41' && k.type !== '42' : true));
  if (cands.length === 1) {
    put((K[cands[0][0]] ??= { codes: {}, authorities: new Set(), sources: new Set(['kba-faltblatt', 'destatis-gv']) }).codes, code, 'festgelegt');
    flag('ohne_behoerde', code, `${code}: laut KBA-Faltblatt „${v.name}“ festgelegt, im AV 1 noch keiner Zulassungsbehörde zugeordnet – vor Nutzung prüfen`);
  } else flag('nicht_zuordenbar', code, `${code}: KBA-Bezeichnung „${v.name}“ passt zu ${cands.length} Kreisen – manuell zuordnen`);
}
// Kreise ohne eigenen Eintrag im AV 1 → nur ausdrückliche KBA-Bezeichnung, prüfen
for (const [key, k] of Object.entries(kreise)) {
  if (K[key] && Object.keys(K[key].codes).length) continue;
  const hits = Object.entries(kbaCurrent).filter(([c]) => labelMentions(c, k.name) || (/^Zulassungsstelle /.test(kbaCurrent[c].name) && same(strip(kbaCurrent[c].name), kreisBase(k))));
  const e = (K[key] ??= { codes: {}, authorities: new Set(), sources: new Set(['kba-faltblatt', 'destatis-gv']) });
  for (const [code] of hits) put(e.codes, code, 'pruefen');
  flag(hits.length ? 'kennziffer_abweichend' : 'ohne_kuerzel', key, hits.length ? `${k.name} (${key}): im AV 1 ohne eigene Kennziffer; laut KBA-Faltblatt ${hits.map(([c, v]) => `${c} („${v.name}“)`).join(', ')} – bestätigen` : `${k.name} (${key}): kein Kürzel in den KBA-Quellen – manuell klären`);
}
// Auslaufend im Bezirk (AV 1 „A:“)
for (const a of avExpiring) if (kreise[a.kreis]) put((K[a.kreis] ??= { codes: {}, authorities: new Set(), sources: new Set(['kba-av1']) }).codes, a.code, 'auslaufend');

/* ===================== 5. Ausgabe ===================== */
const codes = {};
const addCode = (code, ref, status) => {
  const c = (codes[code] ??= { kba: kbaCurrent[code]?.name ?? null, status: kbaCurrent[code] ? 'aktuell' : 'auslaufend', bezirke: {} });
  c.bezirke[ref] = status;
};
for (const [key, e] of Object.entries(K)) for (const [code, st] of Object.entries(e.codes)) addCode(code, key, st);
for (const [ags, g] of Object.entries(G)) for (const [code, st] of Object.entries(g.codes)) addCode(code, ags, st);
for (const [code, text] of Object.entries(kbaExpiring)) {
  codes[code] ??= { kba: null, status: 'aufgehoben', bezirke: {} };
  if (!kbaCurrent[code]) codes[code].status = 'aufgehoben';
  codes[code].aufgehoben = text;
}
const kreiseOut = {};
for (const [key, k] of Object.entries(kreise)) {
  const e = K[key];
  kreiseOut[key] = {
    name: k.name,
    type: k.type,
    land: k.land,
    codes: e?.codes ?? {},
    authorities: [...(e?.authorities ?? [])].sort(),
    sources: [...(e?.sources ?? [])],
    review: review.filter((r) => r.ref === key || r.ref.endsWith(`@${key}`)).map((r) => r.text),
  };
}
const out = {
  meta: {
    checked: CHECKED,
    sources: {
      'kba-faltblatt': { title: 'KBA: Kfz-Kennzeichen und auslaufende Kennzeichen in Deutschland', ...META['kba-faltblatt'] },
      'kba-av1': { title: 'KBA: Anschriftenverzeichnis der Zulassungsbehörden (AV 1)', ...META['kba-av1'] },
      'destatis-gv': { title: 'Destatis: Alle politisch selbständigen Gemeinden mit ausgewählten Merkmalen', ...META['destatis-gv'] },
    },
    specialCodesExcluded: [...specialCodes].sort(),
    counts: { kbaCurrent: Object.keys(kbaCurrent).length, kbaExpiring: Object.keys(kbaExpiring).length, kreise: Object.keys(kreise).length, gemeinden: gemeinden.length },
  },
  lands,
  kreise: kreiseOut,
  /** Gemeinden mit eigener Zulassungsbehörde und eigenem Kürzelangebot */
  gemeindeCodes: Object.fromEntries(Object.entries(G).map(([ags, g]) => [ags, { codes: g.codes, authority: g.authority, review: review.filter((r) => r.ref === ags).map((r) => r.text) }])),
  codes,
  /** [AGS, Name, PLZ, Textkennzeichen] – Kreis = AGS.slice(0, 5) */
  gemeinden,
};
/** Anzeigename eines Kreises nach Textkennzeichen (Destatis): 41 kreisfreie Stadt, 42 Stadtkreis, 43 Kreis, 44 Landkreis, 45 Regionalverband */
function kreisDisplay(k) {
  const base = k.name.split(',')[0].trim();
  if (k.type === '41' || k.type === '42') return /^(Berlin|Hamburg|Bremen)$/.test(base) ? base : `Stadt ${base}`;
  if (/^(Region|Regionalverband|Städteregion|Kreis|Landkreis)\b/.test(base) || /kreis$/i.test(base)) return base;
  return k.type === '43' ? `Kreis ${base}` : `Landkreis ${base}`;
}
// Kompakte, browsertaugliche Kürzelliste für Konfigurator und Ortsseiten (eine Quelle: diese Datei wird erzeugt)
const CODES_TS = arg('codes-ts') ?? 'src/lib/plate-codes.generated.ts';
{
  const rank = { verifiziert: 3, festgelegt: 2, pruefen: 1, auslaufend: 0 };
  const rows = Object.entries(codes)
    .filter(([, v]) => v.status === 'aktuell')
    .sort(([a], [b]) => a.localeCompare(b, 'de'))
    .map(([code, v]) => {
      const best = Object.values(v.bezirke).reduce((a, s) => (rank[s] > rank[a] ? s : a), 'auslaufend');
      const bezirke = Object.entries(v.bezirke)
        .filter(([, st]) => st === best)
        .map(([ref]) => (ref.length === 5 ? kreisDisplay(kreise[ref]) : `Gemeinde ${(gemeinden.find((g) => g[0] === ref)?.[1] ?? ref).split(',')[0]}`));
      const lands = [...new Set(Object.keys(v.bezirke).map((ref) => out.lands[ref.slice(0, 2)]))];
      return `  ${JSON.stringify(code)}: { k: ${JSON.stringify(v.kba)}, s: ${JSON.stringify(best === 'verifiziert' ? 'v' : best === 'festgelegt' ? 'f' : 'p')}, b: ${JSON.stringify(bezirke)}, l: ${JSON.stringify(lands)} },`;
    });
  const aufgehoben = Object.entries(codes).filter(([, v]) => v.status === 'aufgehoben').map(([c]) => c).sort((a, b) => a.localeCompare(b, 'de'));
  fs.writeFileSync(
    CODES_TS,
    `// ERZEUGT von scripts/regions/build-regions.mjs – nicht von Hand ändern.
// Quellen: KBA-Faltblatt (Stand ${META['kba-faltblatt']?.stand}), KBA AV 1 (Stand ${META['kba-av1']?.stand}), Destatis Gemeindeverzeichnis (Stand ${META['destatis-gv']?.stand}); geprüft ${CHECKED}.
// k = Bezeichnung laut KBA, s = Status (v verifiziert, p zu prüfen, f festgelegt ohne Zulassungsbehörde), b = Bezirke, l = Bundesländer

export const PLATE_CODES_CHECKED = ${JSON.stringify(CHECKED)};
export const PLATE_CODES: Readonly<Record<string, { k: string; s: 'v' | 'p' | 'f'; b: readonly string[]; l: readonly string[] }>> = {
${rows.join('\n')}
};

/** Aufgehobene Unterscheidungszeichen (laufen aus, werden nicht neu ausgegeben) */
export const REVOKED_CODES: readonly string[] = ${JSON.stringify(aufgehoben)};
`,
  );
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
// Als TS-Modul mit JSON-Text: läuft identisch in Node und im Cloudflare-Worker, ohne Dateizugriff zur Laufzeit
fs.writeFileSync(
  OUT,
  `// ERZEUGT von scripts/regions/build-regions.mjs – nicht von Hand ändern. Quellen und Stand: siehe meta.\n` +
    `export const REGIONS_JSON = ${JSON.stringify(JSON.stringify(out))};\n` +
    `export const REGIONS_REVIEW_JSON = ${JSON.stringify(JSON.stringify(review))};\n`,
);
fs.writeFileSync(REPORT, JSON.stringify({ review, kbaCurrent, kbaExpiring, stbaSpecial }, null, 1));
const statusCount = {};
for (const k of Object.values(kreiseOut)) for (const st of Object.values(k.codes)) statusCount[st] = (statusCount[st] ?? 0) + 1;
console.log(JSON.stringify({ ...out.meta.counts, gemeindenMitEigenerBehoerde: Object.keys(G).length, kuerzelMitVerifiziertemBezirk: Object.values(codes).filter((c) => Object.values(c.bezirke).includes('verifiziert')).length, zuordnungenNachStatus: statusCount, review: review.length, byKind: review.reduce((a, r) => ((a[r.kind] = (a[r.kind] ?? 0) + 1), a), {}) }, null, 1));
