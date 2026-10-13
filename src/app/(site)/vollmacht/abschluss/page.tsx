import type { Metadata } from 'next';
import '../../../../styles/forms.css';
import { parseReturnParams } from '../../../../lib/power-of-attorney.ts';
import { publicPoaState } from '../../../../server/poa-public.ts';
import { PoaStatusCard } from './PoaStatusCard.tsx';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Digitale Vollmacht', robots: { index: false, follow: false }, referrer: 'no-referrer' };

/**
 * Rücksprungseite nach der Online-Unterschrift (im Partner-Dashboard als Rücksprungadresse hinterlegt).
 * Der angehängte `status` ist nur ein Hinweis – angezeigt wird ausschließlich der über die Partner-Schnittstelle bestätigte Stand.
 */
export default async function VollmachtAbschlussPage({ searchParams }: { searchParams: Promise<{ powerOfAttorneyId?: string | string[]; status?: string | string[] }> }) {
  const { processId } = parseReturnParams(await searchParams);
  const state = await publicPoaState(processId);
  return (
    <div className="shell shell--narrow confirm">
      <PoaStatusCard processId={processId} initial={state} />
    </div>
  );
}
