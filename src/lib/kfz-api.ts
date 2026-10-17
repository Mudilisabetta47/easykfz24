// Anbindung an kfz-api.de (KBA-Großkundenschnittstelle): Webhook-Statuswerte, Signatur, Auswertung.
//
// Grundlage ist die offizielle Spezifikation (Webhooks 3.1.0, spec/webhooks.yaml; API 2.3.0, spec/api.yaml):
//   - Header X-Signature: HMAC-SHA256 (hex) über den Rohtext des Rumpfs (UTF-8)
//   - Header X-Event-Id: bleibt bei Wiederholungen gleich (sieben Zustellversuche in rund 31 Stunden, Rumpf bitgleich)
//   - Rumpf (XkfzEventPayload, flach neben eventType/eventTime): attemptOf, attempt, order.id, order.externalId,
//     businessTransaction (AB, HA, UG, WG, WZ, NZ, TZ), status, derivedStatus, applicationId, licensePlate, files[],
//     messages[] (type, kind, code, text, additional), retryable
//   - Zuordnung laut Spezifikation über attemptOf (Auftrag), nicht über order.id (Versuch); externalId ist die eigene Referenz
// Die Auswertung bleibt tolerant: Unbekannte Statuswerte werden gespeichert, nicht verworfen.

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
  /** Quittungsart in Worten (Hinweis, Warnung, Fehler) – fehlt bei Ablehnungsgründen */
  kind?: string;
  /** Zusatztext des KBA, bei Ablehnungen der Grund */
  additional?: string;
}

export interface KfzEvent {
  /** false = kein order-Objekt (z. B. PING zum Erreichbarkeitstest) */
  hasOrder: boolean;
  orderId: string | null;
  /** Auftrag, zu dem der Versuch gehört (beim ersten Versuch = orderId) – maßgeblich für die Zuordnung */
  attemptOf: string | null;
  attempt: number | null;
  externalId: string | null;
  /** Antragsnummer des KBA (20 Ziffern), erst nach der Quittung */
  applicationId: string | null;
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
        const kind = str(r.kind);
        const additional = str(r.additional);
        return code || text || additional ? [{ code, text, ...(kind ? { kind: kind.slice(0, 20) } : {}), ...(additional ? { additional: additional.slice(0, 1000) } : {}) }] : [];
      })
    : [];
  return {
    hasOrder: !!order,
    orderId: order ? str(order.id) : null,
    attemptOf: order ? (str(b.attemptOf) ?? str(order.id)) : null,
    attempt: typeof b.attempt === 'number' && Number.isInteger(b.attempt) && b.attempt > 0 ? b.attempt : null,
    externalId: order ? str(order.externalId) : null,
    applicationId: str(b.applicationId)?.slice(0, 40) ?? null,
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

/** Belegart (purposeType laut webhooks.yaml 3.1.0: CERTIFICATE, RECEIPT, APPLICATION, UNSPECIFIED) */
const PURPOSE: Record<string, string> = { CERTIFICATE: 'Bescheinigung', RECEIPT: 'Quittung', APPLICATION: 'Antrag', UNSPECIFIED: 'Beleg' };
export function purposeLabel(purposeType: string): string {
  return PURPOSE[purposeType] ?? (purposeType || 'Beleg');
}
