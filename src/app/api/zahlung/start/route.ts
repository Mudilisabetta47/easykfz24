// Startet die Bezahlung für einen bestehenden Auftrag (Zahlungslink mit Zufallstoken). Nur Auftragsnummer und Token kommen
// aus dem Formular – der Betrag immer aus der Datenbank.

import { NextResponse } from 'next/server';
import { normalizeOrderNumber } from '../../../../lib/order-number.ts';
import { getOrderForPayment } from '../../../../server/orders.ts';
import { startMolliePayment } from '../../../../server/mollie.ts';
import { createCheckout, paymentProvider, publicBaseUrl } from '../../../../server/payments.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const nr = normalizeOrderNumber(String(form.get('nr') ?? ''));
  const token = String(form.get('t') ?? '').slice(0, 64);
  const base = publicBaseUrl(req);
  const order = nr ? await getOrderForPayment(nr, token) : null;
  if (!order) return NextResponse.redirect(`${base}/status`, 303);
  if (order.paymentStatus === 'bezahlt') return NextResponse.redirect(`${base}/zahlung/${order.number}?t=${encodeURIComponent(token)}`, 303);
  const back = `${base}/zahlung/${order.number}?t=${encodeURIComponent(token)}`;
  if (paymentProvider() === 'mollie') {
    // Betrag kommt aus der Datenbank; offener Versuch wird fortgesetzt statt doppelt angelegt
    const r = await startMolliePayment(order.id, base);
    return NextResponse.redirect(r.ok ? r.checkoutUrl : r.paid ? back : `${back}&fehler=1`, 303);
  }
  const url = await createCheckout({ number: order.number, email: order.email, totalCents: order.totalCents, token: order.token }, base);
  return NextResponse.redirect(url ?? `${back}&fehler=1`, 303);
}
