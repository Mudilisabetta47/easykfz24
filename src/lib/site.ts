// Unternehmensangaben. Alles in eckigen Klammern mit "PLATZHALTER" muss vor dem Livegang ersetzt werden;
// die Website hebt diese Stellen sichtbar hervor.

export const PLACEHOLDER_PREFIX = '[PLATZHALTER';

export const SITE = {
  name: 'EasyKFZ24',
  claim: 'Kfz-Zulassungsdienst – online beauftragen, wir erledigen den Behördengang.',
  company: '[PLATZHALTER: Firmenname und Rechtsform]',
  owner: '[PLATZHALTER: Vertretungsberechtigte Person]',
  street: '[PLATZHALTER: Straße und Hausnummer]',
  city: '[PLATZHALTER: PLZ und Ort]',
  phone: '[PLATZHALTER: Telefonnummer]',
  email: '[PLATZHALTER: E-Mail-Adresse]',
  register: '[PLATZHALTER: Registergericht und Registernummer]',
  vatId: '[PLATZHALTER: Umsatzsteuer-Identifikationsnummer]',
  supervisory: '[PLATZHALTER: ggf. zuständige Aufsichtsbehörde / Gewerbeamt]',
  openingHours: '[PLATZHALTER: Öffnungszeiten für Abholung]',
  privacyContact: '[PLATZHALTER: Kontakt für Datenschutzanfragen]',
  hosting: '[PLATZHALTER: Hosting-Anbieter mit Anschrift]',
} as const;

export function isPlaceholder(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX);
}
