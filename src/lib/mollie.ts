// Mollie Payments API v2 – reine Hilfsfunktionen (ohne Netz). Grundlage ausschließlich die Mollie-Dokumentation
// (docs.mollie.com, gelesen am 13.10.2026):
//   POST /v2/payments       amount {currency, value "10.00"}, description, redirectUrl, webhookUrl, locale, metadata (≈ 1 kB)
//                           → id „tr_…“, status, mode (live|test), _links.checkout.href, expiresAt
//   GET  /v2/payments/{id}  status open|pending|authorized|paid|canceled|expired|failed, amount, amountRefunded,
//                           amountChargedBack, method, metadata, paidAt, mode
//   Webhook                 POST application/x-www-form-urlencoded mit nur `id` – ohne Signatur; der Stand wird immer per GET
//                           geholt. 200 bestätigt, sonst bis zu 10 Wiederholungen in ≈ 26 h; unbekannte IDs ebenfalls mit 200.
//   Idempotency-Key         alle POST-Endpunkte, eine Stunde gespeichert; gleiche Anfrage → gleiche Antwort.
//   Schlüssel               test_… (Testmodus) bzw. live_… – Testdaten sind vollständig von Live-Daten getrennt.

export const MOLLIE_STATUSES = ['open', 'pending', 'authorized', 'paid', 'canceled', 'expired', 'failed'] as const;
export type MollieStatus = (typeof MOLLIE_STATUSES)[number];
export const isMollieStatus = (v: unknown): v is MollieStatus => typeof v === 'string' && (MOLLIE_STATUSES as readonly string[]).includes(v);

/** Noch nicht abgeschlossen – Kunde kann (weiter) bezahlen, Abgleich lohnt sich */
export const MOLLIE_OPEN: MollieStatus[] = ['open', 'pending', 'authorized'];
/** Abgeschlossen ohne Zahlung – neuer Versuch möglich */
export const MOLLIE_RETRY: MollieStatus[] = ['failed', 'canceled', 'expired'];

export type MollieKeyMode = 'test' | 'live';
/** Modus allein am Präfix ablesen (der Schlüssel selbst wird nie ausgegeben) */
export function keyMode(key: string | undefined): MollieKeyMode | null {
  if (!key) return null;
  if (/^test_[A-Za-z0-9]{20,}$/.test(key)) return 'test';
  if (/^live_[A-Za-z0-9]{20,}$/.test(key)) return 'live';
  return null;
}

export const isPaymentId = (v: unknown): v is string => typeof v === 'string' && /^tr_[A-Za-z0-9]{1,64}$/.test(v);

/** Cent → Mollie-Betrag („120.96“), ganzzahlig ohne Gleitkomma-Rundung */
export function centsToValue(cents: number): string {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new Error('Ungültiger Betrag');
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}
/** Mollie-Betrag → Cent; alles andere als „123.45“ ist ungültig */
export function valueToCents(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{1,9}\.\d{2}$/.test(value)) return null;
  const [eur, ct] = value.split('.');
  return Number(eur) * 100 + Number(ct);
}

/** Was der Kunde auf der Zahlungsseite sieht – nur aus dem serverseitig bestätigten Stand */
export type PayView = 'bezahlt' | 'in_pruefung' | 'offen' | 'fehlgeschlagen' | 'abgebrochen' | 'abgelaufen' | 'keine';
export function payView(status: MollieStatus | '' | null): PayView {
  switch (status) {
    case 'paid':
      return 'bezahlt';
    case 'pending':
    case 'authorized':
      return 'in_pruefung';
    case 'open':
      return 'offen';
    case 'failed':
      return 'fehlgeschlagen';
    case 'canceled':
      return 'abgebrochen';
    case 'expired':
      return 'abgelaufen';
    default:
      return 'keine';
  }
}

export const PAY_TEXT: Record<PayView, { tone: 'ok' | 'wait' | 'warn' | 'error' | 'neutral'; title: string; text: string }> = {
  bezahlt: { tone: 'ok', title: 'Vielen Dank – Ihre Zahlung ist eingegangen.', text: 'Die Zahlung wurde von unserem Zahlungsdienstleister bestätigt.' },
  in_pruefung: {
    tone: 'wait',
    title: 'Ihre Zahlung wird noch bestätigt.',
    text: 'Der Zahlungsdienstleister hat die Zahlung noch nicht abschließend bestätigt. Das kann je nach Zahlart einen Moment dauern.',
  },
  offen: { tone: 'wait', title: 'Die Zahlung ist noch nicht abgeschlossen.', text: 'Sie können die begonnene Zahlung fortsetzen.' },
  fehlgeschlagen: {
    tone: 'error',
    title: 'Die Zahlung ist fehlgeschlagen.',
    text: 'Es wurde nichts abgebucht. Bitte versuchen Sie es erneut, gern mit einer anderen Zahlart.',
  },
  abgebrochen: { tone: 'warn', title: 'Die Zahlung wurde abgebrochen.', text: 'Es wurde nichts abgebucht. Sie können die Zahlung jederzeit neu starten.' },
  abgelaufen: { tone: 'warn', title: 'Die Zahlung ist abgelaufen.', text: 'Es wurde nichts abgebucht. Bitte starten Sie die Zahlung neu.' },
  keine: { tone: 'neutral', title: 'Noch keine Zahlung begonnen.', text: '' },
};

