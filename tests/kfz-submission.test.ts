// Automatische Übermittlung an kfz-api.de, Phase 1 Außerbetriebsetzung: Antragsaufbau nach spec/api.yaml 2.3.0,
// verschlüsselte Sicherheitscodes, Freigabe, Doppelschutz, verlorene Antworten, Konflikte, Webhook-Zuordnung (attemptOf).
// Nur synthetische Daten gegen den lokalen Testnachbau (scripts/fake-kfz-api.mjs) – keine echten Anträge, keine Kosten.

import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { displayFor, signKfzBody } from '../src/lib/kfz-api.ts';
import { AB_COST, buildAbRequest, checkAbCodes, defaultPlates, plateComponents } from '../src/lib/kfz-deregistration.ts';
import { emptyDraft, validateOrder, type OrderInput, type ValidatedOrder } from '../src/lib/order.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeKfzApi } from '../scripts/fake-kfz-api.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-uebermittlung-'));
process.env.KFZ_API_WEBHOOK_SECRET = 'uebermittlung-test-secret';
delete process.env.VOLLMACHT_DIGITAL;
delete process.env.VOLLMACHT_TESTMODUS;
delete process.env.KFZ_VERTRAGSPARTNER;
delete process.env.KFZ_UEBERMITTLUNG_EMAIL;
const fake = createFakeKfzApi() as {
  server: import('node:http').Server;
  mode: Record<string, unknown>;
  abOrders: Map<number, Record<string, unknown> & { _body: Record<string, any>; externalId: string; _at: number }>;
};
let base = '';

const orders = await import('../src/server/orders.ts');
const oa = await import('../src/server/os/order-actions.ts');
const kfz = await import('../src/server/kfz-api.ts');
const sub = await import('../src/server/kfz-submission.ts');
const box = await import('../src/server/secret-box.ts');
const { getDb } = await import('../src/server/db.ts');

