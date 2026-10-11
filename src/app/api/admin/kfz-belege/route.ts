// Belege von kfz-api.de (Bescheid, Nachweise) – nur für angemeldete Admins, über den lesenden API-Zugang abgerufen.

import { NextResponse } from 'next/server';
import { isAdmin } from '../../../../server/auth.ts';
import { fetchKfzFile, getKfzOrderInfo, kfzApiConfigured } from '../../../../server/kfz-api.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  if (!(await isAdmin())) return new NextResponse('Nicht angemeldet', { status: 401 });
  if (!kfzApiConfigured()) return new NextResponse('API-Zugang zu kfz-api.de nicht konfiguriert', { status: 503 });
  const q = new URL(req.url).searchParams;
  const orderId = Number(q.get('auftrag'));
  const key = q.get('key') ?? '';
  const info = Number.isInteger(orderId) && orderId > 0 ? await getKfzOrderInfo(orderId) : null;
  // Nur Belege, die per Webhook zu genau diesem Auftrag gemeldet wurden
  if (!info || !info.files.some((f) => f.fileAccessKey === key)) return new NextResponse('Nicht gefunden', { status: 404 });
  const res = await fetchKfzFile(info.transaction, key).catch(() => null);
  if (!res || !res.ok || !res.body) return new NextResponse(`Beleg nicht abrufbar${res ? ` (HTTP ${res.status})` : ''}`, { status: 502 });
  const type = res.headers.get('content-type') ?? 'application/octet-stream';
  return new NextResponse(res.body, {
    headers: {
      'Content-Type': type,
      'Content-Disposition': `inline; filename="beleg-${orderId}${type.includes('pdf') ? '.pdf' : ''}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; object-src 'self'; frame-ancestors 'self'",
    },
  });
}
