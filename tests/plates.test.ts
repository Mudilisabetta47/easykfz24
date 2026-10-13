import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { offerOf, plateFinishOf, plateSummary, PLATE_PRICE_DEFAULTS } from '../src/lib/plates.ts';
import { PRICE_CONFIG } from '../src/lib/pricing.config.ts';
import { calculatePrice, withPlateOffer } from '../src/lib/pricing.ts';
import { plateCostSnapshot, pricesAt, versionAt } from '../src/server/plates.ts';

const carbonCfg = withPlateOffer(PRICE_CONFIG, { standard: 1299, carbon: 1499 });
const base = { service: 'halterwechsel' as const, vehicleType: 'pkw', plateChoice: 'neu' as const, plateSigns: true, delivery: 'abholung' as const, newCustomer: false };

describe('Kennzeichenschilder: Standard und Carbon-Optik', () => {
  it('Standard: Position mit Ausführung, Stückzahl und Einzelpreis', () => {
    const p = calculatePrice(base, carbonCfg);
    const l = p.lines.find((x) => x.key === 'schilder')!;
    assert.equal(l.label, 'Kennzeichenschilder Standard (2 Stück)');
    assert.equal(l.cents, 2 * 1299);
    assert.deepEqual([l.qty, l.unitCents, l.finish], [2, 1299, 'standard']);
  });

  it('Carbon-Optik: eigener Preis je Schild, Gesamtpreis neu berechnet', () => {
    const std = calculatePrice(base, carbonCfg);
    const p = calculatePrice({ ...base, plateFinish: 'carbon' }, carbonCfg);
    const l = p.lines.find((x) => x.key === 'schilder')!;
    assert.equal(l.label, 'Kennzeichenschilder Carbon-Optik (2 Stück)');
    assert.deepEqual([l.cents, l.qty, l.unitCents, l.finish], [2 * 1499, 2, 1499, 'carbon']);
    assert.equal(p.totalCents - std.totalCents, 2 * (1499 - 1299));
  });

  it('Carbon ohne freigegebenen Preis wird nie berechnet (fällt auf Standard zurück)', () => {
    const p = calculatePrice({ ...base, plateFinish: 'carbon' }, PRICE_CONFIG);
    assert.equal(p.lines.find((x) => x.key === 'schilder')!.finish, 'standard');
  });

  it('Komplett-Paket mit Carbon: Paketpreis + Aufpreis je Schild, gleicher Paketvorteil', () => {
    const bundle = { ...base, plateChoice: 'wunsch' as const, delivery: 'versand' as const, carrier: 'dhl' };
    const std = calculatePrice(bundle, carbonCfg);
    const cb = calculatePrice({ ...bundle, plateFinish: 'carbon' }, carbonCfg);
    assert.ok(std.bundleSaving > 0);
    assert.equal(cb.bundleSaving, std.bundleSaving);
    assert.equal(cb.totalCents - std.totalCents, 2 * (1499 - 1299));
  });

  it('Prüfung: Carbon nur, wenn angeboten; ohne Schilder immer Standard', () => {
    const d = emptyDraft('halterwechsel');
    Object.assign(d.vehicle, { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000101', bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin' });
    Object.assign(d.holder, { typ: 'privat', vorname: 'A', nachname: 'B', geburtsdatum: '1980-01-01', strasse: 'Weg', hausnummer: '1', plz: '28195', ort: 'Bremen', email: 'a@example.de', telefon: '0421 123456' });
    Object.assign(d.plate, { wahl: 'neu', schilder: true, ausfuehrung: 'carbon', zustellung: 'abholung' });
    Object.assign(d.finish, { evb: 'A1B2C3D', kontoinhaber: 'A B', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true });
    const off = validateOrder(d, { plateOffer: { standard: 1299, carbon: null } });
    assert.equal(off.ok, false);
    assert.match(String(!off.ok && off.errors['plate.ausfuehrung']), /nicht verfügbar/);
    const on = validateOrder(d, { plateOffer: { standard: 1299, carbon: 1499 } });
    assert.ok(on.ok && on.order.plate.ausfuehrung === 'carbon');
    const none = validateOrder({ ...d, plate: { ...d.plate, schilder: false } }, { plateOffer: { standard: 1299, carbon: null } });
    assert.ok(none.ok && none.order.plate.ausfuehrung === 'standard');
    const bad = validateOrder({ ...d, plate: { ...d.plate, ausfuehrung: 'gold' } });
    assert.equal(bad.ok, false);
  });

  it('Ältere Aufträge ohne Angabe gelten als Standard; Kurztext für Akte und Übermittlung', () => {
    assert.equal(plateFinishOf({ schilder: true }), 'standard');
    assert.equal(plateSummary({ schilder: true, ausfuehrung: 'carbon' }, 2), '2 × Carbon-Optik');
    assert.equal(plateSummary({ schilder: false }, 2), 'keine Schilder bestellt');
  });

  it('Angebot: Carbon erst mit Preis und „anbieten“; Einkaufspreis zum Bestellzeitpunkt', () => {
    assert.equal(offerOf(PLATE_PRICE_DEFAULTS).carbon, null);
    assert.equal(offerOf({ ...PLATE_PRICE_DEFAULTS, carbon: { sellCents: 1499, buyCents: 530, active: false } }).carbon, null);
    assert.equal(offerOf({ ...PLATE_PRICE_DEFAULTS, carbon: { sellCents: 1499, buyCents: 530, active: true } }).carbon, 1499);
    assert.equal(offerOf({ ...PLATE_PRICE_DEFAULTS, carbon: { sellCents: 1499, buyCents: 530, active: true } }, { deliverable: true, permitted: false }).carbon, null, 'ohne Zulässigkeit nicht im Angebot');
    const p1 = { ...PLATE_PRICE_DEFAULTS, carbon: { sellCents: 1499, buyCents: 530, active: true } };
    const p2 = { ...p1, carbon: { sellCents: 1599, buyCents: 560, active: true } };
    const checks = { deliverable: true, permitted: true };
    const h = [
      { version: 1, from: '2026-10-12T10:00:00.000Z', by: 'x', prices: p1, supplierShippingCents: null, carbonChecks: checks },
      { version: 2, from: '2026-11-01T00:00:00.000Z', by: 'x', prices: p2, supplierShippingCents: 390, carbonChecks: checks },
    ];
    assert.equal(versionAt(h, '2026-10-01T00:00:00.000Z').version, 0, 'vor dem ersten Eintrag: Ausgangswerte');
    assert.equal(pricesAt(h, '2026-10-20T00:00:00.000Z').carbon.buyCents, 530);
    assert.equal(pricesAt(h, '2026-11-05T00:00:00.000Z').carbon.buyCents, 560);
    assert.deepEqual(plateCostSnapshot(h[1], 'carbon', 2), { finish: 'carbon', qty: 2, unitBuyCents: 560, buyCents: 1120, supplierShippingCents: 390, priceVersion: 2, priceFrom: '2026-11-01T00:00:00.000Z' });
  });
});
