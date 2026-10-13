// POST /api/intern/zeitplan – nur für den Cron-Trigger des Workers (worker.ts) im selben Isolat. Das Kennwort entsteht dort
// zufällig beim ersten Lauf und verlässt das Isolat nie; ohne passendes Kennwort antwortet die Route wie eine unbekannte Seite (404).
// Läuft nur die kostenlosen, lesenden Regeln „Vollmacht-Abgleich“ (GET /powerOfAttorneys/{processId}) und
// „Zahlungsabgleich“ (GET /v2/payments/{id} bei Mollie).

import { NextResponse } from 'next/server';
import { mollieModes } from '../../../../server/mollie.ts';
import { runScheduledRules } from '../../../../server/os/automation.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TOKEN = Symbol.for('easykfz24.zeitplan');
const ZEITPLAN_REGELN = ['vollmacht_abgleich', 'zahlung_abgleich'] as const;

function sameToken(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function POST(req: Request) {
  const expected = (globalThis as Record<symbol, unknown>)[TOKEN];
  const got = req.headers.get('x-ek-zeitplan') ?? '';
  if (typeof expected !== 'string' || expected.length < 64 || !sameToken(got, expected)) return new NextResponse('Not Found', { status: 404 });
  const r = await runScheduledRules(true, ZEITPLAN_REGELN);
  // Im privaten Worker-Protokoll sichtbar: nur Modus der Mollie-Schlüssel (test/live) und Schalter – nie Schlüsselwerte
  return NextResponse.json({ ok: true, ...r, mollie: mollieModes() }, { headers: { 'Cache-Control': 'no-store' } });
}
