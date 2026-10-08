import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PRICE_CONFIG, PRICES_ARE_EXAMPLE_VALUES, PRICES_FINAL } from '../src/lib/pricing.config.ts';
import { calculatePrice, plateSignCount } from '../src/lib/pricing.ts';

describe('Preise', () => {
  it('sind als Beispielwerte gekennzeichnet, solange nicht final', () => {
    assert.equal(PRICES_ARE_EXAMPLE_VALUES, !PRICES_FINAL);
  });
  it('Servicepauschale + Versand', () => {
    const p = calculatePrice({ service: 'halterwechsel', vehicleType: 'pkw', plateChoice: 'behalten', plateSigns: true, delivery: 'versand' });
    assert.deepEqual(
      p.lines.map((l) => l.key),
      ['service', 'versand'],
      'beim Behalten keine Schilder, auch wenn angehakt',
    );
    assert.equal(p.totalCents, PRICE_CONFIG.serviceFeeCents.halterwechsel + PRICE_CONFIG.shippingCents);
  });
  it('Wunschkennzeichen und Schilder je Fahrzeugart', () => {
    const pkw = calculatePrice({ service: 'neuzulassung', vehicleType: 'pkw', plateChoice: 'wunsch', plateSigns: true, delivery: 'abholung' });
    assert.equal(
      pkw.totalCents,
      PRICE_CONFIG.serviceFeeCents.neuzulassung + PRICE_CONFIG.wishPlateHandlingCents + 2 * PRICE_CONFIG.plateSignCents,
    );
    const bike = calculatePrice({ service: 'neuzulassung', vehicleType: 'motorrad', plateChoice: 'neu', plateSigns: true, delivery: 'abholung' });
    assert.equal(bike.lines.find((l) => l.key === 'schilder')?.cents, PRICE_CONFIG.plateSignCents);
    assert.equal(plateSignCount('anhaenger'), 1);
    assert.equal(plateSignCount('unbekannt'), 2);
  });
  it('Abmeldung ohne Kennzeichenpositionen', () => {
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: 'wunsch', plateSigns: true, delivery: 'versand' });
    assert.deepEqual(
      p.lines.map((l) => l.key),
      ['service', 'versand'],
    );
  });
  it('Umzug mit Kennzeichenwechsel berechnet Schilder', () => {
    const p = calculatePrice({ service: 'umzug', vehicleType: 'pkw', plateChoice: 'neu', plateSigns: true, delivery: 'versand' });
    assert.ok(p.lines.some((l) => l.key === 'schilder'));
  });
  it('rechnet mit eigener Konfiguration', () => {
    const cfg = { ...PRICE_CONFIG, shippingCents: 1000, serviceFeeCents: { ...PRICE_CONFIG.serviceFeeCents, abmeldung: 1 } };
    const p = calculatePrice({ service: 'abmeldung', vehicleType: 'pkw', plateChoice: null, plateSigns: false, delivery: 'versand' }, cfg);
    assert.equal(p.totalCents, 1001);
  });
});
