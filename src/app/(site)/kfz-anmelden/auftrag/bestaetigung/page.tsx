import type { Metadata } from 'next';
import Link from 'next/link';
import '../../../../../styles/forms.css';
import { ArrowRight, Check } from '../../../../../components/icons.tsx';
import { Ph } from '../../../../../components/Ph.tsx';
import { normalizeOrderNumber } from '../../../../../lib/order-number.ts';
import { isServiceId, SERVICES } from '../../../../../lib/services.ts';
import { SITE } from '../../../../../lib/site.ts';

export const metadata: Metadata = { title: 'Auftrag eingegangen', robots: { index: false } };

export default async function BestaetigungPage({ searchParams }: { searchParams: Promise<{ nr?: string; l?: string }> }) {
  const { nr = '', l = '' } = await searchParams;
  const number = normalizeOrderNumber(nr);
  const def = isServiceId(l) ? SERVICES[l] : null;

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

        <h2>So geht es weiter</h2>
        <ol className="confirm__steps">
          <li>Wir prüfen Ihre Angaben und Unterlagen. Fehlt etwas, sehen Sie den Hinweis in der Statusabfrage und wir melden uns.</li>
          <li>
            Senden Sie uns die unterschriebene <Link href={`/kfz-anmelden/vollmacht${number ? `?nr=${number}` : ''}`}>Vollmacht</Link> und die
            Originale per Post an: <Ph>{SITE.company}</Ph>, <Ph>{SITE.street}</Ph>, <Ph>{SITE.city}</Ph>. Bitte die Auftragsnummer beilegen.
          </li>
          <li>Sobald alles vollständig ist, reichen wir den Vorgang bei der zuständigen Zulassungsbehörde ein.</li>
        </ol>
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
