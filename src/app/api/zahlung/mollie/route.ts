// Mollie-Webhook: POST application/x-www-form-urlencoded mit nur `id` (tr_…), ohne Signatur. Der Inhalt wird deshalb nie
// übernommen – er stößt nur den Abgleich über GET /v2/payments/{id} an (src/server/mollie.ts). Antwort laut Mollie-Doku:
// 200 auch für unbekannte IDs (verrät nichts); 503, wenn der Stand gerade nicht abrufbar ist → Mollie wiederholt die Zustellung.
// Bei Mollie wird die Adresse je Zahlung mitgegeben (webhookUrl) – keine Einstellung im Dashboard nötig.

import { NextResponse } from 'next/server';
import { ipFrom, limits } from '../../../../server/limits.ts';
import { handleMollieWebhook } from '../../../../server/mollie.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  // Schutz vor Missbrauch als Abfrage-Verstärker; Mollie wiederholt bei Fehlern ohnehin
  if (!limits().mollieWebhook.hit(ipFrom(req.headers)).allowed) return new NextResponse('Zu viele Anfragen', { status: 429 });
  let id: unknown = null;
  try {
    const form = await req.formData();
    id = form.get('id');
  } catch {
    id = null;
  }
  const status = await handleMollieWebhook(id);
  return new NextResponse(status === 200 ? 'OK' : 'Später erneut', { status, headers: { 'Cache-Control': 'no-store' } });
}
