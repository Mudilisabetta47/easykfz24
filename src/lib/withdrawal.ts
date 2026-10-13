// Widerruf: Widerrufsbelehrung und Muster-Widerrufsformular – Wortlaut vom Inhaber vorgegeben (Stand 13.10.2026), Anbieterangaben
// aus src/lib/site.ts eingesetzt – sowie die elektronische Widerrufsfunktion nach § 356a BGB. Öffentlich erst mit WIDERRUF_AKTIV=1;
// vorher anwaltlich prüfen lassen (siehe docs/RECHTSTEXTE-PRUEFUNG.md).

import { PROVIDER, PROVIDER_NAME } from './site.ts';

/** Beschriftungen laut § 356a Abs. 1 und 3 BGB */
export const WITHDRAW_LABEL = 'Vertrag widerrufen';
export const CONFIRM_LABEL = 'Widerruf bestätigen';
export const WITHDRAW_PATH = '/widerruf';
export const NOTICE_PATH = '/widerrufsbelehrung';

/** Zustimmungen im Bestellabschluss (beide Pflicht) – Wortlaut vom Inhaber vorgegeben (13.10.2026) */
export const EARLY_START_TEXT =
  'Ich verlange ausdrücklich und stimme zu, dass EasyKFZ24 bereits vor Ablauf der gesetzlichen Widerrufsfrist von 14 Tagen mit der Ausführung meiner beauftragten Dienstleistung beginnt.';
export const LOSS_ACK_TEXT =
  'Ich bestätige, dass mir bekannt ist, dass mein gesetzliches Widerrufsrecht bei vollständiger Erbringung der vertraglich vereinbarten Dienstleistung durch EasyKFZ24 erlischt.';
export const VALUE_HINT_TEXT =
  'Mir ist bekannt, dass ich bei einem Widerruf nach Beginn der Dienstleistung unter den gesetzlichen Voraussetzungen einen angemessenen Wertersatz für die bis zum Widerruf bereits erbrachten Leistungen schulden kann.';

/** Kopf der Belehrung */
export const WITHDRAWAL_META = { subtitle: `Ein Service der ${PROVIDER_NAME}`, stand: 'Stand: 13. Oktober 2026' };

/** Anschrift des Unternehmers für Belehrung und Formular (Name, Anschrift, Telefon, E-Mail – Gestaltungshinweis 2) */
export const WITHDRAW_ADDRESSEE = [PROVIDER_NAME, PROVIDER.street, `${PROVIDER.zip} ${PROVIDER.city}`, PROVIDER.phone ? `Telefon: ${PROVIDER.phone}` : '', `E-Mail: ${PROVIDER.email}`]
  .filter(Boolean)
  .join(', ');

/**
 * Widerrufsbelehrung für Dienstleistungsverträge nach Anlage 1 zu Art. 246a § 1 Abs. 2 Satz 2 EGBGB,
 * Gestaltungshinweis 1 a („des Vertragsabschlusses.“), mit dem Baustein zur Online-Widerrufsfunktion.
 */
