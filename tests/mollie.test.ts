// Online-Zahlung über Mollie gegen den Testnachbau (scripts/fake-mollie.mjs): Zahlung starten, Webhook mit serverseitiger
// Prüfung, Preismanipulation, doppelte Zahlungen und Zustellungen, ausgefallene Webhooks, erneute Versuche, Erstattung.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { emptyDraft, validateOrder, type ValidatedOrder } from '../src/lib/order.ts';
import { centsToValue, keyMode, payView, valueToCents } from '../src/lib/mollie.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeMollie, FAKE_MOLLIE_KEYS } from '../scripts/fake-mollie.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-mollie-'));
const fake = createFakeMollie() as {
  server: import('node:http').Server;
  payments: Map<string, Record<string, unknown> & { _body: Record<string, unknown>; _key: string | null }>;
  calls: { method: string; path: string; idempotencyKey: string | null }[];
  mode: Record<string, unknown>;
};
let base = '';

const mollie = await import('../src/server/mollie.ts');
const payments = await import('../src/server/payments.ts');
const orders = await import('../src/server/orders.ts');
const { getDb } = await import('../src/server/db.ts');

function order(): ValidatedOrder {
  const d = emptyDraft('neuzulassung');
  d.vehicle = { ...d.vehicle, art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000555', bisherigesKennzeichen: '', antrieb: 'benzin' };
  d.holder = {
    ...d.holder,
    typ: 'privat',
    vorname: 'Erika',
    nachname: 'Musterfrau',
    geburtsdatum: '1988-03-15',
    strasse: 'Teststraße',
    hausnummer: '1',
    plz: '24937',
    ort: 'Flensburg',
    email: 'erika@example.test',
    telefon: '0461 123456',
  };
  d.plate = { ...d.plate, wahl: 'neu', zustellung: 'abholung' };
  d.finish = {
    ...d.finish,
    evb: 'A1B2C3D',
    kontoinhaber: 'Erika Musterfrau',
    iban: 'DE89 3704 0044 0532 0130 00',
    sepaMandat: true,
    vollmacht: true,
    datenschutz: true,
  };
  const v = validateOrder(d);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  return (v as { ok: true; order: ValidatedOrder }).order;
}
const control = async (p: string, body: unknown) => (await fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();
const site = 'https://easykfz24.de';
const db = async () => getDb();
const orderRow = async (id: number) =>
  (await db()).first<{ payment_status: string; payment_ref: string; total_cents: number }>(
    'SELECT payment_status, payment_ref, total_cents FROM orders WHERE id = ?',
    id,
  );
const bookings = async (id: number) =>
  (await db()).all<{ provider: string; kind: string; status: string; amount_cents: number; note: string }>(
    'SELECT provider, kind, status, amount_cents, note FROM payments WHERE order_id = ? ORDER BY id',
    id,
  );
const paymentIdOf = (url: string) => new URL(url).searchParams.get('token')!;

before(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  process.env.MOLLIE_API_BASE = `${base}/v2`;
  process.env.MOLLIE_API_KEY = (FAKE_MOLLIE_KEYS as { test: string }).test;
  process.env.ZAHLUNG_ONLINE = '1';
});
after(() => fake.server.close());

describe('Hilfsfunktionen und Freischaltung', () => {
  it('Beträge ganzzahlig, Modus nur am Präfix, Anzeige aus dem bestätigten Stand', () => {
    assert.equal(centsToValue(12096), '120.96');
    assert.equal(centsToValue(5), '0.05');
    assert.equal(valueToCents('120.96'), 12096);
    for (const bad of ['120.9', '120', '-1.00', '1e3', 120.96, null]) assert.equal(valueToCents(bad), null, String(bad));
    assert.equal(keyMode('test_abcdefghijklmnopqrstuvwxyz'), 'test');
    assert.equal(keyMode('live_abcdefghijklmnopqrstuvwxyz'), 'live');
    assert.equal(keyMode('sk_test_abc'), null);
    assert.equal(payView('paid'), 'bezahlt');
    assert.equal(payView('pending'), 'in_pruefung');
    assert.equal(payView(null), 'keine');
  });

  it('Standard AUS: ohne ZAHLUNG_ONLINE keine Online-Zahlung – auch nicht mit Live-Schlüssel', async () => {
    delete process.env.ZAHLUNG_ONLINE;
    assert.equal(mollie.molliePaymentsEnabled(), false);
    assert.equal(payments.paymentProvider(), null);
    process.env.MOLLIE_API_KEY = (FAKE_MOLLIE_KEYS as { live: string }).live;
    assert.equal(mollie.molliePaymentsEnabled(), false);
    const o = await orders.createOrder(order(), []);
    const r = await mollie.startMolliePayment(o.id, site);
    assert.ok(!r.ok);
    assert.equal(fake.payments.size, 0);
    process.env.MOLLIE_API_KEY = (FAKE_MOLLIE_KEYS as { test: string }).test;
    process.env.ZAHLUNG_ONLINE = '1';
    assert.equal(payments.paymentProvider(), 'mollie');
  });

  it('Verbindungstest liest nur die Zahlarten (GET /v2/methods)', async () => {
    const c = await mollie.checkMollie();
    assert.deepEqual([c.ok, c.mode, c.online], [true, 'test', true]);
    assert.deepEqual(c.methods, ['creditcard', 'paypal', 'applepay', 'klarna']);
    process.env.MOLLIE_API_KEY = 'test_falscherSchluessel0123456789';
    const bad = await mollie.checkMollie();
    assert.ok(!bad.ok && /Anmeldung abgelehnt/.test(bad.message));
    process.env.MOLLIE_API_KEY = (FAKE_MOLLIE_KEYS as { test: string }).test;
  });
});

describe('Zahlung starten', () => {
  it('Betrag aus der Datenbank, Bezug zum Auftrag, Rückleitung mit Token, Webhook nur an HTTPS-Adresse', async () => {
    const o = await orders.createOrder(order(), []);
    const r = await mollie.startMolliePayment(o.id, site);
    assert.ok(r.ok && !r.reused, JSON.stringify(r));
    const p = [...fake.payments.values()].at(-1)!;
    const total = (await orderRow(o.id))!.total_cents;
    assert.deepEqual(p._body.amount, { currency: 'EUR', value: centsToValue(total) });
    assert.deepEqual(p._body.metadata, { order: o.number, attempt: 1 });
    assert.equal(p._body.webhookUrl, 'https://easykfz24.de/api/zahlung/mollie');
    assert.equal(p._body.redirectUrl, `https://easykfz24.de/zahlung/${o.number}?t=${encodeURIComponent(o.paymentToken)}&rueckkehr=1`);
    assert.equal(p._body.locale, 'de_DE');
    // Klarna nicht freigegeben: keine zusätzlichen Kundendaten, Auswahl = bei Mollie aktive Methoden ohne Klarna
    assert.equal(p._body.billingAddress, undefined);
    assert.equal(p._body.lines, undefined);
    assert.deepEqual(p._body.method, ['creditcard', 'paypal', 'applepay']);
    assert.match(String(p._key), new RegExp(`^${o.number}-Z1-`), 'Idempotency-Key je Versuch');
    // lokal: keine Webhook-Adresse (Mollie erreicht localhost nicht)
    const o2 = await orders.createOrder(order(), []);
    assert.ok((await mollie.startMolliePayment(o2.id, 'http://localhost:3024')).ok);
    assert.equal([...fake.payments.values()].at(-1)!._body.webhookUrl, undefined);
  });

  it('offener Versuch wird fortgesetzt – kein zweiter Zahlungsvorgang', async () => {
    const o = await orders.createOrder(order(), []);
    const a = await mollie.startMolliePayment(o.id, site);
    const before = fake.payments.size;
    const b = await mollie.startMolliePayment(o.id, site);
    assert.ok(a.ok && b.ok && a.checkoutUrl === b.checkoutUrl);
    assert.equal(fake.payments.size, before);
    assert.equal((await mollie.listAttempts(o.id)).length, 1);
  });

  it('Antwort geht verloren: Wiederholung mit demselben Idempotency-Key liefert dieselbe Zahlung', async () => {
    const o = await orders.createOrder(order(), []);
    await control('/__test/mode', { dropNextPostResponse: true });
    const lost = await mollie.startMolliePayment(o.id, site);
    assert.ok(!lost.ok);
    const before = fake.payments.size;
    const retry = await mollie.startMolliePayment(o.id, site);
    assert.ok(retry.ok && retry.reused, JSON.stringify(retry));
    assert.equal(fake.payments.size, before, 'Mollie hat keinen zweiten Vorgang angelegt');
    const keys = fake.calls
      .filter((c) => c.method === 'POST')
      .slice(-2)
      .map((c) => c.idempotencyKey);
    assert.equal(keys[0], keys[1]);
  });

  it('Mollie gestört: Kunde erhält Hinweis, Auftrag bleibt offen, nichts gebucht', async () => {
    const o = await orders.createOrder(order(), []);
    await control('/__test/mode', { failNextPost: 503 });
    const r = await mollie.startMolliePayment(o.id, site);
    assert.ok(!r.ok && /später erneut/.test(r.error));
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    assert.deepEqual(await bookings(o.id), []);
    assert.match((await mollie.listAttempts(o.id))[0].create_error, /^503/);
  });
});

describe('Webhook mit serverseitiger Prüfung', () => {
  it('bezahlt: Auftrag bezahlt, genau eine Buchung, doppelte und gleichzeitige Zustellung ohne Wirkung', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    const id = paymentIdOf(s.checkoutUrl);
    // vor der Zahlung: Webhook ändert nichts
    assert.equal(await mollie.handleMollieWebhook(id), 200);
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    await control('/__test/set', { id, status: 'paid', method: 'creditcard' });
    const codes = await Promise.all([mollie.handleMollieWebhook(id), mollie.handleMollieWebhook(id), mollie.handleMollieWebhook(id)]);
    assert.deepEqual(codes, [200, 200, 200]);
    assert.equal(await mollie.handleMollieWebhook(id), 200);
    const row = (await orderRow(o.id))!;
    assert.deepEqual([row.payment_status, row.payment_ref], ['bezahlt', id]);
    const b = await bookings(o.id);
    assert.equal(b.length, 1);
    assert.deepEqual([b[0].provider, b[0].kind, b[0].status, b[0].amount_cents], ['mollie', 'zahlung', 'bezahlt', row.total_cents]);
    assert.match(b[0].note, /TESTMODUS/);
    const ev = await (
      await db()
    ).all<{ message: string }>("SELECT message FROM events WHERE order_id = ? AND type = 'payment' AND message LIKE 'Bezahlt (Mollie%'", o.id);
    assert.equal(ev.length, 1, 'genau ein Verlaufseintrag');
    const os = await (await db()).all<{ dedupe_key: string }>("SELECT dedupe_key FROM os_events WHERE type = 'payment.paid' AND order_id = ?", o.id);
    assert.equal(os.length, 1);
    // nach Bezahlung kein neuer Zahlungsstart
    const again = await mollie.startMolliePayment(o.id, site);
    assert.ok(!again.ok && again.paid);
  });

  it('unbekannte, fremde oder ungültige IDs: 200, keine Wirkung, keine Abfrage', async () => {
    const before = fake.calls.length;
    for (const id of ['tr_unbekannt123', 'tr_', 'abc', "tr_1' OR '1'='1", null, 42]) assert.equal(await mollie.handleMollieWebhook(id), 200, String(id));
    assert.equal(fake.calls.length, before, 'kein API-Aufruf für fremde IDs');
  });

  it('Mollie nicht erreichbar: 503 (Mollie wiederholt), Stand bleibt; spätere Zustellung übernimmt ihn', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    const id = paymentIdOf(s.checkoutUrl);
    await control('/__test/set', { id, status: 'paid' });
    await control('/__test/mode', { offline: true });
    assert.equal(await mollie.handleMollieWebhook(id), 503);
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    await control('/__test/mode', { offline: false, failNextGet: 500 });
    assert.equal(await mollie.handleMollieWebhook(id), 503, '5xx von Mollie → erneut zustellen lassen');
    assert.equal(await mollie.handleMollieWebhook(id), 200);
    assert.equal((await orderRow(o.id))!.payment_status, 'bezahlt');
  });

  it('Preismanipulation: abweichender Betrag oder fremder Auftrag wird NICHT als bezahlt übernommen', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    const id = paymentIdOf(s.checkoutUrl);
    await control('/__test/set', { id, status: 'paid', amountValue: '1.00' });
    assert.equal(await mollie.handleMollieWebhook(id), 200);
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    assert.deepEqual(await bookings(o.id), []);
    const att = (await mollie.listAttempts(o.id))[0];
    assert.match(att.mismatch, /Betrag 1\.00 EUR/);
    const os = await (await db()).first<{ payload_json: string }>("SELECT payload_json FROM os_events WHERE type = 'payment.failed' AND order_id = ?", o.id);
    assert.match(os?.payload_json ?? '', /"critical":true/);

    const o2 = await orders.createOrder(order(), []);
    const s2 = await mollie.startMolliePayment(o2.id, site);
    assert.ok(s2.ok);
    const id2 = paymentIdOf(s2.checkoutUrl);
    await control('/__test/set', { id: id2, status: 'paid', metadata: { order: 'EK-2026-99999', attempt: 1 } });
    await mollie.handleMollieWebhook(id2);
    assert.equal((await orderRow(o2.id))!.payment_status, 'offen');
    assert.match((await mollie.listAttempts(o2.id))[0].mismatch, /anderen Auftrag/);
  });

  it('Betrag nach Zahlungsstart geändert: alte Zahlung zählt nicht, neuer Versuch mit neuem Betrag', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    await (await db()).run('UPDATE orders SET total_cents = total_cents + 500 WHERE id = ?', o.id);
    const s2 = await mollie.startMolliePayment(o.id, site);
    assert.ok(s2.ok && s2.checkoutUrl !== s.checkoutUrl, 'neuer Versuch statt alter Checkout mit falschem Betrag');
    await control('/__test/set', { id: paymentIdOf(s.checkoutUrl), status: 'paid' });
    await mollie.handleMollieWebhook(paymentIdOf(s.checkoutUrl));
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
  });
});

