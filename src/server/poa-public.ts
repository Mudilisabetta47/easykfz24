// Öffentliche Sicht auf einen Vollmachtsvorgang (Rücksprungseite): nur der bestätigte Stand, keine Auftrags- oder Personendaten.
// Wer nur die Vorgangsnummer kennt, erfährt nichts über Auftrag oder Person – der Stand allein ist für Dritte wertlos.

import { customerView, type CustomerView } from '../lib/power-of-attorney.ts';
import { poaByProcessId, verifyPoa } from './power-of-attorney.ts';

export interface PublicPoaState {
  view: CustomerView;
  /** Zeitpunkt der letzten bestätigten Abfrage beim Partner ('' = noch keine) */
  verifiedAt: string;
  /** Abfrage gerade nicht möglich (Partner gestört) – Anzeige bleibt beim zuletzt bestätigten Stand */
  checkFailed: boolean;
  known: boolean;
}

export async function publicPoaState(processId: number | null): Promise<PublicPoaState> {
  if (!processId) return { view: 'unknown', verifiedAt: '', checkFailed: false, known: false };
  const rec = await poaByProcessId(processId);
  if (!rec) return { view: 'unknown', verifiedAt: '', checkFailed: false, known: false };
  // Abgleich über die Partner-Schnittstelle (gedrosselt). Der Rücksprung-Parameter `status` spielt dafür keine Rolle.
  const r = await verifyPoa(rec.id, { actor: 'Rücksprung (Abgleich)' });
  const cur = r.ok ? r.poa : (r.poa ?? null);
  const status = cur ? cur.status || null : rec.status || null;
  const ready = cur ? cur.ready : !!rec.ready;
  // Ohne je bestätigten Stand gilt „wird verarbeitet“ – nie eine Erfolgsmeldung
  const view = customerView(status === null ? 'offen' : status, ready);
  return { view, verifiedAt: cur?.verifiedAt ?? rec.verified_at, checkFailed: !r.ok, known: true };
}