const KEY = randomBytes(32).toString('base64');
const owner = { id: 0, name: 'Inhaber', role: 'inhaber' as const };
const staff = { id: 7, name: 'Sachbearbeitung', role: 'verwaltung' as const };
// Synthetische Codes mit Groß-/Kleinschreibung (gehört zum Wert)
const CODES = { zb1: 'Qx7Zp4K', rear: 'Vbg', front: 'K7m', plates: 2 };
const control = async (p: string, body: unknown) => (await fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();

let finSeq = 100;
function draft(over: { art?: string; plate?: string; eKennzeichen?: boolean; antrieb?: string } = {}): OrderInput {
  const d = emptyDraft('abmeldung');
  d.vehicle = {
    ...d.vehicle,
    art: (over.art as 'pkw') ?? 'pkw',
    hersteller: 'VW',
    modell: 'Golf',
    fin: `WVWZZZ1KZAW${String(700000 + finSeq++)}`,
    bisherigesKennzeichen: over.plate ?? 'HB-EK 12',
    antrieb: (over.antrieb as 'benzin') ?? 'benzin',
    eKennzeichen: over.eKennzeichen ?? false,
  };
  d.holder = {
    ...d.holder,
    typ: 'privat',
    vorname: 'Erika',
    nachname: 'Synthetisch',
    geburtsdatum: '1988-03-15',
    geburtsort: 'Kiel',
    strasse: 'Testweg',
    hausnummer: '1',
    plz: '28195',
    ort: 'Bremen',
    email: 'synthetisch@example.de',
    telefon: '0421 123456',
  };
  d.plate = { ...d.plate, wahl: '', zustellung: 'abholung' };
  d.finish = { ...d.finish, vollmacht: true, datenschutz: true };
  return d;
}
function validated(over: Parameters<typeof draft>[0] = {}): ValidatedOrder {
  const v = validateOrder(draft(over));
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  const o = (v as { ok: true; order: ValidatedOrder }).order;
  o.finish.vorzeitigerBeginnAt = new Date().toISOString();
  return o;
}
/** In Prüfung, Checkliste vollständig, bezahlt, Codes bestätigt – dann interne Freigabe wie im OS */
async function released(over: Parameters<typeof draft>[0] = {}) {
  const d = await orders.createOrder(validated(over), []);
  const o = (await orders.getOrder(d.id))!;
  const checklist = Object.fromEntries(o.checklistItems.map((i) => [i.key, { checked: true, at: new Date().toISOString() }]));
  await (
    await getDb()
  ).run(
    "UPDATE orders SET status = 'in_pruefung', payment_status = 'bezahlt', checklist_json = ?, reg_checks_json = ? WHERE id = ?",
    JSON.stringify(checklist),
    JSON.stringify({ code_zb1: true, code_plaketten: true }),
    d.id,
  );
  const r = await oa.actRelease(d.id, true, owner);
  assert.ok(r.ok, JSON.stringify(r));
  return d;
}
async function withCodes(id: number, codes: Record<string, unknown> = CODES) {
  const r = await sub.saveCodes(id, codes, staff);
  assert.ok(r.ok, JSON.stringify(r));
}
async function send(id: number, actor: { name: string; role: 'verwaltung' | 'inhaber' } = staff, reservePlate = false) {
  const pv = await sub.previewSubmission(id, actor, { reservePlate });
  return sub.submitDeregistration(id, actor, { reservePlate, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
}
const fakeFor = (ext: string) => [...fake.abOrders.values()].filter((o) => o.externalId === ext);
const row = async (id: number) =>
  (await getDb()).first<{ status: string; kfz_order_id: string; kfz_display: string }>('SELECT status, kfz_order_id, kfz_display FROM orders WHERE id = ?', id);
const webhook = async (body: Record<string, unknown>, eventId: string) => {
  const raw = JSON.stringify(body);
  const r = await kfz.handleKfzWebhook(raw, new Headers({ 'X-Signature': signKfzBody(raw, 'uebermittlung-test-secret'), 'X-Event-Id': eventId }));
  await r.after?.();
  return r.result;
};
/** Gesamte Datenbank als Text – die Codes dürfen nirgends im Klartext stehen */
async function dbText(): Promise<string> {
  const db = await getDb();
  const tables = await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'");
  let out = '';
  for (const t of tables) out += JSON.stringify(await db.all(`SELECT * FROM "${t.name}"`));
  return out;
}

before(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  process.env.KFZ_API_BASE_URL = `${base}/fake-api/10/2.3.0`;
  process.env.KFZ_API_LOGIN = 'test';
  process.env.KFZ_API_PASSWORD = 'test';
});
after(() => fake.server.close());
beforeEach(() => {
  process.env.KFZ_CODES_KEY = KEY;
  process.env.KFZ_UEBERMITTLUNG = 'aktiv';
  process.env.KFZ_VERTRAGSPARTNER = 'U871450';
  Object.assign(fake.mode, { offline: false, dropNextAbResponse: false, failNextAb: 0, abDelayMs: 0 });
});

describe('Antragsaufbau nach spec/api.yaml 2.3.0 (VehicleDeregistrationRequest)', () => {
  it('nur dokumentierte Felder, Pflichtfelder gesetzt, Codes unverändert (Groß-/Kleinschreibung bleibt)', () => {
    const r = buildAbRequest(
      validated(),
      { zb1: 'Qx7Zp4K', rear: 'Vbg', front: 'K7m' },
      { externalOrderId: 'EK-2026-00042-AB1', email: 'kundenservice@easykfz24.de', reservePlate: false },
    );
    assert.ok(r.ok);
    const b = (r as { body: Record<string, any> }).body;
    assert.deepEqual(Object.keys(b).sort(), ['customization', 'email', 'externalOrderId']);
    assert.deepEqual(Object.keys(b.customization).sort(), [
      'frontLicensePlateSecurityCode',
      'licensePlateNumberComponents',
      'licensePlateReservationIncluded',
      'productType',
      'rearLicensePlateSecurityCode',
      'vehicleIdentificationNumber',
      'vehicleRegistrationCertificateSecurityCode',
    ]);
    assert.deepEqual(b.customization.licensePlateNumberComponents, { usageType: 'EURO', city: 'HB', middle: 'EK', end: '12' });
    assert.equal(b.customization.vehicleRegistrationCertificateSecurityCode, 'Qx7Zp4K');
    assert.equal(b.customization.productType, 'VEHICLE_DEREGISTRATION');
    assert.equal(b.customization.licensePlateReservationIncluded, false);
    assert.equal('contractPartner' in b.customization, false, 'ohne hinterlegte Nummer nicht gesendet');
    assert.equal('vehicleHolder' in b, false, 'Halterdaten gehen laut Spezifikation nicht an das KBA – nicht senden');
  });

  it('ein Kennzeichenschild: kein Code vorne (laut Spezifikation unzulässig); E-Kennzeichen → ELECTRIC; Vertragspartner geprüft', () => {
    const one = buildAbRequest(
      validated({ art: 'motorrad' }),
      { zb1: 'Qx7Zp4K', rear: 'Vbg', front: null },
      { externalOrderId: 'X-AB1', email: 'a@b.de', reservePlate: true, contractPartner: 'u871450' },
    );
    assert.ok(one.ok);
    const c = (one as { body: Record<string, any> }).body.customization;
    assert.equal('frontLicensePlateSecurityCode' in c, false);
    assert.equal(c.contractPartner, 'U871450');
    assert.equal(c.licensePlateReservationIncluded, true);
    assert.deepEqual(plateComponents('M-AB 12E', { eKennzeichen: true, hKennzeichen: false }), { usageType: 'ELECTRIC', city: 'M', middle: 'AB', end: '12' });
    assert.equal(plateComponents('M-AB 12', { eKennzeichen: true, hKennzeichen: false }), null, 'E-Fahrzeug ohne E am Schild: nicht raten');
    const bad = buildAbRequest(
      validated(),
      { zb1: 'Qx7Zp4K', rear: 'Vbg', front: 'K7m' },
      { externalOrderId: 'X', email: 'a@b.de', reservePlate: false, contractPartner: 'X123' },
    );
    assert.ok(!bad.ok && bad.reasons.some((x) => /Vertragspartnernummer/.test(x)));
    assert.equal(defaultPlates('motorrad'), 1);
    assert.equal(defaultPlates('pkw'), 2);
  });

  it('Codes nur in der dokumentierten Form: ZB I genau 7, Plaketten genau 3 Zeichen, Anzahl der Schilder ausdrücklich', () => {
    assert.ok(checkAbCodes(CODES).ok);
    const r = checkAbCodes({ zb1: '12345', rear: 'ab', front: '', plates: 2 });
    assert.ok(!r.ok);
    assert.deepEqual(r.problems.map((p) => p.field).sort(), ['front', 'rear', 'zb1']);
    assert.ok(!checkAbCodes({ ...CODES, plates: undefined }).ok, 'Schilderzahl muss angegeben sein');
    assert.ok(!checkAbCodes({ ...CODES, plates: 1 }).ok, 'ein Schild, aber Code vorne');
    assert.ok(!checkAbCodes({ ...CODES, zb1: 'Qx7Zp4!' }).ok);
  });

  it('Kosten laut Preisliste (Stand 29.09.2026): 2,00 € Leistung + 19 % USt, amtliche Gebühren ohne USt, abgewiesen 0,10 € netto', () => {
    assert.equal(AB_COST.serviceNetCents + AB_COST.officialFromCents, AB_COST.fromNetCents);
    assert.equal(AB_COST.fromNetCents, 635);
    assert.equal(AB_COST.fromGrossCents, 673, 'USt nur auf die Leistung des Partners');
    assert.equal(AB_COST.rejectedGrossCents, 12);
  });

  it('Statuswerte laut Webhooks 3.1.0: korrigierbare Ablehnung → Angaben erforderlich, ERROR_UNHANDLED → fehlgeschlagen', () => {
    assert.equal(displayFor('FAILED', 'LICENSE_PLATE_CODE_INVALID', false), 'angaben_erforderlich');
    assert.equal(displayFor('FAILED', 'ERROR_UNHANDLED', false), 'fehlgeschlagen');
    assert.equal(displayFor('FAILED', 'VEHICLE_ALREADY_DEREGISTERED', null), 'fehlgeschlagen');
    assert.equal(displayFor('PROCESSED', 'PENDING', null), 'in_bearbeitung');
    assert.equal(displayFor('UNKNOWN', null, null), null);
    assert.equal(displayFor('beschieden', 'SUCCESS', null), 'abgeschlossen', 'Vorgangsauskunft: state deutsch, derivedStatus entscheidet');
  });
});

describe('Sicherheitscodes: nur verschlüsselt, nie zurück, kurzlebig', () => {
  it('AES-256-GCM: Geheimtext an Auftrag gebunden; ohne bzw. mit anderem Schlüssel nicht lesbar', async () => {
    const s = await box.seal('geheim', 'order:1:ab_codes');
    assert.equal(await box.open(s, 'order:1:ab_codes'), 'geheim');
    assert.equal(await box.open(s, 'order:2:ab_codes'), null, 'in andere Zeile kopiert');
    process.env.KFZ_CODES_KEY = randomBytes(32).toString('base64');
    assert.equal(await box.open(s, 'order:1:ab_codes'), null);
    process.env.KFZ_CODES_KEY = 'zu-kurz';
    assert.equal(box.secretBoxConfigured(), false);
  });

  it('Betriebsart AUS ohne Schalter oder ohne Schlüssel: keine Erfassung, keine Übermittlung', async () => {
    const d = await released();
    delete process.env.KFZ_UEBERMITTLUNG;
    assert.equal(sub.submitMode(), 'aus');
    assert.ok(!(await sub.saveCodes(d.id, CODES, staff)).ok);
    process.env.KFZ_UEBERMITTLUNG = 'aktiv';
    delete process.env.KFZ_CODES_KEY;
    assert.equal(sub.submitMode(), 'aus');
    const r = await sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: 'x' });
    assert.ok(!r.ok && /KFZ_CODES_KEY/.test(r.error));
  });

  it('Werte stehen nirgends im Klartext (Datenbank, Verlauf, Status) und kommen nie zurück; nach Annahme gelöscht', async () => {
    const d = await released();
    await withCodes(d.id);
    const st = await sub.codesStatus(d.id);
    assert.deepEqual({ present: st.present, plates: st.plates, readable: st.readable }, { present: true, plates: 2, readable: true });
    assert.ok(!JSON.stringify(st).includes(CODES.zb1));
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(pv.ok);
    assert.ok(!JSON.stringify(pv).includes(CODES.zb1) && !JSON.stringify(pv).includes('"Vbg"'), 'Vorschau ohne Codes');
    let all = await dbText();
    assert.ok(!all.includes(CODES.zb1), 'ZB-I-Code nicht im Klartext gespeichert');
    const r = await sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(r.ok, JSON.stringify(r));
    // Beim Partner kommen die echten Werte an …
    assert.equal(fakeFor(r.submission.externalOrderId)[0]._body.customization.vehicleRegistrationCertificateSecurityCode, CODES.zb1);
    // … bei uns stehen sie nirgends, auch nicht im gespeicherten Rumpf; der Geheimtext ist gelöscht
    all = await dbText();
    assert.ok(!all.includes(CODES.zb1) && !all.includes('"K7m"') && !all.includes('"Vbg"'));
    assert.equal((await sub.codesStatus(d.id)).present, false);
    const sec = await (
      await getDb()
    ).first<{ ciphertext: string; delete_reason: string }>('SELECT ciphertext, delete_reason FROM order_secrets WHERE order_id = ?', d.id);
    assert.deepEqual({ ...sec }, { ciphertext: '', delete_reason: 'uebermittelt' });
  });

  it('ungeklärte Übermittlung: Codes bleiben über 30 Tage hinaus erhalten (nicht löschbar, nicht änderbar) – erst nach 90 Tagen gelöscht', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.failNextAb = 500;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'ungewiss');
    const db = await getDb();
    const old = new Date(Date.now() - 40 * 86_400_000).toISOString();
    await db.run(
      "UPDATE order_secrets SET created_at = ?, expires_at = ? WHERE order_id = ? AND deleted_at = ''",
      old,
      new Date(Date.now() - 10 * 86_400_000).toISOString(),
      d.id,
    );
    await sub.purgeSecrets();
    assert.equal((await sub.codesStatus(d.id)).present, true, 'nach 30 Tagen noch vorhanden, weil ungeklärt');
    assert.ok(!(await sub.deleteCodes(d.id, staff)).ok, 'nicht manuell löschbar');
    assert.ok(!(await sub.saveCodes(d.id, CODES, staff)).ok, 'nicht änderbar');
    // Klärung „nicht angelegt“ → Wiederholung mit denselben Codes und derselben Referenz möglich
    await db.run("UPDATE kfz_submissions SET sent_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ?", d.id);
    const c = await sub.clarifySubmission(d.id, staff);
    assert.ok(c.ok && c.submission.state === 'nicht_angelegt');
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(pv.ok && pv.preview.retrySame, JSON.stringify(pv));
    // Höchstfrist: bleibt es ungeklärt, wird nach 90 Tagen trotzdem gelöscht und im Verlauf vermerkt
    const d2 = await released();
    await withCodes(d2.id);
    fake.mode.dropNextAbResponse = true;
    assert.ok(!(await send(d2.id)).ok);
    await db.run(
      "UPDATE order_secrets SET created_at = ?, expires_at = ? WHERE order_id = ? AND deleted_at = ''",
      new Date(Date.now() - 91 * 86_400_000).toISOString(),
      old,
      d2.id,
    );
    await sub.purgeSecrets();
    assert.equal((await sub.codesStatus(d2.id)).present, false);
    const ev = await db.all<{ message: string }>('SELECT message FROM events WHERE order_id = ?', d2.id);
    assert.ok(ev.some((e) => /Höchstfrist/.test(e.message)));
  });

  it('Storno und Anonymisierung löschen die Codes sofort', async () => {
    const d = await released();
    await withCodes(d.id);
    assert.ok((await oa.actStatus(d.id, 'storniert', '', 'Test', { id: null, name: 'Test' })).ok);
    const sec = await (
      await getDb()
    ).first<{ ciphertext: string; delete_reason: string }>('SELECT ciphertext, delete_reason FROM order_secrets WHERE order_id = ?', d.id);
    assert.deepEqual({ ...sec }, { ciphertext: '', delete_reason: 'storniert' });

    const customers = await import('../src/server/os/customers.ts');
    const e = await released();
    await withCodes(e.id);
    const link = await customers.linkOrderToCustomer(e.id);
    assert.ok(link);
    await (await getDb()).run("UPDATE orders SET status = 'abgeschlossen' WHERE id = ?", e.id);
    const an = await customers.anonymizeCustomer(link!.customerId, 'Test');
    assert.ok(an.ok, JSON.stringify(an));
    assert.equal((await sub.codesStatus(e.id)).present, false);
  });

  it('Frist und Storno: zeitgesteuert gelöscht; nach Schlüsselwechsel nicht mehr verwendbar', async () => {
    const d = await released();
    await withCodes(d.id);
    await (await getDb()).run("UPDATE order_secrets SET expires_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ? AND deleted_at = ''", d.id);
    assert.ok((await sub.purgeSecrets()) >= 1);
    assert.equal((await sub.codesStatus(d.id)).present, false);
    await withCodes(d.id);
    process.env.KFZ_CODES_KEY = randomBytes(32).toString('base64');
    assert.equal((await sub.codesStatus(d.id)).readable, false);
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /anderen Schlüssel/.test(pv.error));
  });
});

