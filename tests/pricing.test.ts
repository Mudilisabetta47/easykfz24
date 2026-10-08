import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { NEW_CUSTOMER_PROMO, PRICE_CONFIG, PRICES_ARE_EXAMPLE_VALUES, PRICES_FINAL } from '../src/lib/pricing.config.ts';
import { calculatePrice, discountFor, fromPrice, isPromoActive, plateSignCount, servicePrice } from '../src/lib/pricing.ts';

const noPromo = { ...NEW_CUSTOMER_PROMO, enabled: false };

describe('Preise', () => {
  it('Beispielwert-Kennzeichnung folgt PRICES_FINAL', () => {
    assert.equal(PRICES_ARE_EXAMPLE_VALUES, !PRICES_FINAL);
  });
  it('Servicepauschalen enden auf ,90', () => {
    for (const cents of Object.values(PRICE_CONFIG.serviceFeeCents)) assert.equal(cents % 100, 90);
  });
  it('Servicepauschale + Versand, beim Behalten keine Schilder', () => {
    const p = calculatePrice({ service: 'halterwechsel', vehicleType: 'pkw', plateChoice: 'behalten', plateSigns: true, delivery: 'versand' }, PRICE_CONFIG, noPromo);
    assert.deepEqual(p.lines.map((l) => l.key), ['service', 'versand']);
    assert.equal(p.totalCents, PRICE_CONFIG.serviceFeeCents.halterwechsel + PRICE_CONFIG.shippingCents);
    assert.equal(p.discountCents, 0);
  });
  it('Wunschkennzeichen und Schilder je Fahrzeugart', () => {
    const pkw = calculatePrice({ service: 'neuzulassung', vehicleType: 'pkw', plateChoice: 'wunsch', plateSigns: true, delivery: 'abholung' }, PRICE_CONFIG, noPromo);
    assert.equal(pkw.totalCents, PRICE_CONFIG.serviceFeeCents.neuzulassung + PRICE_CONFIG.wishPlateHandlingCents + 2 * PRICE_CONFIG.plateSignCents);
    const bike = calculatePrice({ service: 'neuzulassung', vehicleType: 'motorrad', plateChoice: 'neu', plateSigns: true, delivery: 'abholung' }, PRICE_CONFIG, noPromo);
    assert.equal(bike.lines.find((l) => l.key === 'schilder')?.cents, PRICE_CONFIG.plateSignCents);
    assert.equal(plateSignCount('anhaenger'), 1);
    assert.equal(plateSignCount('unbekannt'), 2);
  });
  it('Abmeldung ohne Kennzeichenpositionen', () => {
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: 'wunsch', plateSigns: true, delivery: 'versand' }, PRICE_CONFIG, noPromo);
    assert.deepEqual(p.lines.map((l) => l.key), ['service', 'versand']);
  });
});

describe('Neukundenrabatt', () => {
  it('10 % nur auf die Servicepauschale – nicht auf Schilder oder Versand', () => {
    const cfg = { ...PRICE_CONFIG, serviceFeeCents: { ...PRICE_CONFIG.serviceFeeCents, neuzulassung: 8990 } };
    const promo = { ...NEW_CUSTOMER_PROMO, enabled: true, percent: 10, validUntil: null };
    const p = calculatePrice({ service: 'neuzulassung', vehicleType: 'pkw', plateChoice: 'neu', plateSigns: true, delivery: 'versand' }, cfg, promo);
    assert.equal(p.discountCents, 899);
    assert.equal(p.regularCents, 8990 + 2 * cfg.plateSignCents + cfg.shippingCents);
    assert.equal(p.totalCents, p.regularCents - 899);
    assert.equal(p.lines.at(-1)?.cents, -899);
  });
  it('kein Rabatt für Bestandskunden', () => {
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: null, plateSigns: false, delivery: 'abholung', newCustomer: false });
    assert.equal(p.discountCents, 0);
    assert.equal(p.totalCents, p.regularCents);
  });
  it('rechnet 89,90 € → 80,91 € (Vorteil 8,99 €)', () => {
    const promo = { ...NEW_CUSTOMER_PROMO, enabled: true, percent: 10, validUntil: null };
    assert.equal(discountFor(8990, promo), 899);
    const cfg = { ...PRICE_CONFIG, serviceFeeCents: { ...PRICE_CONFIG.serviceFeeCents, neuzulassung: 8990 } };
    assert.deepEqual(servicePrice('neuzulassung', cfg, promo), { regularCents: 8990, promoCents: 8091, savingCents: 899 });
  });
  it('„ab“-Preis nimmt die günstigste Leistung', () => {
    const p = fromPrice(['halterwechsel', 'umzug']);
    assert.equal(p.regularCents, Math.min(PRICE_CONFIG.serviceFeeCents.halterwechsel, PRICE_CONFIG.serviceFeeCents.umzug));
  });
  it('endet am hinterlegten Enddatum', () => {
    const promo = { ...NEW_CUSTOMER_PROMO, enabled: true, validUntil: '2026-12-31' };
    assert.equal(isPromoActive(promo, '2026-12-31'), true);
    assert.equal(isPromoActive(promo, '2027-01-01'), false);
    assert.equal(isPromoActive({ ...promo, enabled: false }, '2026-01-01'), false);
  });
});
