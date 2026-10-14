// QES-Nachweis: technische Vorprüfung des signierten PDF und Nachweis je Partnervorgang als Freigabevoraussetzung.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';
import { emptyDraft, validateOrder, type ValidatedOrder } from '../src/lib/order.ts';
import { checkSignedPdf } from '../src/server/qes-check.ts';
import { plainPdf, signedPdf } from './helpers/qes-fixture.ts';
// @ts-expect-error – Testnachbau als .mjs ohne Typen
import { createFakeKfzApi } from '../scripts/fake-kfz-api.mjs';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-qes-'));
delete process.env.VOLLMACHT_DIGITAL;
const fake = createFakeKfzApi() as { server: import('node:http').Server };
let base = '';
const orders = await import('../src/server/orders.ts');
const poa = await import('../src/server/power-of-attorney.ts');
const oa = await import('../src/server/os/order-actions.ts');
const ev = await import('../src/server/os/poa-evidence.ts');
const { putBlob } = await import('../src/server/blobs.ts');
const { getDb } = await import('../src/server/db.ts');
const owner = { id: 0, name: 'Inhaber', role: 'inhaber' as const };
const staff = { name: 'Sachbearbeitung', role: 'verwaltung' as const };

before(async () => {
  await new Promise<void>((r) => fake.server.listen(0, '127.0.0.1', () => r()));
  base = `http://127.0.0.1:${(fake.server.address() as AddressInfo).port}`;
  Object.assign(process.env, { KFZ_API_BASE_URL: `${base}/fake-api/10/2.3.0`, KFZ_API_LOGIN: 'test', KFZ_API_PASSWORD: 'test' });
});
after(() => fake.server.close());

let fin = 500;
function order(): ValidatedOrder {
  const d = emptyDraft('halterwechsel');
  d.vehicle = {
    ...d.vehicle,
    art: 'pkw',
    hersteller: 'VW',
    modell: 'Golf',
    fin: `WVWZZZ1KZAW${String(700000 + fin++)}`,
    bisherigesKennzeichen: 'HB-EK 12',
    antrieb: 'benzin',
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
    email: 'syn@example.de',
    telefon: '0421 123456',
  };
  d.plate = { ...d.plate, wahl: 'behalten', zustellung: 'abholung' };
  d.finish = {
    ...d.finish,
    evb: 'A1B2C3D',
    kontoinhaber: 'Erika Synthetisch',
    iban: 'DE89 3704 0044 0532 0130 00',
    sepaMandat: true,
    vollmacht: true,
    datenschutz: true,
  };
  const v = validateOrder(d);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  const o = (v as { ok: true; order: ValidatedOrder }).order;
  o.finish.vorzeitigerBeginnAt = new Date().toISOString();
  return o;
}
async function upload(orderId: number, bytes: Uint8Array, category: string, mime = 'application/pdf') {
  const id = createHash('sha256').update(`${orderId}${Math.random()}`).digest('hex').slice(0, 32);
  const key = `${'a'.repeat(24)}/${id}.pdf`;
  await putBlob(key, bytes, mime);
  await (
    await getDb()
  ).run(
    'INSERT INTO documents (id, order_id, kind, original_name, mime, size, stored_name, sha256, created_at, category) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    orderId,
    'sonstiges',
    `${category}.pdf`,
    mime,
    bytes.byteLength,
    key,
    createHash('sha256').update(bytes).digest('hex'),
    new Date().toISOString(),
    category,
  );
  return id;
}
/** Bezahlter, prüfbereiter Auftrag mit vom Partner bestätigter Vollmacht (Testnachbau) */
async function signedOrder() {
  const db = await getDb();
  const d = await orders.createOrder(order(), []);
  const o = (await orders.getOrder(d.id))!;
  const checklist = Object.fromEntries(o.checklistItems.map((i) => [i.key, { checked: true, at: new Date().toISOString() }]));
  const codes = Object.fromEntries(['zb1', 'zb2', 'plaketten'].map((c) => [`code_${c}`, true]));
  await db.run(
    "UPDATE orders SET status = 'in_pruefung', payment_status = 'bezahlt', checklist_json = ?, reg_checks_json = ? WHERE id = ?",
    JSON.stringify(checklist),
    JSON.stringify(codes),
    d.id,
  );
  process.env.VOLLMACHT_DIGITAL = '1';
  try {
    const pv = await poa.previewPoa(d.id, staff, { sepa: false });
    const r = await poa.requestPoa(d.id, staff, { sepa: false, fingerprint: pv.ok ? pv.preview.fingerprint : '' });
    assert.ok(r.ok, JSON.stringify(r));
  } finally {
    delete process.env.VOLLMACHT_DIGITAL;
  }
  const rec = (await poa.latestPoa(d.id))!;
  await fetch(`${base}/__test/set`, { method: 'POST', body: JSON.stringify({ id: rec.process_id, status: 'signiert', ready: true }) });
  await poa.verifyPoa(rec.id, { force: true });
  return { id: d.id, number: d.number, processId: rec.process_id!, external: rec.external_order_id };
}
const input = (o: { processId: number }, pdf: string, report: string, over: Record<string, unknown> = {}) => ({
  processId: o.processId,
  pdfDocId: pdf,
  reportDocId: report,
  validator: 'Prüfsoftware (lokal, EU-Vertrauensliste)',
  result: 'gueltig_qualifiziert',
  signerName: 'Erika Synthetisch',
  signedAt: new Date().toISOString(),
  confirmed: true,
  ...over,
});