describe('Fehlgeschlagen, abgebrochen, abgelaufen, erneuter Versuch, Doppelzahlung, Erstattung', () => {
  it('fehlgeschlagen → Buchung „fehlgeschlagen“, Auftrag offen, neuer Versuch V2 mit neuer Zahlung', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    const id = paymentIdOf(s.checkoutUrl);
    await control('/__test/set', { id, status: 'failed' });
    await mollie.handleMollieWebhook(id);
    assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    assert.deepEqual(
      (await bookings(o.id)).map((b) => b.status),
      ['fehlgeschlagen'],
    );
    const st = await mollie.paymentStateForOrder(o.id);
    assert.equal(st.view, 'fehlgeschlagen');
    const r = await mollie.startMolliePayment(o.id, site);
    assert.ok(r.ok && r.checkoutUrl !== s.checkoutUrl);
    assert.equal((await mollie.listAttempts(o.id))[0].attempt, 2);
  });

  it('abgebrochen und abgelaufen: erneut bezahlen möglich, nichts abgebucht', async () => {
    for (const status of ['canceled', 'expired']) {
      const o = await orders.createOrder(order(), []);
      const s = await mollie.startMolliePayment(o.id, site);
      assert.ok(s.ok);
      await control('/__test/set', { id: paymentIdOf(s.checkoutUrl), status });
      await mollie.handleMollieWebhook(paymentIdOf(s.checkoutUrl));
      assert.equal((await mollie.paymentStateForOrder(o.id)).view, status === 'canceled' ? 'abgebrochen' : 'abgelaufen');
      assert.ok((await mollie.startMolliePayment(o.id, site)).ok);
      assert.equal((await orderRow(o.id))!.payment_status, 'offen');
    }
  });

  it('Doppelzahlung (zweiter Versuch ebenfalls bezahlt): gebucht, gekennzeichnet, kritischer Hinweis', async () => {
    const o = await orders.createOrder(order(), []);
    const s1 = await mollie.startMolliePayment(o.id, site);
    assert.ok(s1.ok);
    const id1 = paymentIdOf(s1.checkoutUrl);
    await control('/__test/set', { id: id1, status: 'failed' });
    await mollie.handleMollieWebhook(id1);
    const s2 = await mollie.startMolliePayment(o.id, site);
    assert.ok(s2.ok);
    const id2 = paymentIdOf(s2.checkoutUrl);
    await control('/__test/set', { id: id2, status: 'paid' });
    await mollie.handleMollieWebhook(id2);
    // verspätet: der erste Versuch wird doch noch bezahlt
    await control('/__test/set', { id: id1, status: 'paid' });
    await (await db()).run("UPDATE payment_attempts SET status = 'open' WHERE provider_id = ?", id1);
    await mollie.handleMollieWebhook(id1);
    const paid = (await bookings(o.id)).filter((b) => b.status === 'bezahlt');
    assert.equal(paid.length, 2);
    assert.ok(paid.some((b) => /DOPPELZAHLUNG/.test(b.note)));
    const os = await (await db()).all<{ payload_json: string }>("SELECT payload_json FROM os_events WHERE type = 'payment.paid' AND order_id = ?", o.id);
    assert.ok(os.some((e) => /"double":true/.test(e.payload_json)));
  });

  it('Erstattung (teilweise, dann vollständig) und Rückbuchung werden je Stand genau einmal gebucht', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    const id = paymentIdOf(s.checkoutUrl);
    const total = (await orderRow(o.id))!.total_cents;
    await control('/__test/set', { id, status: 'paid' });
    await mollie.handleMollieWebhook(id);
    await control('/__test/set', { id, amountRefunded: '10.00' });
    await mollie.handleMollieWebhook(id);
    await mollie.handleMollieWebhook(id);
    await control('/__test/set', { id, amountRefunded: centsToValue(total) });
    await mollie.handleMollieWebhook(id);
    const refunds = (await bookings(o.id)).filter((b) => b.kind === 'erstattung');
    assert.deepEqual(
      refunds.map((b) => b.amount_cents),
      [-1000, -(total - 1000)],
    );
    assert.equal((await orderRow(o.id))!.payment_status, 'erstattet');
    await control('/__test/set', { id, amountChargedBack: '5.00' });
    await mollie.handleMollieWebhook(id);
    await mollie.handleMollieWebhook(id);
    assert.deepEqual(
      (await bookings(o.id)).filter((b) => b.kind === 'rueckbuchung').map((b) => b.amount_cents),
      [-500],
    );
  });
});