describe('Freigabe und Sperren vor jedem kostenpflichtigen Antrag', () => {
  it('ohne Vertragspartnernummer wird nichts gesendet (ohne eigenen KoPa-Schlüssel Pflicht); mit Nummer geht sie im Rumpf mit', async () => {
    const d = await released();
    await withCodes(d.id);
    delete process.env.KFZ_VERTRAGSPARTNER;
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /Vertragspartnernummer/.test(pv.error));
    process.env.KFZ_VERTRAGSPARTNER = 'U871450';
    const r = await send(d.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(fakeFor(r.submission.externalOrderId)[0]._body.customization.contractPartner, 'U871450');
  });

  it('ohne interne Freigabe, ohne Zahlung, als Testauftrag, für andere Leistungen oder manuell verknüpft: gesperrt', async () => {
    const d = await orders.createOrder(validated(), []);
    await (await getDb()).run("UPDATE orders SET status = 'in_pruefung', payment_status = 'bezahlt' WHERE id = ?", d.id);
    await withCodes(d.id);
    let pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /Freigabe/.test(pv.error));

    const unpaid = await released();
    await withCodes(unpaid.id);
    await (await getDb()).run("UPDATE orders SET payment_status = 'offen' WHERE id = ?", unpaid.id);
    pv = await sub.previewSubmission(unpaid.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /Zahlung/.test(pv.error));

    // Testauftrag des Inhabers (TEST-…, is_test = 1) – wird nie übermittelt, auch nicht mit gesetzter Freigabe
    const t = await released();
    await (await getDb()).run('UPDATE orders SET is_test = 1 WHERE id = ?', t.id);
    assert.ok(!(await sub.saveCodes(t.id, CODES, owner)).ok, 'Testauftrag: keine Codes');
    pv = await sub.previewSubmission(t.id, owner, { reservePlate: false });
    assert.ok(!pv.ok && /Testauftrag/.test(pv.error));
    assert.ok(!(await sub.setSubmitTestRelease(t.id, true, owner)).ok);

    const manual = await released();
    await withCodes(manual.id);
    assert.ok((await kfz.linkKfzOrder(manual.id, '555')).ok, 'manueller Weg bleibt nutzbar');
    pv = await sub.previewSubmission(manual.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /manuell/.test(pv.error));
  });

  it('ohne bestätigte bzw. mit veralteter Prüfsumme wird nichts gesendet', async () => {
    const d = await released();
    await withCodes(d.id);
    const before = fake.abOrders.size;
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(pv.ok);
    let r = await sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: '' });
    assert.ok(!r.ok && r.code === 'changed');
    // Reservierung geändert → anderer Rumpf → alte Bestätigung gilt nicht
    r = await sub.submitDeregistration(d.id, staff, { reservePlate: true, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(!r.ok && r.code === 'changed');
    // Codes neu erfasst → alte Bestätigung gilt nicht
    await withCodes(d.id, { ...CODES, rear: 'Xy1' });
    r = await sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(!r.ok && r.code === 'changed');
    assert.equal(fake.abOrders.size, before, 'nichts beim Partner angelegt');
  });

  it('Testmodus: nur der Inhaber, nur mit Testfreigabe genau dieses Auftrags; Freigabe gilt für genau eine Übermittlung', async () => {
    process.env.KFZ_UEBERMITTLUNG = 'test';
    const d = await released();
    await withCodes(d.id);
    let r = await send(d.id, staff);
    assert.ok(!r.ok && /Inhaber/.test(r.error));
    r = await send(d.id, owner);
    assert.ok(!r.ok && /Testfreigabe/.test(r.error));
    assert.ok(!(await sub.setSubmitTestRelease(d.id, true, staff)).ok, 'nur Inhaber');
    assert.ok((await sub.setSubmitTestRelease(d.id, true, owner)).ok);
    r = await send(d.id, owner);
    assert.ok(r.ok, JSON.stringify(r));
    const other = await released();
    await withCodes(other.id);
    r = await send(other.id, owner);
    assert.ok(!r.ok && /Testfreigabe/.test(r.error), 'Freigabe gilt nur für den einen Auftrag');
    const rel = await sub.getSubmitTestRelease();
    assert.equal(rel?.submissionId !== null, true, 'Freigabe an die Übermittlung gebunden');
  });
});

