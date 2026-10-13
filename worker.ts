// Einstieg für Cloudflare Workers: der von OpenNext erzeugte Worker (Seiten, API) plus Zeitsteuerung.
// Der Cron-Trigger (wrangler.jsonc → triggers.crons) ruft im selben Isolat den internen Endpunkt /api/intern/zeitplan auf;
// das Kennwort dafür entsteht hier zufällig beim ersten Lauf und verlässt das Isolat nie – kein Secret nötig, von außen nicht aufrufbar.
// Ausgeführt wird nur der kostenlose Vollmacht-Abgleich (GET beim Partner), keine kostenpflichtigen Aufrufe.

// @ts-expect-error: entsteht beim Build (opennextjs-cloudflare build → .open-next/worker.js)
import openNext from './.open-next/worker.js';
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

export default {
  fetch: (req: Request, env: unknown, ctx: WorkerCtx) => handler.fetch(req, env, ctx),
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
