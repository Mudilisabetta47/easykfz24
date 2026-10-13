// Rechtliche Angaben. „EasyKFZ24“ ist eine Marke – Anbieter der Website und Vertragspartner der Kundinnen und Kunden ist
// die MONVEX UG (haftungsbeschränkt). EasyKFZ24 darf nirgends wie eine eigene Gesellschaft erscheinen.
//
// Quellen (Stand 13.10.2026): notarielle Gründung mit Musterprotokoll vom 23.09.2026 (Firma, Sitz Bremen, Geschäftsführer),
// Handelsregisteranmeldung an das Amtsgericht Bremen (inländische Geschäftsanschrift), Unternehmensstammdaten im
// EasyKFZ24 OS (E-Mail). Anschrift, Geschäftsführer, Telefon und E-Mail am 13.10.2026 vom Inhaber verbindlich bestätigt;
// die Gesellschaft ist laut Inhaber weiterhin in Gründung – daher „i. G.“ und ausdrücklich keine Registernummer.
// Registernummer, Telefon und USt-IdNr. nur eintragen, wenn sie nachweislich vorliegen – niemals erfinden.

export const BRAND = 'EasyKFZ24';

export const PROVIDER = {
  /** Firma laut Gesellschaftsvertrag */
  firm: 'MONVEX UG (haftungsbeschränkt)',
  /** Handelsregister: null = noch nicht eingetragen (Gesellschaft in Gründung) */
  register: null as { court: string; number: string } | null,
  /** zuständiges Registergericht nach dem Sitz der Gesellschaft */
  registerCourt: 'Amtsgericht Bremen',
  seat: 'Bremen',
  managingDirector: 'Mohammed Al Bakhit',
  street: 'Kirchbachstraße 200',
  zip: '28211',
  city: 'Bremen',
  country: 'Deutschland',
  email: 'kundenservice@easykfz24.de',
  /** Telefon für die unmittelbare Kontaktaufnahme (bestätigt am 13.10.2026) */
  phone: '0421 499 58 207' as string | null,
  /** Umsatzsteuer-Identifikationsnummer – nur, wenn erteilt */
  vatId: null as string | null,
  /** Wirtschafts-Identifikationsnummer – nur, wenn erteilt */
  economicId: null as string | null,
};

/** Firma wie im Rechtsverkehr zu führen: bis zur Eintragung mit Zusatz „i. G.“ (in Gründung) */
export const PROVIDER_NAME = PROVIDER.register ? PROVIDER.firm : `${PROVIDER.firm} i. G.`;
export const PROVIDER_ADDRESS = `${PROVIDER.street}, ${PROVIDER.zip} ${PROVIDER.city}`;
/** Telefon als tel:-Link (international, nur Ziffern) */
export const telHref = (phone: string) => `tel:+49${phone.replace(/\D/g, '').replace(/^0/, '')}`;
/** Kontakt in einer Zeile, z. B. für Checkout und E-Mails */
export const PROVIDER_CONTACT = [PROVIDER.phone ? `Telefon ${PROVIDER.phone}` : '', `E-Mail ${PROVIDER.email}`].filter(Boolean).join(' · ');
/** Satzende ohne doppelten Punkt nach „i. G.“ */
export const sentence = (s: string) => (s.endsWith('.') ? s : `${s}.`);
export const BRAND_NOTE = sentence(`${BRAND} ist eine Marke der ${PROVIDER_NAME}`);

export const PLACEHOLDER_PREFIX = '[PLATZHALTER';

export const SITE = {
  name: BRAND,
  claim: 'Kfz-Zulassungsdienst – online beauftragen, wir erledigen den Behördengang.',
  company: PROVIDER_NAME,
  owner: PROVIDER.managingDirector,
  street: PROVIDER.street,
  city: `${PROVIDER.zip} ${PROVIDER.city}`,
  email: PROVIDER.email,
  privacyContact: PROVIDER.email,
  hosting: 'Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA',
} as const;

export function isPlaceholder(value: string): boolean {
  return value.startsWith(PLACEHOLDER_PREFIX);
}

/** Fehlende Angaben für ein vollständiges Impressum (§ 5 DDG) – leer = vollständig */
export function imprintGaps(): string[] {
  const gaps: string[] = [];
  // Neben der E-Mail ist ein zweiter, unmittelbarer Kontaktweg nötig (EuGH C-298/07), üblicherweise ein Telefon
  if (!PROVIDER.phone) gaps.push('Telefonnummer (oder ein anderer unmittelbarer Kontaktweg neben der E-Mail)');
  return gaps;
}
