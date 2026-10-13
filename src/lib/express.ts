// Express-Bearbeitung: Stufen, Werbeaussage mit Einschränkung, Preise und Meilensteine – ohne Server-Abhängigkeiten.
// Grundsatz: Wir versprechen nur, was wir selbst steuern (Reihenfolge und Priorität unserer Bearbeitung). Über Dauer und
// Ergebnis entscheidet die Zulassungsbehörde – dafür gibt es keine Frist und keine Zusage.

export const PROCESSING_LEVELS = ['standard', 'express', 'express_plus'] as const;
export type ProcessingLevel = (typeof PROCESSING_LEVELS)[number];
export type ExpressLevel = Exclude<ProcessingLevel, 'standard'>;
export const EXPRESS_LEVELS: readonly ExpressLevel[] = ['express', 'express_plus'];

export const isProcessingLevel = (v: unknown): v is ProcessingLevel => typeof v === 'string' && (PROCESSING_LEVELS as readonly string[]).includes(v);
export const isExpress = (v: unknown): v is ExpressLevel => v === 'express' || v === 'express_plus';

export const PROCESSING: Record<ProcessingLevel, { label: string; short: string; text: string }> = {
  standard: { label: 'Standard', short: 'Standard', text: 'Bearbeitung in der Reihenfolge des Eingangs.' },
  express: { label: 'Express', short: 'Express', text: 'Ihr Auftrag wird nach Zahlung und vollständigen Unterlagen vor Standard-Aufträgen geprüft und eingereicht.' },
  express_plus: {
    label: 'Express Plus',
    short: 'Express+',
    text: 'Wie Express – zusätzlich mit dem unten beschriebenen persönlichen Service.',
  },
};

/** Hauptaussage (ohne belastbare Bearbeitungsdaten keine Zeitangabe) und die Einschränkung direkt am Sternchen. */
export const EXPRESS_HEADLINE = 'Express-Zulassung – bevorzugte Bearbeitung*';
export const EXPRESS_FOOTNOTE =
  '* Bevorzugte Bearbeitung heißt: Sobald die Zahlung bestätigt ist und alle Unterlagen vollständig vorliegen, prüfen wir Ihren Auftrag vor ' +
  'Standard-Aufträgen und reichen ihn nach erfolgreicher Prüfung bevorzugt beim Zulassungspartner ein. Über die Zulassung entscheidet die ' +
  'Zulassungsbehörde; auf deren Bearbeitungsdauer haben wir keinen Einfluss. Eine Zulassung innerhalb einer bestimmten Frist sagen wir nicht zu.';

export interface ExpressPrice {
  /** Aufpreis brutto (inkl. MwSt.); null = nicht festgelegt */
  sellCents: number | null;
  active: boolean;
  /** zusätzliche interne Bearbeitungskosten je Auftrag (netto), für den Deckungsbeitrag */
  internalCostCents: number;
  /** interne Bearbeitungsfrist ab Zahlung (Stunden) – nur intern, wird Kunden nie angezeigt */
  internalHours: number;
}

/** Gespeicherte Express-Einstellungen (Version wie bei den Schilderpreisen). */
export interface ExpressVersion {
  version: number;
  from: string;
  by: string;
  levels: Record<ExpressLevel, ExpressPrice>;
  /** Leistungen von Express Plus – nur, was der Betrieb tatsächlich zusichert (wird dem Kunden so angezeigt) */
  plusServices: string[];
}

export const EXPRESS_DEFAULT: ExpressVersion = {
  version: 0,
  from: '',
  by: 'Ausgangswerte',
  levels: {
    express: { sellCents: 1990, active: false, internalCostCents: 0, internalHours: 24 },
    express_plus: { sellCents: 2990, active: false, internalCostCents: 0, internalHours: 12 },
  },
  plusServices: ['Feste persönliche Ansprechperson für Ihren Auftrag', 'Telefonischer Rückruf bei Rückfragen der Behörde während unserer Geschäftszeiten'],
};

/** Was Kunden sehen: Aufpreise der angebotenen Stufen und die Express-Plus-Leistungen. */
export interface ExpressOffer {
  express: number | null;
  express_plus: number | null;
  plusServices: string[];
}

export function expressOfferOf(v: ExpressVersion): ExpressOffer {
  const price = (l: ExpressLevel) => (v.levels[l].active && v.levels[l].sellCents ? v.levels[l].sellCents : null);
  return { express: price('express'), express_plus: price('express_plus'), plusServices: v.plusServices };
}

export const NO_EXPRESS: ExpressOffer = { express: null, express_plus: null, plusServices: [] };

/** Bearbeitungsstufe eines (auch älteren) Auftrags: ohne Angabe Standard. */
export function processingOf(order: { bearbeitung?: unknown } | undefined): ProcessingLevel {
  return order && isProcessingLevel(order.bearbeitung) ? order.bearbeitung : 'standard';
}

/** Interne Kosten zum Bestellzeitpunkt (im Auftrag gespeichert, nur mit Finanzrecht sichtbar). */
export interface ExpressCostSnapshot {
  level: ExpressLevel;
  internalCostCents: number;
  internalHours: number;
  version: number;
}

/* ---------- Meilensteine (aus echten Ereignissen) ---------- */

export const MILESTONES = [
  { key: 'eingang', label: 'Auftrag eingegangen' },
  { key: 'zahlung', label: 'Zahlung bestätigt' },
  { key: 'unterlagen', label: 'Unterlagen vollständig' },
  { key: 'pruefung', label: 'Express-Prüfung läuft' },
  { key: 'freigabe', label: 'Für Übermittlung freigegeben' },
  { key: 'uebertragen', label: 'An Zulassungspartner übertragen' },
  { key: 'behoerde', label: 'Bei Zulassungsbehörde' },
  { key: 'ergebnis', label: 'Ergebnis der Zulassungsbehörde' },
] as const;
export type MilestoneKey = (typeof MILESTONES)[number]['key'];

export interface Milestone {
  key: MilestoneKey;
  label: string;
  /** Zeitpunkt des tatsächlichen Ereignisses; null = noch nicht erreicht */
  at: string | null;
  /** Ergebnis/Hinweis, z. B. „Zulassung erfolgreich“, „Rückfrage“, „Behörde prüft von Hand“ */
  note?: string;
  tone?: 'ok' | 'warn' | 'fail';
}
