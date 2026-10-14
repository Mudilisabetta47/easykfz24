// Zahlung per Überweisung (Vorkasse): Bankverbindung ausschließlich aus den Unternehmensdaten im OS
// (Einstellungen › Unternehmen › Steuer und Rechnung). Angeboten nur, wenn die Online-Zahlung nicht verfügbar ist
// (Zahlungspause / Mollie aus) UND eine gültige IBAN hinterlegt ist. Bezahlt gilt ein Auftrag erst, wenn ein Mitarbeiter
// den Zahlungseingang mit Buchungsreferenz im OS verbucht (actPayment) – nie automatisch.

import { checkIban, formatIban } from '../lib/validation.ts';
import { PROVIDER_NAME } from '../lib/site.ts';
import { customerPaymentsOpen } from './checkout.ts';

export interface BankTransferAccount {
  recipient: string;
  iban: string;
  bic: string;
  bankName: string;
  /** Zahlungsziel in Tagen ab Bestellung */
  termDays: number;
}

export interface BankTransferRequest extends BankTransferAccount {
  /** Verwendungszweck: nur die Auftragsnummer */
  reference: string;
  amountCents: number;
  /** Zahlungsziel als Kalendertag (JJJJ-MM-TT, deutsche Ortszeit) */
  dueDate: string;
}

/** Bankverbindung, wenn Überweisung angeboten wird – sonst null */
export async function bankTransferAccount(): Promise<BankTransferAccount | null> {
  if (customerPaymentsOpen()) return null;
  const { getCompany } = await import('./os/company.ts');
  const c = await getCompany();
  const iban = checkIban(c.iban ?? '');
  if (!iban.ok) return null;
  return {
    recipient: (c.name || PROVIDER_NAME).trim(),
    iban: formatIban(iban.value),
    bic: (c.bic ?? '').trim(),
    bankName: (c.bankName ?? '').trim(),
    termDays: Number.isInteger(c.paymentTermDays) && c.paymentTermDays > 0 ? c.paymentTermDays : 14,
  };
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });

export function dueDateFor(orderedAt: string, termDays: number): string {
  const [y, m, d] = DAY.format(new Date(orderedAt)).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + termDays)).toISOString().slice(0, 10);
}

/** Zahlungsaufforderung für einen Auftrag (Betrag aus der Datenbank) */
export async function bankTransferRequest(order: { number: string; total_cents: number; created_at: string }): Promise<BankTransferRequest | null> {
  const acc = await bankTransferAccount();
  if (!acc || !Number.isSafeInteger(order.total_cents) || order.total_cents <= 0) return null;
  return { ...acc, reference: order.number, amountCents: order.total_cents, dueDate: dueDateFor(order.created_at, acc.termDays) };
}
