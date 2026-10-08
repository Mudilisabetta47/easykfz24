import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NEW_CUSTOMER_PROMO, PRICE_CONFIG, PRICES_ARE_EXAMPLE_VALUES, PRICES_FINAL } from '../src/lib/pricing.config.ts';
import { bundleInfo, calculatePrice, charmPrice, discountFor, fromPrice, isPromoActive, plateSignCount, servicePrice } from '../src/lib/pricing.ts';
import { SERVICE_IDS } from '../src/lib/services.ts';

const noPromo = { ...NEW_CUSTOMER_PROMO, enabled: false };
const promo = { ...NEW_CUSTOMER_PROMO, enabled: true, percent: 10, validUntil: null };

describe('Preise', () => {
  it('Beispielwert-Kennzeichnung folgt PRICES_FINAL', () => {
    assert.equal(PRICES_ARE_EXAMPLE_VALUES, !PRICES_FINAL);
  });
  it('alle Preise enden auf ,99', () => {
    const all = [
      ...Object.values(PRICE_CONFIG.serviceFeeCents),
      ...Object.values(PRICE_CONFIG.bundleCents).filter((v): v is number => v !== null),
      PRICE_CONFIG.wishPlateHandlingCents,
      PRICE_CONFIG.plateSignCents,
      PRICE_CONFIG.shippingCents,
    ];
    for (const cents of all) assert.equal(cents % 100, 99, String(cents));
  });
  it('Servicepauschale + Versand, beim Behalten keine Schilder', () => {
    const p = calculatePrice({ service: 'halterwechsel', vehicleType: 'pkw', plateChoice: 'behalten', plateSigns: true, delivery: 'versand' }, PRICE_CONFIG, noPromo);
    assert.deepEqual(p.lines.map((l) => l.key), ['service', 'versand']);
    assert.equal(p.totalCents, PRICE_CONFIG.serviceFeeCents.halterwechsel + PRICE_CONFIG.shippingCents);
  });
  it('Schilder je Fahrzeugart', () => {
    const bike = calculatePrice({ service: 'neuzulassung', vehicleType: 'motorrad', plateChoice: 'neu', plateSigns: true, delivery: 'abholung' }, PRICE_CONFIG, noPromo);
    assert.equal(bike.lines.find((l) => l.key === 'schilder')?.cents, PRICE_CONFIG.plateSignCents);
    assert.equal(plateSignCount('anhaenger'), 1);
    assert.equal(plateSignCount('unbekannt'), 2);
  });
  it('Abmeldung ohne Kennzeichenpositionen und ohne Paket', () => {
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: 'wunsch', plateSigns: true, delivery: 'versand' }, PRICE_CONFIG, noPromo);
    assert.deepEqual(p.lines.map((l) => l.key), ['service', 'versand']);
  });
});

describe('Psychologische Preise', () => {
  it('rundet nur ab und endet immer auf ,99 – bevorzugt …9,99', () => {
    assert.equal(charmPrice(8099), 7999);
    assert.equal(charmPrice(5039), 4999);
    assert.equal(charmPrice(2519), 2499);
    for (const c of [1000, 2519, 5039, 8099, 12345]) {
      const v = charmPrice(c);
      assert.ok(v <= c);
      assert.equal(v % 100, 99);
    }
  });
  it('Neukundenpreise: 89,99 → 79,99 · 79,99 → 69,99 · 55,99 → 49,99 · 27,99 → 24,99', () => {
    assert.equal(servicePrice('neuzulassung').promoCents, 7999);
    assert.equal(servicePrice('halterwechsel').promoCents, 6999);
    assert.equal(servicePrice('umzug').promoCents, 4999);
    assert.equal(servicePrice('abmeldung').promoCents, 2499);
  });
  it('jede Leistung: Ersparnis mindestens 10 %, Neukundenpreis endet auf ,99', () => {
    for (const s of SERVICE_IDS) {
      const p = servicePrice(s);
      assert.ok(p.savingCents * 10 >= p.regularCents, s);
      assert.equal(p.promoCents % 100, 99, s);
    }
  });
});

describe('Neukundenrabatt', () => {
  it('nur auf die Servicepauschale – nicht auf Schilder oder Versand', () => {
    const p = calculatePrice({ service: 'neuzulassung', vehicleType: 'pkw', plateChoice: 'neu', plateSigns: true, delivery: 'versand' }, PRICE_CONFIG, promo);
    assert.equal(p.discountCents, 1000);
    assert.equal(p.bundleSaving, 0);
    assert.equal(p.totalCents, p.regularCents - 1000);
    assert.equal(discountFor(8999, promo), 1000);
  });
  it('kein Rabatt für Bestandskunden', () => {
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: null, plateSigns: false, delivery: 'abholung', newCustomer: false });
    assert.equal(p.discountCents, 0);
    assert.equal(p.totalCents, p.regularCents);
  });
  it('„ab“-Preis nimmt die günstigste Leistung', () => {
    assert.equal(fromPrice(['halterwechsel', 'umzug']).regularCents, PRICE_CONFIG.serviceFeeCents.umzug);
  });
  it('endet am hinterlegten Enddatum', () => {
    const p = { ...promo, validUntil: '2026-12-31' };
    assert.equal(isPromoActive(p, '2026-12-31'), true);
    assert.equal(isPromoActive(p, '2027-01-01'), false);
  });
});

describe('Komplett-Pakete', () => {
  const full = { vehicleType: 'pkw', plateChoice: 'wunsch' as const, plateSigns: true, delivery: 'versand' as const };
  it('greifen nur mit Wunschkennzeichen, Schildern und Versand', () => {
    const p = calculatePrice({ service: 'neuzulassung', ...full }, PRICE_CONFIG, noPromo);
    assert.equal(p.totalCents, 11999);
    assert.equal(p.bundleSaving, p.regularCents - 11999);
    assert.equal(calculatePrice({ service: 'neuzulassung', ...full, delivery: 'abholung' }, PRICE_CONFIG, noPromo).bundleSaving, 0);
    assert.equal(calculatePrice({ service: 'neuzulassung', ...full, plateSigns: false }, PRICE_CONFIG, noPromo).bundleSaving, 0);
  });
  it('sind immer günstiger als die Einzelpreise – auch mit nur einem Schild', () => {
    for (const s of SERVICE_IDS) {
      for (const vehicleType of ['pkw', 'motorrad']) {
        const p = calculatePrice({ service: s, ...full, vehicleType }, PRICE_CONFIG, noPromo);
        assert.ok(p.bundleSaving >= 0, `${s} ${vehicleType}`);
      }
    }
  });
  it('Neukunden-Paketpreis endet auf ,99 und spart mindestens 10 % der Servicepauschale', () => {
    const p = calculatePrice({ service: 'halterwechsel', ...full }, PRICE_CONFIG, promo);
    assert.equal(p.totalCents, 9999);
    assert.ok(p.discountCents * 10 >= PRICE_CONFIG.serviceFeeCents.halterwechsel);
    for (const s of SERVICE_IDS) {
      const info = bundleInfo(s);
      if (!info) continue;
      assert.equal(info.promoCents % 100, 99, s);
      assert.ok(info.promoCents < info.singleCents, s);
    }
  });
});
