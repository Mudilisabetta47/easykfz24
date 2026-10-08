// Zahlungsanbindung über Stripe Checkout (ohne SDK, nur HTTPS).
// Stripe bietet Visa, Mastercard, Klarna, PayPal, Apple Pay und Google Pay über dieselbe Checkout-Seite an;
// welche Methoden erscheinen, wird im Stripe-Dashboard aktiviert.
//
// .env:
//   STRIPE_SECRET_KEY=sk_test_…      (geheim, nie in den Browser)
//   STRIPE_WEBHOOK_SECRET=whsec_…    (für /api/zahlung/webhook)
//   PUBLIC_BASE_URL=https://easykfz24.de
// Ohne STRIPE_SECRET_KEY bleibt die Zahlung „offen“ und wird manuell im Admin gepflegt.

import { createHmac, timingSafeEqual } from 'node:crypto';

export function paymentsEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function publicBaseUrl(req?: Request): string {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, '');
  if (req) return new URL(req.url).origin;
  return 'http://localhost:3000';
}

export interface CheckoutInput {
  number: string;
  email: string;
  totalCents: number;
  token: string;
}

/** Legt eine Stripe-Checkout-Session an und liefert die Bezahl-URL – oder null bei Fehlern/ohne Konfiguration. */
export async function createCheckout(input: CheckoutInput, baseUrl: string): Promise<string | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || input.totalCents <= 0) return null;
  const body = new URLSearchParams({
    mode: 'payment',
    locale: 'de',
    customer_email: input.email,
    client_reference_id: input.number,
    'metadata[order]': input.number,
    'payment_intent_data[metadata][order]': input.number,
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': String(input.totalCents),
    'line_items[0][price_data][product_data][name]': `EasyKFZ24 Servicekosten – Auftrag ${input.number}`,
    success_url: `${baseUrl}/kfz-anmelden/auftrag/bestaetigung?nr=${input.number}&zahlung=ok`,
    cancel_url: `${baseUrl}/zahlung/${input.number}?t=${encodeURIComponent(input.token)}&abgebrochen=1`,
  });
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const json = (await res.json()) as { url?: string; error?: { message?: string } };
    if (!res.ok || !json.url) {
      console.error('[zahlung] Checkout fehlgeschlagen', json.error?.message);
      return null;
    }
    return json.url;
  } catch (e) {
    console.error('[zahlung] Stripe nicht erreichbar', e);
    return null;
  }
}

/** Prüft die Stripe-Signatur (Header „Stripe-Signature“: t=…,v1=…) mit Toleranz gegen Replays. */
export function verifyStripeSignature(payload: string, header: string | null, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => {
      const i = p.indexOf('=');
      return [p.slice(0, i).trim(), p.slice(i + 1).trim()];
    }),
  );
  const t = Number(parts.t);
  if (!Number.isFinite(t) || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const signatures = header
    .split(',')
    .filter((p) => p.trim().startsWith('v1='))
    .map((p) => p.trim().slice(3));
  return signatures.some((sig) => {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}
