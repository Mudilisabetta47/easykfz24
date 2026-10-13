import type { Metadata } from 'next';
import '../../../styles/forms.css';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { normalizeOrderNumber } from '../../../lib/order-number.ts';
import { PROVIDER, PROVIDER_NAME } from '../../../lib/site.ts';
import { NOTICE_PATH, WITHDRAW_LABEL } from '../../../lib/withdrawal.ts';
import { withdrawalMode } from '../../../server/withdrawal.ts';
import { WithdrawalForm } from './WithdrawalForm.tsx';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: WITHDRAW_LABEL,
  description: 'Elektronische Widerrufsfunktion: Vertrag mit EasyKFZ24 online widerrufen und sofort eine Eingangsbestätigung erhalten.',
  alternates: { canonical: '/widerruf' },
  robots: { index: false, follow: true },
};

/** Elektronische Widerrufsfunktion nach § 356a BGB – ENTWURF, nur mit WIDERRUF_AKTIV=1 öffentlich */
export default async function WiderrufPage({ searchParams }: { searchParams: Promise<{ nr?: string }> }) {
  const mode = withdrawalMode();
  if (mode === 'aus') notFound();
  const { nr = '' } = await searchParams;
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Widerruf</p>
          <h1>{WITHDRAW_LABEL}</h1>
          <p className="lead">
            Hier können Sie einen mit der {PROVIDER_NAME} (EasyKFZ24) online geschlossenen Vertrag widerrufen. Nach dem Absenden erhalten Sie
            unverzüglich eine Eingangsbestätigung per E-Mail.
          </p>
          {mode === 'vorschau' ? (
            <p className="lead">
              <mark className="placeholder">Entwurf – nicht veröffentlicht. Vor der Freischaltung rechtlich prüfen lassen.</mark>
            </p>
          ) : null}
        </div>
      </header>
      <div className="shell shell--narrow section-pad">
        <WithdrawalForm initialContract={normalizeOrderNumber(nr) ?? ''} />
        <p className="muted wd__alt">
          Sie können auch per E-Mail an <a href={`mailto:${PROVIDER.email}`}>{PROVIDER.email}</a> oder per Post widerrufen. Weitere Informationen:{' '}
          <Link href={NOTICE_PATH}>Widerrufsbelehrung</Link>.
        </p>
      </div>
    </>
  );
}
