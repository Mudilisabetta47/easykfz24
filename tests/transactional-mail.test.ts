// Transaktionsmails: Freigabe-Sperre, Idempotenz, Bestell-/Zahlungsbestätigung nur aus bestätigten Ereignissen, Wiederholung,
// Testmail. Versand gegen einen lokalen Resend-Nachbau (keine echten E-Mails), Zahlungen gegen den Mollie-Testnachbau.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { emptyDraft, validateOrder, type ValidatedOrder } from '../src/lib/order.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeMollie, FAKE_MOLLIE_KEYS } from '../scripts/fake-mollie.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-mail-'));
process.env.PUBLIC_BASE_URL = 'https://easykfz24.de';

// Resend-Nachbau: nimmt POST /emails an, merkt sich die Mails, kann Fehler simulieren
const sent: { to: string[]; subject: string; html: string; text: string; reply_to?: string; from: string }[] = [];
let failNext = 0;
const resend = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    if (req.headers.authorization !== 'Bearer re_test_fake') return void (res.writeHead(401), res.end('{}'));
    if (failNext > 0) {
      failNext--;
      res.writeHead(500, { 'Content-Type': 'application/json' });
      return void res.end('{"message":"Testfehler"}');
    }
    sent.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: `res_${sent.length}` }));
  });
});
const fake = createFakeMollie() as { server: http.Server; payments: Map<string, Record<string, unknown>> };
let mollieBase = '';

const mail = await import('../src/server/transactional-mail.ts');
const mollie = await import('../src/server/mollie.ts');
const orders = await import('../src/server/orders.ts');
const { getDb } = await import('../src/server/db.ts');
const { emitSafe } = await import('../src/server/os/events.ts');

