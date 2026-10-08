// Leistungen des Zulassungsdienstes und ihre Anforderungen (Unterlagen, eVB, SEPA, Kennzeichen).

export const SERVICE_IDS = ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung', 'abmeldung'] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const DOCUMENT_KINDS = ['ausweis', 'zb1', 'zb2', 'coc', 'hu'] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export type Requirement = 'pflicht' | 'optional';
export type PlateChoice = 'behalten' | 'neu' | 'wunsch';

export const DOCUMENTS: Record<DocumentKind, { label: string; short: string; hint: string }> = {
  ausweis: {
    label: 'Personalausweis oder Reisepass mit Meldebescheinigung',
    short: 'Ausweis',
    hint: 'Vorder- und Rückseite. Bei Firmen zusätzlich Gewerbeanmeldung oder Handelsregisterauszug.',
  },
  zb1: {
    label: 'Zulassungsbescheinigung Teil I (Fahrzeugschein)',
    short: 'ZB I',
    hint: 'Vorderseite mit allen Feldern gut lesbar.',
  },
  zb2: {
    label: 'Zulassungsbescheinigung Teil II (Fahrzeugbrief)',
    short: 'ZB II',
    hint: 'Alle beschriebenen Seiten.',
  },
  coc: {
    label: 'Übereinstimmungsbescheinigung (COC-Papier)',
    short: 'COC',
    hint: 'Vom Hersteller oder Händler, für Neufahrzeuge.',
  },
  hu: {
    label: 'Nachweis Hauptuntersuchung (HU-Bericht)',
    short: 'HU',
    hint: 'Aktueller Prüfbericht der letzten Hauptuntersuchung.',
  },
};

export const PLATE_CHOICES: Record<PlateChoice, { label: string; hint: string }> = {
  behalten: {
    label: 'Bisheriges Kennzeichen behalten',
    hint: 'Möglich, wenn das Kennzeichen noch zugeteilt bzw. reserviert ist.',
  },
  neu: { label: 'Neues Kennzeichen (zufällig zugeteilt)', hint: 'Die Zulassungsstelle teilt ein freies Kennzeichen zu.' },
  wunsch: { label: 'Wunschkennzeichen', hint: 'Wir reservieren Ihre Wunschkombination, sofern verfügbar.' },
};

export interface ServiceDefinition {
  id: ServiceId;
  title: string;
  summary: string;
  description: string;
  documents: Partial<Record<DocumentKind, Requirement>>;
  /** eVB-Nummer der Versicherung: immer, nur bei Kennzeichenwechsel oder nie. */
  evb: 'pflicht' | 'bei_kennzeichenwechsel' | 'nein';
  /** SEPA-Lastschriftmandat für die Kfz-Steuer erforderlich. */
  sepa: boolean;
  /** Mögliche Kennzeichen-Optionen; leer = keine Kennzeichenwahl (Abmeldung). */
  plateChoices: PlateChoice[];
  previousPlate: Requirement | 'nein';
  /** Was im Original per Post zu uns muss. */
  originals: string[];
  notes: string[];
}

