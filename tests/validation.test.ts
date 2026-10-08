import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  checkBirthDate,
  checkEmail,
  checkEvb,
  checkFin,
  checkIban,
  checkPhone,
  checkPlate,
  checkPlz,
  formatIban,
  ibanMod97,
  maskIban,
} from '../src/lib/validation.ts';

describe('FIN', () => {
  it('akzeptiert 17 gültige Zeichen und normalisiert', () => {
    assert.deepEqual(checkFin(' wvwzzz1jz3w386752 '), { ok: true, value: 'WVWZZZ1JZ3W386752' });
    assert.equal(checkFin('WVW-ZZZ1JZ 3W386752').ok, true);
  });
  it('lehnt I, O und Q mit konkretem Hinweis ab', () => {
    const r = checkFin('WVWZZZ1JZ3WO86752');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /I, O oder Q/);
  });
  it('prüft die Länge', () => {
    const r = checkFin('WVWZZZ1JZ3W38675');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /16/);
  });
  it('lehnt leere und unplausible Werte ab', () => {
    assert.equal(checkFin('').ok, false);
    assert.equal(checkFin('11111111111111111').ok, false);
    assert.equal(checkFin('WVWZZZ1JZ3W38675!').ok, false);
  });
});

describe('IBAN (mod 97)', () => {
  it('akzeptiert gültige IBANs verschiedener SEPA-Länder', () => {
    assert.deepEqual(checkIban('DE89 3704 0044 0532 0130 00'), { ok: true, value: 'DE89370400440532013000' });
    assert.equal(checkIban('GB82WEST12345698765432').ok, true);
    assert.equal(checkIban('AT611904300234573201').ok, true);
    assert.equal(checkIban('nl91abna0417164300').ok, true);
  });
  it('erkennt falsche Prüfziffern', () => {
    const r = checkIban('DE89370400440532013001');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /Prüfziffer/);
  });
  it('prüft die Länge je Land', () => {
    const r = checkIban('DE8937040044053201300');
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /22 Zeichen/);
  });
  it('lehnt Nicht-SEPA-Länder ab', () => {
    assert.equal(checkIban('BR1800360305000010009795493C1').ok, false);
  });
  it('rechnet mod 97 korrekt', () => {
    assert.equal(ibanMod97('DE89370400440532013000'), 1);
    assert.notEqual(ibanMod97('DE88370400440532013000'), 1);
  });
  it('maskiert für Listen und formatiert in Vierergruppen', () => {
    assert.equal(maskIban('DE89370400440532013000'), 'DE89 **** **** **** **30 00');
    assert.equal(formatIban('de89370400440532013000'), 'DE89 3704 0044 0532 0130 00');
    assert.ok(!maskIban('DE89370400440532013000').includes('0532'));
  });
});

describe('eVB, Kennzeichen, Kontakt', () => {
  it('eVB: 7 alphanumerische Zeichen', () => {
    assert.deepEqual(checkEvb('a1b2 c3d'), { ok: true, value: 'A1B2C3D' });
    assert.equal(checkEvb('A1B2C3').ok, false);
    assert.equal(checkEvb('A1B2C3D4').ok, false);
  });
  it('Kennzeichen werden normalisiert', () => {
    assert.deepEqual(checkPlate('m ab 1234'), { ok: true, value: 'M-AB 1234' });
    assert.deepEqual(checkPlate('HB-EZ24'), { ok: true, value: 'HB-EZ 24' });
    assert.deepEqual(checkPlate('B-EK 42E'), { ok: true, value: 'B-EK 42E' });
    assert.deepEqual(checkPlate('ös-a 1h'), { ok: true, value: 'ÖS-A 1H' });
  });
  it('Kennzeichen: ungültige Formate', () => {
    assert.equal(checkPlate('MAB1234').ok, false); // Trennung fehlt
    assert.equal(checkPlate('M-AB 0123').ok, false); // führende Null
    assert.equal(checkPlate('ABC-DE 1234').ok, false); // mehr als 8 Zeichen
    assert.equal(checkPlate('M-ABC 12').ok, false);
  });
  it('PLZ, E-Mail, Telefon', () => {
    assert.equal(checkPlz('28195').ok, true);
    assert.equal(checkPlz('2819').ok, false);
    assert.deepEqual(checkEmail(' Max@Example.DE '), { ok: true, value: 'max@example.de' });
    assert.equal(checkEmail('max@example').ok, false);
    assert.equal(checkPhone('+49 421 123456').ok, true);
    assert.equal(checkPhone('123').ok, false);
    assert.equal(checkPhone('0421 abc').ok, false);
  });
  it('Geburtsdatum: echtes Datum, mindestens 16 Jahre', () => {
    const today = new Date(Date.UTC(2026, 9, 8));
    assert.equal(checkBirthDate('1984-03-07', today).ok, true);
    assert.equal(checkBirthDate('2023-02-30', today).ok, false);
    assert.equal(checkBirthDate('2015-01-01', today).ok, false);
    assert.equal(checkBirthDate('1890-01-01', today).ok, false);
    assert.equal(checkBirthDate('07.03.1984', today).ok, false);
  });
});
