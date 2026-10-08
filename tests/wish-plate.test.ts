import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISTRICTS } from '../src/lib/districts.ts';
import { checkWish, formatWish, parseWishText, searchDistricts, suggestPlates } from '../src/lib/wish-plate.ts';

describe('Ortskennzeichen', () => {
  it('kennt gängige und neue Unterscheidungszeichen', () => {
    for (const c of ['B', 'HB', 'OHZ', 'M', 'HH', 'ÖHR', 'MÜ', 'WOB']) assert.ok(DISTRICTS[c], c);
    assert.equal(DISTRICTS.OHZ, 'Landkreis Osterholz');
    assert.ok(Object.keys(DISTRICTS).length > 650);
    assert.equal(DISTRICTS.BP, undefined, 'Sonderkennzeichen ausgeschlossen');
  });
  it('sucht nach Code und Name', () => {
    assert.equal(searchDistricts('oh')[0].code, 'OH');
    assert.ok(searchDistricts('osterholz').some((d) => d.code === 'OHZ'));
  });
});

describe('Wunschkennzeichen', () => {
  it('zerlegt Freitext', () => {
    assert.deepEqual(parseWishText('ohz ?? ??'), { cityCode: 'OHZ', letters: '??', numbers: '??' });
    assert.deepEqual(parseWishText('OHZ-AB 123'), { cityCode: 'OHZ', letters: 'AB', numbers: '123' });
  });
  it('prüft Bezirk, Länge, führende Null und gesperrte Kombinationen', () => {
    assert.equal(checkWish({ cityCode: 'XYQ', letters: 'AB', numbers: '1' }).ok, false);
    assert.equal(checkWish({ cityCode: 'OHZ', letters: 'AB', numbers: '0123' }).ok, false);
    assert.equal(checkWish({ cityCode: 'OHZ', letters: 'AB', numbers: '1234' }).ok, false, '9 Zeichen');
    assert.equal(checkWish({ cityCode: 'OHZ', letters: 'SS', numbers: '12' }).ok, false);
    const ok = checkWish({ cityCode: 'ohz', letters: '??', numbers: '??' });
    assert.ok(ok.ok && ok.openSlots === 4 && ok.districtName === 'Landkreis Osterholz');
  });
  it('erzeugt gültige, eindeutige Vorschläge', () => {
    const list = suggestPlates({ cityCode: 'OHZ', letters: '??', numbers: '??' }, 12, 0);
    assert.equal(list.length, 12);
    assert.equal(new Set(list.map(formatWish)).size, 12);
    for (const w of list) {
      assert.match(formatWish(w), /^OHZ-[A-Z]{2} [1-9][0-9]$/);
      assert.ok(!['HJ', 'KZ', 'NS', 'SA', 'SS'].includes(w.letters));
      assert.ok(checkWish(w).ok);
    }
    assert.deepEqual(suggestPlates({ cityCode: 'OHZ', letters: '??', numbers: '??' }, 12, 0), list, 'reproduzierbar');
    assert.notDeepEqual(suggestPlates({ cityCode: 'OHZ', letters: '??', numbers: '??' }, 12, 1), list);
    assert.deepEqual(suggestPlates({ cityCode: 'OHZ', letters: 'AB', numbers: '12' }), [{ cityCode: 'OHZ', letters: 'AB', numbers: '12' }]);
  });
});
