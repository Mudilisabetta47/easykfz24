// Widerruf: Widerrufsbelehrung und Muster-Widerrufsformular nach den amtlichen Mustern (Anlage 1 und 2 zu Art. 246a EGBGB)
// sowie die elektronische Widerrufsfunktion nach § 356a BGB. ENTWURF – vor der Aktivierung von einer spezialisierten Kanzlei
// bzw. eRecht24 prüfen lassen (siehe docs/WIDERRUF-VORBEREITUNG.md).
//
// Bewusst NICHT übernommen (erst nach rechtlicher Prüfung): Sonderregeln zum vorzeitigen Beginn der Dienstleistung,
// zum Wertersatz und zum Erlöschen des Widerrufsrechts sowie Ausnahmen für nach Kundenvorgabe gefertigte Kennzeichenschilder.

import { PROVIDER, PROVIDER_NAME } from './site.ts';

/** Beschriftungen laut § 356a Abs. 1 und 3 BGB */
export const WITHDRAW_LABEL = 'Vertrag widerrufen';
export const CONFIRM_LABEL = 'Widerruf bestätigen';
export const WITHDRAW_PATH = '/widerruf';
export const NOTICE_PATH = '/widerrufsbelehrung';

/** Anschrift des Unternehmers für Belehrung und Formular (Name, Anschrift, Telefon, E-Mail – Gestaltungshinweis 2) */
export const WITHDRAW_ADDRESSEE = [PROVIDER_NAME, PROVIDER.street, `${PROVIDER.zip} ${PROVIDER.city}`, PROVIDER.phone ? `Telefon: ${PROVIDER.phone}` : '', `E-Mail: ${PROVIDER.email}`]
  .filter(Boolean)
  .join(', ');

/**
 * Widerrufsbelehrung für Dienstleistungsverträge nach Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB,
 * Gestaltungshinweis 1 a („des Vertragsabschlusses.“), mit dem Baustein zur Online-Widerrufsfunktion.
 */
export function withdrawalNotice(baseUrl: string): { heading: string; paragraphs: string[] }[] {
  return [
    {
      heading: 'Widerrufsrecht',
      paragraphs: [
        'Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.',
        'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
        `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${WITHDRAW_ADDRESSEE}) mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.`,
        `Sie können Ihr Widerrufsrecht auch online unter ${baseUrl}${WITHDRAW_PATH} („${WITHDRAW_LABEL}“) ausüben. Wenn Sie diese Online-Funktion nutzen, übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.`,
        'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
      ],
    },
    {
      heading: 'Folgen des Widerrufs',
      paragraphs: [
        'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.',
      ],
    },
  ];
}

/**
 * Bausteine, die das Muster für Dienstleistungen bzw. Warenlieferungen vorsieht, die aber eine rechtliche Entscheidung
 * voraussetzen. Werden nur im Entwurf als Prüfhinweis angezeigt – nie als Teil der Belehrung.
 */
export const REVIEW_ITEMS: { topic: string; note: string }[] = [
  {
    topic: 'Wertersatz bei Beginn der Dienstleistung während der Widerrufsfrist',
    note: 'Das Muster sieht für Dienstleistungen einen Baustein zum angemessenen Betrag vor, wenn der Kunde den Beginn während der Widerrufsfrist verlangt hat. Setzt ein ausdrückliches Verlangen im Bestellablauf voraus – Gestaltung prüfen lassen.',
  },
  {
    topic: 'Erlöschen des Widerrufsrechts',
    note: 'Ob und wie ein Hinweis auf das Erlöschen nach vollständiger Erbringung der Dienstleistung aufgenommen wird, ist rechtlich zu prüfen.',
  },
  {
    topic: 'Kennzeichenschilder (Waren)',
    note: 'Mitbestellte Schilder werden nach Kundenvorgabe geprägt. Ob eine Ausnahme vom Widerrufsrecht greift und welche Bausteine zur Rücksendung von Waren nötig sind, ist rechtlich zu prüfen (gemischter Vertrag).',
  },
  {
    topic: 'Amtliche Gebühren',
    note: 'Behandlung bereits verauslagter amtlicher Gebühren (Zulassungsbehörde, Kennzeichenreservierung) bei Widerruf klären.',
  },
];

