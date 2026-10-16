// Öffentlich nur der bereits intern geladene Katalog. Kein Anbieteraufruf durch Besucher.
import { NextResponse } from 'next/server';
import { getCatalog } from '../../../../server/kennzeichen.ts';
export const dynamic = 'force-dynamic';
export async function GET() {
  return NextResponse.json({ catalog: await getCatalog(), searchEnabled: false, reservationEnabled: false }, { headers: { 'Cache-Control': 'no-store' } });
}
