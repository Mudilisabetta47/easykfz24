import type { Metadata } from 'next';
import '../../../styles/forms.css';
import { normalizeOrderNumber } from '../../../lib/order-number.ts';
import { StatusLookup } from './StatusLookup.tsx';

export const metadata: Metadata = {
  title: 'Status abrufen',
  description: 'Mit Auftragsnummer und E-Mail-Adresse den aktuellen Stand Ihres Vorgangs abrufen.',
};

export default async function StatusPage({ searchParams }: { searchParams: Promise<{ nr?: string }> }) {
  const { nr = '' } = await searchParams;
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Anmelden</p>
          <h1>Status abrufen</h1>
          <p className="lead">Sehen Sie, in welchem Schritt Ihr Vorgang ist – und ob wir noch etwas von Ihnen brauchen.</p>
        </div>
      </header>
      <div className="shell section-pad">
        <StatusLookup initialNr={normalizeOrderNumber(nr) ?? ''} />
      </div>
    </>
  );
}
