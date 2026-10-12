// Nach „next build“: Cloudflare-Worker mit OpenNext erzeugen (.open-next/), ohne Next.js erneut zu bauen.
// Cloudflare Workers Builds führt „npm run build“ und danach „npx wrangler deploy“ aus; wrangler übergibt an
// „opennextjs-cloudflare deploy“, das genau diese Ausgabe erwartet.
// Ruft OpenNext selbst „npm run build“ auf (npm run cf:build), ist EK_SKIP_CF_POSTBUILD gesetzt → hier nichts tun.

import { spawnSync } from 'node:child_process';

if (process.env.EK_SKIP_CF_POSTBUILD === '1') process.exit(0);

const r = spawnSync('npx', ['opennextjs-cloudflare', 'build', '--skipNextBuild'], {
  stdio: 'inherit',
  env: { ...process.env, EK_SKIP_CF_POSTBUILD: '1' },
});
process.exit(r.status ?? 1);
