// Öffentliche Einzelprüfung: ausdrücklicher Klick, eigenes Freigabetor, gemeinsames Tagesbudget mit dem OS.
import { createHmac } from 'node:crypto';
import { plateSearchSchema, referenceSchema } from '../lib/kennzeichen-api.ts';
import { getCatalog, KennzeichenError, kennzeichenPolicy, searchPlate } from './kennzeichen.ts';

export function publicSearchEnabled() {
  return process.env.KENNZEICHEN_PUBLIC_SEARCH_ENABLED === '1' && kennzeichenPolicy().searchEnabled;
}
export async function publicCatalog() {
  // GET /bezirke ist kostenlos. Bei ausgeschalteter Integration bleibt der alte reine Cache-Zugriff erhalten.
  const refresh = publicSearchEnabled() || process.env.KENNZEICHEN_METADATA_ENABLED === '1';
  return { catalog: await getCatalog(-1, refresh), searchEnabled: publicSearchEnabled(), reservationEnabled: false };
}
export async function handlePublicSearch(req: Request, ip: string) {
  if (!publicSearchEnabled()) throw new KennzeichenError(423, 'Die Verfügbarkeitsprüfung ist derzeit nicht freigeschaltet.');
  const origin = req.headers.get('origin');
  const expected = new URL(process.env.PUBLIC_BASE_URL || req.url).origin;
  const site = req.headers.get('sec-fetch-site');
  if (origin !== expected || (site && site !== 'same-origin')) throw new KennzeichenError(403, 'Anfrage nicht von dieser Seite.');
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) throw new KennzeichenError(415, 'JSON erwartet.');
  if (Number(req.headers.get('content-length') || 0) > 4096) throw new KennzeichenError(413, 'Anfrage zu groß.');
  const raw = await req.text();
  if (new TextEncoder().encode(raw).length > 4096) throw new KennzeichenError(413, 'Anfrage zu groß.');
  let body: { plate?: unknown; reference?: unknown; confirmed?: unknown };
  try { body = JSON.parse(raw); } catch { throw new KennzeichenError(400, 'Ungültiges JSON.'); }
  if (!body || body.confirmed !== true) throw new KennzeichenError(422, 'Prüfung bitte ausdrücklich starten.');
  const p = plateSearchSchema.safeParse(body.plate);
  const r = referenceSchema.safeParse(body.reference);
  if (!p.success || !r.success) throw new KennzeichenError(422, 'Vollständige Kombination, Behörde und gültige Referenz erforderlich.');
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new KennzeichenError(503, 'Verfügbarkeitsprüfung vorübergehend nicht verfügbar.');
  // Negative, sichere Ganzzahl trennt öffentliche Aufrufer von OS-Benutzer-IDs; keine IP im Vorgangsdatensatz.
  const actor = -(Number.parseInt(createHmac('sha256', secret).update(`kennzeichen:${ip}`).digest('hex').slice(0, 13), 16) + 1);
  await getCatalog(-1, true);
  return searchPlate(actor, p.data, r.data);
}
