import type { Metadata } from 'next';
import '../../../../styles/info.css';
import { PrintButton } from '../../../../components/PrintButton.tsx';
import { Ph } from '../../../../components/Ph.tsx';
import { normalizeOrderNumber } from '../../../../lib/order-number.ts';
import { SITE } from '../../../../lib/site.ts';

export const metadata: Metadata = { title: 'Vollmacht (Vorlage)', robots: { index: false } };

export default async function VollmachtPage({ searchParams }: { searchParams: Promise<{ nr?: string }> }) {
  const { nr = '' } = await searchParams;
  const number = normalizeOrderNumber(nr);
  return (
    <div className="shell shell--narrow section-pad print-doc">
      <div className="print-doc__bar no-print">
        <p className="muted">Bitte ausdrucken, vollständig ausfüllen, unterschreiben und im Original an uns senden.</p>
        <PrintButton />
      </div>
      <article className="card vollmacht">
        <h1>Vollmacht</h1>
        <p className="muted">für Zulassungsangelegenheiten nach der Fahrzeug-Zulassungsverordnung</p>
        {number ? (
          <p>
            Auftragsnummer: <strong>{number}</strong>
          </p>
        ) : (
          <p>Auftragsnummer: ______________________</p>
        )}
        <h2>Vollmachtgeber (Halter)</h2>
        <dl className="vollmacht__lines">
          <div><dt>Name, Vorname / Firma</dt><dd /></div>
          <div><dt>Geburtsdatum</dt><dd /></div>
          <div><dt>Anschrift</dt><dd /></div>
        </dl>
        <h2>Bevollmächtigter</h2>
        <p>
          <Ph>{SITE.company}</Ph>, <Ph>{SITE.street}</Ph>, <Ph>{SITE.city}</Ph> sowie deren Mitarbeiterinnen und Mitarbeiter.
        </p>
        <h2>Umfang</h2>
        <p>
          Der Bevollmächtigte darf für das unten bezeichnete Fahrzeug bei der zuständigen Zulassungsbehörde alle Erklärungen abgeben und
          Anträge stellen, die für den beauftragten Vorgang (Zulassung, Umschreibung, Adressänderung, Wiederzulassung oder Außerbetriebsetzung)
          erforderlich sind, einschließlich der Reservierung und Zuteilung eines Kennzeichens sowie der Entgegennahme von Bescheinigungen,
          Kennzeichen und Plaketten.
        </p>
        <dl className="vollmacht__lines">
          <div><dt>Fahrzeug (Hersteller, Modell)</dt><dd /></div>
          <div><dt>Fahrzeug-Identifizierungsnummer (FIN)</dt><dd /></div>
          <div><dt>Kennzeichen (falls vorhanden)</dt><dd /></div>
        </dl>
        <dl className="vollmacht__lines vollmacht__sign">
          <div><dt>Ort, Datum</dt><dd /></div>
          <div><dt>Unterschrift Vollmachtgeber (bei Firmen mit Stempel)</dt><dd /></div>
        </dl>
        <p className="vollmacht__fine">
          Vorlage – vor Verwendung rechtlich prüfen lassen. Einige Zulassungsbehörden verlangen eigene Formulare; in diesem Fall senden wir Ihnen
          das passende Formular zu.
        </p>
      </article>
    </div>
  );
}
