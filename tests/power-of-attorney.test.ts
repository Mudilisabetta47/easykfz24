// Digitale Vollmacht: Aufbau nach Partner-Doku, Rücksprung ohne Vertrauen, Abgleich, Idempotenz, Fehlerfälle.
// Gegen den lokalen Testnachbau (scripts/fake-kfz-api.mjs) – es entstehen keine echten Vollmachten.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { emptyDraft, validateOrder, type ValidatedOrder } from '../src/lib/order.ts';
import {
  POA_COST,
  poaNotices,
  sepaOption,
  accountHolderMatches,
  adminState,
  buildPoaRequest,
  customerView,
  CUSTOMER_TEXT,
  parseReturnParams,
  safeRedirectUrl,
  splitHouseNumber,
  splitStreet,
} from '../src/lib/power-of-attorney.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeKfzApi } from '../scripts/fake-kfz-api.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-vollmacht-'));
const fake = createFakeKfzApi() as { server: import('node:http').Server; processes: Map<number, Record<string, unknown>>; mode: Record<string, unknown> };
let base = '';

const poa = await import('../src/server/power-of-attorney.ts');
const pub = await import('../src/server/poa-public.ts');
const orders = await import('../src/server/orders.ts');
const { getDb } = await import('../src/server/db.ts');

