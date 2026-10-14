// Aufbewahrung nach Partnervertrag POWR GmbH § 4 Abs. 6: antragsbegründende Unterlagen, Vollmachten und Nachweise ab
// Antragstellung mindestens zwei Jahre revisionssicher und dem Antrag zuordenbar. Bis dahin werden Unterlagen und
// Auftragsangaben solcher Aufträge weder endgültig gelöscht noch anonymisiert. Bezugspunkt bewusst großzügig: Aufträge mit
// Freigabe zur Übermittlung oder kfz-api.de-Verknüpfung, gerechnet ab der letzten Änderung (liegt nie vor der Antragstellung).

import { getDb } from '../db.ts';

export const PARTNER_RETENTION_DAYS = 2 * 366;

export function partnerRetentionCutoff(at = Date.now()): string {
  return new Date(at - PARTNER_RETENTION_DAYS * 86_400_000).toISOString();
}

/** SQL-Bedingung für Aufträge (Alias o) unter Aufbewahrung; Parameter: Stichtag aus partnerRetentionCutoff() */
export const RETAINED_ORDER_SQL = "((o.released_at != '' OR o.kfz_order_id != '') AND o.updated_at > ?)";

export async function retainedOrderIds(customerId: number): Promise<number[]> {
  const rows = await (
    await getDb()
  ).all<{ id: number }>(`SELECT o.id FROM orders o WHERE o.customer_id = ? AND ${RETAINED_ORDER_SQL}`, customerId, partnerRetentionCutoff());
  return rows.map((r) => r.id);
}

export async function documentRetained(docId: string): Promise<boolean> {
  const row = await (
    await getDb()
  ).first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM documents d JOIN orders o ON o.id = d.order_id WHERE d.id = ? AND ${RETAINED_ORDER_SQL}`,
    docId,
    partnerRetentionCutoff(),
  );
  return !!row?.n;
}
