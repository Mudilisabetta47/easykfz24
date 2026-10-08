// Auftragseingang: multipart/form-data mit "data" (JSON) und Dateien "doc_<art>".
// Der Server prüft alles erneut – die Prüfung im Browser ist nur Komfort.

import { NextResponse } from 'next/server';
import { checkUpload, MAX_FILES_PER_DOCUMENT, MAX_UPLOAD_BYTES } from '../../../lib/files.ts';
import { isDocumentKind, validateDocuments, validateOrder, type FieldErrors } from '../../../lib/order.ts';
import { DOCUMENT_KINDS } from '../../../lib/services.ts';
import { formatRetryAfter } from '../../../lib/rate-limit.ts';
import { createOrder, type UploadFile } from '../../../server/orders.ts';
import { ipFrom, limits } from '../../../server/limits.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TOTAL_BYTES = DOCUMENT_KINDS.length * MAX_FILES_PER_DOCUMENT * MAX_UPLOAD_BYTES + 1024 * 1024;

function fail(status: number, message: string, errors?: FieldErrors) {
  return NextResponse.json({ ok: false, message, errors }, { status });
}

export async function POST(req: Request) {
  const ip = ipFrom(req.headers);
  const length = Number(req.headers.get('content-length') || 0);
  if (length > MAX_TOTAL_BYTES) return fail(413, 'Die Dateien sind insgesamt zu groß.');
  if (!(req.headers.get('content-type') ?? '').includes('multipart/form-data')) return fail(400, 'Ungültige Anfrage.');

  const limit = limits().orders.check(ip);
  if (!limit.allowed) {
    return fail(429, `Zu viele Aufträge in kurzer Zeit. Bitte versuchen Sie es in ${formatRetryAfter(limit.retryAfterMs)} erneut.`);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(400, 'Die Anfrage konnte nicht gelesen werden.');
  }

  let raw: unknown;
  try {
    raw = JSON.parse(String(form.get('data') ?? ''));
  } catch {
    return fail(400, 'Die Angaben konnten nicht gelesen werden.');
  }

  // Honeypot: Bots füllen das versteckte Feld aus. Absichtlich wortkarg.
  if (raw && typeof raw === 'object' && typeof (raw as { website?: unknown }).website === 'string' && (raw as { website: string }).website.trim()) {
    return fail(400, 'Die Anfrage konnte nicht verarbeitet werden.');
  }

  const result = validateOrder(raw);
  if (!result.ok) return fail(422, 'Bitte prüfen Sie die markierten Angaben.', result.errors);
  const order = result.order;

  const files: UploadFile[] = [];
  const counts: Record<string, number> = {};
  const fileErrors: FieldErrors = {};
  for (const [field, value] of form.entries()) {
    if (!field.startsWith('doc_') || typeof value === 'string') continue;
    const kind = field.slice(4);
    if (!isDocumentKind(kind)) {
      fileErrors[`documents.${kind}`] = 'Unbekannte Unterlage';
      continue;
    }
    counts[kind] = (counts[kind] ?? 0) + 1;
    const bytes = new Uint8Array(await value.arrayBuffer());
    const check = checkUpload(value.name || 'Datei', bytes.byteLength, bytes.subarray(0, 32));
    if (!check.ok) {
      fileErrors[`documents.${kind}`] ??= check.error;
      continue;
    }
    files.push({ kind, name: value.name || `${kind}.${check.type.ext}`, bytes, type: check.type });
  }
  const docErrors = { ...validateDocuments(order.service, counts), ...fileErrors };
  if (Object.keys(docErrors).length > 0) return fail(422, 'Bitte prüfen Sie die hochgeladenen Unterlagen.', docErrors);

  // Erst zählen, wenn die Anfrage gültig ist – Tippfehler sollen niemanden aussperren.
  limits().orders.hit(ip);

  try {
    const created = createOrder(order, files);
    return NextResponse.json({ ok: true, number: created.number, service: order.service });
  } catch (e) {
    console.error('[auftrag] Anlage fehlgeschlagen', e);
    return fail(500, 'Der Auftrag konnte gerade nicht gespeichert werden. Bitte versuchen Sie es später erneut.');
  }
}
