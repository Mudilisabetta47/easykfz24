import { DRIVE_TYPES, VEHICLE_TYPES } from '../../lib/catalog.ts';
import { formatDateTime, formatEuro, formatIsoDay } from '../../lib/format.ts';
import { PLATE_CHOICES, SERVICES } from '../../lib/services.ts';
import { formatIban } from '../../lib/validation.ts';
import { CARRIERS } from '../../lib/shipping.ts';
import type { OrderDetail } from '../../server/orders.ts';

function Facts({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <section className="facts">
      <h2>{title}</h2>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '–'}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** Alle Auftragsangaben – genutzt in Detail- und Druckansicht. IBAN hier vollständig (wird für die Zulassung benötigt). */
export function OrderFacts({ order }: { order: OrderDetail }) {
  const d = order.data;
  const h = d.holder;
  return (
    <div className="facts-grid">
      <Facts
        title="Fahrzeug"
        rows={[
          ['Art', VEHICLE_TYPES[d.vehicle.art].label],
          ['Hersteller / Modell', `${d.vehicle.hersteller} ${d.vehicle.modell}`],
          ['FIN', d.vehicle.fin],
          ['Antrieb', DRIVE_TYPES[d.vehicle.antrieb]],
          ['Bisheriges Kennzeichen', d.vehicle.bisherigesKennzeichen],
          ['E-Kennzeichen', d.vehicle.eKennzeichen ? 'gewünscht' : 'nein'],
        ]}
      />
      <Facts
        title={h.typ === 'firma' ? 'Halter (Firma)' : 'Halter (Privat)'}
        rows={[
          ...(h.typ === 'firma'
            ? ([
                ['Firma', h.firmenname],
                ['Registernummer', h.registernummer],
                ['Ansprechperson', h.ansprechpartner],
              ] as [string, string][])
            : ([
                ['Name', `${h.vorname} ${h.nachname}`],
                ['Geburtsdatum', formatIsoDay(h.geburtsdatum)],
              ] as [string, string][])),
          ['Anschrift', `${h.strasse} ${h.hausnummer}, ${h.plz} ${h.ort}`],
          ['E-Mail', h.email],
          ['Telefon', h.telefon],
        ]}
      />
      <Facts
        title="Kennzeichen & Zustellung"
        rows={[
          ['Wahl', d.plate.wahl ? PLATE_CHOICES[d.plate.wahl].label : 'entfällt (Abmeldung)'],
          ['Wunschkennzeichen', d.plate.wunschkennzeichen],
          ['Schilder', d.plate.schilder ? 'mitbestellt' : 'nein'],
          ['Zustellung', d.plate.zustellung === 'versand' ? `Versand mit ${d.plate.versanddienst ? CARRIERS[d.plate.versanddienst].name : '–'}` : 'Abholung'],
        ]}
      />
      <Facts
        title="Versicherung & Steuer"
        rows={[
          ['eVB-Nummer', d.finish.evb],
          ['Kontoinhaber', d.finish.kontoinhaber],
          ['IBAN', d.finish.iban ? formatIban(d.finish.iban) : ''],
          ['SEPA-Mandat', SERVICES[d.service].sepa ? (d.finish.sepaMandat ? 'erteilt' : 'fehlt') : 'nicht erforderlich'],
        ]}
      />
      <Facts
        title="Zustimmungen & Preis"
        rows={[
          ['Vollmacht / Datenschutz', `bestätigt am ${formatDateTime(order.consent_at)}`],
          ...order.price.lines.map((l) => [l.label, formatEuro(l.cents)] as [string, string]),
          ['Servicekosten gesamt', formatEuro(order.price.totalCents)],
        ]}
      />
      {d.finish.hinweise ? <Facts title="Hinweise des Kunden" rows={[['Text', d.finish.hinweise]]} /> : null}
    </div>
  );
}