describe('Technische Vorprüfung signierter PDF', () => {
  it('erkennt Signatur, vollständige Abdeckung, passenden Hash und EU-Kennzeichen', () => {
    const r = checkSignedPdf(signedPdf({ reference: 'EK-2026-00001-V1' }), ['EK-2026-00001-V1']);
    assert.deepEqual(
      [r.ok, r.coversWholeFile, r.digestMatches, r.digestAlgorithm, r.qcCompliance, r.qscd, r.referenceFound],
      [true, true, true, 'SHA256', true, true, true],
      JSON.stringify(r),
    );
  });
  it('bloßes PDF, nachträglich geänderter Inhalt, angehängte Daten, fehlende Qualifizierung: nicht bestanden', () => {
    assert.ok(!checkSignedPdf(plainPdf()).ok);
    const pdf = Buffer.from(signedPdf());
    const changed = Buffer.from(pdf);
    changed[changed.length - 12] ^= 1; // Byte im signierten Bereich nach der Signatur
    const c = checkSignedPdf(new Uint8Array(changed));
    assert.ok(!c.ok && !c.digestMatches);
    const appended = checkSignedPdf(new Uint8Array(Buffer.concat([pdf, Buffer.from('\n% Nachtrag\n')])));
    assert.ok(!appended.ok && !appended.coversWholeFile);
    assert.ok(!checkSignedPdf(signedPdf({ qc: false })).ok);
    assert.ok(!checkSignedPdf(signedPdf({ qscd: false })).ok);
    assert.ok(!checkSignedPdf(new Uint8Array(Buffer.from('kein pdf'))).ok);
  });
});

