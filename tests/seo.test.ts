// SEO-Grundregeln: eindeutige Titel, Beschreibungen in sinnvoller Länge, Leistungsseiten ohne Zeitzusagen.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { districtCopy } from '../src/lib/district-copy.ts';
import { allCodes, districtPage } from '../src/lib/district-pages.ts';
import { SERVICE_LANDINGS } from '../src/lib/service-landings.ts';

describe('Ortsseiten', () => {
  const copies = allCodes().map((c) => ({ c, copy: districtCopy(districtPage(c)!) }));

  it('jede Seite hat einen eigenen Titel', () => {
    const titles = new Set(copies.map((x) => x.copy.title));
    assert.equal(titles.size, copies.length);
  });

  it('Titel nach Muster „Wunschkennzeichen … reservieren in …“', () => {
    const as = copies.find((x) => x.c === 'AS')!.copy;
    assert.equal(as.title, 'Wunschkennzeichen AS reservieren in Amberg-Sulzbach');
  });

  it('Beschreibungen höchstens 160 Zeichen (bis auf sehr lange amtliche Bezirksnamen)', () => {
    const long = copies.filter((x) => x.copy.metaDescription.length > 160);
    assert.ok(long.length <= copies.length * 0.05, `${long.length} zu lang: ${long.slice(0, 3).map((x) => x.c)}`);
  });
});

describe('Leistungsseiten', () => {
  it('eigene Titel und Beschreibungen (≤ 160 Zeichen), FAQ vorhanden', () => {
    const pages = Object.values(SERVICE_LANDINGS);
    assert.equal(new Set(pages.map((p) => p.title)).size, pages.length);
    for (const p of pages) {
      assert.ok(p.description.length <= 160, `${p.path}: ${p.description.length}`);
      assert.ok(p.faq.length >= 3);
    }
  });

  it('keine Zusage einer Bearbeitungs- oder Zulassungsdauer', () => {
    const text = JSON.stringify(SERVICE_LANDINGS);
    assert.ok(!/\b24\s*(Stunden|h)\b|innerhalb von \d+|garantiert/i.test(text));
  });
});
