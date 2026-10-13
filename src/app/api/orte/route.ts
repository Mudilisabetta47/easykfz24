// GET /api/orte?q=Lilienthal – Ortssuche für den Kennzeichen-Konfigurator aus der verifizierten Datenbasis (KBA + Destatis).
// Liefert nur verifizierte Kürzel; Orte mit noch zu prüfender Zuordnung werden als solche gekennzeichnet (nichts geraten).

import { NextResponse } from 'next/server';
import { formatRetryAfter } from '../../../lib/rate-limit.ts';
import { ipFrom, limits } from '../../../server/limits.ts';
import { placeByAgs, searchPlaces, type Place } from '../../../server/regions.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const view = (p: Place) => ({
  ags: p.ags,
  name: p.name,
  ...(p.zusatz ? { zusatz: p.zusatz } : {}),
  official: p.officialName,
  kreis: p.kreisName,
  land: p.land,
  codes: p.codes,
  pending: p.assignments.filter((a) => a.status === 'pruefen' || a.status === 'festgelegt').map((a) => a.code),
});

export async function GET(req: Request) {
  const limit = limits().plates.hit(ipFrom(req.headers));
  if (!limit.allowed) return NextResponse.json({ ok: false, error: `Zu viele Anfragen. Bitte in ${formatRetryAfter(limit.retryAfterMs)} erneut versuchen.` }, { status: 429 });
  const url = new URL(req.url);
  const ags = (url.searchParams.get('ags') ?? '').trim();
  if (ags) {
    const p = /^\d{8}$/.test(ags) ? placeByAgs(ags) : null;
    return p ? NextResponse.json({ ok: true, place: view(p) }) : NextResponse.json({ ok: false, error: 'Ort nicht gefunden' }, { status: 404 });
  }
  const q = (url.searchParams.get('q') ?? '').slice(0, 60);
  if (q.trim().length < 2) return NextResponse.json({ ok: true, places: [] });
  // Ein Treffer mehr als angezeigt: dann weist die Auswahl auf „Kreis oder PLZ ergänzen“ hin
  const hits = searchPlaces(q, 13);
  return NextResponse.json({ ok: true, places: hits.slice(0, 12).map(view), more: hits.length > 12 }, { headers: { 'Cache-Control': 'public, max-age=600' } });
}
