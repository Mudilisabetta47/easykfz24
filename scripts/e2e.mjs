// End-to-End-Tests gegen den GEBAUTEN Server mit isolierter Testdatenbank und Testgeheimnissen.
//   npm run build            (einmal vorher)
//   node scripts/e2e.mjs node     → Next-Standalone-Server (Node, SQLite, lokaler Dateispeicher)
//   node scripts/e2e.mjs worker   → Cloudflare-Laufzeit workerd (wrangler dev --local, D1 und R2 emuliert)
// Externe Dienste sind abgeschaltet (kein Stripe-, E-Mail- oder kfz-api.de-Schlüssel) – es werden keine echten
// Zahlungen, E-Mails oder Zulassungsanträge ausgelöst. Mollie nur gegen den lokalen Testnachbau (scripts/fake-mollie.mjs). Ergebnis zusätzlich als JUnit-XML in test-results/.

import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode = process.argv[2] === 'worker' ? 'worker' : 'node';
const port = mode === 'worker' ? 8899 : 3199;
const base = `http://127.0.0.1:${port}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), `ek-e2e-${mode}-`));
const secrets = {
  ADMIN_PASSWORD: `E2e-${randomBytes(12).toString('base64url')}-9!`,
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  KFZ_API_WEBHOOK_SECRET: randomBytes(24).toString('hex'),
  STRIPE_WEBHOOK_SECRET: `whsec_${randomBytes(24).toString('hex')}`,
};
// Alles Externe ausdrücklich leer – überschreibt eventuelle Werte aus .env-Dateien
const blank = { KENNZEICHEN_SEARCH_ENABLED: '', KENNZEICHEN_DAILY_BUDGET_CENT: '', STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', MAIL_FROM: '', SMTP_URL: '', KFZ_API_BASE_URL: '', KFZ_API_LOGIN: '', KFZ_API_PASSWORD: '', PLATE_AVAILABILITY_URL: '' };
// Online-Zahlung nur gegen den lokalen Mollie-Testnachbau (scripts/fake-mollie.mjs) – nie gegen Mollie selbst
const { createFakeMollie, FAKE_MOLLIE_KEYS } = await import('./fake-mollie.mjs');
const fakeMollie = createFakeMollie();
await new Promise((r) => fakeMollie.server.listen(0, '127.0.0.1', r));
const fakeMollieBase = `http://127.0.0.1:${fakeMollie.server.address().port}`;
const mollieEnv = { MOLLIE_API_BASE: `${fakeMollieBase}/v2`, MOLLIE_API_KEY: FAKE_MOLLIE_KEYS.test, ZAHLUNG_ONLINE: '1' };
// Wie im Produktivbetrieb: Widerrufsbelehrung erreichbar, Checkout freigegeben (Sicherheitsschalter, siehe src/server/checkout.ts)
const legalEnv = { WIDERRUF_AKTIV: '1', BESTELLUNG_AKTIV: '1', ZAHLUNG_PAUSE: '0' };

let server;
if (mode === 'node') {
  const dir = path.resolve('.next/standalone');
  if (!fs.existsSync(path.join(dir, 'server.js'))) throw new Error('Erst „npm run build“ ausführen');
  server = spawn(process.execPath, ['server.js'], {
    cwd: dir,
    env: { ...blank, ...secrets, ...mollieEnv, ...legalEnv, PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', DATA_DIR: tmp, PUBLIC_BASE_URL: base },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
} else {
  const envFile = path.join(tmp, 'e2e.env');
  fs.writeFileSync(envFile, Object.entries({ ...blank, ...secrets, ...mollieEnv, ...legalEnv, PUBLIC_BASE_URL: base }).map(([k, v]) => `${k}=${v}`).join('\n'));
  server = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', path.join(tmp, 'state'), '--env-file', envFile], {
    env: { ...process.env, ...blank },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
const log = fs.createWriteStream(path.join(tmp, 'server.log'));
server.stdout.pipe(log);
server.stderr.pipe(log);

const stop = () => {
  try {
    server.kill('SIGTERM');
  } catch {
    /* schon beendet */
  }
  fakeMollie.server.close();
};
process.on('exit', stop);
process.on('SIGINT', () => (stop(), process.exit(130)));

// Warten bis erreichbar
const t0 = Date.now();
for (;;) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) break;
  } catch {
    /* noch nicht da */
  }
  if (Date.now() - t0 > 120_000) {
    console.error('Server nicht erreichbar – Log:', path.join(tmp, 'server.log'));
    stop();
    process.exit(1);
  }
  await new Promise((r) => setTimeout(r, 500));
}
console.log(`E2E (${mode}) gegen ${base} – Daten in ${tmp}`);

fs.mkdirSync('test-results', { recursive: true });
const junit = `test-results/e2e-${mode}.xml`;
const run = spawn(
  process.execPath,
  [
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON',
    '--experimental-strip-types',
    '--test',
    '--test-concurrency=1',
    '--test-reporter=spec',
    '--test-reporter-destination=stdout',
    '--test-reporter=junit',
    `--test-reporter-destination=${junit}`,
    'tests-e2e/api.e2e.test.ts',
  ],
  {
    stdio: 'inherit',
    env: { ...process.env, E2E_BASE: base, E2E_MODE: mode, E2E_ADMIN_PASSWORD: secrets.ADMIN_PASSWORD, E2E_KFZ_SECRET: secrets.KFZ_API_WEBHOOK_SECRET, E2E_STRIPE_SECRET: secrets.STRIPE_WEBHOOK_SECRET, E2E_FAKE_MOLLIE: fakeMollieBase, E2E_SERVER_LOG: path.join(tmp, 'server.log') },
  },
);
run.on('exit', (code) => {
  stop();
  console.log(`JUnit-Bericht: ${junit} · Server-Log: ${path.join(tmp, 'server.log')}`);
  process.exit(code ?? 1);
});
