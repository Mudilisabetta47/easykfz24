// Betriebsstatus ohne Details: Plattform, Speicher-Bindungen, Datenbank und Schema-Version.
// Fehlerursachen stehen nur im Server-Log, nicht in der Antwort.

import { NextResponse } from 'next/server';
import { storageInfo } from '../../../server/blobs.ts';
import { getDb, SCHEMA_VERSION, schemaVersion } from '../../../server/db.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const info = storageInfo();
  try {
    const db = await getDb();
    await db.first('SELECT 1 AS x FROM kfz_webhook_events LIMIT 1');
    const schema = await schemaVersion();
    return NextResponse.json(
      { ok: schema === SCHEMA_VERSION, storage: 'ok', schema, expected: SCHEMA_VERSION, ...info },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (e) {
    console.error('[health] Datenbank nicht verfügbar:', (e as Error).stack ?? (e as Error).message);
    return NextResponse.json({ ok: false, storage: 'nicht verfügbar', ...info }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
