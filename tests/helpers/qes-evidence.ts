// Testhilfe: QES-Nachweis wie im OS erfassen – signiertes PDF (Kategorie „Vollmacht“) + Prüfbericht hochladen, zuordnen.

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { plainPdf, signedPdf } from './qes-fixture.ts';

export async function uploadDoc(orderId: number, bytes: Uint8Array, category: string, mime = 'application/pdf'): Promise<string> {
  const { putBlob } = await import('../../src/server/blobs.ts');
  const { getDb } = await import('../../src/server/db.ts');
  const id = randomBytes(16).toString('hex');
  const key = `${randomBytes(12).toString('hex')}/${id}.pdf`;
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

/** Gültigen QES-Nachweis für den aktuellen (signierten) Vollmachtsvorgang des Auftrags erfassen */
export async function recordValidEvidence(orderId: number, signerName: string): Promise<void> {
  const { getDb } = await import('../../src/server/db.ts');
  const ev = await import('../../src/server/os/poa-evidence.ts');
  const p = await (
    await getDb()
  ).first<{ process_id: number }>('SELECT process_id FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC, id DESC LIMIT 1', orderId);
  const pdf = await uploadDoc(orderId, signedPdf(), 'Vollmacht');
  const report = await uploadDoc(orderId, plainPdf(), 'Nachweise');
  const r = await ev.recordEvidence(
    orderId,
    {
      processId: p?.process_id,
      pdfDocId: pdf,
      reportDocId: report,
      validator: 'Prüfsoftware (Test)',
      result: ev.QES_VALID,
      signerName,
      signedAt: new Date().toISOString(),
      confirmed: true,
    },
    'Test',
  );
  assert.ok(r.ok, JSON.stringify(r));
}
