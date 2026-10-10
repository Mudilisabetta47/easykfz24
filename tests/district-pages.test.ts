import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { allCodes, codeFromSlug, districtLabel, districtPage, inDistrict, slugForCode, variant } from '../src/lib/district-pages.ts';

describe('Ortsseiten', () => {
  it('bilden eindeutige Adressen für alle Kürzel', () => {
    const slugs = allCodes().map(slugForCode);
    assert.equal(new Set(slugs).size, slugs.length);
    assert.equal(slugForCode('WÜ'), 'wue');
    assert.equal(codeFromSlug('wue'), 'WÜ');
    assert.equal(codeFromSlug('OHZ'), 'OHZ');
    assert.equal(codeFromSlug('xyz'), null);
  });
  it('liefern Steckbrief, Bundesland und verwandte Kürzel', () => {
    const p = districtPage('OHZ');
    assert.ok(p);
    assert.equal(p.district, 'Landkreis Osterholz');
    assert.deepEqual(p.states, ['Niedersachsen']);
    assert.ok(p.sameLetter.includes('OH'));
    const ro = districtPage('RO');
    assert.ok(ro?.sameDistrict.includes('AIB'), 'Altkennzeichen im selben Kreis');
  });
  it('haben für jedes Kürzel ein Bundesland', () => {
    for (const c of allCodes()) assert.ok(districtPage(c)?.states.length, `Bundesland fehlt für ${c}`);
  });
  it('formulieren Bezirke grammatisch', () => {
    assert.equal(inDistrict('Landkreis Osterholz'), 'im Landkreis Osterholz');
    assert.equal(inDistrict('Stadt Bremen; Stadt Bremerhaven'), 'in der Stadt Bremen und in der Stadt Bremerhaven');
    assert.equal(inDistrict('Ostalbkreis'), 'im Ostalbkreis');
    assert.equal(inDistrict('Berlin'), 'in Berlin');
    assert.equal(inDistrict('Stadt Augsburg und Landkreis Augsburg'), 'in der Stadt Augsburg und im Landkreis Augsburg');
    assert.equal(districtLabel('Landkreis A; Landkreis B; Landkreis C'), 'Landkreis A, Landkreis B und Landkreis C');
  });
  it('wählt Textvarianten stabil', () => {
    assert.equal(variant('OHZ', 'intro', 3), variant('OHZ', 'intro', 3));
    assert.ok(new Set(allCodes().map((c) => variant(c, 'intro', 3))).size === 3);
  });
});

describe('Ortsseiten-Texte', () => {
  it('nennen keine festen Behördengebühren und passen zu jedem Kürzel', async () => {
    const { districtCopy } = await import('../src/lib/district-copy.ts');
    for (const c of allCodes()) {
      const copy = districtCopy(districtPage(c)!);
      const all = JSON.stringify(copy);
      assert.ok(!/10,20|12,80|2,60/.test(all), `feste Gebühr in ${c}`);
      assert.ok(copy.title.includes(c));
      assert.ok(copy.metaDescription.length <= 300);
    }
  });
});
