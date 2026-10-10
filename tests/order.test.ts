import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { applyServiceDefaults, emptyDraft, errorsForPrefix, validateDocuments, validateOrder } from '../src/lib/order.ts';

function validDraft() {
  const d = emptyDraft('halterwechsel');
  d.vehicle = { art: 'pkw', hersteller: 'Audi', modell: 'A5 Coupé', fin: 'WAUZZZF55KA012345', bisherigesKennzeichen: 'hb-ez 24', antrieb: 'benzin', eKennzeichen: true, hKennzeichen: false };
  d.holder = {
    ...d.holder,
    typ: 'privat',
    vorname: 'Erika',
    nachname: 'Mustermann',
    geburtsdatum: '1984-03-07',
    firmenname: 'soll verworfen werden',
    strasse: 'Musterweg',
    hausnummer: '1a',
    plz: '28195',
    ort: 'Bremen',
    email: 'Erika@Example.de',
    telefon: '0421 123456',
  };
  d.plate = { wahl: 'behalten', wunschkennzeichen: '', schilder: true, zustellung: 'versand', versanddienst: 'dhl' };
  d.finish = { evb: 'a1b2c3d', kontoinhaber: 'Erika Mustermann', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true, hinweise: '' };
  return d;
}

describe('validateOrder', () => {
  it('akzeptiert einen vollständigen Halterwechsel und normalisiert', () => {
    const r = validateOrder(validDraft());
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.equal(r.order.vehicle.bisherigesKennzeichen, 'HB-EZ 24');
    assert.equal(r.order.holder.email, 'erika@example.de');
    assert.equal(r.order.holder.firmenname, '', 'Firmenfelder werden bei Privatpersonen verworfen');
    assert.equal(r.order.finish.iban, 'DE89370400440532013000');
    assert.equal(r.order.finish.evb, 'A1B2C3D');
    assert.equal(r.order.plate.schilder, false, 'beim Behalten keine Schilder');
    assert.equal(r.order.vehicle.eKennzeichen, false, 'E-Kennzeichen nur für passende Antriebe');
  });

  it('meldet Fehler je Feld mit Schritt-Präfix', () => {
    const d = validDraft();
    d.vehicle.fin = 'WAUZZZF55KA01234O';
    d.holder.plz = '123';
    d.finish.iban = 'DE89370400440532013001';
    d.finish.vollmacht = false;
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors['vehicle.fin']);
    assert.ok(r.errors['holder.plz']);
    assert.ok(r.errors['finish.iban']);
    assert.ok(r.errors['finish.vollmacht']);
    assert.deepEqual(Object.keys(errorsForPrefix(r.errors, 'holder.')), ['holder.plz']);
  });

  it('verlangt eine bekannte Leistung', () => {
    const r = validateOrder({ service: 'gutachten' });
    assert.deepEqual(r, { ok: false, errors: { service: 'Bitte eine Leistung wählen' } });
  });

  it('lehnt falsche Typen und überlange Werte über das Schema ab', () => {
    assert.equal(validateOrder({ ...validDraft(), vehicle: { ...validDraft().vehicle, modell: 'x'.repeat(200) } }).ok, false);
    assert.equal(validateOrder({ ...validDraft(), finish: { ...validDraft().finish, vollmacht: 'ja' } }).ok, false);
    assert.equal(validateOrder(null).ok, false);
  });

  it('Abmeldung: kein eVB, kein SEPA, keine Kennzeichenwahl', () => {
    const d = applyServiceDefaults(validDraft(), 'abmeldung');
    d.finish = { ...d.finish, evb: '', iban: '', kontoinhaber: '', sepaMandat: false };
    const r = validateOrder(d);
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.order.plate.wahl, null);
      assert.equal(r.order.finish.iban, '');
    }
  });

  it('Umzug: eVB nur bei Kennzeichenwechsel', () => {
    const d = applyServiceDefaults(validDraft(), 'umzug');
    d.finish = { ...d.finish, evb: '', iban: '', sepaMandat: false };
    assert.equal(validateOrder(d).ok, true, 'Kennzeichen behalten → kein eVB nötig');
    d.plate.wahl = 'neu';
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors['finish.evb']);
  });

  it('Wunschkennzeichen wird geprüft', () => {
    const d = validDraft();
    d.plate.wahl = 'wunsch';
    d.plate.wunschkennzeichen = 'HBEZ24';
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors['plate.wunschkennzeichen']);
  });

  it('Firma braucht Firmenname und Ansprechperson, kein Geburtsdatum', () => {
    const d = validDraft();
    d.holder = { ...d.holder, typ: 'firma', geburtsdatum: '', firmenname: '', ansprechpartner: '' };
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.ok(r.errors['holder.firmenname']);
      assert.ok(r.errors['holder.ansprechpartner']);
      assert.equal(r.errors['holder.geburtsdatum'], undefined);
    }
  });

  it('Wiederzulassung: „behalten“ braucht das bisherige Kennzeichen', () => {
    const d = applyServiceDefaults(validDraft(), 'wiederzulassung');
    d.vehicle.bisherigesKennzeichen = '';
    d.plate.wahl = 'behalten';
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors['vehicle.bisherigesKennzeichen']);
  });
});

