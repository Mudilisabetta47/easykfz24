import type { Metadata } from 'next';
import Link from 'next/link';
import { OFFICIAL_FEES_NOTE } from '../../../lib/pricing.config.ts';
import { BRAND_NOTE, PROVIDER, PROVIDER_NAME } from '../../../lib/site.ts';
import { NOTICE_PATH, WITHDRAW_LABEL, WITHDRAW_PATH } from '../../../lib/withdrawal.ts';
import { customerPaymentsOpen } from '../../../server/checkout.ts';

// Zahlungsabschnitt hängt vom Laufzeit-Schalter ab (Zahlungspause) – je Aufruf rendern
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Kundeninformationen',
  description: 'Informationen vor Vertragsschluss: Anbieter, Leistungen, Vertragsschluss, Preise, Zahlung, Bearbeitungsbeginn, Widerruf und Gewährleistung.',
  alternates: { canonical: '/kundeninformationen' },
  robots: { index: false, follow: true },
};

/** Informationen vor Vertragsschluss (Art. 246a, 246c EGBGB) – Stand 14.10.2026, anwaltlich zu bestätigen */
export default function KundeninformationenPage() {
  const online = customerPaymentsOpen();
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Rechtliches</p>
          <h1>Kundeninformationen</h1>
          <p className="lead">Informationen vor Abschluss Ihres Auftrags · Stand: 14. Oktober 2026</p>
        </div>
      </header>
      <div className="shell section-pad prose legal">
        <h2>1. Ihr Vertragspartner</h2>
        <p>
          {PROVIDER_NAME}, {PROVIDER.street}, {PROVIDER.zip} {PROVIDER.city}, vertreten durch den Geschäftsführer {PROVIDER.managingDirector}.
          {PROVIDER.phone ? ` Telefon: ${PROVIDER.phone}.` : ''} E-Mail: {PROVIDER.email}. {BRAND_NOTE}
        </p>

        <h2>2. Unsere Leistungen</h2>
        <p>
          Wir übernehmen auf Grundlage Ihrer Vollmacht die Beantragung des gewählten Zulassungsvorgangs – Neuzulassung, Ummeldung bei Halterwechsel oder Umzug,
          Wiederzulassung oder Abmeldung – bei der zuständigen Zulassungsbehörde. Auf Wunsch beantragen wir die Reservierung eines Wunschkennzeichens und
          liefern geprägte Kennzeichenschilder. Wir sind keine Behörde: Über den Antrag und eine Kennzeichenkombination entscheidet die Zulassungsbehörde; die
          Verfügbarkeit eines Wunschkennzeichens sagen wir nicht zu. Die „Express“-Bearbeitung bedeutet bevorzugte Prüfung und Einreichung durch uns; eine
          Zulassung innerhalb einer bestimmten Frist sagen wir nicht zu. Einzelheiten zu den Leistungen und den benötigten Unterlagen finden Sie unter{' '}
          <Link href="/kfz-anmelden">Leistungen</Link>.
        </p>

        <h2>3. So kommt der Vertrag zustande</h2>
        <p>
          Sie wählen in sieben Schritten Leistung und Kennzeichen, geben Fahrzeug- und Halterdaten ein, laden die Unterlagen hoch, wählen Zustellung und
          Bearbeitung und geben die erforderlichen Erklärungen ab. Im letzten Schritt „Prüfen“ sehen Sie alle Angaben und den Gesamtpreis. Bis zum Absenden
          können Sie jede Angabe über „Zurück“ oder „Ändern“ korrigieren.
        </p>
        <p>
          Mit Klick auf „Zahlungspflichtig beauftragen“ geben Sie ein verbindliches Angebot ab. Unmittelbar danach erhalten Sie eine Bestellbestätigung per
          E-Mail; mit ihr nehmen wir Ihr Angebot an, und der Vertrag kommt zustande. Die Vertragssprache ist Deutsch.
        </p>
        <p>
          Ihre Bestelldaten speichern wir. Die Bestellbestätigung enthält den Inhalt Ihres Auftrags, die Preise, die Vertragsinformationen und die
          Widerrufsbelehrung; den Bearbeitungsstand können Sie jederzeit in der <Link href="/status">Statusabfrage</Link> einsehen.
        </p>

        <h2>4. Preise</h2>
        <p>
          Sie zahlen die Servicepauschale der gewählten Leistung sowie die von Ihnen gewählten Zusatzleistungen (z. B. Express-Bearbeitung, Bearbeitung eines
          Wunschkennzeichens, Kennzeichenschilder, Versand). Der Gesamtpreis inklusive gesetzlicher Umsatzsteuer wird Ihnen vor dem Absenden angezeigt.
        </p>
        <p>{OFFICIAL_FEES_NOTE}</p>

        <h2>5. Zahlung</h2>
        {online ? (
          <p>
            Die Zahlung erfolgt online über unseren Zahlungsdienstleister Mollie. Nach dem Absenden werden Sie zur Bezahlseite weitergeleitet; dort wählen Sie
            eine der angebotenen Zahlungsmethoden. Die Servicepauschale ist mit Vertragsschluss fällig.
          </p>
        ) : (
          <p>
            Die Online-Zahlung ist derzeit noch nicht freigeschaltet. Nach Prüfung Ihrer Unterlagen erhalten Sie von uns per E-Mail eine Zahlungsaufforderung
            mit den Zahlungsdetails. Mit dem Absenden der Bestellung wird noch keine Zahlung ausgelöst.
          </p>
        )}
        <p>Bei der Zulassungsbehörde reichen wir Ihren Vorgang erst ein, wenn Ihre Zahlung bei uns eingegangen ist.</p>

        <h2>6. Beginn und Ablauf der Bearbeitung</h2>
        <p>
          Verbraucher haben ein gesetzliches Widerrufsrecht von 14 Tagen. Ohne Ihre ausdrückliche Erklärung, dass wir vorher beginnen sollen, beginnen wir mit
          der Bearbeitung erst nach Ablauf der Widerrufsfrist. Verlangen Sie den sofortigen Beginn, starten wir, sobald Ihre Angaben und Unterlagen vollständig
          vorliegen. Die Express-Bearbeitung setzt den sofortigen Beginn voraus.
        </p>
        <p>
          Die unterschriebene Vollmacht und die im Auftrag genannten Originale senden Sie uns per Post. Über die Dauer der behördlichen Bearbeitung entscheidet
          die Zulassungsbehörde; eine bestimmte Bearbeitungsdauer sagen wir nicht zu. Papiere und Kennzeichen erhalten Sie per DHL oder UPS oder holen sie nach
          Terminabsprache in unserer Geschäftsstelle ab.
        </p>

        <h2>7. Widerrufsrecht</h2>
        <p>
          Einzelheiten zu Ihrem Widerrufsrecht, zu den Folgen eines Widerrufs und das Muster-Widerrufsformular finden Sie in der{' '}
          <Link href={NOTICE_PATH}>Widerrufsbelehrung</Link>. Sie können auch online widerrufen: <Link href={WITHDRAW_PATH}>{WITHDRAW_LABEL}</Link>.
        </p>

        <h2>8. Gewährleistung</h2>
        <p>Es gilt das gesetzliche Mängelhaftungsrecht.</p>

        <h2>9. Kundendienst und Beschwerden</h2>
        <p>
          Fragen und Beschwerden richten Sie bitte an {PROVIDER.email}
          {PROVIDER.phone ? ` oder telefonisch an ${PROVIDER.phone}` : ''}. Wir sind nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
          Verbraucherschlichtungsstelle teilzunehmen.
        </p>

        <h2>10. Datenschutz</h2>
        <p>
          Wie wir Ihre Daten verarbeiten, erklären wir in der <Link href="/datenschutz">Datenschutzerklärung</Link>.
        </p>
      </div>
    </>
  );
}
