// Dokumente nur für angemeldete Admins. Dateien liegen außerhalb von public/ in ./data/uploads.

import { NextResponse } from 'next/server';
import { safeFileName } from '../../../../../lib/files.ts';
import { currentSession } from '../../../../../server/auth.ts';
import { audit } from '../../../../../server/audit.ts';
import { can } from '../../../../../lib/permissions.ts';
import { getDocument, readDocumentFile } from '../../../../../server/orders.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await currentSession();
  if (!session) return new NextResponse('Nicht angemeldet', { status: 401 });
  if (!can(session.user.role, 'docs.read')) return new NextResponse('Keine Berechtigung', { status: 403 });
  const { id } = await params;
  const doc = await getDocument(id);
  if (!doc) return new NextResponse('Nicht gefunden', { status: 404 });
  // Gelöschte Dateien (Papierkorb) nur für Berechtigte, die über Wiederherstellen/Löschen entscheiden
  const deleted = (doc as { deleted_at?: string }).deleted_at;
  if (deleted && !can(session.user.role, 'docs.write')) return new NextResponse('Nicht gefunden', { status: 404 });
  let body: Uint8Array | null;
  try {
    body = await readDocumentFile(doc);
  } catch {
    body = null;
  }
  if (!body) return new NextResponse('Datei fehlt', { status: 404 });
  const download = new URL(req.url).searchParams.has('download');
  await audit({ id: session.user.id, username: session.user.username }, download ? 'dokument.heruntergeladen' : 'dokument.geoeffnet', `Auftrag ${doc.order_id}`, `${doc.kind} ${doc.id}`);
  const name = safeFileName(doc.original_name);
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': doc.mime,
      'Content-Length': String(body.byteLength),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${name}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; object-src 'self'; frame-ancestors 'self'",
    },
  });
}