describe('validateDocuments', () => {
  it('verlangt Pflichtunterlagen je Leistung', () => {
    const errs = validateDocuments('neuzulassung', { ausweis: 1 });
    assert.ok(errs['documents.zb2']);
    assert.ok(errs['documents.coc']);
    assert.equal(errs['documents.ausweis'], undefined);
  });
  it('optionale Unterlagen dürfen fehlen, fremde nicht dabei sein', () => {
    assert.deepEqual(validateDocuments('umzug', { ausweis: 1, zb1: 2 }), {});
    assert.ok(validateDocuments('abmeldung', { ausweis: 1, zb1: 1, coc: 1 })['documents.coc']);
  });
  it('begrenzt die Anzahl je Unterlage', () => {
    assert.ok(validateDocuments('abmeldung', { ausweis: 4, zb1: 1 })['documents.ausweis']);
  });
});

describe('Versanddienst', () => {
  it('ist bei Versand Pflicht und bei Abholung leer', () => {
    const d = emptyDraft('abmeldung');
    d.vehicle = { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1JZ3W386752', bisherigesKennzeichen: 'HB-A 1', antrieb: 'benzin', eKennzeichen: false, hKennzeichen: false };
    d.holder = { ...d.holder, typ: 'privat', vorname: 'A', nachname: 'B', geburtsdatum: '1980-01-01', strasse: 'X', hausnummer: '1', plz: '28195', ort: 'Bremen', email: 'a@b.de', telefon: '0421 123456' };
    d.finish = { ...d.finish, vollmacht: true, datenschutz: true };
    d.plate = { ...d.plate, zustellung: 'versand', versanddienst: '' };
    const r1 = validateOrder(d);
    assert.equal(r1.ok, false);
    if (!r1.ok) assert.ok(r1.errors['plate.versanddienst']);
    d.plate.versanddienst = 'ups';
    const r2 = validateOrder(d);
    assert.ok(r2.ok && r2.order.plate.versanddienst === 'ups');
    d.plate = { ...d.plate, zustellung: 'abholung', versanddienst: 'ups' };
    const r3 = validateOrder(d);
    assert.ok(r3.ok && r3.order.plate.versanddienst === null);
  });
});

describe('H-Kennzeichen', () => {
  it('verlangt das Oldtimer-Gutachten als Unterlage', () => {
    assert.ok(validateDocuments('halterwechsel', { ausweis: 1, zb1: 1, zb2: 1, hu: 1 }, { hKennzeichen: true })['documents.gutachten']);
    assert.deepEqual(validateDocuments('halterwechsel', { ausweis: 1, zb1: 1, zb2: 1, hu: 1, gutachten: 1 }, { hKennzeichen: true }), {});
    assert.ok(validateDocuments('halterwechsel', { ausweis: 1, zb1: 1, zb2: 1, hu: 1, gutachten: 1 })['documents.gutachten'], 'ohne H nicht erlaubt');
  });
  it('lässt sich nicht mit dem E-Kennzeichen kombinieren', () => {
    const d = validDraft();
    d.vehicle = { ...d.vehicle, antrieb: 'elektro', eKennzeichen: true, hKennzeichen: true };
    const r = validateOrder(d);
    assert.equal(r.ok, false);
    if (!r.ok) assert.ok(r.errors['vehicle.hKennzeichen']);
  });
  it('wird gespeichert, wenn gewählt', () => {
    const d = validDraft();
    d.vehicle = { ...d.vehicle, eKennzeichen: false, hKennzeichen: true };
    const r = validateOrder(d);
    assert.ok(r.ok);
    if (r.ok) assert.equal(r.order.vehicle.hKennzeichen, true);
  });
});
