import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DISTRICTS } from '../src/lib/districts.ts';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { PLATE_CODES, REVOKED_CODES } from '../src/lib/plate-codes.generated.ts';
import { checkWish, cityCodeProblem } from '../src/lib/wish-plate.ts';
import { codeAllowedFor, orderWishPlace, placeByAgs, placeForAddress, regions, searchPlaces, wishCodeCheck } from '../src/server/regions.ts';

const place = (name: string, kreis?: string) => {
  const p = searchPlaces(name, 30).filter((x) => x.name === name && (!kreis || x.kreisName.includes(kreis)));
  assert.equal(p.length, 1, `${name}${kreis ? ` (${kreis})` : ''} eindeutig`);
  return p[0];
};

describe('Verifizierte Orts- und Kennzeichendaten (KBA + Destatis)', () => {
  it('Quellen mit Stand und Prüfsumme; Umfang laut amtlichen Listen', () => {
    const m = regions().meta;
    assert.equal(m.sources['kba-faltblatt'].stand, '16.04.2026');
    assert.equal(m.sources['kba-av1'].stand, 'Juli 2026');
    assert.equal(m.sources['destatis-gv'].stand, '30.09.2026');
    for (const s of Object.values(m.sources)) assert.match(s.sha256, /^[0-9a-f]{64}$/);
    assert.equal(m.counts.kbaCurrent, 716);
    assert.equal(m.counts.kbaExpiring, 55);
    assert.equal(m.counts.kreise, 401);
    assert.ok(m.counts.gemeinden > 10_000);
    assert.equal(Object.keys(PLATE_CODES).length, 716);
  });

  it('Pflichtfälle: Bremen → HB, Lilienthal → OHZ, Osterholz-Scharmbeck → OHZ, Hamburg → HH, Hannover → H', () => {
    assert.deepEqual(place('Bremen').codes, ['HB']);
    assert.deepEqual(place('Lilienthal').codes, ['OHZ']);
    assert.equal(place('Lilienthal').kreisName, 'Landkreis Osterholz');
    assert.deepEqual(place('Osterholz-Scharmbeck').codes, ['OHZ']);
    assert.deepEqual(place('Hamburg').codes, ['HH']);
    assert.deepEqual(place('Hannover').codes, ['H']);
  });

  it('Mehrere zulässige Kürzel in einem Bezirk und wieder eingeführte Altkennzeichen', () => {
    assert.deepEqual(place('Duderstadt').codes, ['DUD', 'GÖ', 'HMÜ', 'OHA']);
    assert.deepEqual(place('Bocholt').codes, ['AH', 'BOH', 'BOR']);
    assert.ok(place('Gersthofen').codes.includes('A') && place('Gersthofen').codes.includes('WER'));
  });

  it('Ein Kürzel für mehrere Bezirke (AIB: Landkreis München und Rosenheim; A: Stadt und Landkreis Augsburg)', () => {
    assert.match(DISTRICTS.AIB, /Landkreis München/);
    assert.match(DISTRICTS.AIB, /Landkreis Rosenheim/);
    assert.ok(place('Grasbrunn').codes.includes('AIB'));
    assert.match(DISTRICTS.A, /Stadt Augsburg.*Landkreis Augsburg/);
  });

  it('Gleichnamige Gemeinden bleiben getrennt; Anschrift nur bei eindeutiger Zuordnung', () => {
    const neu = searchPlaces('Neuenkirchen', 30).filter((p) => p.name === 'Neuenkirchen');
    assert.ok(neu.length >= 10);
    assert.equal(new Set(neu.map((p) => p.ags)).size, neu.length, 'je Gemeinde eigener Schlüssel');
    assert.equal(placeForAddress('99999', 'Neuenkirchen'), null, 'ohne passende PLZ keine Vermutung');
    const diepholz = neu.find((p) => p.kreisName === 'Landkreis Diepholz')!;
    assert.equal(placeForAddress(diepholz.plz, 'Neuenkirchen')?.ags, diepholz.ags);
    // „Rosenheim“ gibt es auch als Gemeinde im Landkreis Altenkirchen (Westerwald) – mit AK, nicht RO
    assert.deepEqual(place('Rosenheim', 'Altenkirchen').codes, ['AK']);
    assert.ok(place('Rosenheim', 'Stadt').codes.includes('RO'));
  });

  it('Gemeindebezogene Kürzel: BÜS nur für Büsingen am Hochrhein, nicht für Konstanz', () => {
    assert.ok(place('Büsingen am Hochrhein').codes.includes('BÜS'));
    assert.ok(!place('Konstanz').codes.includes('BÜS'));
    assert.equal(codeAllowedFor('BÜS', place('Konstanz')), 'nein');
  });

  it('Erfundene, aufgehobene und noch zu prüfende Kürzel werden abgelehnt – nichts wird ergänzt', () => {
    for (const fake of ['LIL', 'ABC', 'XQZ', 'BRE']) {
      assert.equal(DISTRICTS[fake], undefined);
      assert.match(String(cityCodeProblem(fake)), /kein amtlich vergebenes Ortskennzeichen/);
      assert.equal(checkWish({ cityCode: fake, letters: 'AB', numbers: '1' }).ok, false);
    }
    assert.ok(REVOKED_CODES.includes('SNH'));
    assert.match(String(cityCodeProblem('SNH')), /aufgehobenes Kürzel/);
    assert.equal(PLATE_CODES.SAB.s, 'p');
    assert.match(String(cityCodeProblem('SAB')), /amtlich geprüft/);
    for (const special of ['BD', 'BP', 'THW', 'NRW']) assert.equal(PLATE_CODES[special], undefined, `Sonderkennzeichen ${special} nicht enthalten`);
    assert.equal(codeAllowedFor('LIL', place('Lilienthal')), 'nein');
    assert.equal(codeAllowedFor('HB', place('Lilienthal')), 'nein');
    assert.equal(codeAllowedFor('OHZ', place('Lilienthal')), 'ja');
  });

  it('Gleichnamige Gemeinden im selben Kreis erhalten einen amtlichen Zusatz oder die PLZ', () => {
    const forst = searchPlaces('Forst Cochem').map((p) => p.zusatz).sort();
    assert.deepEqual(forst, ['Eifel', 'Hunsrück']);
    assert.deepEqual(searchPlaces('Garding').map((p) => p.zusatz).sort(), ['Kirchspiel', 'Stadt']);
    assert.deepEqual(searchPlaces('Neuenkirchen Greifswald').map((p) => p.zusatz).sort(), ['PLZ 17392', 'PLZ 17498']);
    assert.equal(place('Lilienthal').zusatz, undefined, 'eindeutige Namen ohne Zusatz');
  });

  it('Ortssuche grenzt gleichnamige Gemeinden über Kreis, Land oder PLZ ein', () => {
    const dh = searchPlaces('Neuenkirchen Diepholz');
    assert.deepEqual(dh.map((p) => [p.name, p.kreisName, p.codes]), [['Neuenkirchen', 'Landkreis Diepholz', ['DH', 'SY']]]);
    assert.equal(searchPlaces(`Neuenkirchen ${dh[0].plz}`)[0].ags, dh[0].ags);
    assert.ok(searchPlaces('Neuenkirchen Niedersachsen').every((p) => p.land === 'Niedersachsen'));
    assert.deepEqual(searchPlaces('Rosenheim Altenkirchen').map((p) => p.codes), [['AK']]);
  });

  it('Gewählter Ort am Auftrag: Kürzel muss passen, unbekannter Ort abgelehnt, nur bei Wunschkennzeichen gespeichert', () => {
    const lil = place('Lilienthal');
    const d = emptyDraft('neuzulassung');
    Object.assign(d.vehicle, { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000101', antrieb: 'benzin' });
    Object.assign(d.holder, { typ: 'privat', vorname: 'A', nachname: 'B', geburtsdatum: '1980-01-01', strasse: 'Weg', hausnummer: '1', plz: '28865', ort: 'Lilienthal', email: 'a@example.de', telefon: '0421 123456' });
    Object.assign(d.plate, { wahl: 'wunsch', wunschkennzeichen: 'OHZ-AB 12', wunschort: lil.ags, zustellung: 'abholung' });
    Object.assign(d.finish, { evb: 'A1B2C3D', kontoinhaber: 'A B', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true });
    const opts = { wishPlace: placeByAgs };
    const good = validateOrder(d, opts);
    assert.ok(good.ok);
    assert.equal(good.ok && good.order.plate.wunschort, lil.ags);
    assert.deepEqual(good.ok && orderWishPlace(good.order), { ags: lil.ags, name: 'Lilienthal', kreis: 'Landkreis Osterholz', land: 'Niedersachsen', codes: ['OHZ'], fits: true });
    const wrong = validateOrder({ ...d, plate: { ...d.plate, wunschkennzeichen: 'HB-AB 12' } }, opts);
    assert.match(String(!wrong.ok && wrong.errors['plate.wunschkennzeichen']), /HB gehört laut Kraftfahrt-Bundesamt nicht zu Lilienthal – zulässig: OHZ/);
    const unknown = validateOrder({ ...d, plate: { ...d.plate, wunschort: '99999999' } }, opts);
    assert.match(String(!unknown.ok && unknown.errors['plate.wunschkennzeichen']), /Ort ist nicht bekannt/);
    const garbage = validateOrder({ ...d, plate: { ...d.plate, wunschort: 'abc' } }, opts);
    assert.ok(garbage.ok && garbage.order.plate.wunschort === undefined, 'ungültiger Schlüssel wird nicht gespeichert');
    const neu = validateOrder({ ...d, plate: { ...d.plate, wahl: 'neu', wunschkennzeichen: '' } }, opts);
    assert.ok(neu.ok && neu.order.plate.wunschort === undefined, 'ohne Wunschkennzeichen kein Ort');
  });

  it('Mehrdeutiger Wohnort: der ausdrücklich gewählte gleichnamige Ort entscheidet – sonst „unklar“', () => {
    const dh = searchPlaces('Neuenkirchen Diepholz')[0];
    const base = { plate: { wahl: 'wunsch', wunschkennzeichen: 'DH-AB 12' }, holder: { plz: '99999', ort: 'Neuenkirchen' } };
    assert.equal(wishCodeCheck(base as never)?.result, 'unklar');
    assert.equal(wishCodeCheck({ ...base, plate: { ...base.plate, wunschort: dh.ags } } as never)?.result, 'ja');
    // gewählter Ort mit anderem Namen als der Wohnort zählt nicht
    assert.equal(wishCodeCheck({ plate: { ...base.plate, wunschort: place('Lilienthal').ags }, holder: base.holder } as never)?.result, 'unklar');
  });

  it('Bestellung: Wunschkennzeichen nur mit verifiziertem Kürzel', () => {
    const d = emptyDraft('neuzulassung');
    Object.assign(d.vehicle, { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000101', antrieb: 'benzin' });
    Object.assign(d.holder, { typ: 'privat', vorname: 'A', nachname: 'B', geburtsdatum: '1980-01-01', strasse: 'Weg', hausnummer: '1', plz: '28865', ort: 'Lilienthal', email: 'a@example.de', telefon: '0421 123456' });
    Object.assign(d.plate, { wahl: 'wunsch', wunschkennzeichen: 'LIL-AB 12', zustellung: 'abholung' });
    Object.assign(d.finish, { evb: 'A1B2C3D', kontoinhaber: 'A B', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true });
    const bad = validateOrder(d);
    assert.equal(bad.ok, false);
    assert.match(String(!bad.ok && bad.errors['plate.wunschkennzeichen']), /kein amtlich vergebenes/);
    const good = validateOrder({ ...d, plate: { ...d.plate, wunschkennzeichen: 'OHZ-AB 12' } });
    assert.ok(good.ok, JSON.stringify(!good.ok && good.errors));
  });
});
