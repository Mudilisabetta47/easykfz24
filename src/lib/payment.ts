// Zahlarten. Abgewickelt über einen Zahlungsdienstleister (vorbereitet: Stripe Checkout), der Karten, Klarna,
// PayPal, Apple Pay und Google Pay über eine Schnittstelle anbietet. Welche Methoden der Kunde tatsächlich sieht,
// wird im Stripe-Dashboard aktiviert. Logos wie bei den Versandpartnern unter public/brands/ ablegen.

export const PAYMENT_METHOD_IDS = ['visa', 'mastercard', 'paypal', 'klarna', 'apple_pay', 'google_pay'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export const PAYMENT_METHODS: Record<PaymentMethodId, { name: string; logo: string | null }> = {
  visa: { name: 'Visa', logo: null },
  mastercard: { name: 'Mastercard', logo: null },
  paypal: { name: 'PayPal', logo: null },
  klarna: { name: 'Klarna', logo: null },
  apple_pay: { name: 'Apple Pay', logo: null },
  google_pay: { name: 'Google Pay', logo: null },
};

export const PAYMENT_STATUS = ['offen', 'bezahlt', 'erstattet'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS)[number];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  offen: 'Zahlung offen',
  bezahlt: 'Bezahlt',
  erstattet: 'Erstattet',
};

export function isPaymentStatus(v: unknown): v is PaymentStatus {
  return typeof v === 'string' && (PAYMENT_STATUS as readonly string[]).includes(v);
}
