// GET /api/vollmacht/status?powerOfAttorneyId=… – Nachprüfung für die Rücksprungseite. Liefert nur den bestätigten Stand
// (Anzeigeart), keine Auftrags- oder Personendaten; gedrosselt je IP und je Vorgang.

import { NextResponse } from 'next/server';
import { formatRetryAfter } from '../../../../lib/rate-limit.ts';
import { parseReturnParams } from '../../../../lib/power-of-attorney.ts';
import { ipFrom, limits } from '../../../../server/limits.ts';
import { publicPoaState } from '../../../../server/poa-public.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = limits().poaStatus.hit(ipFrom(req.headers));
  if (!limit.allowed) return NextResponse.json({ ok: false, error: `Bitte in ${formatRetryAfter(limit.retryAfterMs)} erneut versuchen.` }, { status: 429 });
  const url = new URL(req.url);
  const { processId } = parseReturnParams({ powerOfAttorneyId: url.searchParams.get('powerOfAttorneyId') ?? undefined });
  const state = await publicPoaState(processId);
  return NextResponse.json({ ok: true, ...state }, { headers: { 'Cache-Control': 'no-store' } });
}