describe('Rückleitung und Zeitsteuerung', () => {
  it('Rückkehrseite gleicht gedrosselt ab und zeigt nur den bestätigten Stand', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    assert.equal((await mollie.paymentStateForOrder(o.id)).view, 'offen');
    await control('/__test/set', { id: paymentIdOf(s.checkoutUrl), status: 'paid' });
    assert.equal((await mollie.paymentStateForOrder(o.id)).view, 'offen', 'gedrosselt: Neuladen fragt nicht jedes Mal');
    await (await db()).run("UPDATE payment_attempts SET checked_at = '' WHERE order_id = ?", o.id);
    assert.equal((await mollie.paymentStateForOrder(o.id)).view, 'bezahlt');
    assert.equal((await orderRow(o.id))!.payment_status, 'bezahlt');
  });

  it('ausgebliebener Webhook: Zeitsteuerung „zahlung_abgleich“ übernimmt den Stand', async () => {
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, site);
    assert.ok(s.ok);
    await control('/__test/set', { id: paymentIdOf(s.checkoutUrl), status: 'paid' });
    await (await db()).run("UPDATE payment_attempts SET checked_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ?", o.id);
    const { runScheduledRules } = await import('../src/server/os/automation.ts');
    const r = await runScheduledRules(true, ['zahlung_abgleich']);
    assert.ok(r.ran && r.cases >= 1);
    assert.equal((await orderRow(o.id))!.payment_status, 'bezahlt');
  });
});

