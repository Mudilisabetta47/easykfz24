// Statuswerte von kfz-api.de und ihre Anzeige – ohne Node-Abhängigkeiten, auch im Browser nutzbar.
// Grundlage: öffentlich dokumentierte Werte unter https://kfz-api.de/api/ (siehe kfz-api.ts).

export const KFZ_STATUSES = [
  'ACCEPTED',
  'FORWARDED',
  'APPROVED',
  'APPROVED_WITH_DOCUMENTS',
  'REJECTED',
  'REJECTED_WITH_DOCUMENTS',
  'FAILED',
] as const;
export type KfzStatus = (typeof KFZ_STATUSES)[number];

export const KFZ_STATUS_TEXT: Record<KfzStatus, string> = {
  ACCEPTED: 'Das KBA hat den Antrag angenommen.',
  FORWARDED: 'Weitergeleitet, die Zulassungsbehörde entscheidet von Hand.',
  APPROVED: 'Beschieden.',
  APPROVED_WITH_DOCUMENTS: 'Beschieden, Belege liegen vor.',
  REJECTED: 'Abgelehnt.',
  REJECTED_WITH_DOCUMENTS: 'Abgelehnt, Belege liegen vor.',
  FAILED: 'Gescheitert.',
};

export const DERIVED_STATUSES = ['PENDING', 'SUCCESS', 'FAILURE'] as const;
export type DerivedStatus = (typeof DERIVED_STATUSES)[number];

/** Vorgangsarten laut Dokumentation, mit Pfadpräfix für Abfragen und Belege. */
export const BUSINESS_TRANSACTIONS = {
  NZ: { label: 'Neuzulassung', prefix: 'vehicleRegistrations' },
  TZ: { label: 'Tageszulassung', prefix: 'vehicleRegistrations' },
  UG: { label: 'Umschreibung', prefix: 'vehicleTransfers' },
  WG: { label: 'Wiederzulassung', prefix: 'vehicleReRegistrations' },
  WZ: { label: 'Wiederzulassung auf denselben Halter', prefix: 'vehicleReRegistrations' },
  HA: { label: 'Adressänderung', prefix: 'vehicleHolderChanges' },
  AB: { label: 'Abmeldung', prefix: 'vehicleDeregistrations' },
} as const;
export type BusinessTransaction = keyof typeof BUSINESS_TRANSACTIONS;

/* ---------- Anzeige für Dashboard und Kunden ---------- */

export const DISPLAY_IDS = ['eingegangen', 'in_bearbeitung', 'angaben_erforderlich', 'abgeschlossen', 'fehlgeschlagen'] as const;
export type DisplayStatus = (typeof DISPLAY_IDS)[number];

export const DISPLAY: Record<DisplayStatus, { label: string; tone: 'blue' | 'violet' | 'amber' | 'green' | 'red'; text: string }> = {
  eingegangen: { label: 'Auftrag eingegangen', tone: 'blue', text: 'Ihr Auftrag ist bei uns eingegangen.' },
  in_bearbeitung: {
    label: 'In Bearbeitung',
    tone: 'violet',
    text: 'Ihr Antrag wird bearbeitet. Die zuständige Zulassungsbehörde entscheidet – bei manueller Prüfung kann das etwas länger dauern.',
  },
  angaben_erforderlich: {
    label: 'Weitere Angaben erforderlich',
    tone: 'amber',
    text: 'Für Ihren Antrag sind weitere Angaben oder eine Korrektur nötig. Wir melden uns bei Ihnen bzw. kümmern uns darum.',
  },
  abgeschlossen: { label: 'Erfolgreich abgeschlossen', tone: 'green', text: 'Die Zulassungsbehörde hat Ihren Antrag beschieden.' },
  fehlgeschlagen: {
    label: 'Fehlgeschlagen',
    tone: 'red',
    text: 'Der Antrag konnte nicht abgeschlossen werden. Wir prüfen den Vorgang und melden uns bei Ihnen.',
  },
};

/**
 * Zuordnung der dokumentierten Statuswerte zur Anzeige.
 * ACCEPTED/FORWARDED → In Bearbeitung · APPROVED* → Erfolgreich abgeschlossen · REJECTED* (Code und Klartext,
 * korrigierbar) → Weitere Angaben erforderlich · FAILED → Fehlgeschlagen, außer retryable (vorübergehend) → In Bearbeitung.
 * Ohne bekannten status entscheidet derivedStatus (PENDING/SUCCESS/FAILURE).
 */
export function displayFor(status: string | null, derived: string | null, retryable: boolean | null): DisplayStatus | null {
  switch (status) {
    case 'ACCEPTED':
    case 'FORWARDED':
      return 'in_bearbeitung';
    case 'APPROVED':
    case 'APPROVED_WITH_DOCUMENTS':
      return 'abgeschlossen';
    case 'REJECTED':
    case 'REJECTED_WITH_DOCUMENTS':
      return 'angaben_erforderlich';
    case 'FAILED':
      return retryable === true ? 'in_bearbeitung' : 'fehlgeschlagen';
  }
  switch (derived) {
    case 'PENDING':
      return 'in_bearbeitung';
    case 'SUCCESS':
      return 'abgeschlossen';
    case 'FAILURE':
      return 'fehlgeschlagen';
  }
  return null;
}

/** Für diese Anzeigen wird der Kunde per E-Mail informiert (jeweils beim ersten Erreichen bzw. Wechsel). */
export const NOTIFY_ON: readonly DisplayStatus[] = ['in_bearbeitung', 'angaben_erforderlich', 'abgeschlossen', 'fehlgeschlagen'];
