// GET /api/kennzeichen?ort=OHZ&buchstaben=??&zahlen=??&seite=0
// Prüft das Wunschkennzeichen, löst Platzhalter auf und fragt – falls angebunden – die Verfügbarkeit ab.

import { NextResponse } from 'next/server';
import { formatRetryAfter } from '../../../lib/rate-limit.ts';
import { checkWish, formatWish, suggestPlates } from '../../../lib/wish-plate.ts';
import { ipFrom, limits } from '../../../server/limits.ts';
import { availabilityProvider } from '../../../server/plate-availability.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const limit = limits().plates.hit(ipFrom(req.headers));
  if (!limit.allowed) {
    return NextResponse.json({ ok: false, error: `Zu viele Anfragen. Bitte in ${formatRetryAfter(limit.retryAfterMs)} erneut versuchen.` }, { status: 429 });
  }
  const url = new URL(req.url);
  const check = checkWish({
    cityCode: (url.searchParams.get('ort') ?? '').slice(0, 5),
    letters: (url.searchParams.get('buchstaben') ?? '').slice(0, 4),
    numbers: (url.searchParams.get('zahlen') ?? '').slice(0, 6),
  });
  if (!check.ok) return NextResponse.json({ ok: false, field: check.field, error: check.error }, { status: 422 });

  const page = Math.max(0, Math.min(50, Number(url.searchParams.get('seite')) || 0));
  const candidates = suggestPlates(check.pattern, 12, page);
  const provider = availabilityProvider();
  const status = await provider.check(candidates.map(formatWish));

  return NextResponse.json({
    ok: true,
    district: { code: check.pattern.cityCode, name: check.districtName },
    provider: provider.name,
    suggestions: candidates.map((c) => ({ ...c, plate: formatWish(c), status: status[formatWish(c)] ?? 'unbekannt' })),
  });
}
