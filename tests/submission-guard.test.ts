// Absicherung aller Wege zu Partner und Behörde (Partnervertrag POWR § 3) und Testaufträge des Inhabers – nur synthetische
// Daten, kfz-api.de ausschließlich als lokaler Testnachbau (scripts/fake-kfz-api.mjs), keine echten Dienste.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { signKfzBody } from '../src/lib/kfz-api.ts';
import { emptyDraft, validateOrder, type OrderInput, type ValidatedOrder } from '../src/lib/order.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeKfzApi } from '../scripts/fake-kfz-api.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-submission-'));
process.env.KFZ_API_WEBHOOK_SECRET = 'submission-test-secret';
delete process.env.VOLLMACHT_DIGITAL;
delete process.env.VOLLMACHT_TESTMODUS;
const fake = createFakeKfzApi() as { server: import('node:http').Server; processes: Map<number, Record<string, unknown>> };
let base = '';

const orders = await import('../src/server/orders.ts');
const poa = await import('../src/server/power-of-attorney.ts');
const oa = await import('../src/server/os/order-actions.ts');
const kfz = await import('../src/server/kfz-api.ts');
const tests = await import('../src/server/os/test-orders.ts');
const { queryOrders } = await import('../src/server/os/order-query.ts');
const { startMolliePayment } = await import('../src/server/mollie.ts');
const { issueInvoice } = await import('../src/server/os/finance.ts');
const { queueStatusMail } = await import('../src/server/transactional-mail.ts');
const customers = await import('../src/server/os/customers.ts');
const { getDb } = await import('../src/server/db.ts');

const owner = { id: 0, name: 'Inhaber', role: 'inhaber' as const };
const staff = { id: 7, name: 'Sachbearbeitung', role: 'verwaltung' as const };
const control = async (p: string, body: unknown) => (await fetch(`${base}${p}`, { method: 'POST', body: JSON.stringify(body) })).json();

