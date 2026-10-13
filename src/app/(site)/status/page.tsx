import type { Metadata } from 'next';
import '../../../styles/forms.css';
import { normalizeOrderNumber } from '../../../lib/order-number.ts';
import { StatusLookup } from './StatusLookup.tsx';
import Link from 'next/link';
import { WITHDRAW_LABEL, WITHDRAW_PATH } from '../../../lib/withdrawal.ts';
import { withdrawalMode } from '../../../server/withdrawal.ts';

export const metadata: Metadata = {
  title: 'Status abrufen',
  description: 'Mit Auftragsnummer und E-Mail-Adresse den aktuellen Stand Ihres Vorgangs abrufen.',
  alternates: { canonical: '/status' },
  // Kundenstatus mit personenbezogenen Angaben: nicht indexieren
  robots: { index: false, follow: true },
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
        {withdrawalMode() !== 'aus' ? (
          <p className="muted">
            Sie möchten Ihren Vertrag widerrufen?{' '}
            <Link href={`${WITHDRAW_PATH}${normalizeOrderNumber(nr) ? `?nr=${normalizeOrderNumber(nr)}` : ''}`}>{WITHDRAW_LABEL}</Link>
          </p>
        ) : null}
      </div>
    </>
  );
}
