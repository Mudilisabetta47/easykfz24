// Webhook von kfz-api.de: Statusmeldungen, Bescheide und Belege zu Zulassungsvorgängen.
// Bei kfz-api.de (Dashboard → Webhooks) eintragen: https://<domain>/api/webhooks/kfz-api
// Signatur: X-Signature = HMAC-SHA256 (hex) über den Rohtext, Schlüssel in KFZ_API_WEBHOOK_SECRET.

import { NextResponse } from 'next/server';
import { handleKfzWebhook } from '../../../../server/kfz-api.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Rohtext lesen – die Signatur gilt für die exakten Bytes des Rumpfs.
  const raw = await req.text();
  const { result, after } = handleKfzWebhook(raw, req.headers);
  after?.();
  return NextResponse.json(result.body, { status: result.status, headers: { 'Cache-Control': 'no-store' } });
}

/** Erreichbarkeit prüfen (z. B. im Browser) – verrät nichts über die Konfiguration. */
export function GET() {
  return NextResponse.json({ ok: true, endpoint: 'kfz-api webhook', method: 'POST' }, { headers: { 'Cache-Control': 'no-store' } });
}