describe('Senden, Doppelschutz, Fehlerfälle (keine automatische Wiederholung)', () => {
  it('angenommen: Vorgangsnummer, Status „bei Zulassungsstelle“, Referenz je Versuch; zweiter Klick sendet nichts', async () => {
    const d = await released();
    await withCodes(d.id);
    const r = await send(d.id);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.submission.state, 'angenommen');
    assert.match(r.submission.externalOrderId, /^EK-\d{4}-\d{5}-AB1$/);
    const o = await row(d.id);
    assert.equal(o?.kfz_order_id, r.submission.kfzOrderId);
    assert.equal(o?.status, 'bei_zulassungsstelle');
    const again = await sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: 'egal' });
    assert.ok(again.ok && again.already);
    assert.equal(fakeFor(r.submission.externalOrderId).length, 1);
    // Gegenseitiger Ausschluss: keine manuelle Verknüpfung, kein Lösen, keine Freigabe-Rücknahme
    assert.ok(!(await kfz.linkKfzOrder(d.id, '999')).ok);
    assert.ok(!(await kfz.linkKfzOrder(d.id, '')).ok);
  });

  it('Doppelklick bzw. parallele Aufrufe: genau ein Antrag beim Partner', async () => {
    const d = await released();
    await withCodes(d.id);
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(pv.ok);
    const fp = pv.ok ? pv.preview.fingerprint : '';
    const rs = await Promise.all([1, 2, 3].map(() => sub.submitDeregistration(d.id, staff, { reservePlate: false, fingerprint: fp })));
    assert.equal(rs.filter((x) => x.ok && !x.already).length, 1, JSON.stringify(rs));
    assert.equal(fakeFor(pv.ok ? pv.preview.externalOrderId : '').length, 1);
  });

  it('verlorene Antwort → „ungewiss“, kein erneutes Senden; Klärung über die Auftragsliste findet den Vorgang', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.dropNextAbResponse = true;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'ungewiss', JSON.stringify(r));
    const pv = await sub.previewSubmission(d.id, staff, { reservePlate: false });
    assert.ok(!pv.ok && /klären/.test(pv.error), 'nicht erneut senden');
    assert.ok(!(await oa.actRelease(d.id, false, owner)).ok, 'Freigabe nicht zurücknehmbar, solange ungeklärt');
    assert.ok(!(await sub.deleteCodes(d.id, staff)).ok, 'Codes bleiben für eine Wiederholung mit derselben Referenz');
    const c = await sub.clarifySubmission(d.id, staff);
    assert.ok(c.ok && c.found, JSON.stringify(c));
    assert.equal(c.submission.state, 'angenommen');
    assert.equal(fakeFor(c.submission.externalOrderId).length, 1, 'kein zweiter Antrag');
    assert.equal((await row(d.id))?.status, 'bei_zulassungsstelle');
  });

  it('500 → ungewiss; Klärung ohne Treffer erst nach Wartezeit → „nicht angelegt“ → Wiederholung mit derselben Referenz', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.failNextAb = 500;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'ungewiss');
    const ext = r.submission!.externalOrderId;
    let c = await sub.clarifySubmission(d.id, staff);
    assert.ok(!c.ok && /zwei Minuten/.test(c.error), 'zu früh für „nicht angelegt“');
    await (await getDb()).run("UPDATE kfz_submissions SET sent_at = '2000-01-01T00:00:00.000Z' WHERE external_order_id = ?", ext);
    c = await sub.clarifySubmission(d.id, staff);
    assert.ok(c.ok && !c.found && c.submission.state === 'nicht_angelegt');
    const again = await send(d.id);
    assert.ok(again.ok, JSON.stringify(again));
    assert.equal(again.submission.externalOrderId, ext, 'dieselbe Referenz');
    assert.equal(fakeFor(ext).length, 1);
  });

  it('503/403 mit Fehlerrumpf → „abgewiesen“ (laut Spezifikation nichts gesendet), Wiederholung mit derselben Referenz', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.failNextAb = 503;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'abgewiesen');
    const again = await send(d.id);
    assert.ok(again.ok && again.submission.externalOrderId === r.submission!.externalOrderId);
  });

  it('409 (gleiche Referenz und FIN, andere Daten) → Konflikt, nichts geändert; Klärung übernimmt den bestehenden Vorgang mit Warnung', async () => {
    const d = await released();
    await withCodes(d.id);
    const o = (await orders.getOrder(d.id))!;
    const ext = `${o.number}-AB1`;
    // Jemand hat unter derselben Referenz bereits mit anderen Daten beantragt (z. B. im Dashboard)
    const pre = await fetch(`${base}/fake-api/10/2.3.0/vehicleDeregistrations/deregistrations`, {
      method: 'POST',
      headers: { Authorization: `Basic ${Buffer.from('test:test').toString('base64')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        externalOrderId: ext,
        email: 'x@example.de',
        customization: {
          licensePlateNumberComponents: { city: 'HB', middle: 'EK', end: '12' },
          licensePlateReservationIncluded: true,
          vehicleIdentificationNumber: o.fin,
          vehicleRegistrationCertificateSecurityCode: 'AAAAAAA',
          rearLicensePlateSecurityCode: 'BBB',
        },
      }),
    });
    assert.equal(pre.status, 200);
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'konflikt', JSON.stringify(r));
    assert.equal(fakeFor(ext).length, 1);
    const c = await sub.clarifySubmission(d.id, staff);
    assert.ok(c.ok && c.found && c.submission.state === 'angenommen');
    const ev = await (await getDb()).all<{ message: string }>('SELECT message FROM events WHERE order_id = ?', d.id);
    assert.ok(ev.some((e) => /abweichende Angaben/.test(e.message)));
  });

  it('nicht erreichbar → ungewiss (nie „nicht gesendet“ angenommen)', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.offline = true;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'ungewiss');
  });

  it('Schemafehler des Partners (400) → abgewiesen, Fehlertext ohne Codes', async () => {
    const d = await released();
    await withCodes(d.id);
    // Partner-Antwort, die den Wert zitiert (darf nicht gespeichert werden)
    const orig = fake.server.listeners('request')[0] as (...a: unknown[]) => void;
    fake.server.removeAllListeners('request');
    fake.server.on('request', (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => {
      if (req.method === 'POST' && req.url?.endsWith('/deregistrations')) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: `vehicleRegistrationCertificateSecurityCode ${CODES.zb1} ungültig`, traceId: 't' }));
      }
      orig(req, res);
    });
    try {
      const r = await send(d.id);
      assert.ok(!r.ok && r.submission?.state === 'abgewiesen');
      assert.ok(!r.error.includes(CODES.zb1) && !(await dbText()).includes(CODES.zb1));
    } finally {
      fake.server.removeAllListeners('request');
      fake.server.on('request', orig);
    }
  });
});

describe('Webhooks und Abgleich (Zuordnung laut Webhooks 3.1.0)', () => {
  it('Zuordnung über die eigene Referenz und über attemptOf (Korrekturversuch mit eigener order.id)', async () => {
    const d = await released();
    await withCodes(d.id);
    const r = await send(d.id);
    assert.ok(r.ok);
    const head = Number(r.submission.kfzOrderId);
    let w = await webhook(
      {
        eventType: 'VEHICLE_DEREGISTRATION_XKFZ_EVENT',
        order: { id: head, externalId: r.submission.externalOrderId },
        attemptOf: head,
        attempt: 1,
        businessTransaction: 'AB',
        status: 'ACCEPTED',
        derivedStatus: 'PENDING',
        eventTime: '2026-10-17T10:00:00',
      },
      `ev-${head}-1`,
    );
    assert.equal(w.body.matched, undefined);
    // Korrektur im Dashboard: neuer Versuch mit eigener Id, attemptOf zeigt auf den Auftrag
    w = await webhook(
      {
        eventType: 'VEHICLE_DEREGISTRATION_XKFZ_EVENT',
        order: { id: head + 50000, externalId: null },
        attemptOf: head,
        attempt: 2,
        businessTransaction: 'AB',
        status: 'APPROVED_WITH_DOCUMENTS',
        derivedStatus: 'SUCCESS',
        applicationId: '88888020240510000003',
        files: [{ purposeType: 'CERTIFICATE', mediaType: 'application/pdf', fileAccessKey: `${head}_k_0`, expirationTime: '2026-10-20T10:00:00' }],
        eventTime: '2026-10-17T11:00:00',
      },
      `ev-${head}-2`,
    );
    assert.equal(w.status, 200);
    const o = await row(d.id);
    assert.equal(o?.kfz_display, 'abgeschlossen');
    assert.equal(o?.kfz_order_id, String(head), 'Auftragskopf bleibt verknüpft, nicht die Versuchs-Id');
    assert.equal(o?.status, 'zugelassen');
  });

  it('verspätetes Ereignis eines älteren Versuchs überschreibt den Stand der Korrektur nicht und mailt den Kunden nicht', async () => {
    const d = await released();
    await withCodes(d.id);
    const r = await send(d.id);
    assert.ok(r.ok);
    const head = Number(r.submission.kfzOrderId);
    const base = { eventType: 'VEHICLE_DEREGISTRATION_XKFZ_EVENT', attemptOf: head, businessTransaction: 'AB', eventTime: '2026-10-17T10:00:00' };
    await webhook({ ...base, order: { id: head + 70000, externalId: null }, attempt: 2, status: 'ACCEPTED', derivedStatus: 'PENDING' }, `ev-${head}-a2`);
    const mailsBefore = (await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', d.id)).length;
    await webhook(
      { ...base, order: { id: head, externalId: r.submission.externalOrderId }, attempt: 1, status: 'FAILED', derivedStatus: 'LICENSE_PLATE_CODE_INVALID' },
      `ev-${head}-a1`,
    );
    assert.equal((await row(d.id))?.kfz_display, 'in_bearbeitung', 'Stand des jüngeren Versuchs bleibt');
    assert.equal((await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', d.id)).length, mailsBefore, 'keine Kundenmail');
  });

  it('ERROR_UNHANDLED (nur AB): fehlgeschlagen für Mitarbeiter, aber keine automatische Kundenmail', async () => {
    const d = await released();
    await withCodes(d.id);
    const r = await send(d.id);
    assert.ok(r.ok);
    const head = Number(r.submission.kfzOrderId);
    const mailsBefore = (await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', d.id)).length;
    await webhook(
      {
        eventType: 'VEHICLE_DEREGISTRATION_XKFZ_EVENT',
        order: { id: head, externalId: r.submission.externalOrderId },
        attemptOf: head,
        attempt: 1,
        businessTransaction: 'AB',
        status: 'FAILED',
        derivedStatus: 'ERROR_UNHANDLED',
      },
      `ev-${head}-eu`,
    );
    assert.equal((await row(d.id))?.kfz_display, 'fehlgeschlagen');
    assert.equal((await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', d.id)).length, mailsBefore);
    const ev = await (await getDb()).all<{ message: string }>('SELECT message FROM events WHERE order_id = ?', d.id);
    assert.ok(ev.some((e) => /Manuelle Prüfung nötig/.test(e.message) && /keine automatische Kundenmail/.test(e.message)));
    // Gegenprobe: eine gewöhnliche Ablehnung (FAILURE) legt die Kundenmail an
    const g = await released();
    await withCodes(g.id);
    const rg = await send(g.id);
    assert.ok(rg.ok);
    const hg = Number(rg.submission.kfzOrderId);
    const before = (await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', g.id)).length;
    await webhook(
      {
        eventType: 'VEHICLE_DEREGISTRATION_XKFZ_EVENT',
        order: { id: hg, externalId: rg.submission.externalOrderId },
        attemptOf: hg,
        attempt: 1,
        businessTransaction: 'AB',
        status: 'FAILED',
        derivedStatus: 'FAILURE',
      },
      `ev-${hg}-f`,
    );
    assert.ok((await (await getDb()).all('SELECT id FROM messages WHERE order_id = ?', g.id)).length > before, 'Gegenprobe: Kundenmail angelegt');
  });

  it('Klärung übernimmt nie einen Vorgang unter unserer Referenz zu einem anderen Fahrzeug', async () => {
    const d = await released();
    await withCodes(d.id);
    fake.mode.dropNextAbResponse = true;
    const r = await send(d.id);
    assert.ok(!r.ok && r.submission?.state === 'ungewiss');
    const created = fakeFor(r.submission!.externalOrderId)[0] as Record<string, unknown>;
    created.fin = 'WVWZZZ1KZAW999999';
    const c = await sub.clarifySubmission(d.id, staff);
    assert.ok(!c.ok && /anderen Fahrzeug/.test(c.error));
    assert.equal(c.submission?.state, 'ungewiss');
    assert.equal((await row(d.id))?.kfz_order_id, '');
  });

  it('Abgleich über GET …/orders/{id} nach verlorenem Webhook – gleicher Stand wird nur einmal übernommen', async () => {
    const d = await released();
    await withCodes(d.id);
    const r = await send(d.id);
    assert.ok(r.ok);
    await control('/__test/ab', { id: Number(r.submission.kfzOrderId), state: 'abgelehnt', derivedStatus: 'LICENSE_PLATE_CODE_INVALID' });
    const a = await sub.reconcileOrder(d.id);
    assert.ok(a.ok && a.applied, JSON.stringify(a));
    assert.equal((await row(d.id))?.kfz_display, 'angaben_erforderlich');
    const b = await sub.reconcileOrder(d.id);
    assert.ok(b.ok && !b.applied, 'gleicher Stand: nicht doppelt');
  });
});
