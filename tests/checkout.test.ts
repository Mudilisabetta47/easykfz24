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

describe('Erklärungen zum vorzeitigen Leistungsbeginn', () => {
  it('Website: freiwillig – Bestellung ohne Erklärungen gültig; wer den Beginn verlangt, bestätigt auch das Erlöschen', () => {
    const d = draft();
    assert.ok(validateOrder(d, { earlyStartOffered: true }).ok);
    d.finish = { ...d.finish, vorzeitigerBeginn: true };
    const one = validateOrder(d, { earlyStartOffered: true });
    assert.ok(!one.ok && one.errors['finish.widerrufErlischt'] && !one.errors['finish.vorzeitigerBeginn']);
    d.finish = { ...d.finish, vorzeitigerBeginn: true, widerrufErlischt: true };
    assert.ok(validateOrder(d, { earlyStartOffered: true }).ok);
  });

  it('Express setzt bei Privatpersonen den sofortigen Beginn voraus', () => {
    const d = { ...draft(), bearbeitung: 'express' };
    const v = validateOrder(d, { earlyStartOffered: true });
    assert.ok(!v.ok && /Express setzt/.test(v.errors['finish.vorzeitigerBeginn'] ?? ''));
    d.finish = { ...d.finish, vorzeitigerBeginn: true, widerrufErlischt: true };
    assert.ok(validateOrder(d, { earlyStartOffered: true }).ok);
  });
});

describe('Zahlungspause', () => {
  it('Standard: pausiert; nur ZAHLUNG_PAUSE=0 hebt sie auf', async () => {
    const { paymentsPaused } = await import('../src/server/checkout.ts');
    assert.equal(paymentsPaused({}), true);
    assert.equal(paymentsPaused({ ZAHLUNG_PAUSE: '1' }), true);
    assert.equal(paymentsPaused({ ZAHLUNG_PAUSE: 'nein' }), true);
    assert.equal(paymentsPaused({ ZAHLUNG_PAUSE: '0' }), false);
  });
});

describe('Digitale Vollmacht (VOLLMACHT_DIGITAL)', () => {
  it('Firmen online nur Abmeldung; Privatpersonen alle Leistungen', () => {
    const firm = draft();
    firm.holder = { ...firm.holder, typ: 'firma', firmenname: 'Muster GmbH', ansprechpartner: 'Max Muster' };
    assert.ok(validateOrder(firm, { digitalPoa: true }).ok, 'Abmeldung für Firmen erlaubt');
    const zul = { ...firm, service: 'halterwechsel' };
    const v = validateOrder(zul, { digitalPoa: true });
    assert.ok(!v.ok && /nur die Abmeldung/.test(v.errors['holder.typ'] ?? ''));
  });

  it('Papiervollmacht entfällt aus der Liste der Originale', async () => {
    const { originalsFor } = await import('../src/lib/services.ts');
    assert.ok(originalsFor('neuzulassung', false).includes('Unterschriebene Vollmacht'));
    assert.ok(!originalsFor('neuzulassung', true).includes('Unterschriebene Vollmacht'));
  });
});
