import type { Metadata } from 'next';
import Link from 'next/link';
import '../../../../../styles/forms.css';
import { ArrowRight, Check } from '../../../../../components/icons.tsx';
import { normalizeOrderNumber } from '../../../../../lib/order-number.ts';
import { isServiceId, SERVICES } from '../../../../../lib/services.ts';
import { PROVIDER, SITE, telHref } from '../../../../../lib/site.ts';
import { NOTICE_PATH, WITHDRAW_LABEL, WITHDRAW_PATH } from '../../../../../lib/withdrawal.ts';
import { withdrawalMode } from '../../../../../server/withdrawal.ts';
import { bankTransferAccount } from '../../../../../server/bank-transfer.ts';
import { poaCreationEnabled } from '../../../../../server/power-of-attorney.ts';

export const metadata: Metadata = { title: 'Auftrag eingegangen', robots: { index: false } };

export default async function BestaetigungPage({ searchParams }: { searchParams: Promise<{ nr?: string; l?: string; r?: string; zahlung?: string }> }) {
  const { nr = '', l = '', r = '', zahlung = '' } = await searchParams;
  const number = normalizeOrderNumber(nr);
  const def = isServiceId(l) ? SERVICES[l] : null;
  const transfer = zahlung === 'ok' ? null : await bankTransferAccount();
  const digitalPoa = poaCreationEnabled();

  return (
    <div className="shell shell--narrow confirm">
      <div className="card confirm__card">
        <span className="confirm__icon" aria-hidden="true">
          <Check width={28} height={28} />
        </span>
        <p className="label">Auftrag eingegangen</p>
        <h1>Vielen Dank – wir haben Ihren Auftrag erhalten.</h1>
        {number ? (
          <div className="confirm__number">
            <span>Ihre Auftragsnummer</span>
            <strong>{number}</strong>
          </div>
        ) : (
          <p className="muted">Ihre Auftragsnummer konnte nicht angezeigt werden. Bitte wenden Sie sich an uns.</p>
        )}
        <p>
          Bitte notieren Sie sich die Auftragsnummer. Mit ihr und Ihrer E-Mail-Adresse können Sie den Status jederzeit abrufen.
          {def ? ` Leistung: ${def.title}.` : ''}
        </p>

        {transfer && number ? (
          <div className="card confirm__pay">
            <h2>Zahlung per Überweisung</h2>
            <p>Bitte überweisen Sie den Gesamtbetrag aus Ihrer Bestellbestätigung innerhalb von {transfer.termDays} Tagen:</p>
            <dl className="status-facts">
              <div>
                <dt>Empfänger</dt>
                <dd>{transfer.recipient}</dd>
              </div>
              <div>
                <dt>IBAN</dt>
                <dd>{transfer.iban}</dd>
              </div>
              {transfer.bic ? (
                <div>
                  <dt>BIC</dt>
                  <dd>{transfer.bic}</dd>
                </div>
              ) : null}
              {transfer.bankName ? (
                <div>
                  <dt>Bank</dt>
                  <dd>{transfer.bankName}</dd>
                </div>
              ) : null}
              <div>
                <dt>Verwendungszweck</dt>
                <dd>{number}</dd>
              </div>
            </dl>
            <p className="muted">
              Ihre Zahlung gilt als eingegangen, sobald sie auf unserem Konto gutgeschrieben ist; Sie erhalten dann eine Bestätigung per E-Mail. Bei der
              Zulassungsbehörde reichen wir Ihren Vorgang erst nach Zahlungseingang ein.
            </p>
          </div>
        ) : null}
        {zahlung === 'ok' ? (
          <p className="alert alert--ok">Vielen Dank – Ihre Zahlung wurde übermittelt. Die Bestätigung erscheint in wenigen Minuten in der Statusabfrage.</p>
        ) : null}
        {r === '1' ? (
          <p className="alert alert--ok">Ihr Neukundenrabatt von 10 % auf die Servicepauschale wurde berücksichtigt.</p>
        ) : r === '0' ? (
          <p className="alert alert--info">
            Zu Ihrer E-Mail-Adresse gibt es bereits einen Auftrag – der Neukundenrabatt gilt nur für die erste Beauftragung.
          </p>
        ) : null}

        <h2>So geht es weiter</h2>
        <ol className="confirm__steps">
          <li>
            Haben Sie den sofortigen Bearbeitungsbeginn verlangt, prüfen wir Ihre Angaben und Unterlagen sofort – sonst nach Ablauf der 14-tägigen
            Widerrufsfrist. Fehlt etwas, sehen Sie den Hinweis in der Statusabfrage und wir melden uns. Ihre Bestellbestätigung mit allen Angaben erhalten Sie
            per E-Mail.
          </li>
          {digitalPoa ? (
            <li>
              Für Zulassung, Ummeldung und Wiederzulassung erteilen Sie die Vollmacht online: Nach Zahlungseingang erhalten Sie per E-Mail einen Link
              unseres Partners kfz-api.de, identifizieren sich mit Ihrem Personalausweis über Nect und unterschreiben mit qualifizierter elektronischer
              Signatur – ohne zusätzliche Kosten. Den Link finden Sie dann auch in der Statusabfrage. Im Auftrag genannte Originale senden Sie bitte per Post an: {SITE.company} – {SITE.name}, {SITE.street}, {SITE.city}.
            </li>
          ) : (
            <li>
              Senden Sie uns die unterschriebene <Link href={`/kfz-anmelden/vollmacht${number ? `?nr=${number}` : ''}`}>Vollmacht</Link> und die
              Originale per Post an: {SITE.company} – {SITE.name}, {SITE.street}, {SITE.city}. Bitte die Auftragsnummer beilegen.
            </li>
          )}
          <li>Sobald alles vollständig ist und Ihre Zahlung eingegangen ist, reichen wir den Vorgang bei der zuständigen Zulassungsbehörde ein.</li>
        </ol>
        <p className="muted">
          Fragen zu Ihrem Auftrag? {PROVIDER.phone ? (
            <>
              Telefon <a href={telHref(PROVIDER.phone)}>{PROVIDER.phone}</a> ·{' '}
            </>
          ) : null}
          E-Mail <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a>
        </p>
        {withdrawalMode() !== 'aus' ? (
          <p className="muted">
            Informationen zu Ihrem Widerrufsrecht: <Link href={NOTICE_PATH}>Widerrufsbelehrung</Link> ·{' '}
            <Link href={`${WITHDRAW_PATH}${number ? `?nr=${number}` : ''}`}>{WITHDRAW_LABEL}</Link>
          </p>
        ) : null}
        {def ? (
          <div className="confirm__originals">
            <p className="label">Per Post im Original</p>
            <ul>
              {def.originals.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ul>
          </div>
        ) : null}
        <div className="confirm__actions">
          <Link href={`/status${number ? `?nr=${number}` : ''}`} className="btn">
            Status abrufen <ArrowRight className="btn__icon" />
          </Link>
          <Link href={`/kfz-anmelden/vollmacht${number ? `?nr=${number}` : ''}`} className="btn btn--ghost">
            Vollmacht drucken
          </Link>
        </div>
      </div>
    </div>
  );
}
