import { NextResponse } from 'next/server';
import { handlePublicSearch } from '../../../../server/kennzeichen-public.ts';
import { KennzeichenError } from '../../../../server/kennzeichen.ts';
import { ipFrom } from '../../../../server/limits.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  try {
    return NextResponse.json(await handlePublicSearch(req, ipFrom(req.headers)), { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof KennzeichenError) return NextResponse.json({ error: e.message }, { status: e.status, headers: { 'Cache-Control': 'no-store', ...(e.status === 429 ? { 'Retry-After': '60' } : {}) } });
    return NextResponse.json({ error: 'Verfügbarkeitsprüfung vorübergehend nicht verfügbar.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }
}
