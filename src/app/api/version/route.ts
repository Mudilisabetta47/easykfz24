// GET /api/version – welche Version läuft (Commit und Build-Zeitpunkt). Keine Geheimnisse, keine Konfiguration.

import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  return NextResponse.json({ commit: process.env.EK_BUILD_COMMIT ?? '', builtAt: process.env.EK_BUILD_AT ?? '' }, { headers: { 'Cache-Control': 'no-store' } });
}
