import type { Metadata } from 'next';
import { Ph } from '../../../components/Ph.tsx';
import { SITE } from '../../../lib/site.ts';

export const metadata: Metadata = { title: 'Datenschutz', robots: { index: false, follow: true } };

export default function DatenschutzPage() {
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Datenschutzhinweise</h1>
          <p className="lead">
            <mark className="placeholder">Entwurf: Diese Hinweise beschreiben die technische Umsetzung und enthalten Platzhalter. Vor dem Livegang vollständig ergänzen und rechtlich prüfen lassen.</mark>
          </p>
        </div>
      </header>
      <div className="shell section-pad prose">
        <h2>1. Verantwortlicher</h2>
        <p>
          <Ph>{SITE.company}</Ph>, <Ph>{SITE.street}</Ph>, <Ph>{SITE.city}</Ph>, E-Mail: <Ph>{SITE.email}</Ph>
        </p>
        <p>
          Datenschutzkontakt: <Ph>{SITE.privacyContact}</Ph>
        </p>

        <h2>2. Welche Daten wir verarbeiten</h2>
        <ul>
          <li>Angaben zum Fahrzeug (Art, Hersteller, Modell, FIN, Kennzeichen, Antrieb)</li>
          <li>Angaben zum Halter (Name bzw. Firma, Geburtsdatum, Anschrift, E-Mail, Telefon)</li>
          <li>Hochgeladene Unterlagen (z. B. Ausweis, Zulassungsbescheinigungen, COC, HU-Bericht)</li>
          <li>eVB-Nummer sowie Kontoinhaber und IBAN für das SEPA-Mandat zur Kfz-Steuer</li>
          <li>Zeitpunkt Ihrer Zustimmungen sowie der Bearbeitungsverlauf Ihres Auftrags</li>
        </ul>

        <h2>3. Zwecke und Rechtsgrundlagen</h2>
        <p>
          Wir verarbeiten die Daten, um Ihren Auftrag durchzuführen und den Zulassungsvorgang bei der zuständigen Behörde zu beantragen
          (Art. 6 Abs. 1 lit. b DSGVO). Ausweisdaten und Fahrzeugpapiere werden ausschließlich hierfür genutzt. Gesetzliche
          Aufbewahrungspflichten ergeben sich insbesondere aus Handels- und Steuerrecht (Art. 6 Abs. 1 lit. c DSGVO).
        </p>

        <h2>4. Empfänger</h2>
        <p>
          Die für den Vorgang zuständige Zulassungsbehörde; für die Kfz-Steuer die Bundeszollverwaltung; ggf. Versanddienstleister für die
          Zustellung. Hosting: <Ph>{SITE.hosting}</Ph>.
        </p>

        <h2>5. Speicherung und Sicherheit</h2>
        <p>
          Die Übertragung erfolgt verschlüsselt. Hochgeladene Dateien werden außerhalb des öffentlich erreichbaren Bereichs gespeichert und
          sind nur für angemeldete Sachbearbeiter abrufbar. Der Dateityp wird beim Upload technisch geprüft.
        </p>
        <p>
          Speicherdauer: <mark className="placeholder">[PLATZHALTER: Löschfristen für Auftragsdaten und Unterlagen festlegen]</mark>
        </p>

        <h2>6. Cookies und Reichweitenmessung</h2>
        <p>
          Die öffentliche Website setzt keine Tracking- oder Marketing-Cookies und lädt keine Inhalte von Drittanbietern. Im
          Verwaltungsbereich wird ein technisch notwendiges Sitzungs-Cookie für die Anmeldung gesetzt.
        </p>

        <h2>7. Ihre Rechte</h2>
        <p>
          Sie haben das Recht auf Auskunft, Berichtigung, Löschung, Einschränkung der Verarbeitung, Datenübertragbarkeit und Widerspruch sowie
          das Recht auf Beschwerde bei einer Datenschutzaufsichtsbehörde.
        </p>
      </div>
    </>
  );
}