let finSeq = 100;
type Svc = 'neuzulassung' | 'halterwechsel' | 'umzug' | 'wiederzulassung' | 'abmeldung';
function draft(service: Svc = 'halterwechsel', typ: 'privat' | 'firma' = 'privat'): OrderInput {
  const d = emptyDraft(service);
  d.vehicle = {
    ...d.vehicle,
    art: 'pkw',
    hersteller: 'VW',
    modell: 'Golf',
    fin: `WVWZZZ1KZAW${String(800000 + finSeq++)}`,
    bisherigesKennzeichen: service === 'neuzulassung' ? '' : 'HB-EK 12',
    antrieb: 'benzin',
  };
  d.holder = {
    ...d.holder,
    typ,
    vorname: typ === 'privat' ? 'Erika' : '',
    nachname: typ === 'privat' ? 'Synthetisch' : '',
    geburtsdatum: typ === 'privat' ? '1988-03-15' : '',
    geburtsort: typ === 'privat' ? 'Kiel' : '',
    firmenname: typ === 'firma' ? 'Beispiel Test GmbH' : '',
    ansprechpartner: typ === 'firma' ? 'Max Test' : '',
    strasse: 'Testweg',
    hausnummer: '1',
    plz: '28195',
    ort: 'Bremen',
    email: 'synthetisch@example.de',
    telefon: '0421 123456',
  };
  d.plate =
    service === 'abmeldung'
      ? { ...d.plate, wahl: '', zustellung: 'abholung' }
      : { ...d.plate, wahl: service === 'neuzulassung' || service === 'wiederzulassung' ? 'neu' : 'behalten', zustellung: 'abholung' };
  d.finish =
    service === 'abmeldung'
      ? { ...d.finish, vollmacht: true, datenschutz: true }
      : {
          ...d.finish,
          evb: 'A1B2C3D',
          kontoinhaber: 'Erika Synthetisch',
          iban: 'DE89 3704 0044 0532 0130 00',
          sepaMandat: true,
          vollmacht: true,
          datenschutz: true,
        };
  return d;
}
function validated(service: Svc = 'halterwechsel'): ValidatedOrder {
  const v = validateOrder(draft(service));
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  const o = (v as { ok: true; order: ValidatedOrder }).order;
  o.finish.vorzeitigerBeginnAt = new Date().toISOString();
  return o;
}
/** Alles erledigt außer der Vollmacht: In Prüfung, Checkliste vollständig abgehakt, bezahlt, Sicherheitscodes bestätigt */
async function readyExceptPoa(id: number) {
  const db = await getDb();
  const o = (await orders.getOrder(id))!;
  const checklist = Object.fromEntries(o.checklistItems.map((i) => [i.key, { checked: true, at: new Date().toISOString() }]));
  const codes = Object.fromEntries(['zb1', 'zb2', 'plaketten', 'coc'].map((c) => [`code_${c}`, true]));
  await db.run(
    "UPDATE orders SET status = 'in_pruefung', payment_status = 'bezahlt', checklist_json = ?, reg_checks_json = ? WHERE id = ?",
    JSON.stringify(checklist),
    JSON.stringify(codes),
    id,
  );
}
async function requestSigned(id: number, ready = true) {
  process.env.VOLLMACHT_DIGITAL = '1';
  try {
    const pv = await poa.previewPoa(id, staff, { sepa: false });
    const r = await poa.requestPoa(id, staff, { sepa: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(r.ok, JSON.stringify(r));
  } finally {
    delete process.env.VOLLMACHT_DIGITAL;
  }
  const rec = (await poa.latestPoa(id))!;
  await control('/__test/set', { id: rec.process_id, status: 'signiert', ready, missing: ready ? [] : ['Ort'] });
  await poa.verifyPoa(rec.id, { force: true });
  return rec;
}
const webhook = async (body: Record<string, unknown>, eventId: string, secret = 'submission-test-secret') => {
  const raw = JSON.stringify(body);
  const r = await kfz.handleKfzWebhook(raw, new Headers({ 'X-Signature': signKfzBody(raw, secret), 'X-Event-Id': eventId }));
  await r.after?.();
  return r.result;
};
const events = async (id: number) =>
  (await (await getDb()).all<{ message: string }>('SELECT message FROM events WHERE order_id = ? ORDER BY id', id)).map((e) => e.message);

before(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  process.env.KFZ_API_BASE_URL = `${base}/fake-api/10/2.3.0`;
  process.env.KFZ_API_LOGIN = 'test';
  process.env.KFZ_API_PASSWORD = 'test';
});
after(() => fake.server.close());

describe('QES-Pflicht unabhängig vom Schalter VOLLMACHT_DIGITAL', () => {
  it('Fehlende QES trotz vollständig abgehakter Checkliste, Zahlung und Sicherheitscodes: Freigabe gesperrt (Schalter aus)', async () => {
    assert.equal(process.env.VOLLMACHT_DIGITAL, undefined);
    for (const s of ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung'] as const) {
      const d = await orders.createOrder(validated(s), []);
      const o = (await orders.getOrder(d.id))!;
      assert.ok(!o.checklistItems.some((i) => i.key === 'vollmacht_original'), `${s}: kein Papier-Häkchen für die Vollmacht`);
      assert.equal(o.data.finish.vollmacht, true, 'Checkout-Bestätigung liegt vor');
      await readyExceptPoa(d.id);
      const r = await oa.actRelease(d.id, true, owner);
      assert.ok(!r.ok && /Digitale Vollmacht nicht vom Partner/.test(r.error), `${s}: ${JSON.stringify(r)}`);
    }
  });

  it('Abmeldung (Außerbetriebsetzung) braucht keine QES', async () => {
    const d = await orders.createOrder(validated('abmeldung'), []);
    await readyExceptPoa(d.id);
    const r = await oa.actRelease(d.id, true, owner);
    assert.ok(r.ok, JSON.stringify(r));
  });

  it('nicht signiert, abgelehnt, abgebrochen oder unvollständig: gesperrt; erst der Partnerabgleich „signiert + vollständig“ gibt frei', async () => {
    const d = await orders.createOrder(validated(), []);
    await readyExceptPoa(d.id);
    const rec = await requestSigned(d.id, false);
    assert.ok(!(await oa.actRelease(d.id, true, owner)).ok, 'unvollständig');
    for (const [status, note] of [
      ['offen', 'Identifizierung abgebrochen'],
      ['abgelehnt', ''],
      ['fehlgeschlagen', ''],
    ]) {
      await control('/__test/set', { id: rec.process_id, status, ready: false, note });
      await poa.verifyPoa(rec.id, { force: true });
      const r = await oa.actRelease(d.id, true, owner);
      assert.ok(!r.ok && /Digitale Vollmacht/.test(r.error), status);
    }
    assert.ok(
      (await events(d.id)).some((m) => /Hinweis des Partners.*Identifizierung abgebrochen/.test(m)),
      'Abbruch steht im Verlauf',
    );
    await control('/__test/set', { id: rec.process_id, status: 'signiert', ready: true, missing: [], note: '' });
    await poa.verifyPoa(rec.id, { force: true });
    assert.equal(process.env.VOLLMACHT_DIGITAL, undefined, 'Schalter weiterhin aus');
    const ok = await oa.actRelease(d.id, true, owner);
    assert.ok(ok.ok, JSON.stringify(ok));
  });
});

describe('Manuelle Verknüpfung eines kfz-api.de-Vorgangs', () => {
  it('nur mit interner Freigabe und vom Partner bestätigter QES', async () => {
    const db = await getDb();
    const d = await orders.createOrder(validated(), []);
    const noRelease = await kfz.linkKfzOrder(d.id, 'KFZ-SYN-1');
    assert.ok(!noRelease.ok && /keine interne Freigabe/.test(noRelease.error) && /QES-Vollmacht/.test(noRelease.error));
    // Freigabe ohne QES (z. B. Altbestand): weiterhin gesperrt
    await db.run('UPDATE orders SET released_at = ? WHERE id = ?', new Date().toISOString(), d.id);
    const noQes = await kfz.linkKfzOrder(d.id, 'KFZ-SYN-1');
    assert.ok(!noQes.ok && /QES-Vollmacht nicht vom Partner bestätigt/.test(noQes.error));
    await requestSigned(d.id);
    assert.ok((await kfz.linkKfzOrder(d.id, 'KFZ-SYN-1')).ok);
    assert.ok((await kfz.linkKfzOrder(d.id, '')).ok, 'Lösen bleibt möglich');
  });
});

describe('Eingehende Webhooks', () => {
  it('ungültige Signatur: abgewiesen, nichts geändert', async () => {
    const d = await orders.createOrder(validated(), []);
    const r = await webhook({ order: { id: 9001, externalId: d.number }, businessTransaction: 'UG', status: 'ACCEPTED' }, 'syn-bad', 'falsches-geheimnis');
    assert.ok(r.status >= 400);
    assert.equal((await orders.getOrder(d.id))!.status, 'neu');
  });

  it('extern eingereicht ohne Freigabe und ohne QES: Stand protokolliert, nichts als erfüllt markiert, sofortige Warnung im OS', async () => {
    const db = await getDb();
    const d = await orders.createOrder(validated(), []);
    // manipulierte Zusatzfelder (Vollmacht „signiert“) werden ignoriert
    const r = await webhook(
      {
        order: { id: 9002, externalId: d.number },
        businessTransaction: 'UG',
        status: 'ACCEPTED',
        powerOfAttorney: { status: 'signed', readyForApplication: true },
        released: true,
      },
      'syn-ext-1',
    );
    assert.equal(r.status, 200);
    const o = (await db.first<{ status: string; released_at: string; kfz_order_id: string }>(
      'SELECT status, released_at, kfz_order_id FROM orders WHERE id = ?',
      d.id,
    ))!;
    assert.equal(o.status, 'bei_zulassungsstelle', 'echter externer Stand übernommen');
    assert.equal(o.released_at, '', 'Freigabe nicht vorgetäuscht');
    assert.equal(o.kfz_order_id, '9002');
    assert.equal(await poa.latestPoa(d.id), null, 'kein Vollmachtsstand aus dem Webhook');
    assert.ok((await events(d.id)).some((m) => /^WARNUNG: kfz-api\.de meldet einen Vorgang .*keine interne Freigabe.*QES-Vollmacht/.test(m)));
    const ev = await db.all<{ type: string }>("SELECT type FROM os_events WHERE order_id = ? AND type = 'order.compliance'", d.id);
    assert.equal(ev.length, 1);
    const n = await db.all<{ kind: string; priority: string }>(
      "SELECT kind, priority FROM os_notifications WHERE order_id = ? AND kind = 'freigabe_verstoss'",
      d.id,
    );
    assert.deepEqual(
      n.map((x) => x.priority),
      ['kritisch'],
    );
    const insights = await oa.orderInsights((await orders.getOrder(d.id))!);
    assert.ok(insights.issues.some((i) => i.code === 'extern_ohne_freigabe' && i.level === 'fehler'));
    const list = await queryOrders({ status: 'alle', q: d.number }, 0);
    assert.ok(
      list[0].issues.some((i) => i.code === 'extern_ohne_freigabe'),
      'auch in der Liste sichtbar',
    );
    // Wiederholung derselben Meldung: keine zweite Warnung
    await webhook({ order: { id: 9002, externalId: d.number }, businessTransaction: 'UG', status: 'ACCEPTED' }, 'syn-ext-1');
    assert.equal((await events(d.id)).filter((m) => m.startsWith('WARNUNG')).length, 1);
  });

  it('nach Freigabe mit bestätigter QES: keine Warnung', async () => {
    const d = await orders.createOrder(validated(), []);
    await readyExceptPoa(d.id);
    await requestSigned(d.id);
    assert.ok((await oa.actRelease(d.id, true, owner)).ok);
    await oa.actStatus(d.id, 'bei_zulassungsstelle', '', '', owner);
    await webhook({ order: { id: 9003, externalId: d.number }, businessTransaction: 'UG', status: 'ACCEPTED' }, 'syn-ok-1');
    assert.ok(!(await events(d.id)).some((m) => m.startsWith('WARNUNG')));
    const insights = await oa.orderInsights((await orders.getOrder(d.id))!);
    assert.ok(!insights.issues.some((i) => i.code === 'extern_ohne_freigabe'));
  });

  it('Abmeldung: Freigabe genügt, keine QES-Warnung', async () => {
    const d = await orders.createOrder(validated('abmeldung'), []);
    await readyExceptPoa(d.id);
    assert.ok((await oa.actRelease(d.id, true, owner)).ok);
    await webhook({ order: { id: 9004, externalId: d.number }, businessTransaction: 'AB', status: 'ACCEPTED' }, 'syn-ab-1');
    assert.ok(!(await events(d.id)).some((m) => m.startsWith('WARNUNG')));
  });
});

describe('Testaufträge des Inhabers', () => {
  it('Standard AUS: ohne VOLLMACHT_TESTMODUS weder Testfenster noch Testauftrag – auch nicht für den Inhaber', async () => {
    const w = await tests.setTestWindow(true, owner);
    assert.ok(!w.ok && /VOLLMACHT_TESTMODUS/.test(w.error));
    const c = await tests.createTestOrder(draft(), owner);
    assert.ok(!c.ok && /VOLLMACHT_TESTMODUS/.test(c.error));
  });

  it('nur Inhaber, nur im offenen Testfenster, höchstens drei; Kennzeichnung TEST-…, nichts angefordert, nichts verschickt', async () => {
    process.env.VOLLMACHT_TESTMODUS = '1';
    try {
      const db = await getDb();
      const before = fake.processes.size;
      for (const role of ['verwaltung', 'sachbearbeitung', 'buchhaltung', 'lesen'] as const) {
        const a = { name: role, role };
        assert.ok(!(await tests.setTestWindow(true, a)).ok, role);
        const c = await tests.createTestOrder(draft(), a);
        assert.ok(!c.ok && /Nur der Inhaber/.test(c.error), role);
      }
      const closed = await tests.createTestOrder(draft(), owner);
      assert.ok(!closed.ok && /Kein offenes Testfenster/.test(closed.error));
      const w = await tests.setTestWindow(true, owner);
      assert.ok(w.ok && w.window && Date.parse(w.window.expiresAt) - Date.now() <= tests.TEST_WINDOW_MINUTES * 60_000);
      const firma = await tests.createTestOrder(draft('halterwechsel', 'firma'), owner);
      assert.ok(!firma.ok);
      const abm = await tests.createTestOrder(draft('abmeldung'), owner);
      assert.ok(!abm.ok && /nur für Zulassung, Ummeldung oder Wiederzulassung/.test(abm.error));
      const t = await tests.createTestOrder({ ...draft(), finish: { ...draft().finish, vorzeitigerBeginn: true, widerrufErlischt: true } }, owner);
      assert.ok(t.ok, JSON.stringify(t));
      if (!t.ok) return;
      assert.match(t.number, /^TEST-\d{4}-\d{5}$/);
      const row = (await db.first<{ is_test: number; customer_id: number | null; source: string }>(
        'SELECT is_test, customer_id, source FROM orders WHERE id = ?',
        t.id,
      ))!;
      assert.deepEqual([row.is_test, row.customer_id, row.source], [1, null, 'test']);
      assert.equal(fake.processes.size, before, 'Anlegen fordert keine Vollmacht an');
      assert.equal((await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM messages WHERE order_id = ?', t.id))?.n, 0, 'keine Mail');
      assert.ok((await events(t.id)).some((m) => /^TESTAUFTRAG angelegt/.test(m)));
      // nicht mit echten Bestellungen gemischt
      assert.ok(!(await queryOrders({ status: 'alle' }, 0)).some((o) => o.id === t.id));
      assert.ok((await queryOrders({ status: 'alle', test: 'nur' }, 0)).some((o) => o.id === t.id));
      // höchstens drei je Fenster (zwei weitere, dann Schluss)
      assert.ok((await tests.createTestOrder(draft(), owner)).ok);
      assert.ok((await tests.createTestOrder(draft(), owner)).ok);
      const fourth = await tests.createTestOrder(draft(), owner);
      assert.ok(!fourth.ok && /höchstens 3/.test(fourth.error));
      // Fenster schließen: Schluss
      assert.ok((await tests.setTestWindow(false, owner)).ok);
      assert.equal(await tests.getTestWindow(), null);
    } finally {
      delete process.env.VOLLMACHT_TESTMODUS;
    }
  });

  it('Testauftrag: keine Zahlung, Rechnung, Freigabe, Verknüpfung, Kundenmail oder Kundenstamm', async () => {
    const db = await getDb();
    const t = await orders.createOrder(validated(), [], { test: { actor: 'Inhaber' } });
    await readyExceptPoa(t.id);
    await db.run("UPDATE orders SET payment_status = 'offen' WHERE id = ?", t.id);
    const pay = await oa.actPayment(t.id, 'bezahlt', 'SYN-REF-1', owner);
    assert.ok(!pay.ok && /Testauftrag/.test(pay.error));
    assert.ok(!(await startMolliePayment(t.id, 'http://127.0.0.1')).ok);
    const inv = await issueInvoice(t.id, 'Inhaber');
    assert.ok(!inv.ok);
    const rel = await oa.actRelease(t.id, true, owner);
    assert.ok(!rel.ok && /Testauftrag/.test(rel.error));
    const link = await kfz.linkKfzOrder(t.id, 'KFZ-SYN-T');
    assert.ok(!link.ok && /Testauftrag/.test(link.error));
    const mail = await queueStatusMail(t.id, 'vollmacht_bestaetigt', `syn:${t.id}`);
    assert.ok(!mail.queued && /Testauftrag/.test(mail.reason));
    assert.equal(await customers.linkOrderToCustomer(t.id), null);
    // ein (nie zulässiger) externer Vorgang zu einem Testauftrag wird sofort gemeldet
    await webhook({ order: { id: 9005, externalId: t.number }, businessTransaction: 'UG', status: 'ACCEPTED' }, 'syn-test-1');
    assert.ok((await events(t.id)).some((m) => /^WARNUNG.*Testauftrag/.test(m)));
  });

  it('echte Nect-Anforderung nur nach Testfreigabe genau dieses Testauftrags durch den Inhaber; echte Kundenaufträge nie im Testmodus', async () => {
    process.env.VOLLMACHT_TESTMODUS = '1';
    try {
      const real = await orders.createOrder(validated(), []);
      const g1 = await poa.setTestRelease(real.id, true, owner);
      assert.ok(!g1.ok && /nur für Testaufträge/.test(g1.error));
      const t = await orders.createOrder(validated(), [], { test: { actor: 'Inhaber' } });
      const other = await orders.createOrder(validated(), [], { test: { actor: 'Inhaber' } });
      const before = fake.processes.size;
      const request = async (id: number, actor: { name: string; role: 'inhaber' | 'verwaltung' }) => {
        const pv = await poa.previewPoa(id, actor, { sepa: false });
        return poa.requestPoa(id, actor, { sepa: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
      };
      assert.ok(!(await request(t.id, owner)).ok, 'ohne Testfreigabe nichts');
      assert.ok(!(await poa.setTestRelease(t.id, true, staff)).ok, 'nur Inhaber gibt frei');
      assert.ok((await poa.setTestRelease(t.id, true, owner)).ok);
      assert.ok(!(await request(t.id, staff)).ok, 'Mitarbeiter darf nicht anfordern');
      assert.ok(!(await request(other.id, owner)).ok, 'anderer Testauftrag nicht freigegeben');
      assert.equal(fake.processes.size, before);
      const r = await request(t.id, owner);
      assert.ok(r.ok, JSON.stringify(r));
      assert.equal(fake.processes.size, before + 1, 'genau ein Vorgang (Testnachbau)');
      // Freigabe bleibt für Testaufträge gesperrt – auch mit unterschriebener Vollmacht
      const rec = (await poa.latestPoa(t.id))!;
      await control('/__test/set', { id: rec.process_id, status: 'signiert', ready: true });
      await poa.verifyPoa(rec.id, { force: true });
      await readyExceptPoa(t.id);
      const rel = await oa.actRelease(t.id, true, owner);
      assert.ok(!rel.ok && /Testauftrag/.test(rel.error));
    } finally {
      delete process.env.VOLLMACHT_TESTMODUS;
    }
  });
});

describe('Aufbewahrung und Datensparsamkeit bei der Anonymisierung', () => {
  it('Korrespondenz übermittelter Aufträge bleibt, sonst Text und HTML geleert; Vollmachtshinweise anonymisierter Aufträge entfernt', async () => {
    const db = await getDb();
    const sent = await orders.createOrder(validated(), []);
    const other = await orders.createOrder(validated(), []);
    const cid = (await customers.linkOrderToCustomer(sent.id))!.customerId;
    await customers.linkOrderToCustomer(other.id);
    await db.run(
      "UPDATE orders SET released_at = ?, status = 'abgeschlossen', updated_at = ? WHERE id = ?",
      new Date().toISOString(),
      new Date().toISOString(),
      sent.id,
    );
    await db.run("UPDATE orders SET status = 'storniert' WHERE id = ?", other.id);
    for (const id of [sent.id, other.id])
      await db.run(
        "INSERT INTO messages (at, order_id, customer_id, to_addr, subject, body, html, state) VALUES (?, ?, ?, 'synthetisch@example.de', 'Betreff', 'Text', '<p>HTML</p>', 'versendet')",
        new Date().toISOString(),
        id,
        cid,
      );
    await db.run(
      "INSERT INTO power_of_attorneys (order_id, attempt, external_order_id, status, note, signature_url, created_at, updated_at) VALUES (?, 1, 'SYN-V1', 'abgelehnt', 'Name weicht ab: Erika', 'https://sign.example.test/x', ?, ?)",
      other.id,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    const check = await customers.erasureCheck(cid);
    assert.ok(
      check.retained.some((r) => new RegExp(`${sent.number} bis \\d{4}-\\d{2}-\\d{2}`).test(r)),
      'Aufbewahrung mit Prüfdatum, nicht unbefristet',
    );
    assert.ok((await customers.anonymizeCustomer(cid, 'Test')).ok);
    const msg = async (id: number) => ({
      ...(await db.first<{ body: string; html: string; to_addr: string }>('SELECT body, html, to_addr FROM messages WHERE order_id = ?', id))!,
    });
    assert.deepEqual(await msg(sent.id), { body: 'Text', html: '<p>HTML</p>', to_addr: 'synthetisch@example.de' });
    assert.deepEqual(await msg(other.id), { body: '', html: '', to_addr: '' });
    const p = {
      ...(await db.first<{ note: string; signature_url: string; status: string }>(
        'SELECT note, signature_url, status FROM power_of_attorneys WHERE order_id = ?',
        other.id,
      ))!,
    };
    assert.deepEqual(p, { note: '', signature_url: '', status: 'abgelehnt' });
  });
});

describe('Testauftrag nach dem Test: Testdaten löschen, Kosten nur einmal', () => {
  it('kein zweiter kostenpflichtiger Vorgang ohne neue Freigabe – auch nach Ablehnung; dann Testdaten löschen (nur Inhaber, nur storniert)', async () => {
    process.env.VOLLMACHT_TESTMODUS = '1';
    try {
      const db = await getDb();
      const t = await orders.createOrder(validated(), [], { test: { actor: 'Inhaber' } });
      const req = async () => {
        const pv = await poa.previewPoa(t.id, owner, { sepa: false });
        return poa.requestPoa(t.id, owner, { sepa: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
      };
      assert.ok((await poa.setTestRelease(t.id, true, owner)).ok);
      const before = fake.processes.size;
      assert.ok((await req()).ok);
      const rec = (await poa.latestPoa(t.id))!;
      await control('/__test/set', { id: rec.process_id, status: 'abgelehnt', ready: false, note: 'Identifizierung abgebrochen' });
      await poa.verifyPoa(rec.id, { force: true });
      const second = await req();
      assert.ok(!second.ok && /verbraucht/.test(second.error), JSON.stringify(second));
      assert.equal(fake.processes.size, before + 1, 'genau ein kostenpflichtiger Vorgang');
      // Löschen: nur Inhaber, erst nach Storno und zurückgezogener Freigabe
      assert.ok(!(await tests.anonymizeTestOrder(t.id, staff)).ok);
      const open = await tests.anonymizeTestOrder(t.id, owner);
      assert.ok(!open.ok && /stornieren/.test(open.error));
      await db.run("UPDATE orders SET status = 'storniert' WHERE id = ?", t.id);
      const rel = await tests.anonymizeTestOrder(t.id, owner);
      assert.ok(!rel.ok && /Testfreigabe zurückziehen/.test(rel.error));
      await poa.setTestRelease(t.id, false, owner);
      assert.ok((await tests.anonymizeTestOrder(t.id, owner)).ok);
      const o = (await db.first<{ holder_name: string; email: string; fin: string; data_json: string }>(
        'SELECT holder_name, email, fin, data_json FROM orders WHERE id = ?',
        t.id,
      ))!;
      assert.deepEqual([o.holder_name, o.email, o.fin], ['gelöscht (Testauftrag)', '', '']);
      const data = JSON.parse(o.data_json) as ValidatedOrder;
      assert.deepEqual(
        [data.holder.vorname, data.holder.geburtsdatum, data.holder.geburtsort, data.holder.strasse, data.finish.iban, data.vehicle.fin],
        ['', '', '', '', '', ''],
      );
      const p = {
        ...(await db.first<{ process_id: number; status: string; note: string; signature_url: string }>(
          'SELECT process_id, status, note, signature_url FROM power_of_attorneys WHERE order_id = ?',
          t.id,
        ))!,
      };
      assert.deepEqual(
        p,
        { process_id: rec.process_id, status: 'abgelehnt', note: '', signature_url: '' },
        'Vorgangsnummer und Stand bleiben für die Abrechnung',
      );
      assert.ok(!(await tests.anonymizeTestOrder(t.id, owner)).ok, 'nicht doppelt');
      // echte Aufträge nie über diesen Weg
      const real = await orders.createOrder(validated(), []);
      const r = await tests.anonymizeTestOrder(real.id, owner);
      assert.ok(!r.ok && /Kein Testauftrag/.test(r.error));
    } finally {
      delete process.env.VOLLMACHT_TESTMODUS;
    }
  });
});

describe('Inhaber-Testformular: Vollmacht entsteht erst über Nect, SEPA freiwillig', () => {
  const plain = (service: Svc = 'halterwechsel') => {
    const d = draft(service);
    // wie im OS-Testformular: kein „Vollmacht liegt vor“, SEPA: Nein (alles leer)
    d.finish = { ...d.finish, vollmacht: false, kontoinhaber: '', iban: '', sepaMandat: false, vorzeitigerBeginn: true, widerrufErlischt: true };
    return d;
  };

  it('echte Aufträge (Website/Verwaltung): Vollmacht und SEPA-Mandat bleiben Pflicht', () => {
    const v = validateOrder(plain());
    assert.ok(!v.ok);
    if (v.ok) return;
    assert.match(v.errors['finish.vollmacht'] ?? '', /Ohne Vollmacht/);
    assert.match(v.errors['finish.sepaMandat'] ?? '', /SEPA-Lastschriftmandat/);
    assert.match(v.errors['finish.iban'] ?? '', /.+/);
  });

  it('Testauftrag ohne Vollmacht und mit SEPA: Nein anlegen, Vorschau ohne SEPA, nichts beim Partner – nichts als vorhanden behauptet', async () => {
    process.env.VOLLMACHT_TESTMODUS = '1';
    try {
      assert.ok((await tests.setTestWindow(true, owner)).ok);
      const before = fake.processes.size;
      for (const s of ['halterwechsel', 'neuzulassung', 'umzug', 'wiederzulassung'] as const) {
        const t = await tests.createTestOrder(plain(s), owner);
        assert.ok(t.ok, `${s}: ${JSON.stringify(t)}`);
        if (!t.ok) continue;
        const o = (await orders.getOrder(t.id))!;
        assert.deepEqual([o.data.finish.vollmacht, o.data.finish.sepaMandat, o.data.finish.iban], [false, false, ''], 'nichts als vorhanden behauptet');
        const ins = await oa.orderInsights(o);
        assert.ok(!ins.issues.some((i) => i.level === 'fehler' && (i.code === 'sepa' || i.code === 'vollmacht')), JSON.stringify(ins.issues));
        assert.ok(ins.issues.some((i) => i.code === 'vollmacht' && i.level === 'hinweis'));
        assert.ok(
          ins.releaseBlockers.some((b) => /Testauftrag/.test(b)),
          'nie einreichbar',
        );
        // Nect-Vorschau (nur Inhaber mit Testfreigabe), SEPA: Nein
        assert.ok((await poa.setTestRelease(t.id, true, owner)).ok);
        const pv = await poa.previewPoa(t.id, owner, { sepa: false });
        assert.ok(pv.ok, `${s}: ${JSON.stringify(pv)}`);
        if (!pv.ok) continue;
        assert.equal(pv.preview.sepa.chosen, false);
        assert.equal(pv.preview.sepa.available, false);
        assert.deepEqual([pv.preview.costs.netCents, pv.preview.costs.grossCents], [695, 827]);
        // SEPA: Ja ohne Kontodaten ist nicht möglich
        const pvSepa = await poa.previewPoa(t.id, owner, { sepa: true });
        assert.ok(!pvSepa.ok && pvSepa.reasons?.some((r) => /SEPA-Mandat gewählt, aber nicht möglich/.test(r)));
        await poa.setTestRelease(t.id, false, owner);
        if (s === 'umzug') break; // höchstens 3 je Fenster
      }
      assert.equal(fake.processes.size, before, 'keine Anforderung beim Partner');
    } finally {
      await tests.setTestWindow(false, owner);
      delete process.env.VOLLMACHT_TESTMODUS;
    }
  });

  it('Testauftrag mit SEPA: Ja wird vollständig geprüft (Kontoinhaber, IBAN)', async () => {
    const d = plain();
    d.finish = { ...d.finish, iban: 'DE00 1234', kontoinhaber: '', sepaMandat: true };
    const v = validateOrder(d, { testOrder: true, requireBirthPlace: true, digitalPoa: true });
    assert.ok(!v.ok && v.errors['finish.iban'] && v.errors['finish.kontoinhaber']);
    d.finish = { ...d.finish, iban: 'DE89 3704 0044 0532 0130 00', kontoinhaber: 'Erika Synthetisch' };
    const ok = validateOrder(d, { testOrder: true, requireBirthPlace: true, digitalPoa: true });
    assert.ok(ok.ok && ok.order.finish.sepaMandat && ok.order.finish.vollmacht === false);
  });
});

describe('Testaufträge nicht in Umsatz, Statistik, Export oder Dublettenprüfung', () => {
  it('Umsätze, Deckungsbeiträge, offene Posten, Dashboard und FIN-Dubletten ignorieren Testaufträge', async () => {
    const finance = await import('../src/server/os/finance.ts');
    const { dashboardData } = await import('../src/server/os/dashboard.ts');
    const before = {
      totals: JSON.stringify(await finance.periodTotals()),
      items: (await finance.openItems()).length,
      contrib: (await finance.contributions()).length,
    };
    const t = await orders.createOrder(validated(), [], { test: { actor: 'Inhaber' } });
    assert.equal(JSON.stringify(await finance.periodTotals()), before.totals, 'Umsatz unverändert');
    assert.equal((await finance.openItems()).length, before.items, 'keine offenen Posten');
    assert.ok(!(await finance.contributions()).some((c) => (c as unknown as { id: number }).id === t.id), 'kein Deckungsbeitrag');
    const dash = JSON.stringify(await dashboardData(0, 30));
    assert.ok(!dash.includes(t.number), 'nicht im Dashboard');
    // gleiche FIN wie ein echter Auftrag: keine Dublettenwarnung beim echten Auftrag
    const o = (await orders.getOrder(t.id))!;
    const real = await orders.createOrder({ ...validated(), vehicle: { ...validated().vehicle, fin: o.data.vehicle.fin } }, []);
    const ins = await oa.orderInsights((await orders.getOrder(real.id))!);
    assert.ok(!ins.issues.some((i) => i.code === 'doppelt'), JSON.stringify(ins.issues));
  });
});