/** Muster-Widerrufsformular nach Anlage 2 zu Art. 246a § 1 Abs. 2 Satz 1 Nr. 1 und § 2 Abs. 2 Nr. 2 EGBGB */
export const WITHDRAWAL_FORM = {
  intro: '(Wenn Sie den Vertrag widerrufen wollen, dann füllen Sie bitte dieses Formular aus und senden Sie es zurück.)',
  addressee: `An ${PROVIDER_NAME}, ${PROVIDER.street}, ${PROVIDER.zip} ${PROVIDER.city}, E-Mail: ${PROVIDER.email}:`,
  lines: [
    'Hiermit widerrufe(n) ich/wir (*) den von mir/uns (*) abgeschlossenen Vertrag über den Kauf der folgenden Waren (*)/die Erbringung der folgenden Dienstleistung (*)',
    'Bestellt am (*)/erhalten am (*)',
    'Name des/der Verbraucher(s)',
    'Anschrift des/der Verbraucher(s)',
    'Unterschrift des/der Verbraucher(s) (nur bei Mitteilung auf Papier)',
    'Datum',
  ],
  footnote: '(*) Unzutreffendes streichen.',
};

/** Angaben der elektronischen Widerrufserklärung (§ 356a Abs. 2 BGB) */
export interface WithdrawalInput {
  /** Name des Verbrauchers */
  name: string;
  /** Angaben zur Identifizierung des Vertrags, z. B. Auftragsnummer */
  contract: string;
  /** Elektronischer Weg für die Eingangsbestätigung */
  email: string;
}

export type WithdrawalErrors = Partial<Record<keyof WithdrawalInput, string>>;

export function validateWithdrawal(raw: Partial<Record<keyof WithdrawalInput, unknown>>): { ok: true; value: WithdrawalInput } | { ok: false; errors: WithdrawalErrors } {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '');
  const value: WithdrawalInput = { name: str(raw.name, 120), contract: str(raw.contract, 200), email: str(raw.email, 200).toLowerCase() };
  const errors: WithdrawalErrors = {};
  if (value.name.length < 2) errors.name = 'Bitte Ihren Namen angeben';
  if (value.contract.length < 3) errors.contract = 'Bitte den Vertrag angeben, z. B. die Auftragsnummer (EK-…)';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.email)) errors.email = 'Bitte eine gültige E-Mail-Adresse für die Eingangsbestätigung angeben';
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value };
}

/** Auftragsnummer aus der Vertragsangabe, falls enthalten (EK-JJJJ-NNNNN) */
export function orderNumberIn(contract: string): string {
  return /\bEK-\d{4}-\d{5}\b/i.exec(contract)?.[0].toUpperCase() ?? '';
}

/** Inhalt der Widerrufserklärung – wird gespeichert und in der Eingangsbestätigung wiedergegeben */
export function withdrawalStatement(v: WithdrawalInput): string {
  return `Hiermit widerrufe ich den mit ${PROVIDER_NAME} geschlossenen Vertrag: ${v.contract}. Name: ${v.name}. E-Mail für die Eingangsbestätigung: ${v.email}.`;
}

/** Datum und Uhrzeit des Eingangs in deutscher Zeit */
export function formatReceipt(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', dateStyle: 'long', timeStyle: 'medium' }) + ' Uhr';
}

/** Eingangsbestätigung (dauerhafter Datenträger, § 356a Abs. 4 BGB): Inhalt der Erklärung, Datum und Uhrzeit des Eingangs */
export function receiptMail(v: WithdrawalInput, receivedAt: string, reference: string): { subject: string; text: string } {
  return {
    subject: `Eingangsbestätigung Ihres Widerrufs (${reference})`,
    text: [
      'Guten Tag,',
      '',
      'wir bestätigen den Eingang Ihrer Widerrufserklärung.',
      '',
      `Eingegangen am: ${formatReceipt(receivedAt)}`,
      `Vorgangsnummer: ${reference}`,
      '',
      'Inhalt Ihrer Widerrufserklärung:',
      withdrawalStatement(v),
      '',
      'Wir bearbeiten Ihren Widerruf und melden uns bei Ihnen.',
      '',
      'Freundliche Grüße',
      PROVIDER_NAME,
      `${PROVIDER.street}, ${PROVIDER.zip} ${PROVIDER.city} · ${PROVIDER.phone ? `Telefon ${PROVIDER.phone} · ` : ''}E-Mail ${PROVIDER.email}`,
    ].join('\n'),
  };
}
