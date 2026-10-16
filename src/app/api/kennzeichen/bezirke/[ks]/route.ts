import { NextResponse } from 'next/server';
import { getRequirements, KennzeichenError } from '../../../../../server/kennzeichen.ts';
export const dynamic = 'force-dynamic';
export async function GET(_req: Request, ctx: { params: Promise<{ ks: string }> }) {
  try {
    return NextResponse.json({ requirements: await getRequirements((await ctx.params).ks) }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    if (e instanceof KennzeichenError) return NextResponse.json({ error: e.message }, { status: e.status });
    throw e;
  }
}