/** Zahlarten-Logos (offizielle Mollie-Grafiken unter public/brands/mollie/) je Mollie-Methode */
export const MOLLIE_METHOD_MARKS: Record<string, { name: string; logo: string }[]> = {
  creditcard: [
    { name: 'Visa', logo: '/brands/mollie/visa.svg' },
    { name: 'Mastercard', logo: '/brands/mollie/mastercard.svg' },
  ],
  klarna: [{ name: 'Klarna', logo: '/brands/mollie/klarna.svg' }],
  applepay: [{ name: 'Apple Pay', logo: '/brands/mollie/apple-pay.svg' }],
  googlepay: [{ name: 'Google Pay', logo: '/brands/mollie/google-pay.svg' }],
  paybybank: [{ name: 'Pay by Bank', logo: '/brands/mollie/pay-by-bank.svg' }],
  banktransfer: [{ name: 'SEPA-Überweisung', logo: '/brands/mollie/sepa-ueberweisung.svg' }],
  trustly: [{ name: 'Trustly', logo: '/brands/mollie/trustly.svg' }],
  directdebit: [{ name: 'SEPA-Lastschrift', logo: '/brands/mollie/direct-debit.svg' }],
};

// ---------- Bestellpositionen und Rechnungsadresse (Pflicht für Klarna) ----------
// Laut docs.mollie.com (Create payment, gelesen am 14.10.2026): `lines` und `billingAddress` (givenName, familyName,
// streetAndNumber, postalCode, city, country, email) sind für Klarna Pflicht. Da die Zahlart erst auf der Mollie-Bezahlseite
// gewählt wird, werden sie bei jeder Zahlung mitgesendet. Je Position: unitPrice und totalAmount inkl. MwSt.,
// vatAmount = totalAmount × vatRate / (100 + vatRate); Summe aller totalAmount = Zahlungsbetrag.

export interface MollieLine {
  type: 'digital' | 'physical' | 'shipping_fee' | 'discount';
  description: string;
  quantity: number;
  unitPrice: { currency: 'EUR'; value: string };
  totalAmount: { currency: 'EUR'; value: string };
  vatRate: string;
  vatAmount: { currency: 'EUR'; value: string };
  sku?: string;
}

export interface MollieAddress {
  organizationName?: string;
  givenName: string;
  familyName: string;
  streetAndNumber: string;
  postalCode: string;
  city: string;
  country: string;
  email: string;
}

// Rabattpositionen sind negativ („-3.00“) – Vorzeichen getrennt von der Betragsumrechnung
const eur = (cents: number) => ({ currency: 'EUR' as const, value: `${cents < 0 ? '-' : ''}${centsToValue(Math.abs(cents))}` });
const vatCents = (cents: number, rate: number) => Math.round((cents * rate) / (100 + rate));

/** Positionen aus der Preisaufstellung; stimmt die Summe nicht, eine Gesamtposition (Zahlung darf nie daran scheitern) */
export function mollieLines(
  number: string,
  lines: { key: string; label: string; cents: number; qty?: number; unitCents?: number }[],
  totalCents: number,
  vatRate: number,
): MollieLine[] {
  const rate = vatRate.toFixed(2);
  const one = (key: string, label: string, cents: number, qty?: number, unitCents?: number): MollieLine => {
    const exact = qty && unitCents && qty * unitCents === cents && cents > 0;
    return {
      type: cents < 0 ? 'discount' : key === 'versand' ? 'shipping_fee' : key === 'schilder' ? 'physical' : 'digital',
      description: label.slice(0, 100),
      quantity: exact ? qty : 1,
      unitPrice: eur(exact ? unitCents : cents),
      totalAmount: eur(cents),
      vatRate: rate,
      vatAmount: eur(vatCents(cents, vatRate)),
      sku: key.slice(0, 64),
    };
  };
  const out = lines.filter((l) => Number.isSafeInteger(l.cents) && l.cents !== 0).map((l) => one(l.key, l.label, l.cents, l.qty, l.unitCents));
  const sum = lines.reduce((s, l) => s + (Number.isSafeInteger(l.cents) ? l.cents : 0), 0);
  if (!out.length || sum !== totalCents) return [one('auftrag', `EasyKFZ24 Auftrag ${number}`, totalCents)];
  return out;
}

/** Rechnungsadresse aus den Halterdaten – null, wenn eine Pflichtangabe fehlt (dann wird Klarna nicht angeboten) */
export function mollieBillingAddress(h: {
  typ?: string;
  vorname?: string;
  nachname?: string;
  firmenname?: string;
  ansprechpartner?: string;
  strasse?: string;
  hausnummer?: string;
  plz?: string;
  ort?: string;
  email?: string;
}): MollieAddress | null {
  let given = (h.vorname ?? '').trim();
  let family = (h.nachname ?? '').trim();
  if (h.typ === 'firma') {
    const parts = (h.ansprechpartner ?? '').trim().split(/\s+/).filter(Boolean);
    family = parts.length > 1 ? parts.pop()! : (parts[0] ?? '');
    given = parts.length ? parts.join(' ') : family;
  }
  const a: MollieAddress = {
    ...(h.typ === 'firma' && h.firmenname?.trim() ? { organizationName: h.firmenname.trim() } : {}),
    givenName: given,
    familyName: family,
    streetAndNumber: `${(h.strasse ?? '').trim()} ${(h.hausnummer ?? '').trim()}`.trim(),
    postalCode: (h.plz ?? '').trim(),
    city: (h.ort ?? '').trim(),
    country: 'DE',
    email: (h.email ?? '').trim(),
  };
  return a.givenName && a.familyName && (h.strasse ?? '').trim() && a.postalCode && a.city && a.email ? a : null;
}
