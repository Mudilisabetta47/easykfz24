// Aufbewahrung nach Partnervertrag POWR § 4 Abs. 6: Unterlagen übermittelter Anträge werden mindestens zwei Jahre weder
// endgültig gelöscht noch bei einer DSGVO-Anonymisierung entfernt. Nicht übermittelte Aufträge bleiben normal löschbar.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { emptyDraft, validateOrder, type ValidatedOrder } from '../src/lib/order.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-retention-'));

const orders = await import('../src/server/orders.ts');
const customers = await import('../src/server/os/customers.ts');
const docs = await import('../src/server/os/documents.ts');
const { getDb } = await import('../src/server/db.ts');

const PDF = new TextEncoder().encode('%PDF-1.4\n%Test\n');
function order(fin: string): ValidatedOrder {
  const d = emptyDraft('halterwechsel');
  d.vehicle = {
    art: 'pkw',
    hersteller: 'Audi',
    modell: 'A5',
    fin,
    bisherigesKennzeichen: 'HB-EZ 24',
    antrieb: 'benzin',
    eKennzeichen: false,
    hKennzeichen: false,
  };
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
    email: 'erika.aufbewahrung@example.de',
    telefon: '0421 123456',
  };
  d.plate = { wahl: 'behalten', wunschkennzeichen: '', wunschort: '', schilder: false, ausfuehrung: 'standard', zustellung: 'abholung', versanddienst: '' };
  d.finish = {
    evb: 'a1b2c3d',
    kontoinhaber: 'Erika Muster',
    iban: 'DE89 3704 0044 0532 0130 00',
    sepaMandat: true,
    vollmacht: true,
    datenschutz: true,
    hinweise: '',
  };
  const v = validateOrder(d);
  assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
  return (v as { ok: true; order: ValidatedOrder }).order;
}
const upload = [{ kind: 'ausweis' as const, name: 'ausweis.pdf', bytes: PDF, type: { mime: 'application/pdf' as const, ext: 'pdf' as const } }];

describe('Aufbewahrung übermittelter Anträge (Partnervertrag § 4 Abs. 6)', () => {
  it('endgültiges Löschen aus dem Papierkorb: gesperrt nach Übermittlung, erlaubt ohne Übermittlung', async () => {
    const db = await getDb();
    const sent = await orders.createOrder(order('WAUZZZF55KA000801'), upload);
    const draftOnly = await orders.createOrder(order('WAUZZZF55KA000802'), upload);
    await db.run(
      "UPDATE orders SET released_at = ?, status = 'abgeschlossen', updated_at = ? WHERE id = ?",
      new Date().toISOString(),
      new Date().toISOString(),
      sent.id,
    );
    for (const id of [sent.id, draftOnly.id])
      await db.run("UPDATE documents SET deleted_at = ?, deleted_by = 'Test' WHERE order_id = ?", new Date().toISOString(), id);
    const docOf = async (id: number) => (await db.first<{ id: string }>('SELECT id FROM documents WHERE order_id = ?', id))!.id;
    const blocked = await docs.purgeDoc(await docOf(sent.id));
    assert.ok(!blocked.ok && /Aufbewahrungspflicht/.test(blocked.error));
    assert.ok((await docs.purgeDoc(await docOf(draftOnly.id))).ok);
    // nach Ablauf (> 2 Jahre seit letzter Änderung) wieder löschbar
    await db.run('UPDATE orders SET updated_at = ? WHERE id = ?', new Date(Date.now() - 3 * 365 * 86_400_000).toISOString(), sent.id);
    assert.ok((await docs.purgeDoc(await docOf(sent.id))).ok);
  });

  it('DSGVO-Anonymisierung lässt übermittelte Aufträge samt Unterlagen unverändert, anonymisiert den Rest', async () => {
    const db = await getDb();
    const sent = await orders.createOrder(order('WAUZZZF55KA000803'), upload);
    const other = await orders.createOrder(order('WAUZZZF55KA000804'), upload);
    const link = await customers.linkOrderToCustomer(sent.id);
    await customers.linkOrderToCustomer(other.id);
    const cid = link!.customerId;
    await db.run("UPDATE orders SET kfz_order_id = 'KFZ-TEST-1', status = 'abgeschlossen', updated_at = ? WHERE id = ?", new Date().toISOString(), sent.id);
    await db.run("UPDATE orders SET status = 'storniert' WHERE id = ?", other.id);
    const check = await customers.erasureCheck(cid);
    assert.ok(
      check.retained.some((r) => /Partnervertrag POWR § 4 Abs\. 6/.test(r)),
      JSON.stringify(check),
    );
    assert.ok((await customers.anonymizeCustomer(cid, 'Test')).ok);
    const kept = await db.first<{ holder_name: string; email: string }>('SELECT holder_name, email FROM orders WHERE id = ?', sent.id);
    assert.notEqual(kept?.holder_name, 'gelöscht');
    assert.equal((await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE order_id = ? AND deleted_at = ''", sent.id))?.n, 1);
    assert.equal((await db.first<{ holder_name: string }>('SELECT holder_name FROM orders WHERE id = ?', other.id))?.holder_name, 'gelöscht');
    assert.equal((await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM documents WHERE order_id = ? AND deleted_at = ''", other.id))?.n, 0);
  });
});
