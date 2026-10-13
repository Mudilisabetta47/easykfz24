// POST /api/widerruf – elektronische Widerrufsfunktion (§ 356a BGB). ENTWURF: ohne WIDERRUF_AKTIV=1 im Produktivbetrieb 404.

import { NextResponse } from 'next/server';
import { formatRetryAfter } from '../../../lib/rate-limit.ts';
import { ipFrom, limits } from '../../../server/limits.ts';
import { recordWithdrawal, withdrawalMode } from '../../../server/withdrawal.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  if (withdrawalMode() === 'aus') return NextResponse.json({ ok: false, error: 'Nicht gefunden' }, { status: 404 });
  const limit = limits().withdrawals.hit(ipFrom(req.headers));
  if (!limit.allowed) {
    return NextResponse.json(
      { ok: false, error: `Zu viele Anfragen. Bitte in ${formatRetryAfter(limit.retryAfterMs)} erneut versuchen – oder per E-Mail bzw. Post widerrufen.` },
      { status: 429 },
    );
  }
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'Ungültige Anfrage' }, { status: 400 });
  }
  const result = await recordWithdrawal({ name: body.name, contract: body.contract, email: body.email });
  if (!result.ok) return NextResponse.json({ ok: false, errors: result.errors }, { status: 422 });
  return NextResponse.json({ ok: true, receipt: result.receipt });
}
