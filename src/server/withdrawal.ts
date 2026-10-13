// Elektronische Widerrufsfunktion (§ 356a BGB) – ENTWURF.
// Schalter: WIDERRUF_AKTIV=1 schaltet die Funktion auf der Website frei. Ohne Schalter ist sie im Produktivbetrieb nicht
// erreichbar (404) und nur lokal als Vorschau sichtbar. Bestellungen, Zahlungen und Auftragsstatus werden NICHT verändert:
// Ein Widerruf wird gespeichert, bestätigt und dem Team gemeldet; die Bearbeitung (z. B. Rückzahlung) erfolgt im OS.

import { getDb, runAfter } from './db.ts';
import { sendMail } from './mailer.ts';
import { emitSafe } from './os/events.ts';
import { orderNumberIn, receiptMail, validateWithdrawal, withdrawalStatement, type WithdrawalErrors, type WithdrawalInput } from '../lib/withdrawal.ts';

export type WithdrawalMode = 'aktiv' | 'vorschau' | 'aus';

export function withdrawalMode(): WithdrawalMode {
  if (process.env.WIDERRUF_AKTIV === '1') return 'aktiv';
  return process.env.NODE_ENV === 'production' ? 'aus' : 'vorschau';
}

export interface WithdrawalReceipt {
  reference: string;
  receivedAt: string;
  statement: string;
  /** versendet | nicht_konfiguriert | fehler – Zustand der Eingangsbestätigung per E-Mail */
  confirmation: string;
}

function newReference(at: string): string {
  const day = at.slice(0, 10).replace(/-/g, '');
  const rnd = Array.from(crypto.getRandomValues(new Uint8Array(3)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `WR-${day}-${rnd}`;
}

/**
 * Widerrufserklärung entgegennehmen: speichern (Eingang mit Datum und Uhrzeit), Eingangsbestätigung per E-Mail,
 * Ereignis für das Team. Eine Auftragsnummer in der Vertragsangabe wird dem Auftrag zugeordnet – eine fehlende oder
 * unbekannte Nummer verhindert den Widerruf nicht.
 */
export async function recordWithdrawal(raw: Partial<Record<keyof WithdrawalInput, unknown>>): Promise<{ ok: true; receipt: WithdrawalReceipt } | { ok: false; errors: WithdrawalErrors }> {
  const v = validateWithdrawal(raw);
  if (!v.ok) return v;
  const input = v.value;
  const db = await getDb();
  const receivedAt = new Date().toISOString();
  const reference = newReference(receivedAt);
  const statement = withdrawalStatement(input);
  const number = orderNumberIn(input.contract);
  const order = number ? await db.first<{ id: number; number: string }>('SELECT id, number FROM orders WHERE number = ?', number) : null;
  await db.run(
    'INSERT INTO withdrawals (reference, received_at, name, contract, email, statement, order_id, order_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    reference,
    receivedAt,
    input.name,
    input.contract,
    input.email,
    statement,
    order?.id ?? null,
    order?.number ?? number,
  );

  // Eingangsbestätigung auf dauerhaftem Datenträger (E-Mail) – unverzüglich
  const mail = receiptMail(input, receivedAt, reference);
  const sent = await sendMail({ to: input.email, subject: mail.subject, text: mail.text });
  await db.run('UPDATE withdrawals SET confirmation_state = ?, confirmation_at = ? WHERE reference = ?', sent.state, sent.state === 'versendet' ? new Date().toISOString() : '', reference);

  runAfter(
    emitSafe({
      type: 'order.withdrawal',
      orderId: order?.id ?? null,
      actor: 'Kunde (Widerrufsfunktion)',
      payload: { reference, contract: input.contract, confirmation: sent.state },
      dedupeKey: `withdrawal:${reference}`,
    }),
  );
  return { ok: true, receipt: { reference, receivedAt, statement, confirmation: sent.state } };
}

/** Eingegangene Widerrufe (für Verwaltung und Tests) */
export async function listWithdrawals(limit = 100): Promise<
  { reference: string; received_at: string; name: string; contract: string; email: string; order_id: number | null; order_number: string; confirmation_state: string; handled_at: string }[]
> {
  return (await getDb()).all(
    'SELECT reference, received_at, name, contract, email, order_id, order_number, confirmation_state, handled_at FROM withdrawals ORDER BY received_at DESC LIMIT ?',
    limit,
  );
}
