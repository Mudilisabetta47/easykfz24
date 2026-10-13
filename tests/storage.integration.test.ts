// Integrationstest der Speicherschicht (lokale SQLite-Datei, gleiche Schnittstelle wie Cloudflare D1/R2):
// Auftrag mit Upload anlegen, lesen, Status ändern, Datei zurücklesen, Statusabfrage, Webhook-Zuordnung.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { signKfzBody } from '../src/lib/kfz-api.ts';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-store-'));
process.env.KFZ_API_WEBHOOK_SECRET = 'storage-test-secret';

const orders = await import('../src/server/orders.ts');
const { handleKfzWebhook } = await import('../src/server/kfz-api.ts');

function draft() {
  const d = emptyDraft('halterwechsel');
  d.vehicle = { art: 'pkw', hersteller: 'Audi', modell: 'A5', fin: 'WAUZZZF55KA012345', bisherigesKennzeichen: 'HB-EZ 24', antrieb: 'benzin', eKennzeichen: false, hKennzeichen: false };
  d.holder = { ...d.holder, typ: 'privat', vorname: 'Erika', nachname: 'Muster', geburtsdatum: '1984-03-07', strasse: 'Weg', hausnummer: '1', plz: '28195', ort: 'Bremen', email: 'erika@example.de', telefon: '0421 123456' };
  d.plate = { wahl: 'behalten', wunschkennzeichen: '', wunschort: '', schilder: false, ausfuehrung: 'standard', zustellung: 'abholung', versanddienst: '' };
  d.finish = { evb: 'a1b2c3d', kontoinhaber: 'Erika Muster', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true, hinweise: '' };
  return d;
}

const PDF = new TextEncoder().encode('%PDF-1.4\n%Test\n');

describe('Speicherschicht', () => {
  let id = 0;
  let number = '';
  it('legt einen Auftrag mit Upload atomar an und vergibt fortlaufende Nummern', async () => {
    const v = validateOrder(draft());
    assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
    if (!v.ok) return;
    const a = await orders.createOrder(v.order, [{ kind: 'ausweis', name: 'ausweis.pdf', bytes: PDF, type: { mime: 'application/pdf', ext: 'pdf' } }]);
    const b = await orders.createOrder(v.order, []);
    assert.match(a.number, /^EK-\d{4}-00001$/);
    assert.match(b.number, /^EK-\d{4}-00002$/);
    assert.equal(a.discountApplied, true, 'erster Auftrag = Neukunde');
    assert.equal(b.discountApplied, false, 'zweiter Auftrag derselben E-Mail ohne Rabatt');
    id = a.id;
    number = a.number;
  });
  it('liest Auftrag, Dokument und Datei zurück', async () => {
    const o = await orders.getOrder(id);
    assert.equal(o?.status, 'neu');
    const docs = await orders.listDocuments(id);
    assert.equal(docs.length, 1);
    const bytes = await orders.readDocumentFile(docs[0]);
    assert.deepEqual(bytes && Array.from(bytes), Array.from(PDF));
    assert.equal((await orders.listEvents(id))[0].type, 'created');
  });
  it('ändert den Status mit Verlaufseintrag und zeigt ihn in der Statusabfrage', async () => {
    assert.deepEqual(await orders.changeStatus(id, 'in_pruefung', 'Wir prüfen.'), { ok: true });
    const pub = await orders.lookupStatus(number, 'erika@example.de');
    assert.equal(pub?.status, 'in_pruefung');
    assert.equal(await orders.lookupStatus(number, 'falsch@example.de'), null);
  });
  it('ordnet eine signierte kfz-api-Meldung dem Auftrag zu', async () => {
    const raw = JSON.stringify({ order: { id: 77, externalId: number }, businessTransaction: 'UG', status: 'ACCEPTED' });
    const headers = new Headers({ 'X-Signature': signKfzBody(raw, 'storage-test-secret'), 'X-Event-Id': 'st-1' });
    const r = await handleKfzWebhook(raw, headers);
    assert.equal(r.result.status, 200);
    const o = await orders.getOrder(id);
    assert.equal(o?.kfz_display, 'in_bearbeitung');
    assert.equal(o?.status, 'bei_zulassungsstelle');
  });
});
