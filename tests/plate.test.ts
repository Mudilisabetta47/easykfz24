import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GLYPHS, layoutPlate, normalizePlateParts, PLATE, scalePathX, splitPlate } from '../src/lib/plate.ts';

describe('Kennzeichen-Glyphen', () => {
  it('decken A–Z, Umlaute und Ziffern ab', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÜ0123456789') {
      assert.ok(GLYPHS[c]?.d.length, `Glyphe ${c} fehlt`);
    }
  });
  it('nutzen die Breiten der Mittelschrift', () => {
    assert.equal(GLYPHS.H.w, 47.5);
    assert.equal(GLYPHS['4'].w, 44.5);
    assert.ok(GLYPHS.I.w < 20, 'I ist schmal');
  });
});

describe('layoutPlate', () => {
  it('zentriert „HB EZ 24“ mit Plakettenbereich zwischen den Gruppen', () => {
    const l = layoutPlate('HB', 'EZ', '24');
    assert.equal(l.scaleX, 1);
    assert.deepEqual(
      [l.district, l.letters, l.digits].map((g) => g.map((x) => x.char).join('')),
      ['HB', 'EZ', '24'],
    );
    const lastDistrict = l.district[1];
    assert.ok(l.sealX >= lastDistrict.x + lastDistrict.glyph.w - 0.01);
    assert.ok(l.letters[0].x >= l.sealX + PLATE.SEAL_W - 0.01);
    const left = l.district[0].x - l.textStart;
    const right = l.textEnd - (l.digits[1].x + l.digits[1].glyph.w);
    assert.ok(Math.abs(left - right) < 0.01, 'zentriert');
    assert.ok(l.textStart > PLATE.BAND_X + PLATE.BAND_W, 'rechts vom Eurofeld');
  });
  it('macht lange Kombinationen schmaler statt sie abzuschneiden', () => {
    const l = layoutPlate('ÖHR', 'KW', '1234E');
    assert.ok(l.scaleX < 1);
    const last = l.digits[l.digits.length - 1];
    assert.ok(last.x + last.glyph.w * l.scaleX <= l.textEnd + 0.01);
  });
  it('nutzt ohne Eurofeld mehr Breite', () => {
    assert.ok(layoutPlate('B', 'A', '1', false).textStart < layoutPlate('B', 'A', '1', true).textStart);
  });
  it('filtert ungültige Zeichen', () => {
    assert.deepEqual(normalizePlateParts('hb-', 'ez!', '24x'), { cityCode: 'HB', letters: 'EZ', numbers: '24' });
  });
  it('zerlegt normalisierte Kennzeichen', () => {
    assert.deepEqual(splitPlate('HB-EZ 24'), { cityCode: 'HB', letters: 'EZ', numbers: '24' });
    assert.deepEqual(splitPlate('B-EK 42E'), { cityCode: 'B', letters: 'EK', numbers: '42E' });
    assert.equal(splitPlate('HB EZ 24'), null);
  });
});

describe('scalePathX', () => {
  it('staucht nur x-Koordinaten und Bogenradien in x', () => {
    assert.equal(scalePathX('M5 70L19 5H28.5V9A13 13 0 0 1 42.5 18Z', 0.5), 'M 2.5 70 L 9.5 5 H 14.25 V 9 A 6.5 13 0 0 1 21.25 18 Z');
  });
  it('lässt den Pfad bei Faktor 1 unverändert', () => {
    assert.equal(scalePathX(GLYPHS.S.d[0], 1), GLYPHS.S.d[0]);
  });
  it('kann alle Glyphen verarbeiten', () => {
    for (const g of Object.values(GLYPHS)) for (const d of g.d) assert.doesNotThrow(() => scalePathX(d, 0.8));
  });
});
