// Sicherheitsschalter für den Kunden-Checkout und freiwillige Zustimmung zum vorzeitigen Leistungsbeginn.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { checkoutState } from '../src/server/checkout.ts';

function draft() {
  const d = emptyDraft('abmeldung');
  d.vehicle = { ...d.vehicle, art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000777', bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin' };
  d.holder = {
    ...d.holder,
    typ: 'privat',
    vorname: 'Erika',
    nachname: 'Muster',
    geburtsdatum: '1984-03-07',
    strasse: 'Weg',
    hausnummer: '1',
    plz: '28195',
    ort: 'Bremen',
    email: 'erika@example.de',
    telefon: '0421 123456',
  };
  d.plate = { ...d.plate, wahl: '', zustellung: 'abholung' };
  d.finish = { ...d.finish, vollmacht: true, datenschutz: true };
  return d;
}

describe('Checkout-Schalter', () => {
  const e = process.env as Record<string, string | undefined>;
  const saved = { NODE_ENV: e.NODE_ENV, WIDERRUF_AKTIV: e.WIDERRUF_AKTIV };
  const restore = () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete e[k];
      else e[k] = v;
    }
  };

  it('Produktivbetrieb: nur offen mit BESTELLUNG_AKTIV=1 UND erreichbarer Widerrufsbelehrung', () => {
    try {
      e.NODE_ENV = 'production';
      delete e.WIDERRUF_AKTIV;
      assert.deepEqual(checkoutState({ NODE_ENV: 'production', BESTELLUNG_AKTIV: '1' }), { open: false, reason: 'widerruf' });
      e.WIDERRUF_AKTIV = '1';
      assert.deepEqual(checkoutState({ NODE_ENV: 'production' }), { open: false, reason: 'freigabe' });
      assert.deepEqual(checkoutState({ NODE_ENV: 'production', BESTELLUNG_AKTIV: '0' }), { open: false, reason: 'freigabe' });
      assert.deepEqual(checkoutState({ NODE_ENV: 'production', BESTELLUNG_AKTIV: '1' }), { open: true });
    } finally {
      restore();
    }
  });

  it('lokale Entwicklung: offen', () => {
    assert.deepEqual(checkoutState({ NODE_ENV: 'development' }), { open: true });
  });
});

describe('Vorzeitiger Leistungsbeginn ist freiwillig', () => {
  it('Bestellung ohne Zustimmung ist gültig', () => {
    const v = validateOrder(draft());
    assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  });

  it('wer den vorzeitigen Beginn verlangt, muss zusätzlich das Erlöschen bestätigen', () => {
    const d = draft();
    d.finish = { ...d.finish, vorzeitigerBeginn: true };
    const v = validateOrder(d);
    assert.ok(!v.ok);
    assert.ok(!v.ok && v.errors['finish.widerrufErlischt']);
    assert.ok(!v.ok && !v.errors['finish.vorzeitigerBeginn']);
    d.finish = { ...d.finish, vorzeitigerBeginn: true, widerrufErlischt: true };
    assert.ok(validateOrder(d).ok);
  });
});