function draft(over: Partial<{ hausnummer: string; geburtsort: string; kontoinhaber: string; service: string; typ: string }> = {}) {
  const d = emptyDraft((over.service as 'neuzulassung') ?? 'neuzulassung');
  d.vehicle = { ...d.vehicle, art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000999', bisherigesKennzeichen: '', antrieb: 'benzin' };
  d.holder = {
    ...d.holder,
    typ: (over.typ as 'privat') ?? 'privat',
    vorname: 'Erika',
    nachname: 'Musterfrau',
    geburtsdatum: '1988-03-15',
    geburtsort: over.geburtsort ?? 'Kiel',
    firmenname: over.typ === 'firma' ? 'Beispiel GmbH' : '',
    ansprechpartner: over.typ === 'firma' ? 'Max' : '',
    strasse: 'Große Straße',
    hausnummer: over.hausnummer ?? '1a',
    plz: '24937',
    ort: 'Flensburg',
    email: 'erika@example.de',
    telefon: '0461 123456',
  };
  d.plate = { ...d.plate, wahl: 'neu', zustellung: 'abholung' };
  d.finish = { ...d.finish, evb: 'A1B2C3D', kontoinhaber: over.kontoinhaber ?? 'Erika Musterfrau', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true };
  return d;
}
function validated(over: Parameters<typeof draft>[0] = {}): ValidatedOrder {
  const v = validateOrder(draft(over));
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  return (v as { ok: true; order: ValidatedOrder }).order;
}
const control = async (p: string, body: unknown) => (await fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();
const staff = { name: 'Test', role: 'verwaltung' as const };
const owner = { name: 'Inhaber', role: 'inhaber' as const };
/** Wie im OS: Vorschau holen, Prüfsumme bestätigen, anfordern */
async function request(orderId: number, actor: { name: string; role: 'verwaltung' | 'inhaber' } = staff, sepa = false) {
  const pv = await poa.previewPoa(orderId, actor, { sepa });
  return poa.requestPoa(orderId, actor, { sepa, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
}

before(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  process.env.KFZ_API_BASE_URL = `${base}/fake-api/10/2.3.0`;
  process.env.KFZ_API_LOGIN = 'test';
  process.env.KFZ_API_PASSWORD = 'test';
  process.env.VOLLMACHT_DIGITAL = '1';
});
after(() => fake.server.close());

describe('Aufbau nach Partner-Doku (POST /powerOfAttorneys)', () => {
  it('Pflichtfelder principal, representative, email, vehicles; Hausnummer nur Ziffern + Zusatz; externalOrderId je Versuch', () => {
    const r = buildPoaRequest(validated(), { number: 'EK-2026-00042', attempt: 2, birthPlace: 'Kiel', sendEmail: true, sepa: true });
    assert.ok(r.ok);
    const b = (r as { body: Record<string, any> }).body;
    assert.deepEqual(Object.keys(b).sort(), ['bankAccount', 'email', 'externalOrderId', 'principal', 'representative', 'sendEmail', 'vehicles']);
    assert.deepEqual(b.principal, {
      address: { firstName: 'Erika', lastName: 'Musterfrau', streetName: 'Große Straße', houseNumber: '1', addressSuffix: 'a', zipCode: '24937', cityName: 'Flensburg' },
      dateOfBirth: '1988-03-15',
      placeOfBirth: 'Kiel',
    });
    assert.deepEqual(b.representative, { address: { companyName: 'MONVEX UG (haftungsbeschränkt) i. G.', streetName: 'Kirchbachstraße', houseNumber: '200', zipCode: '28211', cityName: 'Bremen' } });
    assert.deepEqual(b.vehicles, [{ vehicleIdentificationNumber: 'WVWZZZ1KZAW000999' }]);
    assert.equal(b.externalOrderId, 'EK-2026-00042-V2');
    assert.deepEqual(b.bankAccount, { iban: 'DE89370400440532013000', accountHolder: 'Erika Musterfrau' });
    assert.equal(b.redirectUrl, undefined, 'redirectUrl nur auf ausdrücklichen Wunsch');
  });

  it('fehlende Angaben werden benannt statt geraten (Geburtsort, Hausnummernbereich, Firma, Abmeldung)', () => {
    const noPlace = buildPoaRequest(validated({ geburtsort: '' }), { number: 'EK-1', attempt: 1, birthPlace: '', sendEmail: true });
    assert.ok(!noPlace.ok && noPlace.reasons.some((x) => /Geburtsort/.test(x)));
    const range = buildPoaRequest(validated({ hausnummer: '12-14' }), { number: 'EK-1', attempt: 1, birthPlace: 'Kiel', sendEmail: true });
    assert.ok(!range.ok && range.reasons.some((x) => /Hausnummer/.test(x)));
    assert.equal(splitHouseNumber('12 b')?.addressSuffix, 'b');
    assert.deepEqual(splitStreet('Kirchbachstraße 200'), { streetName: 'Kirchbachstraße', houseNumber: '200' });
  });

  it('SEPA-Mandat nur auf ausdrückliche Wahl und nur, wenn der Kontoinhaber zum Vollmachtgeber passt (Regel laut Doku)', () => {
    assert.ok(accountHolderMatches('Musterfrau, Erika', 'Erika', 'Musterfrau'));
    assert.ok(!accountHolderMatches('Erika Musterfrau GmbH', 'Erika', 'Musterfrau'));
    assert.ok(!accountHolderMatches('Max Mustermann', 'Erika', 'Musterfrau'));
    const none = buildPoaRequest(validated(), { number: 'EK-1', attempt: 1, birthPlace: 'Kiel', sendEmail: true });
    assert.ok(none.ok && !none.withSepa && !('bankAccount' in none.body), 'ohne Wahl kein Mandat');
    const other = buildPoaRequest(validated({ kontoinhaber: 'Max Mustermann' }), { number: 'EK-1', attempt: 1, birthPlace: 'Kiel', sendEmail: true, sepa: true });
    assert.ok(!other.ok && other.reasons.some((x) => /SEPA-Mandat gewählt, aber nicht möglich: Kontoinhaber/.test(x)));
    assert.deepEqual(sepaOption(validated()), { available: true, reason: '', ibanMasked: 'DE89 •••• 3000', accountHolder: 'Erika Musterfrau' });
  });

  it('Hinweise vor dem Anlegen: Rechtsverbindlichkeit, SEPA (Kfz-Steuer), Kosten 6,95 € netto / 8,27 € brutto, keine Einreichung', () => {
    assert.deepEqual([POA_COST.netCents, POA_COST.grossCents], [695, 827]);
    const n = poaNotices({ name: 'Erika Musterfrau', fin: 'WVWZZZ1KZAW000999', email: 'erika@example.de', sendEmail: true, withSepa: true, ibanMasked: 'DE89 •••• 3000' }).join(' ');
    for (const re of [/Rechtsverbindlich/, /MONVEX UG \(haftungsbeschränkt\) i\. G\./, /Kfz-Steuer/, /6,95 € netto \(8,27 € brutto\)/, /kein Zulassungsantrag/, /Personalausweis/]) assert.match(n, re);
    assert.match(poaNotices({ name: 'E', fin: 'F', email: 'e@x.de', sendEmail: false, withSepa: false, ibanMasked: '' }).join(' '), /Ohne SEPA-Mandat.*keine E-Mail/s);
  });

  it('redirectUrl nur mit HTTPS und gleichem Origin wie die Dashboard-Adresse', () => {
    const cfg = 'https://easykfz24.de/vollmacht/abschluss';
    assert.equal(safeRedirectUrl(cfg, 'https://easykfz24.de/vollmacht/abschluss'), 'https://easykfz24.de/vollmacht/abschluss');
    assert.equal(safeRedirectUrl(cfg, 'http://easykfz24.de/vollmacht/abschluss'), null);
    assert.equal(safeRedirectUrl(cfg, 'https://evil.example/vollmacht/abschluss'), null);
    assert.equal(safeRedirectUrl(cfg, 'https://user:pw@easykfz24.de/x'), null);
  });
});

describe('Rücksprung: Parameter sind nur ein Hinweis', () => {
  it('nur Ziffern als Vorgangsnummer, bekannte Hinweise; alles andere wird ignoriert', () => {
    assert.deepEqual(parseReturnParams({ powerOfAttorneyId: '4711', status: 'signed' }), { processId: 4711, hint: 'signed' });
    for (const bad of ['', '0', '-1', '4711abc', '1e3', '99999999999999999999', '../4711', "4711' OR 1=1"]) assert.equal(parseReturnParams({ powerOfAttorneyId: bad }).processId, null, bad);
    assert.equal(parseReturnParams({ status: 'approved' }).hint, null);
  });

  it('Anzeige folgt ausschließlich dem bestätigten Stand; „signiert“ ohne readyForApplication ist kein voller Erfolg', () => {
    assert.equal(customerView('signiert', true), 'signed');
    assert.equal(customerView('signiert', false), 'signed_incomplete');
    assert.equal(customerView('offen', false), 'pending');
    assert.equal(customerView(null, false), 'unknown');
    assert.equal(CUSTOMER_TEXT.signed.title, 'Ihre Vollmacht wurde erfolgreich unterschrieben.');
    assert.equal(CUSTOMER_TEXT.pending.title, 'Ihre Unterschrift wird noch verarbeitet.');
    assert.equal(CUSTOMER_TEXT.rejected.title, 'Die Vollmacht wurde nicht unterschrieben.');
    assert.equal(CUSTOMER_TEXT.expired.title, 'Der Unterschriftslink ist abgelaufen.');
    assert.equal(CUSTOMER_TEXT.failed.title, 'Bei der Verarbeitung ist ein Problem aufgetreten.');
    assert.equal(adminState({ status: 'offen', ready: false, sendEmail: true, note: '', createError: '' }), 'link_versendet');
    assert.equal(adminState({ status: 'offen', ready: false, sendEmail: true, note: 'E-Mail nicht versendet', createError: '' }), 'ausstehend');
  });
});

describe('Ablauf gegen den Testnachbau', () => {
  let orderId = 0;
  let number = '';

  it('ohne Freischaltung (VOLLMACHT_DIGITAL) wird nichts angefordert', async () => {
    const v = validateOrder(draft());
    assert.ok(v.ok);
    const created = await orders.createOrder((v as { order: ValidatedOrder }).order, []);
    orderId = created.id;
    number = created.number;
    delete process.env.VOLLMACHT_DIGITAL;
    assert.equal(poa.poaMode(), 'test');
    const r = await request(orderId);
    assert.ok(!r.ok && r.code === 'denied' && /Testmodus/.test(r.error));
    assert.equal(fake.processes.size, 0);
    process.env.VOLLMACHT_DIGITAL = '1';
  });

  it('Anforderung: Vorgang wird angelegt, serverseitig mit dem Auftrag verknüpft, im Verlauf protokolliert', async () => {
    const r = await request(orderId);
    assert.ok(r.ok, JSON.stringify(r));
    if (!r.ok) return;
    assert.equal(r.poa.status, 'offen');
    assert.equal(r.poa.externalOrderId, `${number}-V1`);
    assert.match(r.poa.signatureUrl, /^https:\/\/sign\.example\.test\//);
    assert.equal(r.poa.state, 'link_versendet');
    assert.equal((await poa.poaByProcessId(r.poa.processId!))?.order_id, orderId);
    const ev = await (await getDb()).all<{ type: string; message: string }>("SELECT type, message FROM events WHERE order_id = ? AND type = 'vollmacht'", orderId);
    assert.ok(ev.some((e) => /angefordert/.test(e.message)));
    // erneuter Aufruf: kein zweiter (kostenpflichtiger) Vorgang
    const again = await request(orderId);
    assert.ok(again.ok && again.reused && again.poa.processId === r.poa.processId);
    assert.equal(fake.processes.size, 1);
  });

  it('manipulierter Rücksprung (status=signed) ändert nichts: angezeigt wird der echte Stand „offen“', async () => {
    const rec = (await poa.latestPoa(orderId))!;
    const s = await pub.publicPoaState(parseReturnParams({ powerOfAttorneyId: String(rec.process_id), status: 'signed' }).processId);
    assert.equal(s.view, 'pending');
    assert.equal((await poa.latestPoa(orderId))!.status, 'offen');
  });

  it('Unterschrift: Abgleich über GET bestätigt, Ereignis genau einmal (doppelte Abfragen, Neuladen)', async () => {
    const rec = (await poa.latestPoa(orderId))!;
    await control('/__test/set', { id: rec.process_id, status: 'signiert', ready: true });
    const v1 = await poa.verifyPoa(rec.id, { force: true });
    assert.ok(v1.ok && v1.changed && v1.poa.state === 'unterschrieben');
    const v2 = await poa.verifyPoa(rec.id, { force: true });
    assert.ok(v2.ok && !v2.changed, 'gleicher Stand → keine zweite Meldung');
    const v3 = await poa.verifyPoa(rec.id);
    assert.ok(v3.ok && !v3.fresh, 'gedrosselt: kein erneuter Partneraufruf beim Neuladen');
    const signedEvents = await (await getDb()).all<{ message: string }>("SELECT message FROM events WHERE order_id = ? AND type = 'vollmacht' AND message LIKE '%Vollmacht unterschrieben%'", orderId);
    assert.equal(signedEvents.length, 1);
    const osEv = await (await getDb()).all<{ dedupe_key: string }>("SELECT dedupe_key FROM os_events WHERE type = 'order.poa' AND order_id = ?", orderId);
    assert.equal(osEv.filter((e) => e.dedupe_key.endsWith(':signiert:1')).length, 1);
    const s = await pub.publicPoaState(rec.process_id);
    assert.equal(s.view, 'signed');
    // Auftragsstatus und Zahlung bleiben unberührt
    const o = await orders.getOrder(orderId);
    assert.equal(o?.status, 'neu');
    assert.equal(o?.payment_status, 'offen');
  });

  it('Kunde sieht den bestätigten Stand in der Statusabfrage (nur mit Auftragsnummer + E-Mail)', async () => {
    const st = await orders.lookupStatus(number, 'erika@example.de');
    assert.equal(st?.vollmacht?.view, 'signed');
    assert.equal(st?.vollmacht?.signatureUrl, '', 'kein Link mehr nach der Unterschrift');
    assert.equal(await orders.lookupStatus(number, 'fremd@example.de'), null);
  });

  it('fremde oder unbekannte Vorgangsnummer: keine Daten, neutraler Hinweis', async () => {
    for (const id of [null, 1, 999999]) {
      const s = await pub.publicPoaState(id);
      assert.deepEqual([s.view, s.known], ['unknown', false]);
    }
  });

  it('Partner offline: Stand bleibt beim zuletzt bestätigten, Fehler wird protokolliert, kein Erfolg erfunden', async () => {
    const d2 = await orders.createOrder(validated(), []);
    const r = await request(d2.id);
    assert.ok(r.ok);
    await control('/__test/mode', { offline: true });
    const rec = (await poa.latestPoa(d2.id))!;
    const v = await poa.verifyPoa(rec.id, { force: true });
    assert.ok(!v.ok);
    const after = (await poa.latestPoa(d2.id))!;
    assert.equal(after.status, 'offen');
    assert.match(after.check_error, /nicht erreichbar|Zeitüberschreitung/);
    const s = await pub.publicPoaState(rec.process_id);
    assert.equal(s.view, 'pending');
    await control('/__test/mode', { offline: false });
  });

  it('Antwort geht verloren: erneute Anforderung liefert denselben Vorgang (externalOrderId), kein Doppelvorgang', async () => {
    const d3 = await orders.createOrder(validated(), []);
    await control('/__test/mode', { dropNextPostResponse: true });
    const lost = await request(d3.id);
    assert.ok(!lost.ok);
    const before = fake.processes.size;
    const retry = await request(d3.id);
    assert.ok(retry.ok, JSON.stringify(retry));
    assert.equal(fake.processes.size, before, 'Partner hat keinen zweiten Vorgang angelegt');
    assert.equal(retry.ok && retry.poa.attempt, 1);
  });

  it('Abgelaufen: Kunde sieht den Hinweis; neuer Vorgang mit neuem Versuch (V2) möglich', async () => {
    const d4 = await orders.createOrder(validated(), []);
    const r = await request(d4.id);
    assert.ok(r.ok);
    const rec = (await poa.latestPoa(d4.id))!;
    await control('/__test/set', { id: rec.process_id, status: 'verfallen' });
    await poa.verifyPoa(rec.id, { force: true });
    assert.equal((await pub.publicPoaState(rec.process_id)).view, 'expired');
    const next = await request(d4.id);
    assert.ok(next.ok && !next.reused && next.poa.attempt === 2 && next.poa.externalOrderId.endsWith('-V2'));
    assert.equal((await poa.listPoas(d4.id)).length, 2);
  });

  it('Partner gestört beim Anlegen (502): Vorgang als fehlgeschlagen verknüpft, Fehler sichtbar', async () => {
    const d5 = await orders.createOrder(validated(), []);
    await control('/__test/mode', { failNextPost: 502 });
    const r = await request(d5.id);
    assert.ok(!r.ok);
    const rec = (await poa.latestPoa(d5.id))!;
    assert.equal(rec.status, 'fehlgeschlagen');
    assert.match(rec.create_error, /^502/);
    assert.equal(poa.viewOf(rec).state, 'fehler');
  });

  it('Unterschrieben, aber unvollständig (Reisepass ohne Anschrift): kein voller Erfolg', async () => {
    const d6 = await orders.createOrder(validated(), []);
    const r = await request(d6.id);
    assert.ok(r.ok);
    const rec = (await poa.latestPoa(d6.id))!;
    await control('/__test/set', { id: rec.process_id, status: 'signiert', ready: false, missing: ['Straße', 'Hausnummer', 'Postleitzahl', 'Ort'] });
    const v = await poa.verifyPoa(rec.id, { force: true });
    assert.ok(v.ok && v.poa.state === 'unvollstaendig' && v.poa.missingFields.length === 4);
    assert.equal((await pub.publicPoaState(rec.process_id)).view, 'signed_incomplete');
  });

  it('Abgleich-Automatik findet offene Vorgänge (höchstens alle 10 Minuten je Vorgang)', async () => {
    const due = await poa.poasDue(50);
    assert.ok(due.every((d) => d.process_id > 0));
  });
});

describe('Bestätigung, Testmodus und Doppelklick', () => {
  it('ohne bestätigte Vorschau (Prüfsumme) wird nichts angelegt', async () => {
    const d = await orders.createOrder(validated(), []);
    const before = fake.processes.size;
    const r = await poa.requestPoa(d.id, staff, { sepa: false, fingerprint: '' });
    assert.ok(!r.ok && r.code === 'changed');
    assert.equal(fake.processes.size, before);
    assert.equal(await poa.latestPoa(d.id), null, 'kein Datensatz');
  });

  it('Prüfsumme gilt nur für den bestätigten Stand: SEPA nachträglich umgeschaltet → abgewiesen', async () => {
    const d = await orders.createOrder(validated(), []);
    const pv = await poa.previewPoa(d.id, staff, { sepa: false });
    assert.ok(pv.ok && pv.preview.fingerprint.length === 64 && !pv.preview.sepa.chosen && pv.preview.sepa.available);
    const r = await poa.requestPoa(d.id, staff, { sepa: true, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(!r.ok && r.code === 'changed');
  });

  it('Vorschau zeigt Angaben, Kosten und Hinweise und ruft den Partner nicht auf', async () => {
    const d = await orders.createOrder(validated(), []);
    const before = fake.processes.size;
    const pv = await poa.previewPoa(d.id, staff, { sepa: true });
    assert.ok(pv.ok);
    if (!pv.ok) return;
    assert.equal(fake.processes.size, before);
    const labels = pv.preview.details.map((x) => x.label);
    for (const l of ['Vollmachtgeber', 'Geburtsdatum', 'Geburtsort', 'Anschrift', 'E-Mail', 'Fahrzeug (FIN)', 'Bevollmächtigter']) assert.ok(labels.includes(l), l);
    assert.equal(pv.preview.details.find((x) => x.label === 'Geburtsdatum')?.value, '15.03.1988');
    assert.deepEqual([pv.preview.costs.netCents, pv.preview.costs.grossCents], [695, 827]);
    assert.ok(pv.preview.sepa.chosen && /Kfz-Steuer/.test(pv.preview.notices.join(' ')));
  });

  it('SEPA-Mandat geht nur nach ausdrücklicher Wahl an den Partner', async () => {
    const a = await orders.createOrder(validated(), []);
    const b = await orders.createOrder(validated(), []);
    const ra = await request(a.id, staff, false);
    const rb = await request(b.id, staff, true);
    assert.ok(ra.ok && rb.ok);
    const body = (id: number | null) => (fake.processes.get(id!) as { _body: Record<string, unknown> })._body;
    assert.equal(body(ra.ok ? ra.poa.processId : null).bankAccount, undefined);
    assert.deepEqual(body(rb.ok ? rb.poa.processId : null).bankAccount, { iban: 'DE89370400440532013000', accountHolder: 'Erika Musterfrau' });
    assert.ok(rb.ok && rb.poa.withSepa);
  });

  it('Doppelklick: zwei gleichzeitige Anforderungen ergeben genau einen Vorgang', async () => {
    const d = await orders.createOrder(validated(), []);
    const pv = await poa.previewPoa(d.id, staff, { sepa: false });
    assert.ok(pv.ok);
    const fp = pv.ok ? pv.preview.fingerprint : '';
    const before = fake.processes.size;
    const [x, y] = await Promise.all([poa.requestPoa(d.id, staff, { sepa: false, fingerprint: fp }), poa.requestPoa(d.id, staff, { sepa: false, fingerprint: fp })]);
    assert.ok(x.ok || y.ok);
    assert.equal(fake.processes.size, before + 1, 'genau ein Vorgang beim Partner');
    assert.equal((await poa.listPoas(d.id)).length, 1);
    for (const r of [x, y]) if (!r.ok) assert.equal(r.code, 'busy');
  });

  it('Testmodus: nur Inhaber, nur der freigegebene Auftrag, genau ein Versuch, befristet', async () => {
    delete process.env.VOLLMACHT_DIGITAL;
    try {
      assert.equal(poa.poaMode(), 'test');
      const mine = await orders.createOrder(validated(), []);
      const other = await orders.createOrder(validated(), []);
      const before = fake.processes.size;
      // ohne Freigabe: niemand
      assert.ok(!(await request(mine.id, owner)).ok);
      assert.ok(!(await poa.previewPoa(mine.id, owner, { sepa: false })).ok, 'auch keine Vorschau ohne Freigabe');
      // Freigabe nur durch den Inhaber
      const byStaff = await poa.setTestRelease(mine.id, true, staff);
      assert.ok(!byStaff.ok && /Inhaber/.test(byStaff.error));
      const g = await poa.setTestRelease(mine.id, true, owner);
      assert.ok(g.ok && g.release?.attempt === null);
      assert.ok(g.ok && Date.parse(g.release!.expiresAt) - Date.now() > 23 * 3_600_000);
      // Mitarbeiter und fremder Auftrag bleiben gesperrt
      const s1 = await request(mine.id, staff);
      assert.ok(!s1.ok && s1.code === 'denied');
      const o1 = await request(other.id, owner);
      assert.ok(!o1.ok && /keine Testfreigabe/.test(o1.error));
      assert.equal(fake.processes.size, before, 'nichts beim Partner angelegt');
      // genau ein echter Vorgang
      const r = await request(mine.id, owner);
      assert.ok(r.ok && !r.reused, JSON.stringify(r));
      assert.equal(fake.processes.size, before + 1);
      assert.equal((await poa.getTestRelease())?.attempt, 1, 'Freigabe an Versuch 1 gebunden');
      // erneut: derselbe Vorgang, keine Kosten
      const again = await request(mine.id, owner);
      assert.ok(again.ok && again.reused);
      // nach Ablauf des Vorgangs kein zweiter kostenpflichtiger Versuch ohne neue Freigabe
      const rec = (await poa.latestPoa(mine.id))!;
      await control('/__test/set', { id: rec.process_id, status: 'verfallen' });
      await poa.verifyPoa(rec.id, { force: true });
      const v2 = await request(mine.id, owner);
      assert.ok(!v2.ok && /verbraucht/.test(v2.error));
      assert.equal(fake.processes.size, before + 1);
      // abgelaufene Freigabe
      await poa.setTestRelease(mine.id, true, owner);
      await (await getDb()).run("UPDATE settings SET value = json_set(value, '$.expiresAt', '2000-01-01T00:00:00.000Z') WHERE key = 'vollmacht_testfreigabe'");
      const exp = await request(mine.id, owner);
      assert.ok(!exp.ok && /abgelaufen/.test(exp.error));
      // zurückziehen
      const off = await poa.setTestRelease(mine.id, false, owner);
      assert.ok(off.ok && off.release === null);
      assert.equal(await poa.getTestRelease(), null);
      const ev = await (await getDb()).all<{ message: string }>("SELECT message FROM events WHERE order_id = ? AND type = 'vollmacht'", mine.id);
      assert.ok(ev.some((e) => /Testfreigabe .*erteilt/.test(e.message)) && ev.some((e) => /zurückgezogen/.test(e.message)));
    } finally {
      process.env.VOLLMACHT_DIGITAL = '1';
    }
  });

  it('im aktiven Betrieb ist keine Testfreigabe möglich (und nötig)', async () => {
    const d = await orders.createOrder(validated(), []);
    const g = await poa.setTestRelease(d.id, true, owner);
    assert.ok(!g.ok && /bereits für alle Aufträge/.test(g.error));
  });

  it('Zeitsteuerung (Cron): nur der Vollmacht-Abgleich läuft, unabhängig von der Drossel der Oberfläche', async () => {
    const { runScheduledRules } = await import('../src/server/os/automation.ts');
    const r = await runScheduledRules(true, ['vollmacht_abgleich']);
    assert.ok(r.ran);
    const rules = await (await getDb()).all<{ rule_id: string }>('SELECT DISTINCT rule_id FROM automation_runs');
    assert.deepEqual(
      rules.map((x) => x.rule_id).filter((x) => x !== 'vollmacht_abgleich'),
      [],
    );
  });
});
