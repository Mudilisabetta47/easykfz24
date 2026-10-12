// Stripe-Webhook: markiert Aufträge nach erfolgreicher Zahlung als bezahlt und bucht die Zahlung (mit der
// echten Gebühr aus Stripe). Fehlgeschlagene und abgelaufene Checkouts werden als Buchung protokolliert.
// In Stripe als Endpunkt eintragen: https://<domain>/api/zahlung/webhook, Ereignisse checkout.session.completed,
// checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired.
// Neuzustellungen sind unschädlich: Buchung und Ereignis sind über die Session-ID eindeutig.

import { NextResponse } from 'next/server';
import { runAfter } from '../../../../server/db.ts';
import { getOrderIdByNumber, setPaymentStatus } from '../../../../server/orders.ts';
import { emitSafe } from '../../../../server/os/events.ts';
import { recordStripeEvent } from '../../../../server/os/finance.ts';
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
    id: string;
    type: string;
    data: { object: { id: string; client_reference_id?: string; payment_status?: string; amount_total?: number } };
  };
  const session = event.data.object;
  const paid =
    (event.type === 'checkout.session.completed' && session.payment_status === 'paid') ||
    event.type === 'checkout.session.async_payment_succeeded';
  const failed = event.type === 'checkout.session.async_payment_failed';
  const expired = event.type === 'checkout.session.expired';
  if ((paid || failed || expired) && session.client_reference_id) {
    const id = await getOrderIdByNumber(session.client_reference_id);
    if (id) {
      if (paid) await setPaymentStatus(id, 'bezahlt', session.id, 'Zahlungsdienstleister');
      const status = paid ? 'bezahlt' : failed ? 'fehlgeschlagen' : 'abgebrochen';
      runAfter(
        (async () => {
          const isNew = await recordStripeEvent(id, session.id, status, session.amount_total ?? 0);
          if (!isNew) return;
          if (paid) await emitSafe({ type: 'payment.paid', orderId: id, actor: 'Zahlungsdienstleister', payload: { session: session.id }, dedupeKey: `payment.paid:stripe:${session.id}` });
          if (failed) await emitSafe({ type: 'payment.failed', orderId: id, actor: 'Zahlungsdienstleister', payload: { reason: 'Zahlung abgelehnt' }, dedupeKey: `payment.failed:stripe:${session.id}` });
        })(),
      );
    }
  }
  return NextResponse.json({ received: true });
}
