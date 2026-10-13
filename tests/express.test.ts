import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EXPRESS_DEFAULT, EXPRESS_FOOTNOTE, EXPRESS_HEADLINE, expressOfferOf, processingOf } from '../src/lib/express.ts';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { PRICE_CONFIG } from '../src/lib/pricing.config.ts';
import { calculatePrice, withExpressOffer } from '../src/lib/pricing.ts';
import { milestonesOf, type OrderTimes } from '../src/server/express.ts';

const cfg = withExpressOffer(PRICE_CONFIG, { express: 1990, express_plus: 2990, plusServices: [] });
const base = { service: 'halterwechsel' as const, vehicleType: 'pkw', plateChoice: 'behalten' as const, plateSigns: false, delivery: 'abholung' as const, newCustomer: true };

describe('Express-Bearbeitung', () => {
  it('Aufpreis als eigene Position direkt nach der Servicepauschale, nicht rabattiert', () => {
    const std = calculatePrice(base, cfg);
    const ex = calculatePrice({ ...base, processing: 'express' }, cfg);
    assert.equal(ex.lines[1].key, 'express');
    assert.equal(ex.lines[1].cents, 1990);
    assert.equal(ex.discountCents, std.discountCents, 'Neukundenrabatt nur auf die Servicepauschale');
    assert.equal(ex.totalCents - std.totalCents, 1990);
    assert.equal(ex.lines.reduce((a, l) => a + l.cents, 0), ex.totalCents, 'Summe der Positionen = Gesamtbetrag');
    assert.equal(calculatePrice({ ...base, processing: 'express_plus' }, cfg).totalCents - std.totalCents, 2990);
  });

  it('Komplett-Paket bleibt unverändert, Express kommt zusätzlich dazu', () => {
    const bundle = { ...base, plateChoice: 'wunsch' as const, plateSigns: true, delivery: 'versand' as const, carrier: 'dhl' };
    const std = calculatePrice(bundle, cfg);
    const ex = calculatePrice({ ...bundle, processing: 'express' }, cfg);
    assert.equal(ex.bundleSaving, std.bundleSaving);
    assert.equal(ex.totalCents - std.totalCents, 1990);
  });

  it('Nicht angebotene Stufe wird nie berechnet und bei der Prüfung abgelehnt', () => {
    assert.equal(calculatePrice({ ...base, processing: 'express' }, PRICE_CONFIG).lines.some((l) => l.key === 'express'), false);
    const d = emptyDraft('abmeldung');
    Object.assign(d.vehicle, { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000101', bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin' });
    Object.assign(d.holder, { typ: 'privat', vorname: 'A', nachname: 'B', geburtsdatum: '1980-01-01', strasse: 'Weg', hausnummer: '1', plz: '28195', ort: 'Bremen', email: 'a@example.de', telefon: '0421 123456' });
    Object.assign(d.plate, { zustellung: 'abholung' });
    Object.assign(d.finish, { vollmacht: true, datenschutz: true });
    d.bearbeitung = 'express_plus';
    const off = validateOrder(d, { expressOffer: { express: 1990, express_plus: null, plusServices: [] } });
    assert.equal(off.ok, false);
    assert.match(String(!off.ok && off.errors.bearbeitung), /nicht verfügbar/);
    const on = validateOrder(d, { expressOffer: { express: 1990, express_plus: 2990, plusServices: [] } });
    assert.ok(on.ok && on.order.bearbeitung === 'express_plus');
    assert.equal(validateOrder({ ...d, bearbeitung: 'turbo' }).ok, false);
    assert.equal(processingOf({}), 'standard', 'ältere Aufträge = Standard');
  });

  it('Angebot erst nach Freigabe; Ausgangswerte nicht im Angebot', () => {
    assert.deepEqual([expressOfferOf(EXPRESS_DEFAULT).express, expressOfferOf(EXPRESS_DEFAULT).express_plus], [null, null]);
    const on = { ...EXPRESS_DEFAULT, levels: { ...EXPRESS_DEFAULT.levels, express: { ...EXPRESS_DEFAULT.levels.express, active: true } } };
    assert.equal(expressOfferOf(on).express, 1990);
  });

  it('Werbeaussage: Sternchen an der Aussage, Einschränkung beginnt mit Sternchen, keine Frist- oder Erfolgszusage', () => {
    assert.ok(EXPRESS_HEADLINE.endsWith('*'));
    assert.ok(EXPRESS_FOOTNOTE.startsWith('* '));
    assert.doesNotMatch(EXPRESS_HEADLINE + EXPRESS_FOOTNOTE, /\b24\b|Stunden|garantiert|sofort/i);
    assert.match(EXPRESS_FOOTNOTE, /keinen Einfluss/);
    assert.match(EXPRESS_FOOTNOTE, /nicht zu\.$/);
  });

  it('Meilensteine nur mit tatsächlichen Zeitpunkten; manuelle Behördenprüfung ohne Dauer; Ergebnisarten', () => {
    const t: OrderTimes = {
      eingang: '2026-10-12T08:00:00Z',
      zahlung: '2026-10-12T08:05:00Z',
      unterlagen: null,
      pruefung: null,
      freigabe: null,
      uebertragen: null,
      behoerde: null,
      ergebnis: null,
      result: null,
      manual: false,
    };
    const m = milestonesOf(t);
    assert.deepEqual(
      m.map((x) => x.label),
      ['Auftrag eingegangen', 'Zahlung bestätigt', 'Unterlagen vollständig', 'Express-Prüfung läuft', 'Für Übermittlung freigegeben', 'An Zulassungspartner übertragen', 'Bei Zulassungsbehörde', 'Zulassung erfolgreich / Rückfrage / Abgelehnt'],
    );
    assert.deepEqual(m.filter((x) => x.at).map((x) => x.key), ['eingang', 'zahlung'], 'nichts erfunden');
    const manual = milestonesOf({ ...t, behoerde: '2026-10-13T09:00:00Z', manual: true }).find((x) => x.key === 'behoerde')!;
    assert.match(String(manual.note), /von Hand/);
    assert.doesNotMatch(String(manual.note), /\d+\s*(Tage|Stunden)/);
    assert.equal(milestonesOf({ ...t, ergebnis: 'x', result: 'ok' }).at(-1)!.label, 'Zulassung erfolgreich');
    assert.equal(milestonesOf({ ...t, ergebnis: 'x', result: 'rueckfrage' }).at(-1)!.label, 'Rückfrage der Zulassungsbehörde');
    assert.equal(milestonesOf({ ...t, ergebnis: 'x', result: 'fehler' }).at(-1)!.label, 'Abgelehnt / gescheitert');
  });
});
