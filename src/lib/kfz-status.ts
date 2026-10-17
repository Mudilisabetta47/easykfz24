// Statuswerte von kfz-api.de und ihre Anzeige – ohne Node-Abhängigkeiten, auch im Browser nutzbar.
// Grundlage: Webhook-Spezifikation 3.1.0 und API 2.3.0 von kfz-api.de (spec/webhooks.yaml, spec/api.yaml).

export const KFZ_STATUSES = [
  'ACCEPTED',
  'FORWARDED',
  'APPROVED',
  'APPROVED_WITH_DOCUMENTS',
  'REJECTED',
  'REJECTED_WITH_DOCUMENTS',
  'FAILED',
  'PROCESSED',
  'UNKNOWN',
] as const;
export type KfzStatus = (typeof KFZ_STATUSES)[number];

export const KFZ_STATUS_TEXT: Record<KfzStatus, string> = {
  ACCEPTED: 'Das KBA hat den Antrag angenommen.',
  FORWARDED: 'Weitergeleitet, die Zulassungsbehörde entscheidet von Hand.',
  APPROVED: 'Beschieden.',
  APPROVED_WITH_DOCUMENTS: 'Beschieden, Belege liegen vor.',
  REJECTED: 'Abgelehnt.',
  REJECTED_WITH_DOCUMENTS: 'Abgelehnt, Belege liegen vor.',
  FAILED: 'Vom KBA abgewiesen, der Antrag ist zu korrigieren.',
  PROCESSED: 'Verarbeitet.',
  UNKNOWN: 'Stand unbekannt.',
};

export const DERIVED_STATUSES = [
  'PENDING',
  'SUCCESS',
  'FAILURE',
  'VEHICLE_UNKNOWN',
  'VEHICLE_ALREADY_DEREGISTERED',
  'LICENSE_PLATE_CODE_INVALID',
  'REGISTRATION_CERTIFICATE_CODE_INVALID',
  'LICENSE_PLATE_CODE_QTY_INVALID',
  'INPUT_INVALID',
  'RESERVATION_IMPOSSIBLE',
  'ERROR_UNHANDLED',
] as const;
export type DerivedStatus = (typeof DERIVED_STATUSES)[number];

/** Klartext der Ablehnungsarten (webhooks.yaml 3.1.0, derivedStatus) – für Mitarbeiter, nicht für Kunden */
export const DERIVED_TEXT: Record<DerivedStatus, string> = {
  PENDING: 'Läuft noch.',
  SUCCESS: 'Erfolgreich.',
  FAILURE: 'Abgelehnt, Gründe in den Meldungen.',
  VEHICLE_UNKNOWN: 'Fahrzeug im Register nicht gefunden – FIN und Kennzeichen prüfen.',
  VEHICLE_ALREADY_DEREGISTERED: 'Fahrzeug ist bereits außer Betrieb gesetzt.',
  LICENSE_PLATE_CODE_INVALID: 'Sicherheitscode einer Stempelplakette falsch.',
  REGISTRATION_CERTIFICATE_CODE_INVALID: 'Sicherheitscode der Zulassungsbescheinigung falsch.',
  LICENSE_PLATE_CODE_QTY_INVALID: 'Anzahl der Plakettencodes passt nicht zur Zahl der Kennzeichenschilder.',
  INPUT_INVALID: 'Eingabe ungültig.',
  RESERVATION_IMPOSSIBLE: 'Kennzeichenreservierung nicht möglich – ohne Reservierung neu einreichen.',
  ERROR_UNHANDLED: 'Manuelle Prüfung nötig (Schemaprüfung des KBA an Registerdaten) – weder korrigieren noch erneut einreichen.',
};

/**
 * Ablehnungsarten, die intern zu klären sind (Webhooks 3.1.0): ERROR_UNHANDLED = manuelle Prüfung, weder Kundenkorrektur noch
 * erneutes Einreichen; RESERVATION_IMPOSSIBLE = ohne Reservierung neu einreichen; INPUT_INVALID = eigener Eingabefehler.
 * Hierzu geht keine automatische Kundenmail hinaus – der Kunde muss nichts tun.
 */
export const STAFF_ONLY_DERIVED: readonly string[] = ['ERROR_UNHANDLED', 'RESERVATION_IMPOSSIBLE', 'INPUT_INVALID'];

/** Ablehnungen, die eine Korrektur der Angaben bzw. Codes zulassen (Kunde wird um Angaben gebeten) */
const CORRECTABLE: readonly string[] = [
  'VEHICLE_UNKNOWN',
  'LICENSE_PLATE_CODE_INVALID',
  'REGISTRATION_CERTIFICATE_CODE_INVALID',
  'LICENSE_PLATE_CODE_QTY_INVALID',
  'INPUT_INVALID',
  'RESERVATION_IMPOSSIBLE',
];

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
 * korrigierbar) → Weitere Angaben erforderlich · FAILED → Fehlgeschlagen, außer retryable (vorübergehend) → In Bearbeitung
 * bzw. korrigierbare Ablehnungsart (falscher Code, Fahrzeug unbekannt …) → Weitere Angaben erforderlich.
 * PROCESSED/UNKNOWN und unbekannte Werte: derivedStatus entscheidet (PENDING/SUCCESS, sonst Ablehnungsart).
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
      if (retryable === true) return 'in_bearbeitung';
      return derived && CORRECTABLE.includes(derived) ? 'angaben_erforderlich' : 'fehlgeschlagen';
  }
  switch (derived) {
    case 'PENDING':
      return 'in_bearbeitung';
    case 'SUCCESS':
      return 'abgeschlossen';
    case null:
      return null;
  }
  if (CORRECTABLE.includes(derived)) return 'angaben_erforderlich';
  return (DERIVED_STATUSES as readonly string[]).includes(derived) ? 'fehlgeschlagen' : null;
}

/** Für diese Anzeigen wird der Kunde per E-Mail informiert (jeweils beim ersten Erreichen bzw. Wechsel). */
export const NOTIFY_ON: readonly DisplayStatus[] = ['in_bearbeitung', 'angaben_erforderlich', 'abgeschlossen', 'fehlgeschlagen'];
