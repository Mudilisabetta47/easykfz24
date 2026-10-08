// Startet die Bezahlung für einen bestehenden Auftrag (Zahlungslink mit Zufallstoken).

import { NextResponse } from 'next/server';
import { normalizeOrderNumber } from '../../../../lib/order-number.ts';
import { getOrderForPayment } from '../../../../server/orders.ts';
import { createCheckout, publicBaseUrl } from '../../../../server/payments.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const form = await req.formData();
  const nr = normalizeOrderNumber(String(form.get('nr') ?? ''));
  const token = String(form.get('t') ?? '').slice(0, 64);
  const base = publicBaseUrl(req);
  const order = nr ? getOrderForPayment(nr, token) : null;
  if (!order) return NextResponse.redirect(`${base}/status`, 303);
  if (order.paymentStatus === 'bezahlt') return NextResponse.redirect(`${base}/zahlung/${order.number}?t=${encodeURIComponent(token)}`, 303);
  const url = await createCheckout({ number: order.number, email: order.email, totalCents: order.totalCents, token: order.token }, base);
  return NextResponse.redirect(url ?? `${base}/zahlung/${order.number}?t=${encodeURIComponent(token)}&fehler=1`, 303);
}
