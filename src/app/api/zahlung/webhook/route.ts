// Stripe-Webhook: markiert Aufträge nach erfolgreicher Zahlung als bezahlt.
// In Stripe als Endpunkt eintragen: https://<domain>/api/zahlung/webhook, Ereignisse checkout.session.completed
// und checkout.session.async_payment_succeeded (z. B. Klarna).

import { NextResponse } from 'next/server';
import { getOrderIdByNumber, setPaymentStatus } from '../../../../server/orders.ts';
import { verifyStripeSignature } from '../../../../server/payments.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) return new NextResponse('Webhook nicht konfiguriert', { status: 503 });
  const payload = await req.text();
  if (!verifyStripeSignature(payload, req.headers.get('stripe-signature'), secret)) {
    return new NextResponse('Ungültige Signatur', { status: 400 });
  }
  const event = JSON.parse(payload) as {
    type: string;
    data: { object: { id: string; client_reference_id?: string; payment_status?: string } };
  };
  const session = event.data.object;
  const paid =
    (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded';
  if (paid && session.client_reference_id) {
    const id = getOrderIdByNumber(session.client_reference_id);
    if (id) setPaymentStatus(id, 'bezahlt', session.id, 'Zahlungsdienstleister');
  }
  return NextResponse.json({ received: true });
}
