// Dokumente nur für angemeldete Admins. Dateien liegen außerhalb von public/ in ./data/uploads.

import { NextResponse } from 'next/server';
import { safeFileName } from '../../../../../lib/files.ts';
import { isAdmin } from '../../../../../server/auth.ts';
import { getDocument, readDocumentFile } from '../../../../../server/orders.ts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) return new NextResponse('Nicht angemeldet', { status: 401 });
  const { id } = await params;
  const doc = getDocument(id);
  if (!doc) return new NextResponse('Nicht gefunden', { status: 404 });
  let body: Buffer;
  try {
    body = readDocumentFile(doc);
  } catch {
    return new NextResponse('Datei fehlt', { status: 404 });
  }
  const download = new URL(req.url).searchParams.has('download');
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
