// Rechnung / Gutschrift als druckbare Seite („Drucken → Als PDF sichern“). Daten aus dem bei Ausstellung
// gespeicherten Stand (Verkäufer, Empfänger, Positionen) – spätere Änderungen verändern die Rechnung nicht.

import { notFound } from 'next/navigation';
import { PrintButton } from '../../../../components/PrintButton.tsx';
import { requirePermission } from '../../../../server/auth.ts';
import { audit } from '../../../../server/audit.ts';
import { getInvoice } from '../../../../server/os/finance.ts';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Rechnung' };

const euro = (c: number) => (c / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const day = (iso: string) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '');

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requirePermission('finance.read');
  const id = Number((await params).id);
  const inv = Number.isInteger(id) && id > 0 ? await getInvoice(id) : null;
  if (!inv) notFound();
  await audit({ id: user.id, username: user.username }, 'rechnung.geoeffnet', inv.number);
  const s = inv.seller;
  const b = inv.buyer;
  const credit = inv.kind === 'gutschrift';
  const small = inv.tax_mode === 'kleinunternehmer';
  const rate = small ? 0 : Number(inv.tax_mode.replace('regel_', '')) || 19;
  return (
    <main className="print-sheet invoice">
      <div className="no-print print-sheet__bar">
        <PrintButton label="Drucken / als PDF sichern" />
      </div>
      <header className="invoice__head">
        <div>
          <p className="invoice__sender">
            {s.name} · {s.street} · {s.zip} {s.city}
          </p>
          <address className="invoice__buyer">
            {b.name}
            {b.contact ? (
              <>
                <br />
                z. Hd. {b.contact}
              </>
            ) : null}
            <br />
            {b.street}
            <br />
            {b.city}
          </address>
        </div>
        <div className="invoice__seller">
          <strong>{s.name}</strong>
          <br />
          {s.street}
          <br />
          {s.zip} {s.city}
          {s.phone ? (
            <>
              <br />
              Tel. {s.phone}
            </>
          ) : null}
          {s.email ? (
            <>
              <br />
              {s.email}
            </>
          ) : null}
        </div>
      </header>
      <h1>
        {/* Begriff „Gutschrift“ ist umsatzsteuerlich der Abrechnung durch den Leistungsempfänger vorbehalten – steuerlich prüfen lassen */}
        {credit ? 'Stornorechnung (Rechnungskorrektur)' : 'Rechnung'} {inv.number}
      </h1>
      <dl className="invoice__meta">
        <div>
          <dt>{credit ? 'Datum' : 'Rechnungsdatum'}</dt>
          <dd>{day(inv.issued_at)}</dd>
        </div>
        {inv.service_date ? (
          <div>
            <dt>Leistungsdatum</dt>
            <dd>{day(inv.service_date)}</dd>
          </div>
        ) : null}
        <div>
          <dt>Auftrag</dt>
          <dd>{inv.order_number}</dd>
        </div>
        {credit && inv.ref_number ? (
          <div>
            <dt>Korrektur zu</dt>
            <dd>{inv.ref_number}</dd>
          </div>
        ) : null}
      </dl>
      <table className="invoice__lines">
        <thead>
          <tr>
            <th scope="col">Leistung</th>
            {!small ? (
              <>
                <th scope="col" className="num">
                  Netto
                </th>
                <th scope="col" className="num">
                  USt {rate} %
                </th>
              </>
            ) : null}
            <th scope="col" className="num">
              Betrag
            </th>
          </tr>
        </thead>
        <tbody>
          {inv.lines.map((l, i) => (
            <tr key={i}>
              <td>{l.label}</td>
              {!small ? (
                <>
                  <td className="num">{euro(l.netCents)}</td>
                  <td className="num">{euro(l.vatCents)}</td>
                </>
              ) : null}
              <td className="num">{euro(l.grossCents)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          {!small ? (
            <>
              <tr>
                <td>Summe netto</td>
                <td className="num">{euro(inv.net_cents)}</td>
                <td />
                <td />
              </tr>
              <tr>
                <td>Umsatzsteuer {rate} %</td>
                <td />
                <td className="num">{euro(inv.vat_cents)}</td>
                <td />
              </tr>
            </>
          ) : null}
          <tr className="invoice__total">
            <th scope="row">{credit ? 'Korrekturbetrag' : 'Rechnungsbetrag'}</th>
            {!small ? (
              <>
                <td />
                <td />
              </>
            ) : null}
            <th className="num">{euro(inv.gross_cents)}</th>
          </tr>
        </tfoot>
      </table>
      {small ? <p>Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.</p> : null}
      <p className="invoice__note">Amtliche Gebühren (Zulassungsstelle, Kennzeichenreservierung) sind nicht enthalten und werden gegebenenfalls als durchlaufende Posten nach Beleg weiterberechnet.</p>
      {inv.note ? <p>{inv.note}</p> : null}
      {!credit && s.iban ? (
        <p>
          Bitte überweisen Sie den Betrag {s.paymentTermDays ? `innerhalb von ${s.paymentTermDays} Tagen ` : ''}unter Angabe von {inv.number} auf {s.bankName ? `${s.bankName}, ` : ''}IBAN {s.iban}
          {s.bic ? `, BIC ${s.bic}` : ''}. Bereits online bezahlte Beträge sind berücksichtigt.
        </p>
      ) : null}
      <footer className="invoice__foot">
        {[s.name, s.owner ? `Vertreten durch ${s.owner}` : '', s.register, s.taxNumber ? `Steuernummer ${s.taxNumber}` : '', s.vatId ? `USt-IdNr. ${s.vatId}` : '', s.invoiceFooter]
          .filter(Boolean)
          .join(' · ')}
      </footer>
    </main>
  );
}
