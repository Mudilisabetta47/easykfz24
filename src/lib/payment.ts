// Zahlarten – Abwicklung über Mollie. Angezeigt werden nur die im Mollie-Dashboard aktivierten Methoden
// (Stand 14.10.2026 laut Inhaber): Kredit-/Debitkarte, SEPA-Überweisung, Pay by Bank, Klarna, Apple Pay, Google Pay.
// Klarna wird vorübergehend NICHT beworben, bis der Integrationstest in der Mollie-Testumgebung bestanden ist (KLARNA_AKTIV).
// Logos: offizielle Mollie-Zahlartensymbole unter public/brands/mollie/. Ändert sich die Freischaltung, hier anpassen.

export const PAYMENT_METHOD_IDS = ['visa', 'mastercard', 'banktransfer', 'paybybank', 'apple_pay', 'google_pay'] as const;
export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export const PAYMENT_METHODS: Record<PaymentMethodId, { name: string; logo: string }> = {
  visa: { name: 'Visa', logo: '/brands/mollie/visa.svg' },
  mastercard: { name: 'Mastercard', logo: '/brands/mollie/mastercard.svg' },
  banktransfer: { name: 'SEPA-Überweisung', logo: '/brands/mollie/sepa-ueberweisung.svg' },
  paybybank: { name: 'Pay by Bank', logo: '/brands/mollie/pay-by-bank.svg' },
  apple_pay: { name: 'Apple Pay', logo: '/brands/mollie/apple-pay.svg' },
  google_pay: { name: 'Google Pay', logo: '/brands/mollie/google-pay.svg' },
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
