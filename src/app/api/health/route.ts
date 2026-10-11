// Betriebsstatus ohne Details: Ist die Datenbank erreichbar und das Schema aktuell?
// Fehlerursachen stehen nur im Server-Log, nicht in der Antwort.

import { NextResponse } from 'next/server';
import { getDb, schemaVersion } from '../../../server/db.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  try {
    const db = getDb();
    db.prepare('SELECT 1 FROM kfz_webhook_events LIMIT 1').all();
    return NextResponse.json({ ok: true, storage: 'ok', schema: schemaVersion() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[health] Datenbank nicht verfügbar:', (e as Error).stack ?? (e as Error).message);
    return NextResponse.json({ ok: false, storage: 'nicht verfügbar' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