describe('Separater Testschlüssel bei Live-Hauptschlüssel (MOLLIE_TEST_API_KEY)', () => {
  const keys = FAKE_MOLLIE_KEYS as { test: string; live: string };
  const live = () => {
    process.env.MOLLIE_API_KEY = keys.live;
    process.env.MOLLIE_TEST_API_KEY = keys.test;
    delete process.env.ZAHLUNG_ONLINE;
  };
  const reset = () => {
    process.env.MOLLIE_API_KEY = keys.test;
    delete process.env.MOLLIE_TEST_API_KEY;
    process.env.ZAHLUNG_ONLINE = '1';
  };

  it('Modi werden nur als Präfix gemeldet; Kunden-Zahlung aus, Testzahlung möglich', async () => {
    live();
    try {
      assert.deepEqual(mollie.mollieModes(), { haupt: 'live', testschluessel: true, online: false });
      assert.ok(!JSON.stringify(mollie.mollieModes()).includes('fakeMollieKey'));
      const c = await mollie.checkMollie();
      assert.deepEqual([c.ok, c.mode, c.test.ok, c.test.separate], [true, 'live', true, true]);
      const o = await orders.createOrder(order(), []);
      assert.ok(!(await mollie.startMolliePayment(o.id, site)).ok, 'keine Kunden-Zahlung ohne ZAHLUNG_ONLINE');
      const t = await mollie.startMolliePayment(o.id, site, { test: true });
      assert.ok(t.ok, JSON.stringify(t));
      const p = fake.payments.get(paymentIdOf(t.checkoutUrl))!;
      assert.equal(p.mode, 'test', 'mit dem Testschlüssel angelegt');
    } finally {
      reset();
    }
  });

  it('Testzahlung bezahlt: Auftrag bleibt offen, Buchung „Testzahlung“, keine Automatisierung, Abfrage mit Testschlüssel', async () => {
    live();
    try {
      const o = await orders.createOrder(order(), []);
      const t = await mollie.startMolliePayment(o.id, site, { test: true });
      assert.ok(t.ok);
      const id = paymentIdOf(t.checkoutUrl);
      await control('/__test/set', { id, status: 'paid', method: 'creditcard' });
      assert.equal(await mollie.handleMollieWebhook(id), 200);
      assert.equal(await mollie.handleMollieWebhook(id), 200);
      const row = (await orderRow(o.id))!;
      assert.equal(row.payment_status, 'offen', 'Testzahlung ist nie eine echte Zahlung');
      const b = await bookings(o.id);
      assert.deepEqual(
        b.map((x) => [x.kind, x.status, x.amount_cents]),
        [['testzahlung', 'bezahlt', 0]],
      );
      const ev = await (await db()).all<{ type: string }>('SELECT type FROM os_events WHERE order_id = ?', o.id);
      assert.ok(ev.some((e) => e.type === 'payment.test'));
      assert.ok(!ev.some((e) => e.type === 'payment.paid'), 'kein payment.paid → keine Automatisierung');
      const st = await (await db()).first<{ status: string }>('SELECT status FROM orders WHERE id = ?', o.id);
      assert.equal(st?.status, 'neu');
      assert.equal((await mollie.listAttempts(o.id))[0].status, 'paid');
    } finally {
      reset();
    }
  });

  it('ohne Testschlüssel keine Testzahlung; echte und Testzahlung werden nicht vermischt', async () => {
    process.env.MOLLIE_API_KEY = keys.live;
    delete process.env.MOLLIE_TEST_API_KEY;
    process.env.ZAHLUNG_ONLINE = '1';
    try {
      const o = await orders.createOrder(order(), []);
      const t = await mollie.startMolliePayment(o.id, site, { test: true });
      assert.ok(!t.ok && /Testschlüssel/.test(t.error));
      const real = await mollie.startMolliePayment(o.id, site);
      assert.ok(real.ok);
      assert.equal(fake.payments.get(paymentIdOf(real.checkoutUrl))!.mode, 'live');
      process.env.MOLLIE_TEST_API_KEY = keys.test;
      const mixed = await mollie.startMolliePayment(o.id, site, { test: true });
      assert.ok(!mixed.ok && /echte Zahlung/.test(mixed.error));
    } finally {
      reset();
    }
  });
});