function order(email = 'kunde@example.test'): ValidatedOrder {
  const d = emptyDraft('neuzulassung');
  d.vehicle = { ...d.vehicle, art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000444', bisherigesKennzeichen: '', antrieb: 'benzin' };
  d.holder = {
    ...d.holder,
    typ: 'privat',
    vorname: 'Erika',
    nachname: 'Muster<script>',
    geburtsdatum: '1988-03-15',
    strasse: 'Teststraße',
    hausnummer: '1',
    plz: '24937',
    ort: 'Flensburg',
    email,
    telefon: '0461 123456',
  };
  d.plate = { ...d.plate, wahl: 'neu', zustellung: 'abholung' };
  d.finish = {
    ...d.finish,
    evb: 'A1B2C3D',
    kontoinhaber: 'Erika Muster',
    iban: 'DE89 3704 0044 0532 0130 00',
    sepaMandat: true,
    vollmacht: true,
    datenschutz: true,
  };
  const v = validateOrder(d);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  return (v as { ok: true; order: ValidatedOrder }).order;
}
const db = async () => getDb();
const msgs = async (orderId: number) =>
  (await db()).all<{
    id: number;
    mail_kind: string;
    state: string;
    dedupe_key: string;
    provider_id: string;
    attempts: number;
    next_attempt_at: string;
    error: string;
  }>(
    "SELECT id, mail_kind, state, dedupe_key, provider_id, attempts, next_attempt_at, error FROM messages WHERE order_id = ? AND dedupe_key != '' ORDER BY id",
    orderId,
  );
const control = async (p: string, body: unknown) => (await fetch(`${mollieBase}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();
const enable = () => {
  process.env.KUNDENMAILS = '1';
  process.env.MAIL_FROM = 'EasyKFZ24 <kundenservice@easykfz24.de>';
  process.env.RESEND_API_KEY = 're_test_fake';
};

before(async () => {
  await new Promise<void>((r) => resend.listen(0, '127.0.0.1', () => r()));
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  process.env.RESEND_API_BASE = `http://127.0.0.1:${(resend.address() as AddressInfo).port}`;
  mollieBase = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  process.env.MOLLIE_API_BASE = `${mollieBase}/v2`;
  process.env.MOLLIE_API_KEY = (FAKE_MOLLIE_KEYS as { test: string }).test;
  process.env.ZAHLUNG_ONLINE = '1';
});
after(() => {
  resend.close();
  fake.server.close();
});

describe('Freigabe und Idempotenz', () => {
  it('ohne KUNDENMAILS=1 wird nur protokolliert („zurückgehalten“), nichts versendet', async () => {
    delete process.env.KUNDENMAILS;
    process.env.MAIL_FROM = 'EasyKFZ24 <kundenservice@easykfz24.de>';
    process.env.RESEND_API_KEY = 're_test_fake';
    const o = await orders.createOrder(order(), []);
    const r = await mail.queueOrderConfirmation(o.id);
    assert.ok(r.queued && r.state === 'zurueckgehalten');
    assert.equal(sent.length, 0);
    // im OS freigeben → genau dann versendet
    const d = await mail.deliver((r as { id: number }).id, { force: true, actor: 'Inhaber' });
    assert.ok(d.ok && d.providerId === 'res_1');
    assert.equal(sent.length, 1);
    assert.deepEqual(
      (await msgs(o.id)).map((m) => [m.state, m.provider_id]),
      [['versendet', 'res_1']],
    );
  });

  it('gleiches Ereignis → genau eine Mail (auch bei gleichzeitigen Aufrufen)', async () => {
    enable();
    const before = sent.length;
    const o = await orders.createOrder(order(), []);
    await Promise.all([mail.queueOrderConfirmation(o.id), mail.queueOrderConfirmation(o.id), mail.queueOrderConfirmation(o.id)]);
    assert.equal(sent.length, before + 1);
    assert.equal((await msgs(o.id)).length, 1);
  });
});

describe('Bestell- und Vertragsbestätigung', () => {
  it('Inhalt: Nummer, Datum, Leistung, Einzelpreise, Gesamt, Zahlungsstatus, Zahlungslink, Anbieterangaben, Statuslink', async () => {
    enable();
    const o = await orders.createOrder(order('vertrag@example.test'), []);
    await mail.queueOrderConfirmation(o.id);
    const m = sent.at(-1)!;
    assert.deepEqual(m.to, ['vertrag@example.test']);
    assert.equal(m.subject, `Auftragsbestätigung ${o.number} – EasyKFZ24`);
    assert.equal(m.reply_to, 'kundenservice@easykfz24.de');
    for (const t of [
      o.number,
      'Neuzulassung',
      'Servicepauschale',
      'Gesamt (inkl. MwSt.)',
      'zzgl. amtlicher Gebühren',
      'Die Zahlung ist noch offen',
      'MONVEX UG (haftungsbeschränkt) i. G.',
      'Kirchbachstraße 200',
      'Mohammed Al Bakhit',
      'Vertragspartner',
    ]) {
      assert.ok(m.text.includes(t), t);
    }
    assert.match(m.html, /https:\/\/easykfz24\.de\/logo\/easykfz24-logo-mail\.png/);
    assert.match(m.html, new RegExp(`https://easykfz24\\.de/zahlung/${o.number}\\?t=`), 'sicherer Zahlungslink mit Token');
    assert.ok(m.text.includes(`https://easykfz24.de/status?nr=${o.number}`), 'Link zur Statusabfrage');
    assert.equal((m.text.match(/Neukundenrabatt|Rabatt:/g) ?? []).length <= 1, true, 'Rabatt nicht doppelt');
    assert.ok(!m.text.includes('Muster<script>') && !m.html.includes('<script>'), 'keine Halterdaten, nichts Ungefiltertes');
    assert.ok(!m.text.includes('Widerrufsbelehrung'), 'ohne geprüfte Freischaltung kein Widerrufstext');
    assert.ok(!m.text.includes('WVWZZZ1KZAW000444'), 'keine FIN');
  });

  it('mit WIDERRUF_AKTIV=1: Widerrufsbelehrung, Formular-Link und Bestätigung des vorzeitigen Beginns', async () => {
    enable();
    process.env.WIDERRUF_AKTIV = '1';
    try {
      const v = order('widerruf@example.test');
      (v.finish as unknown as Record<string, unknown>).vorzeitigerBeginnAt = '2026-10-13T10:00:00.000Z';
      const o = await orders.createOrder(v, []);
      await mail.queueOrderConfirmation(o.id);
      const m = sent.at(-1)!;
      assert.ok(m.text.includes('WIDERRUFSBELEHRUNG') && m.text.includes('vierzehn Tagen'));
      assert.ok(m.text.includes('https://easykfz24.de/widerruf'));
      assert.ok(m.text.includes('ausdrücklich verlangt, dass wir vor Ablauf der Widerrufsfrist'));
    } finally {
      delete process.env.WIDERRUF_AKTIV;
    }
  });
});

describe('Zahlungsbestätigung nur aus dem Mollie-Abgleich', () => {
  const idOf = (url: string) => new URL(url).searchParams.get('token')!;

  it('echte Zahlung: genau eine Bestätigung trotz mehrfacher Webhooks; Rückleitung allein löst nichts aus', async () => {
    enable();
    const o = await orders.createOrder(order('zahlung@example.test'), []);
    const s = await mollie.startMolliePayment(o.id, 'https://easykfz24.de');
    assert.ok(s.ok);
    const id = idOf(s.checkoutUrl);
    // Rückleitung ohne Zahlung: kein Abgleich-Erfolg, keine Mail
    await mollie.paymentStateForOrder(o.id);
    assert.ok(!(await msgs(o.id)).some((m) => m.mail_kind === 'zahlung_bestaetigt'));
    await control('/__test/set', { id, status: 'paid', method: 'creditcard' });
    await Promise.all([mollie.handleMollieWebhook(id), mollie.handleMollieWebhook(id), mollie.handleMollieWebhook(id)]);
    await mollie.handleMollieWebhook(id);
    const z = (await msgs(o.id)).filter((m) => m.mail_kind === 'zahlung_bestaetigt');
    assert.equal(z.length, 1);
    assert.equal(z[0].state, 'versendet');
    assert.match(sent.at(-1)!.subject, /Zahlung bestätigt/);
  });

  it('Testzahlung (Live-Hauptschlüssel), Betragsabweichung, Doppelzahlung: keine Zahlungsbestätigung', async () => {
    enable();
    const keys = FAKE_MOLLIE_KEYS as { test: string; live: string };
    process.env.MOLLIE_API_KEY = keys.live;
    process.env.MOLLIE_TEST_API_KEY = keys.test;
    try {
      const o = await orders.createOrder(order(), []);
      const t = await mollie.startMolliePayment(o.id, 'https://easykfz24.de', { test: true });
      assert.ok(t.ok);
      await control('/__test/set', { id: idOf(t.checkoutUrl), status: 'paid' });
      await mollie.handleMollieWebhook(idOf(t.checkoutUrl));
      assert.ok(!(await msgs(o.id)).some((m) => m.mail_kind === 'zahlung_bestaetigt'), 'Testzahlung');
    } finally {
      process.env.MOLLIE_API_KEY = keys.test;
      delete process.env.MOLLIE_TEST_API_KEY;
    }
    const o2 = await orders.createOrder(order(), []);
    const s2 = await mollie.startMolliePayment(o2.id, 'https://easykfz24.de');
    assert.ok(s2.ok);
    await control('/__test/set', { id: idOf(s2.checkoutUrl), status: 'paid', amountValue: '0.01' });
    await mollie.handleMollieWebhook(idOf(s2.checkoutUrl));
    assert.ok(!(await msgs(o2.id)).some((m) => m.mail_kind === 'zahlung_bestaetigt'), 'Betragsabweichung');
  });

  it('fehlgeschlagen → Hinweis mit Zahlungslink; Erstattung → Erstattungsmail je Stand einmal', async () => {
    enable();
    const o = await orders.createOrder(order(), []);
    const s = await mollie.startMolliePayment(o.id, 'https://easykfz24.de');
    assert.ok(s.ok);
    await control('/__test/set', { id: idOf(s.checkoutUrl), status: 'failed' });
    await mollie.handleMollieWebhook(idOf(s.checkoutUrl));
    assert.deepEqual(
      (await msgs(o.id)).map((m) => m.mail_kind),
      ['zahlung_fehlgeschlagen'],
    );
    assert.match(sent.at(-1)!.html, /Erneut bezahlen/);
    const s2 = await mollie.startMolliePayment(o.id, 'https://easykfz24.de');
    assert.ok(s2.ok);
    await control('/__test/set', { id: idOf(s2.checkoutUrl), status: 'paid' });
    await mollie.handleMollieWebhook(idOf(s2.checkoutUrl));
    await control('/__test/set', { id: idOf(s2.checkoutUrl), amountRefunded: '5.00' });
    await mollie.handleMollieWebhook(idOf(s2.checkoutUrl));
    await mollie.handleMollieWebhook(idOf(s2.checkoutUrl));
    assert.deepEqual(
      (await msgs(o.id)).map((m) => m.mail_kind),
      ['zahlung_fehlgeschlagen', 'zahlung_bestaetigt', 'erstattung'],
    );
  });
});

describe('Statusmails, Vollmacht, Wiederholung, Testmail', () => {
  it('Statuswechsel und Behördenmeldung teilen sich den Schlüssel → eine Mail je Anlass', async () => {
    enable();
    const o = await orders.createOrder(order(), []);
    await emitSafe({ type: 'order.status', orderId: o.id, actor: 'Inhaber', payload: { from: 'in_pruefung', to: 'bei_zulassungsstelle' } });
    const { notifyCustomer } = await import('../src/server/kfz-api.ts');
    await notifyCustomer(o.id, 'in_bearbeitung', 'ev-1');
    await emitSafe({ type: 'order.status', orderId: o.id, actor: 'kfz-api.de', payload: { from: 'bei_zulassungsstelle', to: 'zugelassen' } });
    await notifyCustomer(o.id, 'abgeschlossen', 'ev-2');
    await emitSafe({ type: 'order.status', orderId: o.id, actor: 'Inhaber', payload: { from: 'in_pruefung', to: 'unterlagen_fehlen' } });
    const kinds = (await msgs(o.id)).map((m) => m.mail_kind);
    assert.deepEqual(kinds, ['antrag_eingereicht', 'zulassung_abgeschlossen', 'unterlagen_erforderlich']);
  });

  it('Versandfehler → Wiederholung mit Abstand; nach 5 Versuchen „aufgegeben“ und Hinweis im OS', async () => {
    enable();
    const o = await orders.createOrder(order(), []);
    failNext = 1;
    await mail.queueStatusMail(o.id, 'antrag_eingereicht', `antrag:${o.id}`);
    let m = (await msgs(o.id))[0];
    assert.equal(m.state, 'fehler');
    assert.ok(Date.parse(m.next_attempt_at) > Date.now() + 4 * 60_000, 'nächster Versuch in 5 Minuten');
    assert.deepEqual(await mail.mailsDue(), [], 'noch nicht fällig');
    await (await db()).run("UPDATE messages SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE id = ?", m.id);
    const { runScheduledRules } = await import('../src/server/os/automation.ts');
    await runScheduledRules(true, ['mail_wiederholung']);
    m = (await msgs(o.id))[0];
    assert.deepEqual([m.state, m.attempts], ['versendet', 2]);
    // dauerhafter Fehler
    const o2 = await orders.createOrder(order(), []);
    failNext = 99;
    await mail.queueStatusMail(o2.id, 'antrag_eingereicht', `antrag:${o2.id}`);
    for (let i = 0; i < 6; i++) {
      await (await db()).run("UPDATE messages SET next_attempt_at = '2000-01-01T00:00:00.000Z' WHERE order_id = ? AND state = 'fehler'", o2.id);
      const due = await mail.mailsDue();
      for (const d of due) await mail.deliver(d.id);
    }
    failNext = 0;
    const m2 = (await msgs(o2.id))[0];
    assert.deepEqual([m2.state, m2.attempts], ['aufgegeben', 5]);
    const ev = await (await db()).first<{ type: string }>("SELECT type FROM os_events WHERE type = 'message.failed' AND order_id = ?", o2.id);
    assert.equal(ev?.type, 'message.failed');
  });

  it('Testmail: nur synthetische Inhalte an die angegebene Adresse, Nachweis-ID zurück', async () => {
    enable();
    const before = sent.length;
    const bad = await mail.sendTestMail('bestellung', 'keine-adresse', 'Inhaber');
    assert.ok(!bad.ok);
    const r = await mail.sendTestMail('zahlung_bestaetigt', 'inhaber@example.test', 'Inhaber');
    assert.ok(r.ok && r.providerId.startsWith('res_'));
    assert.equal(sent.length, before + 1);
    const m = sent.at(-1)!;
    assert.deepEqual(m.to, ['inhaber@example.test']);
    assert.match(m.subject, /^\[TEST\] Zahlung bestätigt – Auftrag EK-2026-TEST/);
  });
});
