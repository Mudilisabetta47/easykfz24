import { NextResponse } from 'next/server';
import { publicCatalog } from '../../../../server/kennzeichen-public.ts';
import { KennzeichenError } from '../../../../server/kennzeichen.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  try {
    return NextResponse.json(await publicCatalog(), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    const status = e instanceof KennzeichenError ? e.status : 503;
    return NextResponse.json({ catalog: null, searchEnabled: false, reservationEnabled: false, error: 'Bezirkskatalog derzeit nicht verfügbar.' }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
