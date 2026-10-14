// Datenschutzerklärung für /datenschutz – Fassung 3 vom 14.10.2026 (Abgleich mit Code, Konfiguration und Anbieterangaben;
// Quellen und offene Punkte D1–D13: interner Datenschutz-Maßnahmenpaket, nicht im Repository). Änderungen nur nach Prüfung.

import { PROVIDER, PROVIDER_NAME } from './site.ts';

export type PrivacyBlock = { p: string; lead?: string } | { h3: string };
export interface PrivacySection {
  heading: string;
  blocks: PrivacyBlock[];
}

export const PRIVACY_STAND = 'Stand: 14. Oktober 2026';

const RESPONSIBLE = `${PROVIDER_NAME}, ${PROVIDER.street}, ${PROVIDER.zip} ${PROVIDER.city}, Deutschland. Geschäftsführer: ${PROVIDER.managingDirector}. Marke: EasyKFZ24. Website: https://easykfz24.de.${PROVIDER.phone ? ` Telefon: ${PROVIDER.phone}.` : ''} E-Mail: ${PROVIDER.email}.`;

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    heading: '1. Verantwortlicher',
    blocks: [{ p: RESPONSIBLE }, { p: 'Für Datenschutzanfragen verwenden Sie bitte die oben genannte E-Mail-Adresse.' }],
  },
  {
    heading: '2. Allgemeine Hinweise und Zwecke',
    blocks: [
      {
        p: 'Personenbezogene Daten sind Informationen, die eine Person unmittelbar oder mittelbar identifizieren können. Wir verarbeiten Daten zur Bereitstellung der Website, Beantwortung von Anfragen, Bearbeitung von Bestellungen, Durchführung von Kfz-Zulassungsdienstleistungen, Abwicklung von Zahlungen und Versand sowie zur Erfüllung gesetzlicher Pflichten.',
      },
      {
        p: 'Soweit wir Angaben für einen konkreten Auftrag zwingend benötigen, erläutern wir dies im jeweiligen Bestellschritt. Ohne die erforderlichen Fahrzeug-, Halter- und Auftragsinformationen kann der gewünschte Zulassungsvorgang regelmäßig nicht bearbeitet werden.',
      },
    ],
  },
  {
    heading: '3. Aufruf der Website und Server-Protokolle',
    blocks: [
      {
        p: 'Bei der Nutzung unserer Website fallen technisch erforderliche Verbindungsdaten an. Dazu können IP-Adresse, Datum und Uhrzeit, aufgerufene URL, Informationen über Browser und Betriebssystem sowie technische Fehlermeldungen gehören. Diese Daten werden verarbeitet, um die Website bereitzustellen, Fehler zu erkennen und die Systeme vor Missbrauch zu schützen.',
      },
      {
        p: 'Die technische Infrastruktur betreiben wir mit Cloudflare, Inc., 101 Townsend St., San Francisco, CA 94107, USA (insbesondere Workers, D1 und R2). Unsere Datenbank (D1) und unser Dateispeicher (R2) sind bei Cloudflare mit EU-Gerichtsbarkeit eingerichtet. Protokolle der Aufrufe (Anfrage- und Antwortdaten sowie technische Metadaten) speichert Cloudflare für höchstens sieben Tage. Grundlage der für Sicherheit und Betrieb notwendigen Verarbeitung ist Art. 6 Abs. 1 lit. f DSGVO; unser berechtigtes Interesse besteht im sicheren und zuverlässigen Betrieb unseres Angebots.',
      },
    ],
  },
  {
    heading: '4. Kontaktaufnahme per E-Mail oder Telefon',
    blocks: [
      {
        p: 'Wenn Sie uns kontaktieren, verarbeiten wir die von Ihnen übermittelten Angaben, insbesondere Ihren Namen, Ihre Kontaktdaten und den Inhalt Ihrer Anfrage. Soweit die Anfrage einen Vertrag oder vorvertragliche Maßnahmen betrifft, erfolgt die Verarbeitung auf Grundlage von Art. 6 Abs. 1 lit. b DSGVO. Sonstige allgemeine Anfragen bearbeiten wir auf Grundlage unseres berechtigten Interesses an der Beantwortung eingehender Nachrichten (Art. 6 Abs. 1 lit. f DSGVO).',
      },
      { p: 'Wir geben diese Informationen nur weiter, wenn dies für die Bearbeitung erforderlich ist oder eine gesetzliche Verpflichtung besteht.' },
    ],
  },
  {
    heading: '5. Online-Bestellungen und Zulassungsdienstleistungen',
    blocks: [
      {
        p: 'Wenn Sie eine Kfz-Zulassung, Ummeldung, Wiederzulassung oder Außerbetriebsetzung beauftragen, verarbeiten wir die für den Vorgang notwendigen Angaben: Art der Dienstleistung, Auftrags- und Kontaktdaten, Angaben zu Halter und Fahrzeug (z. B. Name/Firma, Adresse, Geburtsdatum, E-Mail, Telefon, Hersteller, Modell, Fahrzeug-Identifizierungsnummer, Kennzeichen), Versicherungsbestätigung (eVB), Daten zum Zulassungsbezirk, den Zeitpunkt Ihrer Erklärungen im Bestellabschluss (z. B. Vollmacht, Zustimmung zum vorzeitigen Leistungsbeginn) sowie Bearbeitungs- und Kommunikationsstände.',
      },
      {
        p: 'Je nach Vorgang benötigen wir außerdem Kontoinhaber und IBAN für das SEPA-Mandat zur Kraftfahrzeugsteuer. Diese IBAN dient dem Steuermandat gegenüber der zuständigen Stelle und ist von der Online-Bezahlung unserer Dienstleistung zu unterscheiden.',
      },
      {
        p: 'Wir verarbeiten die Daten, um Ihren Auftrag zu prüfen, die erforderlichen Schritte vorzubereiten und die Durchführung gegenüber der zuständigen Zulassungsbehörde zu veranlassen (Art. 6 Abs. 1 lit. b DSGVO). Soweit gesetzliche Dokumentationspflichten bestehen, ist Art. 6 Abs. 1 lit. c DSGVO Rechtsgrundlage.',
      },
      {
        p: 'Bei Wunschkennzeichen speichern wir die gewählte Kombination und Angaben zum zuständigen Bezirk, um die gewünschte Reservierung zu prüfen beziehungsweise zu beauftragen. Eine technisch passende Kombination ist nicht automatisch eine behördlich bestätigte Reservierung.',
      },
    ],
  },
  {
    heading: '6. Hochladen von Ausweisen und Fahrzeugunterlagen',
    blocks: [
      {
        p: 'Für bestimmte Zulassungsvorgänge benötigen wir Unterlagen wie Ausweis- oder Reisepasskopien, Zulassungsbescheinigungen Teil I und II, gegebenenfalls COC-Nachweise, HU-Nachweise oder Vollmachten. Hierbei können besonders schutzbedürftige Identitäts- und Fahrzeugdaten enthalten sein. Wir nutzen die Unterlagen ausschließlich zur Identifizierung, Prüfung und Bearbeitung des jeweiligen Auftrags, soweit dies erforderlich und rechtlich zulässig ist.',
      },
      {
        p: 'Der Upload erfolgt verschlüsselt. Hochgeladene Dateien liegen in einem nicht öffentlich erreichbaren Speicherbereich (Cloudflare R2) mit EU-Jurisdiktion; zugreifen können nur entsprechend berechtigte Mitarbeitende.',
      },
      {
        p: 'Für die Zulassung nicht benötigte Angaben auf Ausweisdokumenten, etwa die Zugangsnummer (CAN) und die Seriennummer, dürfen Sie vor dem Hochladen schwärzen.',
      },
    ],
  },
  {
    heading: '7. Statusabfragen und Vertragswiderrufe',
    blocks: [
      {
        p: 'Bei der Abfrage eines Auftragsstatus verwenden wir die zur Zuordnung erforderlichen Angaben, insbesondere Auftragsnummer und E-Mail-Adresse. Dies dient der Bereitstellung von Informationen zu Ihrem laufenden Auftrag (Art. 6 Abs. 1 lit. b DSGVO).',
      },
      {
        p: 'Wenn Sie die elektronische Widerrufsfunktion nutzen, speichern wir die eingegebenen Identifizierungsdaten, die Vertragsangabe, Ihre E-Mail-Adresse, die Widerrufserklärung, Eingangszeitpunkt und die zugeordnete Vorgangsnummer. Dies dient der Bearbeitung und dem Nachweis des Eingangs Ihrer Erklärung; Rechtsgrundlagen sind Art. 6 Abs. 1 lit. b und, soweit rechtliche Nachweis- oder Aufbewahrungspflichten bestehen, lit. c DSGVO.',
      },
    ],
  },
  {
    heading: '8. Zahlungsabwicklung über Mollie',
    blocks: [
      {
        p: 'Für Online-Zahlungen setzen wir Mollie B.V., Keizersgracht 126, 1015 CW Amsterdam, Niederlande, ein. Wir übermitteln Mollie die für eine Zahlung nötigen Angaben: Betrag, Auftragsnummer, Zahlungsbeschreibung, die auf der Bezahlseite angebotenen Zahlungsmethoden sowie technische Adressen für Rückleitung und Statusbenachrichtigung. Ihren Namen, Ihre Anschrift oder Ihre E-Mail-Adresse übermitteln wir dabei nicht. Die vom gewählten Zahlungsmittel benötigten Zahlungsdaten geben Sie direkt auf der Bezahlseite von Mollie ein.',
      },
      {
        p: 'Von Mollie erhalten wir unter anderem den Zahlungsstatus, die verwendete Zahlungsmethode und eine Transaktionsreferenz, um Zahlungen einem Auftrag zuzuordnen und Erstattungen bearbeiten zu können. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO. Für eigene Zahlungsdatenverarbeitungen von Mollie gelten deren Datenschutzhinweise: https://www.mollie.com/de/privacy.',
      },
      { h3: 'Zahlungsmethoden' },
      {
        p: 'Auf der Bezahlseite von Mollie können Sie – je nach Verfügbarkeit, Betrag und Endgerät – folgende Zahlungsmethoden wählen: Kredit- oder Debitkarte, SEPA-Überweisung, Pay by Bank, Apple Pay und Google Pay. Welche Zahlungsmethode Sie nutzen, entscheiden Sie selbst. Je nach Wahl werden die für die Zahlung erforderlichen Daten an den jeweiligen Anbieter übermittelt. Rechtsgrundlage ist jeweils Art. 6 Abs. 1 lit. b DSGVO.',
      },
      {
        lead: 'Kredit- und Debitkarte',
        p: 'Ihre Kartendaten geben Sie direkt in der Bezahlumgebung von Mollie ein; wir erhalten keine vollständigen Kartendaten. Mollie wickelt die Zahlung über die Kartenorganisationen (z. B. Visa, Mastercard) und die kartenausgebende Bank ab. Dabei kann eine starke Kundenauthentifizierung (z. B. 3-D Secure) durch Ihre Bank erfolgen.',
      },
      {
        lead: 'SEPA-Überweisung',
        p: 'Wählen Sie die Überweisung, erhalten Sie von Mollie eine Bankverbindung und einen Verwendungszweck und überweisen den Betrag über Ihre Bank. Mollie erhält dabei die mit der Überweisung übermittelten Angaben (insbesondere Name des Kontoinhabers, IBAN, Betrag und Verwendungszweck), um die Zahlung Ihrem Auftrag zuzuordnen. Die Zahlung gilt erst als eingegangen, wenn Mollie den Zahlungseingang bestätigt.',
      },
      {
        lead: 'Pay by Bank',
        p: 'Bei Pay by Bank geben Sie die Zahlung direkt in Ihrem Online-Banking frei; die Zahlung wird über einen Zahlungsauslösedienst angestoßen. Dabei werden die für die Zahlung erforderlichen Kontodaten (insbesondere Name des Kontoinhabers und IBAN) verarbeitet. Ihre Zugangsdaten zum Online-Banking erhalten wir nicht.',
      },
      {
        lead: 'Apple Pay',
        p: 'Bei Zahlung mit Apple Pay bestätigen Sie die Zahlung auf Ihrem Apple-Gerät; belastet wird die in Ihrer Wallet hinterlegte Karte. Anbieter von Apple Pay ist die Apple Distribution International Ltd., Hollyhill Industrial Estate, Hollyhill, Cork, Irland, die dabei Daten nach ihren eigenen Datenschutzbestimmungen verarbeitet.',
      },
      {
        lead: 'Google Pay',
        p: 'Bei Zahlung mit Google Pay bestätigen Sie die Zahlung über Ihr Google-Konto; belastet wird die dort hinterlegte Karte. Anbieter von Google Pay ist die Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, Irland, die dabei Daten nach ihren eigenen Datenschutzbestimmungen verarbeitet.',
      },
    ],
  },
  {
    heading: '9. E-Mail-Versand über Resend',
    blocks: [
      {
        p: 'Bestellbestätigungen, Zahlungs- und Statusmeldungen sowie elektronische Eingangsbestätigungen von Widerrufen versenden wir mit dem E-Mail-Dienst „Resend“ der Plus Five Five, Inc., 2261 Market Street #5039, San Francisco, CA 94114, USA. Über denselben Dienst können unsere Mitarbeitenden interne Benachrichtigungen zu Aufträgen erhalten. Hierfür werden die Empfängeradresse und die für den jeweiligen Versand notwendigen Nachrichteninhalte an den Anbieter übermittelt. Dazu können Name, Auftragsnummer, gewählte Leistung, Preise, Bearbeitungsstatus und gesetzliche Informationen gehören. Die Verarbeitung findet nach Angaben des Anbieters hauptsächlich in den USA statt.',
      },
      {
        p: 'Die Übermittlung dient der Vertragsabwicklung beziehungsweise der Erfüllung rechtlicher Informationspflichten (Art. 6 Abs. 1 lit. b und c DSGVO).',
      },
    ],
  },
  {
    heading: '10. Zulassungspartner, Behörden und Kraftfahrzeugsteuer',
    blocks: [
      {
        p: 'Zur technischen und organisatorischen Abwicklung von Kfz-Zulassungsverfahren nutzen wir den Dienst kfz-api.de der POWR GmbH, Bremer Heerstraße 79, 26135 Oldenburg. Soweit für den beauftragten Vorgang erforderlich, werden Daten und Unterlagen an den Zulassungspartner und die zuständige Zulassungsbehörde weitergegeben. Statusinformationen und Nachweise können von dort an uns zurückübermittelt werden. Rechtsgrundlage ist regelmäßig Art. 6 Abs. 1 lit. b DSGVO; gesetzliche Pflichten bleiben unberührt.',
      },
      {
        p: 'Soweit die Kraftfahrzeugsteuer betroffen ist, können die für das SEPA-Mandat erforderlichen Informationen an die Bundeszollverwaltung beziehungsweise die zuständige Stelle übermittelt werden.',
      },
      {
        p: 'Eine zusätzliche digitale Identitäts- und Vollmachtsprüfung über Nect ist derzeit nicht aktiviert. Sollte sie künftig eingesetzt werden, werden diese Hinweise vorab um die tatsächlich beteiligten Anbieter, Daten und Zwecke ergänzt.',
      },
    ],
  },
  {
    heading: '11. Versand und Abholung',
    blocks: [
      {
        p: 'Bei Versand von Kennzeichenschildern oder Unterlagen geben wir Empfängername und Versandanschrift an den beauftragten Versanddienstleister (DHL oder UPS) weiter. Rechtsgrundlage ist Art. 6 Abs. 1 lit. b DSGVO.',
      },
    ],
  },
  {
    heading: '12. Cookies und vergleichbare Technologien',
    blocks: [
      {
        p: 'Die öffentlich zugängliche Website setzt keine Marketing- oder Analyse-Cookies und lädt keine externen Werbe- oder Trackingdienste. Im passwortgeschützten Verwaltungsbereich wird ein technisch notwendiges Sitzungs-Cookie eingesetzt, das die Anmeldung und den geschützten Zugriff ermöglicht.',
      },
      {
        p: 'Soweit eine Speicherung auf Ihrem Gerät unbedingt erforderlich ist, um einen ausdrücklich gewünschten Dienst bereitzustellen, erfolgt sie im Rahmen des § 25 Abs. 2 TDDDG ohne gesonderte Einwilligung; die damit verbundene Verarbeitung personenbezogener Daten erfolgt entsprechend dem Zweck insbesondere nach Art. 6 Abs. 1 lit. b oder f DSGVO.',
      },
    ],
  },
  {
    heading: '13. Speicherdauer und Löschung',
    blocks: [
      {
        p: 'Wir benötigen personenbezogene Daten nur für die jeweiligen Verarbeitungszwecke und für die Erfüllung gesetzlicher Verpflichtungen. Dabei ist zwischen abrechnungs- und steuerrelevanten Nachweisen, laufenden Auftragsdaten, Identitäts- und Fahrzeugunterlagen, Zahlungsinformationen, Kommunikation, Widerrufsnachweisen und technischen Protokollen zu unterscheiden.',
      },
      {
        p: 'Bei Unterlagen, die für steuer- oder handelsrechtliche Zwecke aufzubewahren sind, richten sich die Fristen nach den jeweils anwendbaren gesetzlichen Vorschriften. Andere Daten sind nach Wegfall ihres Verarbeitungszwecks und entgegenstehender Aufbewahrungsgründe zu löschen oder geeignet zu beschränken.',
      },
    ],
  },
  {
    heading: '14. Internationale Datenübermittlungen',
    blocks: [
      {
        p: 'Bei der Nutzung von Cloudflare und Resend können Datenverarbeitungen oder Zugriffe in Staaten außerhalb der EU beziehungsweise des EWR stattfinden, insbesondere in den USA. Die Voraussetzungen einer zulässigen Übermittlung richten sich nach Kapitel V DSGVO.',
      },
      {
        p: 'Cloudflare, Inc. und die Plus Five Five, Inc. (Resend) geben in ihren Auftragsverarbeitungsbedingungen an, am EU-US Data Privacy Framework teilzunehmen; für diesen Fall stützt sich die Übermittlung auf den Angemessenheitsbeschluss der EU-Kommission (Art. 45 DSGVO). Ergänzend sehen beide Anbieter die EU-Standardvertragsklauseln (Durchführungsbeschluss (EU) 2021/914) als geeignete Garantien nach Art. 46 DSGVO vor.',
      },
    ],
  },
  {
    heading: '15. Technische und organisatorische Sicherheit',
    blocks: [
      {
        p: 'Wir setzen zur Absicherung der Website und der Auftragsverarbeitung insbesondere verschlüsselte Übertragungswege, Zugriffsbeschränkungen, rollenbezogene Berechtigungen und nicht öffentlich erreichbare Dateiablagen ein.',
      },
    ],
  },
  {
    heading: '16. Betroffenenrechte',
    blocks: [
      {
        p: 'Soweit die gesetzlichen Voraussetzungen vorliegen, haben Sie nach der DSGVO insbesondere das Recht auf Auskunft (Art. 15), Berichtigung (Art. 16), Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit (Art. 20 DSGVO). Gegen Verarbeitungen auf Grundlage berechtigter Interessen können Sie nach Art. 21 DSGVO Widerspruch einlegen. Soweit ausnahmsweise eine Einwilligung Grundlage der Verarbeitung ist, können Sie diese jederzeit mit Wirkung für die Zukunft widerrufen.',
      },
      {
        p: 'Sie haben zudem das Recht, sich bei einer Datenschutzaufsichtsbehörde zu beschweren, insbesondere bei der Landesbeauftragten für Datenschutz und Informationsfreiheit der Freien Hansestadt Bremen: https://www.datenschutz.bremen.de/ . Anfragen zu Ihren Rechten richten Sie bitte an kundenservice@easykfz24.de.',
      },
    ],
  },
  {
    heading: '17. Automatisierte Entscheidungen',
    blocks: [
      {
        p: 'EasyKFZ24 trifft keine ausschließlich automatisierten Entscheidungen im Sinne von Art. 22 DSGVO, die Ihnen gegenüber rechtliche Wirkung entfalten oder Sie in ähnlicher Weise erheblich beeinträchtigen. Die behördliche Entscheidung über einen Zulassungsantrag trifft die zuständige Behörde.',
      },
    ],
  },
  {
    heading: '18. Aktualisierung dieser Datenschutzerklärung',
    blocks: [
      {
        p: 'Bei Änderungen der eingesetzten Dienste, der technischen Abläufe oder der rechtlichen Anforderungen aktualisieren wir diese Datenschutzhinweise. Maßgeblich ist die jeweils auf unserer Website veröffentlichte Fassung.',
      },
    ],
  },
];
