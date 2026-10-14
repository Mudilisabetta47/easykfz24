// QES-Nachweis je Vollmachtsvorgang (Partnervertrag POWR § 3 Abs. 2, § 4 Abs. 6). Die Partner-API liefert das signierte PDF
// nicht – es wird aus dem POWR-Dashboard geladen und im Auftrag hochgeladen, ebenso der Prüfbericht eines
// Validierungsdienstes. Ein Nachweis gilt nur, wenn
//   – der Vollmachtsvorgang laut Partnerabgleich „signiert + vollständig“ ist und die eingegebene Vorgangsnummer passt,
//   – das PDF die technische Vorprüfung besteht (Signatur deckt die Datei ab, Hash stimmt, Zertifikat qualifiziert, QSCD),
//   – ein separater Prüfbericht mit dem Ergebnis „gültig – qualifizierte elektronische Signatur“ vorliegt,
//   – der Unterzeichner laut Prüfbericht der Halter ist,
//   – beide Dateien unverändert (SHA-256), nicht gelöscht und nicht ersetzt sind und der Nachweis nicht widerrufen wurde.
// Ein bloßes PDF zählt nie.

import { accountHolderMatches } from '../../lib/power-of-attorney.ts';
import type { ValidatedOrder } from '../../lib/order.ts';
import { getBlob } from '../blobs.ts';
import { getDb } from '../db.ts';
import { eventStmt, touchStmt } from '../orders.ts';
import { checkSignedPdf, type QesTechCheck } from '../qes-check.ts';

const now = () => new Date().toISOString();

/** Einziges zulässiges Prüfergebnis */
export const QES_VALID = 'gueltig_qualifiziert';

export interface EvidenceView {
  id: number;
  processId: number;
  pdfDocId: string;
  reportDocId: string;
  validator: string;
  result: string;
  signerName: string;
  signedAt: string;
  tech: QesTechCheck | null;
  checkedBy: string;
  checkedAt: string;
  revokedAt: string;
  revokedBy: string;
  revokeReason: string;
  /** Nachweis trägt die Freigabe (aktueller Vorgang, Dateien unverändert vorhanden, nicht widerrufen) */
  valid: boolean;
  invalidReason: string;
}

interface EvidenceRow {
  id: number;
  order_id: number;
  poa_id: number;
  process_id: number;
  pdf_doc_id: string;
  pdf_sha256: string;
  report_doc_id: string;
  report_sha256: string;
  validator: string;
  result: string;
  signer_name: string;
  signed_at: string;
  tech_json: string;
  checked_by: string;
  checked_at: string;
  revoked_at: string;
  revoked_by: string;
  revoke_reason: string;
}

interface DocRow {
  id: string;
  order_id: number;
  mime: string;
  sha256: string;
  stored_name: string;
  category: string;
  deleted_at: string;
  superseded_at: string;
}

async function doc(id: string): Promise<DocRow | null> {
  return (await getDb()).first<DocRow>('SELECT id, order_id, mime, sha256, stored_name, category, deleted_at, superseded_at FROM documents WHERE id = ?', id);
}

async function latestSignedPoa(orderId: number) {
  return (await getDb()).first<{ id: number; process_id: number | null; status: string; ready: number; external_order_id: string }>(
    'SELECT id, process_id, status, ready, external_order_id FROM power_of_attorneys WHERE order_id = ? ORDER BY attempt DESC, id DESC LIMIT 1',
    orderId,
  );
}