export function withdrawalNotice(baseUrl: string): { heading: string; paragraphs: string[] }[] {
  const addr = [
    PROVIDER_NAME,
    'EasyKFZ24',
    PROVIDER.street,
    `${PROVIDER.zip} ${PROVIDER.city}`,
    `E-Mail: ${PROVIDER.email}`,
    PROVIDER.phone ? `Telefon: ${PROVIDER.phone}` : '',
    'Website: https://easykfz24.de',
  ]
    .filter(Boolean)
    .join(', ');
  return [
    {
      heading: '1. Widerrufsrecht',
      paragraphs: [
        'Sie haben als Verbraucher das Recht, binnen vierzehn Tagen ohne Angabe von Gründen einen mit uns geschlossenen Dienstleistungsvertrag zu widerrufen.',
        'Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag des Vertragsabschlusses.',
        `Um Ihr Widerrufsrecht auszuüben, müssen Sie uns (${addr}) mittels einer eindeutigen Erklärung, beispielsweise durch einen mit der Post versandten Brief oder eine E-Mail, über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren.`,
        'Sie können hierfür das nachstehende Muster-Widerrufsformular verwenden. Die Verwendung dieses Formulars ist jedoch nicht vorgeschrieben.',
        `Sie können Ihr Widerrufsrecht auch über unsere elektronische Widerrufsfunktion unter ${baseUrl}${WITHDRAW_PATH} („${WITHDRAW_LABEL}“) ausüben.`,
        'Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie Ihre Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.',
      ],
    },
    {
      heading: '2. Folgen des Widerrufs',
      paragraphs: [
        'Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir im Zusammenhang mit dem widerrufenen Dienstleistungsvertrag von Ihnen erhalten haben, unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem Ihre Widerrufserklärung bei uns eingegangen ist.',
        'Für diese Rückzahlung verwenden wir grundsätzlich dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, sofern mit Ihnen nicht ausdrücklich etwas anderes vereinbart wurde.',
        'In keinem Fall werden Ihnen wegen dieser Rückzahlung zusätzliche Entgelte berechnet.',
        'Haben Sie ausdrücklich verlangt, dass die Dienstleistung während der Widerrufsfrist beginnen soll, haben Sie uns unter den gesetzlichen Voraussetzungen einen angemessenen Betrag zu zahlen. Dieser entspricht dem Anteil der bis zu dem Zeitpunkt, zu dem Sie uns über die Ausübung des Widerrufsrechts informieren, bereits erbrachten Dienstleistungen im Vergleich zum Gesamtumfang der vertraglich vorgesehenen Dienstleistungen.',
      ],
    },
    {
      heading: '3. Ausdrückliche Zustimmung zum sofortigen Bearbeitungsbeginn',
      paragraphs: [
        'EasyKFZ24 bietet digitale Dienstleistungen zur Vorbereitung, Beantragung und Abwicklung von Kfz-Zulassungsverfahren an.',
        'Auf ausdrücklichen Wunsch des Kunden kann EasyKFZ24 bereits unmittelbar nach Abschluss des Vertrags mit der Durchführung der beauftragten Dienstleistung beginnen.',
        'Hierzu kann der Kunde im Bestellprozess ausdrücklich verlangen und bestätigen, dass EasyKFZ24 mit der Bearbeitung vor Ablauf der gesetzlichen Widerrufsfrist beginnt.',
        'Der vorzeitige Bearbeitungsbeginn kann insbesondere folgende Tätigkeiten umfassen:',
        '• Prüfung der übermittelten Fahrzeug- und Halterdaten',
        '• Überprüfung der erforderlichen Zulassungsunterlagen',
        '• Technische und administrative Vorbereitung des Zulassungsantrags',
        '• Überprüfung der für das jeweilige Verfahren erforderlichen Angaben',
        '• Übermittlung des Antrags an angebundene Dienstleister oder zuständige Stellen',
        '• Bearbeitung von Rückmeldungen und Fortführung des Zulassungsverfahrens',
        '• Durchführung weiterer vertraglich geschuldeter Bearbeitungsschritte',
        'Die Zustimmung zum vorzeitigen Bearbeitungsbeginn erfolgt ausdrücklich durch eine aktive Erklärung des Kunden.',
        'Der bloße Beginn der Bearbeitung führt nicht automatisch zum Erlöschen des gesetzlichen Widerrufsrechts.',
      ],
    },
    {
      heading: '4. Erlöschen des Widerrufsrechts bei vollständiger Leistungserbringung',
      paragraphs: [
        // RECHTLICH ZU PRÜFEN: Vorlage nannte § 356 Abs. 5 BGB; für Dienstleistungen regelt das Erlöschen § 356 Abs. 4 BGB
        'Bei einem Vertrag über eine kostenpflichtige Dienstleistung erlischt das gesetzliche Widerrufsrecht gemäß § 356 Abs. 4 BGB bei vollständiger Erbringung der vertraglich vereinbarten Dienstleistung, sofern der Kunde vor Beginn der Leistungserbringung:',
        '1. ausdrücklich zugestimmt hat, dass EasyKFZ24 bereits vor Ablauf der Widerrufsfrist mit der Dienstleistung beginnt, und',
        '2. bestätigt hat, dass ihm bekannt ist, dass sein Widerrufsrecht mit vollständiger Vertragserfüllung durch EasyKFZ24 erlischt.',
        'Sobald EasyKFZ24 die vertraglich geschuldete Dienstleistung vollständig erbracht hat und die gesetzlichen Voraussetzungen erfüllt sind, erlischt das Widerrufsrecht des Kunden auch dann, wenn die reguläre Widerrufsfrist von vierzehn Tagen noch nicht abgelaufen ist.',
        'Entscheidend ist die vollständige Erfüllung der tatsächlich vereinbarten Leistung.',
        'Eine bloße interne Statusänderung, die Annahme des Auftrags, der Beginn der Dokumentenprüfung oder die Übermittlung des Zulassungsantrags reicht hierfür nicht automatisch aus.',
        'Welche Bearbeitungsschritte zur vollständigen Vertragserfüllung erforderlich sind, richtet sich nach dem konkreten Leistungsumfang des abgeschlossenen Vertrags.',
      ],
    },
    {
      heading: '5. Widerruf nach Beginn der Bearbeitung',
      paragraphs: [
        'Hat EasyKFZ24 auf ausdrückliches Verlangen des Kunden bereits während der gesetzlichen Widerrufsfrist mit der Bearbeitung begonnen, kann der Kunde sein Widerrufsrecht grundsätzlich weiterhin ausüben, solange dieses nicht nach den gesetzlichen Vorschriften erloschen ist.',
        'In diesem Fall kann EasyKFZ24 gemäß § 357a Abs. 2 BGB Wertersatz für die bis zum Widerruf tatsächlich erbrachten Dienstleistungen verlangen, sofern sämtliche gesetzlichen Voraussetzungen erfüllt sind.',
        'Der Wertersatz richtet sich grundsätzlich nach dem Verhältnis der bereits erbrachten Dienstleistungen zum vertraglich vereinbarten Gesamtumfang der Leistung.',
        'Grundlage der Berechnung ist der vereinbarte Gesamtpreis. Ist dieser unverhältnismäßig hoch, erfolgt die Berechnung auf Grundlage des Marktwerts der bereits erbrachten Leistungen.',
        'Eine pauschale Einbehaltung der gesamten Servicevergütung allein aufgrund des Bearbeitungsbeginns erfolgt nicht.',
        'Besteht kein gesetzlicher Anspruch auf Wertersatz, wird kein Wertersatz verlangt.',
      ],
    },
    {
      heading: '6. Besonderheiten bei bereits eingereichten Zulassungsanträgen',
      paragraphs: [
        'Im Rahmen der Durchführung eines Zulassungsauftrags können Anträge und Fahrzeugdaten an zuständige Zulassungsbehörden oder externe Dienstleister übermittelt werden.',
        'Wurde ein Zulassungsantrag bereits eingereicht, kann dies Auswirkungen auf die tatsächliche Möglichkeit haben, die weitere behördliche Bearbeitung anzuhalten.',
        'Ein wirksamer Widerruf des Dienstleistungsvertrags bedeutet nicht automatisch, dass ein bereits eingeleitetes Verwaltungsverfahren beendet oder ein bereits zugelassenes Fahrzeug wieder außer Betrieb gesetzt wird.',
        'Ein Widerruf gegenüber EasyKFZ24 hebt eine bereits erfolgte behördliche Fahrzeugzulassung nicht automatisch auf.',
        'Soweit erforderlich, muss eine Rücknahme, Änderung oder Außerbetriebsetzung im Rahmen eines eigenständigen behördlichen Verfahrens erfolgen.',
        'Die gesetzlichen Widerrufs- und Rückzahlungsrechte des Verbrauchers bleiben hiervon unberührt.',
      ],
    },
    {
      heading: '7. Amtliche Zulassungsgebühren und Kosten Dritter',
      paragraphs: [
        'Bei der Bearbeitung von Zulassungsaufträgen können neben der Servicevergütung von EasyKFZ24 amtliche Gebühren und Kosten externer Dienstleister entstehen.',
        'Diese werden entsprechend ihrer rechtlichen Einordnung und dem vereinbarten Leistungsumfang behandelt.',
        'Ob amtliche Gebühren oder Kosten Dritter im Falle eines Widerrufs zurückzuzahlen sind oder bereits entstandene Beträge rechtlich berücksichtigt werden können, richtet sich nach den gesetzlichen Bestimmungen und den Umständen des jeweiligen Vertrags.',
        'Eine automatische Einbehaltung sämtlicher amtlicher Gebühren oder Kosten Dritter erfolgt nicht unabhängig von der gesetzlichen Rechtslage.',
        'Die Ansprüche des Verbrauchers auf gesetzlich geschuldete Rückzahlungen bleiben unberührt.',
      ],
    },
    {
      heading: '8. Kennzeichenschilder und individuell angefertigte Waren',
      paragraphs: [
        'Sofern Kunden zusätzlich Kennzeichenschilder bestellen, sind diese von der eigentlichen Zulassungsdienstleistung zu unterscheiden.',
        'Für Waren gelten teilweise andere gesetzliche Widerrufsregeln als für Dienstleistungen.',
        'Bei Waren, die nicht vorgefertigt sind und für deren Herstellung eine individuelle Auswahl oder Bestimmung durch den Verbraucher maßgeblich ist oder die eindeutig auf persönliche Bedürfnisse zugeschnitten sind, kann das Widerrufsrecht gemäß § 312g Abs. 2 Nr. 1 BGB ausgeschlossen sein.',
        'Ein solcher Ausschluss gilt nur, wenn die gesetzlichen Voraussetzungen im konkreten Einzelfall tatsächlich erfüllt sind.',
        'Die hierfür erforderlichen Informationen werden dem Kunden gegebenenfalls vor Abgabe seiner Bestellung gesondert bereitgestellt.',
      ],
    },
    {
      heading: '9. Elektronische Widerrufsfunktion',
      paragraphs: [
        'Verbrauchern steht während der gesetzlichen Widerrufsfrist eine elektronische Widerrufsfunktion auf unserer Website zur Verfügung.',
        'Die Widerrufsfunktion ermöglicht es, eine Widerrufserklärung ohne Angabe von Gründen elektronisch abzugeben.',
        'Hierfür werden die zur Identifizierung des Verbrauchers und des betroffenen Vertrags erforderlichen Angaben abgefragt.',
        `Nach Betätigung der Funktion „${CONFIRM_LABEL}“ erhält der Verbraucher unverzüglich eine elektronische Eingangsbestätigung auf einem dauerhaften Datenträger.`,
        'Die Bestätigung enthält die erforderlichen Angaben zur Widerrufserklärung sowie Datum und Uhrzeit ihres Eingangs.',
        'Die Nutzung dieser Funktion ist freiwillig. Ein Widerruf kann weiterhin per E-Mail oder Post erklärt werden.',
      ],
    },
    {
      heading: '10. Gesetzliche Verbraucherrechte',
      paragraphs: [
        'Die gesetzlichen Verbraucherrechte bleiben uneingeschränkt bestehen.',
        'Insbesondere werden durch diese Widerrufsbelehrung keine gesetzlich zwingenden Rechte auf Widerruf, Rückzahlung oder sonstige Ansprüche des Verbrauchers ausgeschlossen.',
        'Eine etwaige Verpflichtung zur Leistung von Wertersatz besteht ausschließlich unter den gesetzlichen Voraussetzungen.',
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
    topic: 'Abschnitt 4 – Gesetzesverweis',
    note: 'Die Vorlage nannte § 356 Abs. 5 BGB (digitale Inhalte). Für Dienstleistungen regelt § 356 Abs. 4 BGB das Erlöschen – im Text auf Abs. 4 angepasst, bitte bestätigen lassen.',
  },
  {
    topic: 'Eigener Wortlaut statt amtlichem Muster',
    note: 'Die Belehrung weicht vom amtlichen Muster (Anlage 1 zu Art. 246a EGBGB) ab; die Musterschutzwirkung (Art. 246a § 1 Abs. 2 Satz 2 EGBGB) entfällt damit. Anwaltlich prüfen lassen.',
  },
  {
    topic: 'Kennzeichenschilder (Waren)',
    note: 'Abschnitt 8 verweist auf gesonderte Informationen vor der Bestellung. Diese Informationen sowie Bausteine zur Rücksendung von Waren sind noch nicht im Bestellablauf umgesetzt.',
  },
  {
    topic: 'Amtliche Gebühren',
    note: 'Abschnitt 7 bleibt bewusst allgemein – Behandlung verauslagter amtlicher Gebühren und Kosten Dritter bei Widerruf mit der Kanzlei abstimmen.',
  },
];

/** Muster-Widerrufsformular – Wortlaut vom Inhaber vorgegeben (13.10.2026) */
export const WITHDRAWAL_FORM = {
  intro: 'Wenn Sie den Vertrag widerrufen wollen, können Sie dieses Formular ausfüllen und an uns zurücksenden.',
  addressee: `An: ${PROVIDER_NAME}, EasyKFZ24, ${PROVIDER.street}, ${PROVIDER.zip} ${PROVIDER.city}, E-Mail: ${PROVIDER.email}`,
  lines: [
    'Hiermit widerrufe(n) ich/wir den von mir/uns abgeschlossenen Vertrag über die Erbringung folgender Dienstleistung beziehungsweise den Kauf folgender Waren:',
    'Dienstleistung/Ware: __________________',
    'Auftragsnummer: __________________',
    'Bestellt am: __________________',
    'Name des Verbrauchers: __________________',
    'Anschrift des Verbrauchers: __________________',
    'Datum: __________________',
    'Unterschrift (nur bei Mitteilung auf Papier): __________________',
  ],
  footnote: '',
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