describe('Klarna-Angaben (Bestellpositionen, Rechnungsadresse)', () => {
  it('Positionen inkl. Rabatt und Schildern: Summe = Zahlungsbetrag, MwSt. nach Mollie-Formel', async () => {
    const { mollieLines } = await import('../src/lib/mollie.ts');
    const l = mollieLines(
      'EK-2026-00001',
      [
        { key: 'service', label: 'Servicepauschale Neuzulassung', cents: 8999 },
        { key: 'schilder', label: 'Kennzeichenschilder (2 Stück)', cents: 2598, qty: 2, unitCents: 1299 },
        { key: 'versand', label: 'Versand mit DHL', cents: 690 },
        { key: 'rabatt', label: 'Neukundenrabatt', cents: -1000 },
      ],
      11287,
      19,
    );
    assert.deepEqual(
      l.map((x) => [x.type, x.quantity, x.unitPrice.value, x.totalAmount.value, x.vatAmount.value]),
      [
        ['digital', 1, '89.99', '89.99', '14.37'],
        ['physical', 2, '12.99', '25.98', '4.15'],
        ['shipping_fee', 1, '6.90', '6.90', '1.10'],
        ['discount', 1, '-10.00', '-10.00', '-1.60'],
      ],
    );
  });

  it('Summe passt nicht: eine Gesamtposition statt Abbruch; Kleinunternehmer 0 %', async () => {
    const { mollieLines } = await import('../src/lib/mollie.ts');
    const l = mollieLines('EK-2026-00002', [{ key: 'service', label: 'X', cents: 100 }], 2499, 0);
    assert.deepEqual(
      l.map((x) => [x.description, x.totalAmount.value, x.vatRate, x.vatAmount.value]),
      [['EasyKFZ24 Auftrag EK-2026-00002', '24.99', '0.00', '0.00']],
    );
  });

  it('Rechnungsadresse: Firma mit Ansprechperson; fehlende Pflichtangabe → keine Adresse (Klarna wird dann nicht angeboten)', async () => {
    const { mollieBillingAddress } = await import('../src/lib/mollie.ts');
    const firm = mollieBillingAddress({
      typ: 'firma',
      firmenname: 'Muster GmbH',
      ansprechpartner: 'Max von Muster',
      strasse: 'Weg',
      hausnummer: '2',
      plz: '28195',
      ort: 'Bremen',
      email: 'a@b.de',
    });
    assert.deepEqual([firm?.organizationName, firm?.givenName, firm?.familyName], ['Muster GmbH', 'Max von', 'Muster']);
    assert.equal(mollieBillingAddress({ typ: 'privat', vorname: 'A', nachname: 'B', strasse: '', plz: '1', ort: 'C', email: 'a@b.de' }), null);
  });
});

describe('Klarna-Freigabe (KLARNA_AKTIV=1)', () => {
  it('mit Freigabe: Rechnungsadresse und Bestellpositionen, keine Einschränkung der Auswahl', async () => {
    process.env.KLARNA_AKTIV = '1';
    try {
      const o = await orders.createOrder(order(), []);
      const r = await mollie.startMolliePayment(o.id, site);
      assert.ok(r.ok, JSON.stringify(r));
      const p = [...fake.payments.values()].at(-1)!;
      const total = (await orderRow(o.id))!.total_cents;
      assert.equal(p._body.method, undefined);
      assert.deepEqual(p._body.billingAddress, {
        givenName: 'Erika',
        familyName: 'Musterfrau',
        streetAndNumber: 'Teststraße 1',
        postalCode: '24937',
        city: 'Flensburg',
        country: 'DE',
        email: 'erika@example.test',
      });
      const lines = p._body.lines as { totalAmount: { value: string }; vatRate: string }[];
      assert.ok(lines.every((l) => l.vatRate === '19.00'));
      assert.equal(Math.round(lines.reduce((s, l) => s + Number(l.totalAmount.value) * 100, 0)), total);
    } finally {
      delete process.env.KLARNA_AKTIV;
    }
  });
});