export const SERVICES: Record<ServiceId, ServiceDefinition> = {
  neuzulassung: {
    id: 'neuzulassung',
    title: 'Neuzulassung',
    summary: 'Erstzulassung eines Neufahrzeugs oder eines Fahrzeugs, das noch nie in Deutschland zugelassen war.',
    description:
      'Wir übernehmen die Erstzulassung Ihres Fahrzeugs bei der Zulassungsstelle – inklusive Kennzeichen-Reservierung und auf Wunsch der Kennzeichenschilder.',
    documents: { ausweis: 'pflicht', zb2: 'pflicht', coc: 'pflicht' },
    evb: 'pflicht',
    sepa: true,
    plateChoices: ['neu', 'wunsch'],
    previousPlate: 'nein',
    originals: [
      'Unterschriebene Vollmacht',
      'Zulassungsbescheinigung Teil II (Fahrzeugbrief)',
      'Übereinstimmungsbescheinigung (COC-Papier)',
    ],
    notes: [
      'Bei Importfahrzeugen können weitere Nachweise nötig sein (z. B. Unbedenklichkeitsbescheinigung, Datenbestätigung). Wir melden uns, falls etwas fehlt.',
    ],
  },
  halterwechsel: {
    id: 'halterwechsel',
    title: 'Ummeldung bei Halterwechsel',
    summary: 'Sie haben ein gebrauchtes, noch zugelassenes Fahrzeug gekauft und möchten es auf sich umschreiben.',
    description:
      'Wir schreiben das Fahrzeug auf Sie als neuen Halter um. Das bisherige Kennzeichen kann – je nach Zulassungsbezirk und Zustimmung – übernommen werden.',
    documents: { ausweis: 'pflicht', zb1: 'pflicht', zb2: 'pflicht', hu: 'pflicht' },
    evb: 'pflicht',
    sepa: true,
    plateChoices: ['behalten', 'neu', 'wunsch'],
    previousPlate: 'pflicht',
    originals: [
      'Unterschriebene Vollmacht',
      'Zulassungsbescheinigung Teil I (Fahrzeugschein)',
      'Zulassungsbescheinigung Teil II (Fahrzeugbrief)',
      'Alte Kennzeichenschilder (nur bei Kennzeichenwechsel)',
    ],
    notes: ['Die HU muss zum Zeitpunkt der Ummeldung gültig sein.'],
  },
  umzug: {
    id: 'umzug',
    title: 'Ummeldung bei Umzug',
    summary: 'Ihre Anschrift hat sich geändert – wir tragen die neue Adresse in die Fahrzeugpapiere ein.',
    description:
      'Nach einem Umzug muss die Anschrift in der Zulassungsbescheinigung aktualisiert werden. Ihr Kennzeichen können Sie bundesweit behalten oder ein neues wählen.',
    documents: { ausweis: 'pflicht', zb1: 'pflicht', zb2: 'optional', hu: 'optional' },
    evb: 'bei_kennzeichenwechsel',
    sepa: false,
    plateChoices: ['behalten', 'neu', 'wunsch'],
    previousPlate: 'pflicht',
    originals: [
      'Unterschriebene Vollmacht',
      'Zulassungsbescheinigung Teil I (Fahrzeugschein)',
      'Zulassungsbescheinigung Teil II und alte Kennzeichenschilder (nur bei Kennzeichenwechsel)',
    ],
    notes: ['Der Ausweis muss bereits die neue Anschrift enthalten (Ummeldung beim Einwohnermeldeamt zuerst).'],
  },
  wiederzulassung: {
    id: 'wiederzulassung',
    title: 'Wiederzulassung',
    summary: 'Ein abgemeldetes (außer Betrieb gesetztes) Fahrzeug soll wieder auf die Straße.',
    description:
      'Wir lassen Ihr zuvor abgemeldetes Fahrzeug wieder zu. Ein reserviertes früheres Kennzeichen kann in der Regel wieder verwendet werden.',
    documents: { ausweis: 'pflicht', zb1: 'pflicht', zb2: 'pflicht', hu: 'pflicht' },
    evb: 'pflicht',
    sepa: true,
    plateChoices: ['behalten', 'neu', 'wunsch'],
    previousPlate: 'optional',
    originals: [
      'Unterschriebene Vollmacht',
      'Zulassungsbescheinigung Teil I mit Abmeldevermerk',
      'Zulassungsbescheinigung Teil II (Fahrzeugbrief)',
    ],
    notes: ['Liegt die Abmeldung länger als sieben Jahre zurück, können zusätzliche Nachweise erforderlich sein.'],
  },
  abmeldung: {
    id: 'abmeldung',
    title: 'Abmeldung',
    summary: 'Sie möchten Ihr Fahrzeug außer Betrieb setzen – z. B. nach Verkauf ins Ausland, Verschrottung oder Stilllegung.',
    description:
      'Wir melden Ihr Fahrzeug bei der Zulassungsstelle ab und senden Ihnen die Abmeldebestätigung zu. Versicherung und Kfz-Steuer werden automatisch informiert.',
    documents: { ausweis: 'pflicht', zb1: 'pflicht' },
    evb: 'nein',
    sepa: false,
    plateChoices: [],
    previousPlate: 'pflicht',
    originals: [
      'Unterschriebene Vollmacht',
      'Zulassungsbescheinigung Teil I (Fahrzeugschein)',
      'Beide Kennzeichenschilder (zum Entstempeln)',
    ],
    notes: ['Ohne die Original-Kennzeichenschilder ist eine Abmeldung nicht möglich.'],
  },
};

export function isServiceId(v: unknown): v is ServiceId {
  return typeof v === 'string' && (SERVICE_IDS as readonly string[]).includes(v);
}

export function getService(id: ServiceId): ServiceDefinition {
  return SERVICES[id];
}

/** Unterlagen in fester Reihenfolge, die für eine Leistung abgefragt werden. */
export function documentsFor(id: ServiceId): { kind: DocumentKind; requirement: Requirement }[] {
  const docs = SERVICES[id].documents;
  return DOCUMENT_KINDS.filter((k) => docs[k]).map((kind) => ({ kind, requirement: docs[kind] as Requirement }));
}

export function requiredDocuments(id: ServiceId): DocumentKind[] {
  return documentsFor(id)
    .filter((d) => d.requirement === 'pflicht')
    .map((d) => d.kind);
}

/** Wird das Kennzeichen gewechselt (neue Schilder nötig)? */
export function isPlateChange(id: ServiceId, choice: PlateChoice | null): boolean {
  if (SERVICES[id].plateChoices.length === 0) return false;
  return choice === 'neu' || choice === 'wunsch';
}

export function isEvbRequired(id: ServiceId, choice: PlateChoice | null): boolean {
  const rule = SERVICES[id].evb;
  if (rule === 'pflicht') return true;
  if (rule === 'bei_kennzeichenwechsel') return isPlateChange(id, choice);
  return false;
}

export function isPreviousPlateRequired(id: ServiceId, choice: PlateChoice | null): boolean {
  return SERVICES[id].previousPlate === 'pflicht' || choice === 'behalten';
}
