// Einstieg für Cloudflare Workers: der von OpenNext erzeugte Worker (Seiten, API) plus Zeitsteuerung.
// Vorab: http:// und www. leiten dauerhaft auf https://easykfz24.de um (eine Adresse für Suchmaschinen).
// Der Cron-Trigger (wrangler.jsonc → triggers.crons) ruft im selben Isolat den internen Endpunkt /api/intern/zeitplan auf;
// das Kennwort dafür entsteht hier zufällig beim ersten Lauf und verlässt das Isolat nie – kein Secret nötig, von außen nicht aufrufbar.
// Ausgeführt werden nur kostenlose, lesende Abgleiche (Vollmacht bei kfz-api.de, Zahlungen bei Mollie) – nichts Kostenpflichtiges.

// @ts-expect-error: entsteht beim Build (opennextjs-cloudflare build → .open-next/worker.js)
import openNext from './.open-next/worker.js';
import { canonicalRedirect } from './src/lib/canonical-host.ts';
// @ts-expect-error: entsteht beim Build
export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from './.open-next/worker.js';

interface WorkerCtx {
  waitUntil(p: Promise<unknown>): void;
  passThroughOnException(): void;
}
interface Handler {
  fetch(req: Request, env: unknown, ctx: WorkerCtx): Promise<Response>;
}

const TOKEN = Symbol.for('easykfz24.zeitplan');
/** Erst beim ersten Cron-Lauf erzeugen – Zufallswerte sind im globalen Gültigkeitsbereich eines Workers nicht erlaubt */
function zeitplanToken(): string {
  const g = globalThis as Record<symbol, unknown>;
  if (typeof g[TOKEN] !== 'string') g[TOKEN] = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');
  return g[TOKEN] as string;
}

const handler = openNext as Handler;

function handle(req: Request, env: unknown, ctx: WorkerCtx): Promise<Response> {
  const redirect = canonicalRedirect(req.url, req.method);
  if (redirect) return Promise.resolve(new Response(null, { status: redirect.status, headers: { location: redirect.location } }));
  return handler.fetch(req, env, ctx);
}

export default {
  fetch: handle,
  async scheduled(_controller: unknown, env: Record<string, unknown>, ctx: WorkerCtx) {
    const base = typeof env.PUBLIC_BASE_URL === 'string' && env.PUBLIC_BASE_URL.startsWith('http') ? env.PUBLIC_BASE_URL : 'https://easykfz24.de';
    const res = await handler.fetch(
      new Request(new URL('/api/intern/zeitplan', base), { method: 'POST', headers: { 'x-ek-zeitplan': zeitplanToken() } }),
      env,
      ctx,
    );
    const text = await res.text();
    if (!res.ok) console.error(`[zeitplan] HTTP ${res.status}`);
    else console.log(`[zeitplan] ${text.slice(0, 200)}`);
  },
};