async function viewOf(r: EvidenceRow, currentPoaId: number | null): Promise<EvidenceView> {
  let invalidReason = '';
  if (r.revoked_at) invalidReason = 'widerrufen';
  else if (r.poa_id !== currentPoaId) invalidReason = 'gehört nicht zum aktuellen Vollmachtsvorgang';
  else if (r.result !== QES_VALID) invalidReason = 'Prüfergebnis nicht „gültig – qualifiziert“';
  else {
    for (const [id, sha, label] of [
      [r.pdf_doc_id, r.pdf_sha256, 'Signiertes PDF'],
      [r.report_doc_id, r.report_sha256, 'Prüfbericht'],
    ] as const) {
      const d = await doc(id);
      if (!d || d.order_id !== r.order_id || d.deleted_at || d.superseded_at) invalidReason ||= `${label} gelöscht oder ersetzt`;
      else if (d.sha256 !== sha) invalidReason ||= `${label} verändert (Prüfsumme weicht ab)`;
    }
  }
  let tech: QesTechCheck | null = null;
  try {
    tech = JSON.parse(r.tech_json) as QesTechCheck;
  } catch {
    tech = null;
  }
  if (!invalidReason && !tech?.ok) invalidReason = 'technische Vorprüfung nicht bestanden';
  return {
    id: r.id,
    processId: r.process_id,
    pdfDocId: r.pdf_doc_id,
    reportDocId: r.report_doc_id,
    validator: r.validator,
    result: r.result,
    signerName: r.signer_name,
    signedAt: r.signed_at,
    tech,
    checkedBy: r.checked_by,
    checkedAt: r.checked_at,
    revokedAt: r.revoked_at,
    revokedBy: r.revoked_by,
    revokeReason: r.revoke_reason,
    valid: !invalidReason,
    invalidReason,
  };
}

export async function listEvidence(orderId: number): Promise<EvidenceView[]> {
  const rows = await (await getDb()).all<EvidenceRow>('SELECT * FROM poa_evidence WHERE order_id = ? ORDER BY id DESC', orderId);
  const poa = await latestSignedPoa(orderId);
  return Promise.all(rows.map((r) => viewOf(r, poa?.id ?? null)));
}

/** Gültiger QES-Nachweis für den aktuellen, vom Partner als signiert + vollständig bestätigten Vorgang */
export async function poaEvidenceOk(orderId: number): Promise<boolean> {
  const poa = await latestSignedPoa(orderId);
  if (!poa || poa.status !== 'signiert' || !poa.ready) return false;
  return (await listEvidence(orderId)).some((e) => e.valid);
}