describe('QES-Nachweis als Freigabevoraussetzung', () => {
  it('signiertes PDF in „Vollmacht“ allein genügt nicht; erst der geprüfte Nachweis mit Prüfbericht gibt frei', async () => {
    const o = await signedOrder();
    const pdf = await upload(o.id, signedPdf({ reference: o.external }), 'Vollmacht');
    const blocked = await oa.actRelease(o.id, true, owner);
    assert.ok(!blocked.ok && /QES-Nachweis fehlt/.test(blocked.error), JSON.stringify(blocked));
    const report = await upload(o.id, plainPdf(), 'Nachweise');
    const r = await ev.recordEvidence(o.id, input(o, pdf, report), 'Sachbearbeitung');
    assert.ok(r.ok, JSON.stringify(r));
    if (r.ok) assert.ok(r.evidence.valid && r.evidence.tech?.referenceFound);
    assert.ok((await oa.actRelease(o.id, true, owner)).ok);
    const evs = await (await getDb()).all<{ message: string }>("SELECT message FROM events WHERE order_id = ? AND type = 'vollmacht'", o.id);
    assert.ok(evs.some((e) => /QES-Nachweis erfasst \(Vorgang \d+\)/.test(e.message)));
  });

  it('abgewiesen: falsche Vorgangsnummer, fremder Unterzeichner, Ergebnis nicht qualifiziert, gleiche Datei, Bericht kein PDF, unsigniertes PDF, ohne Bestätigung', async () => {
    const o = await signedOrder();
    const pdf = await upload(o.id, signedPdf(), 'Vollmacht');
    const report = await upload(o.id, plainPdf(), 'Nachweise');
    const png = await upload(o.id, plainPdf(), 'Nachweise', 'image/png');
    const plain = await upload(o.id, plainPdf(), 'Vollmacht');
    const cases: [Record<string, unknown>, RegExp, string?, string?][] = [
      [{ processId: o.processId + 1 }, /Vorgangsnummer passt nicht/],
      [{ signerName: 'Max Fremd' }, /nicht der Halter/],
      [{ result: 'gueltig' }, /gültig – qualifizierte/],
      [{ confirmed: false }, /bestätigen/],
      [{ validator: '' }, /Validierungsdienst/],
      [{}, /separaten Prüfbericht/, pdf, pdf],
      [{}, /Prüfbericht muss als PDF/, pdf, png],
      [{}, /Technische Vorprüfung nicht bestanden/, plain, report],
      [{}, /Kategorie „Vollmacht“/, report, pdf],
    ];
    for (const [over, re, p, rep] of cases) {
      const r = await ev.recordEvidence(o.id, input(o, p ?? pdf, rep ?? report, over), 'Sachbearbeitung');
      assert.ok(!r.ok && re.test(r.error), `${JSON.stringify(over)}: ${JSON.stringify(r)}`);
    }
    assert.ok(!(await ev.poaEvidenceOk(o.id)));
  });

  it('Widerruf, gelöschte/ersetzte Dateien und neuer Vollmachtsvorgang machen den Nachweis ungültig', async () => {
    const db = await getDb();
    const o = await signedOrder();
    const pdf = await upload(o.id, signedPdf(), 'Vollmacht');
    const report = await upload(o.id, plainPdf(), 'Nachweise');
    const r = await ev.recordEvidence(o.id, input(o, pdf, report), 'Sachbearbeitung');
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.ok(await ev.poaEvidenceOk(o.id));
    // Datei gelöscht → ungültig
    await db.run('UPDATE documents SET deleted_at = ? WHERE id = ?', new Date().toISOString(), report);
    assert.ok(!(await ev.poaEvidenceOk(o.id)));
    assert.match((await ev.listEvidence(o.id))[0].invalidReason, /gelöscht oder ersetzt/);
    await db.run("UPDATE documents SET deleted_at = '' WHERE id = ?", report);
    assert.ok(await ev.poaEvidenceOk(o.id));
    // Widerruf → ungültig, Freigabe gesperrt
    assert.ok(!(await ev.revokeEvidence(o.id, r.evidence.id, '', 'X')).ok, 'Grund Pflicht');
    assert.ok((await ev.revokeEvidence(o.id, r.evidence.id, 'Prüfbericht gehört zu anderem Vorgang', 'Inhaber')).ok);
    assert.ok(!(await ev.poaEvidenceOk(o.id)));
    const rel = await oa.actRelease(o.id, true, owner);
    assert.ok(!rel.ok && /QES-Nachweis fehlt/.test(rel.error));
  });
});
