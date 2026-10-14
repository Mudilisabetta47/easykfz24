// Übermittlungs-Voraussetzungen eines Auftrags (Partnervertrag POWR § 3 Abs. 4): interne Freigabe, bei Zulassung, Ummeldung
// und Wiederzulassung eine vom Partner per GET bestätigte QES-Vollmacht (signiert + readyForApplication), kein Testauftrag.
// Grundlage für die manuelle Verknüpfung (Sperre) und für eingehende Webhooks (Warnung, externer Stand bleibt protokolliert).

import { poaGate, submissionProblems, type PoaGate, type PoaStatus } from '../../lib/power-of-attorney.ts';
import type { ServiceId } from '../../lib/services.ts';
import { getDb } from '../db.ts';

/** Geprüfter QES-Nachweis (signiertes PDF + Prüfbericht, Vorgang zugeordnet, Vorprüfung bestanden) – siehe poa-evidence.ts */
export async function poaArchived(orderId: number): Promise<boolean> {
  const { poaEvidenceOk } = await import('./poa-evidence.ts');
  return poaEvidenceOk(orderId);
}

export interface SubmissionState {
  releasedAt: string;
  isTest: boolean;
  poa: PoaGate;
  problems: string[];
}

export async function submissionState(orderId: number): Promise<SubmissionState | null> {
  const db = await getDb();
  const o = await db.first<{ service: ServiceId; released_at: string; is_test: number }>(
    'SELECT service, released_at, is_test FROM orders WHERE id = ?',
    orderId,
  );
  if (!o) return null;
  const p = await db.first<{ status: PoaStatus | ''; ready: number; send_email: number; note: string; create_error: string }>(
    'SELECT status, ready, send_email, note, create_error FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC, id DESC LIMIT 1',
    orderId,
  );
  const poa = poaGate(o.service, p ? { status: p.status, ready: !!p.ready, sendEmail: !!p.send_email, note: p.note, createError: p.create_error } : null);
  const isTest = !!o.is_test;
  return {
    releasedAt: o.released_at,
    isTest,
    poa,
    problems: submissionProblems({ releasedAt: o.released_at, poa, isTest, poaArchived: poa.required ? await poaArchived(orderId) : undefined }),
  };
}