export interface EvidenceInput {
  processId: unknown;
  pdfDocId: unknown;
  reportDocId: unknown;
  validator: unknown;
  result: unknown;
  signerName: unknown;
  signedAt: unknown;
  confirmed: unknown;
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export async function recordEvidence(
  orderId: number,
  input: EvidenceInput,
  actor: string,
): Promise<{ ok: true; evidence: EvidenceView } | { ok: false; error: string; tech?: QesTechCheck }> {
  const db = await getDb();
  const order = await db.first<{ data_json: string; is_test: number }>('SELECT data_json, is_test FROM orders WHERE id = ?', orderId);
  if (!order) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (input.confirmed !== true) return { ok: false, error: 'Bitte bestätigen, dass Prüfbericht und Angaben geprüft wurden.' };
  const poa = await latestSignedPoa(orderId);
  if (!poa || poa.status !== 'signiert' || !poa.ready || !poa.process_id)
    return { ok: false, error: 'Kein vom Partner als „signiert + vollständig“ bestätigter Vollmachtsvorgang – erst Stand abfragen.' };
  const processId = Number(input.processId);
  if (!Number.isSafeInteger(processId) || processId !== poa.process_id)
    return { ok: false, error: `Vorgangsnummer passt nicht zum Partnervorgang (erwartet ${poa.process_id}, wie im POWR-Dashboard).` };
  const pdfId = str(input.pdfDocId, 64);
  const reportId = str(input.reportDocId, 64);
  if (!pdfId || !reportId || pdfId === reportId) return { ok: false, error: 'Bitte das signierte PDF und einen separaten Prüfbericht auswählen.' };
  const pdf = await doc(pdfId);
  const report = await doc(reportId);
  for (const [d, label] of [
    [pdf, 'Signiertes PDF'],
    [report, 'Prüfbericht'],
  ] as const) {
    if (!d || d.order_id !== orderId || d.deleted_at || d.superseded_at)
      return { ok: false, error: `${label} nicht im Auftrag gefunden (oder gelöscht/ersetzt).` };
  }
  if (pdf!.mime !== 'application/pdf' || pdf!.category !== 'Vollmacht')
    return { ok: false, error: 'Das signierte PDF muss als PDF in der Kategorie „Vollmacht“ abgelegt sein.' };
  if (report!.mime !== 'application/pdf') return { ok: false, error: 'Der Prüfbericht muss als PDF vorliegen.' };
  const validator = str(input.validator, 200);
  if (validator.length < 3) return { ok: false, error: 'Bitte den Validierungsdienst bzw. die Prüfsoftware angeben.' };
  if (input.result !== QES_VALID) return { ok: false, error: 'Nur ein Prüfergebnis „gültig – qualifizierte elektronische Signatur“ trägt die Freigabe.' };
  const signerName = str(input.signerName, 200);
  const h = (JSON.parse(order.data_json) as ValidatedOrder).holder;
  if (h.typ !== 'privat' || !accountHolderMatches(signerName, h.vorname, h.nachname))
    return { ok: false, error: 'Unterzeichner laut Prüfbericht ist nicht der Halter (Vor- und Nachname wie im Auftrag).' };
  const signedAt = str(input.signedAt, 40);
  if (!/^\d{4}-\d{2}-\d{2}/.test(signedAt) || Number.isNaN(Date.parse(signedAt)))
    return { ok: false, error: 'Bitte den Signaturzeitpunkt laut Prüfbericht angeben.' };
  const bytes = await getBlob(pdf!.stored_name);
  if (!bytes) return { ok: false, error: 'Signiertes PDF nicht lesbar.' };
  const tech = checkSignedPdf(bytes, [String(poa.process_id), poa.external_order_id]);
  if (!tech.ok) return { ok: false, error: `Technische Vorprüfung nicht bestanden: ${tech.problems.join('; ')}`, tech };
  const at = now();
  const row = await db.first<{ id: number }>(
    `INSERT INTO poa_evidence (order_id, poa_id, process_id, pdf_doc_id, pdf_sha256, report_doc_id, report_sha256, validator, result, signer_name, signed_at, tech_json, checked_by, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    orderId,
    poa.id,
    processId,
    pdf!.id,
    pdf!.sha256,
    report!.id,
    report!.sha256,
    validator,
    QES_VALID,
    signerName,
    signedAt,
    JSON.stringify(tech),
    actor,
    at,
  );
  if (!row) return { ok: false, error: 'Nachweis konnte nicht gespeichert werden.' };
  await db.batch([
    eventStmt(orderId, {
      type: 'vollmacht',
      message: `QES-Nachweis erfasst (Vorgang ${processId}): Prüfbericht ${validator}, Ergebnis gültig – qualifiziert, unterzeichnet ${signedAt.slice(0, 16).replace('T', ' ')}; Vorprüfung: Signatur deckt Datei ab, ${tech.digestAlgorithm} stimmt, Zertifikat qualifiziert (QSCD)`,
      actor,
    }),
    touchStmt(orderId),
  ]);
  const view = (await listEvidence(orderId)).find((e) => e.id === row.id)!;
  return { ok: true, evidence: view };
}

export async function revokeEvidence(orderId: number, id: number, reason: string, actor: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const why = reason.trim().slice(0, 300);
  if (why.length < 3) return { ok: false, error: 'Bitte einen Grund angeben.' };
  const db = await getDb();
  const r = await db.run(
    "UPDATE poa_evidence SET revoked_at = ?, revoked_by = ?, revoke_reason = ? WHERE id = ? AND order_id = ? AND revoked_at = ''",
    now(),
    actor,
    why,
    id,
    orderId,
  );
  if (!r.changes) return { ok: false, error: 'Nachweis nicht gefunden oder bereits widerrufen.' };
  await db.batch([eventStmt(orderId, { type: 'vollmacht', message: `QES-Nachweis #${id} widerrufen: ${why}`, actor }), touchStmt(orderId)]);
  return { ok: true };
}
