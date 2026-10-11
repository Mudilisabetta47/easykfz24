// Anbindung an kfz-api.de (KBA-Großkundenschnittstelle): Webhook-Statuswerte, Signatur, Auswertung.
//
// Grundlage sind ausschließlich die öffentlich dokumentierten Angaben unter https://kfz-api.de/api/ und
// https://kfz-api.de/software-anbieter/ (Stand Oktober 2026):
//   - Header X-Signature: HMAC-SHA256 (hex) über den Rohtext des Rumpfs
//   - Header X-Event-Id: bleibt bei Wiederholungen gleich (bis zu sieben Zustellversuche in rund 31 Stunden)
//   - Rumpf: order.id, order.externalId, businessTransaction (NZ, TZ, UG, WG, WZ, HA, AB), status, derivedStatus,
//     licensePlate, files[] (purposeType, fileAccessKey), messages[] (Code und Klartext), retryable
//   - status: ACCEPTED, FORWARDED, APPROVED, APPROVED_WITH_DOCUMENTS, REJECTED, REJECTED_WITH_DOCUMENTS, FAILED
//   - derivedStatus: PENDING, SUCCESS, FAILURE
// Die vollständige Spezifikation (Feldnamen in messages[], Format des PING) steht nur in der Dokumentation nach dem
// Login (api.kfz-api.de/docs). Die Auswertung ist deshalb bewusst tolerant und speichert Unbekanntes nachvollziehbar.

import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export * from './kfz-status.ts';
import { BUSINESS_TRANSACTIONS, DERIVED_STATUSES, KFZ_STATUSES, type BusinessTransaction, type DerivedStatus, type KfzStatus } from './kfz-status.ts';

/* ---------- Signatur ---------- */

/** X-Signature = HMAC-SHA256 (hex) über den Rohtext, Vergleich in konstanter Zeit. */
export function verifyKfzSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex'));
  const received = Buffer.from(signature.trim().toLowerCase());
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function signKfzBody(rawBody: string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function sha256Hex(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/* ---------- Rumpf auswerten ---------- */

export interface KfzFile {
  purposeType: string;
  fileAccessKey: string;
}

export interface KfzMessage {
  code: string;
  text: string;
}

export interface KfzEvent {
  /** false = kein order-Objekt (z. B. PING zum Erreichbarkeitstest) */
  hasOrder: boolean;
  orderId: string | null;
  externalId: string | null;
  businessTransaction: BusinessTransaction | null;
  status: KfzStatus | null;
  /** Unbekannter, aber gelieferter Statuswert – wird gespeichert, nicht verworfen */
  rawStatus: string | null;
  derivedStatus: DerivedStatus | null;
  licensePlate: string | null;
  files: KfzFile[];
  messages: KfzMessage[];
  retryable: boolean | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : typeof v === 'number' ? String(v) : null);

function pickText(m: Record<string, unknown>): string {
  for (const k of ['text', 'message', 'description', 'plainText', 'klartext']) {
    const v = str(m[k]);
    if (v) return v;
  }
  return '';
}

/** Liest einen Webhook-Rumpf tolerant aus. Nur dokumentierte Felder werden übernommen. */
export function parseKfzEvent(body: unknown): KfzEvent {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const order = b.order && typeof b.order === 'object' ? (b.order as Record<string, unknown>) : null;
  const rawStatus = str(b.status);
  const status = rawStatus && (KFZ_STATUSES as readonly string[]).includes(rawStatus) ? (rawStatus as KfzStatus) : null;
  const derivedRaw = str(b.derivedStatus);
  const derivedStatus = derivedRaw && (DERIVED_STATUSES as readonly string[]).includes(derivedRaw) ? (derivedRaw as DerivedStatus) : null;
  const bt = str(b.businessTransaction);
  const files = Array.isArray(b.files)
    ? b.files.flatMap((f) => {
        if (!f || typeof f !== 'object') return [];
        const r = f as Record<string, unknown>;
        const key = str(r.fileAccessKey);
        return key ? [{ purposeType: str(r.purposeType) ?? '', fileAccessKey: key }] : [];
      })
    : [];
  const messages = Array.isArray(b.messages)
    ? b.messages.flatMap((m) => {
        if (typeof m === 'string') return [{ code: '', text: m }];
        if (!m || typeof m !== 'object') return [];
        const r = m as Record<string, unknown>;
        const code = str(r.code) ?? '';
        const text = pickText(r);
        return code || text ? [{ code, text }] : [];
      })
    : [];
  return {
    hasOrder: !!order,
    orderId: order ? str(order.id) : null,
    externalId: order ? str(order.externalId) : null,
    businessTransaction: bt && bt in BUSINESS_TRANSACTIONS ? (bt as BusinessTransaction) : null,
    status,
    rawStatus,
    derivedStatus,
    licensePlate: str(b.licensePlate),
    files,
    messages,
    retryable: typeof b.retryable === 'boolean' ? b.retryable : null,
  };
}

/** Kennzeichen aus dem Webhook („OL-KR 100“) in unser Format bringen; null, wenn unplausibel. */
export function normalizeKfzPlate(v: string | null): string | null {
  if (!v) return null;
  const m = /^([A-ZÄÖÜ]{1,3})[\s-]+([A-Z]{1,2})[\s-]*(\d{1,4}[EH]?)$/.exec(v.toUpperCase().trim());
  return m ? `${m[1]}-${m[2]} ${m[3]}` : null;
}

/** Belegart (purposeType) – die Werteliste ist nur in der Dokumentation nach Login beschrieben, daher unverändert. */
export function purposeLabel(purposeType: string): string {
  return purposeType || 'Beleg';
}
