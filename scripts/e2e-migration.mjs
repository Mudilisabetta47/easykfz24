// Migrationstest D1/R2 in der Cloudflare-Laufzeit (lokal, workerd) – VOR jedem Deploy mit Schemaänderung ausführen.
// Der bisher ausgelieferte Stand erzeugt echte Daten (Bestellungen mit Unterlagen in R2, Stripe-Zahlung, kfz-Meldungen),
// danach wird auf den neuen Stand migriert und geprüft, dass alles erhalten und nutzbar ist. Nichts davon berührt
// die Produktion (nur --local, eigene Testgeheimnisse, keine externen Schlüssel).
//
// Vorbereitung (Produktionsstand <commit> in ein Arbeitsverzeichnis außerhalb des Repos):
//   W=$(mktemp -d); mkdir -p $W/prod $W/state
//   git archive <commit> | tar -x -C $W/prod && cp -Rc node_modules $W/prod/node_modules && (cd $W/prod && npm run build)
//   node -e "const c=require('crypto');require('fs').writeFileSync('$W/secrets.json',JSON.stringify({ADMIN_PASSWORD:'Mig-'+c.randomBytes(12).toString('base64url')+'-9!',SESSION_SECRET:c.randomBytes(32).toString('base64url'),KFZ_API_WEBHOOK_SECRET:c.randomBytes(24).toString('hex'),STRIPE_WEBHOOK_SECRET:'whsec_'+c.randomBytes(24).toString('hex')}))"
// Ablauf (aus dem Repo, nach „npm run build“):
//   node scripts/e2e-migration.mjs $W/prod $W/state seed        → alter Stand legt Daten an
//   cp -Rc $W/state $W/state-rt
//   node scripts/e2e-migration.mjs $W/prod $W/state sql         → Weg 1: Migrations-SQL vorab (empfohlen)
//   node scripts/e2e-migration.mjs $W/prod $W/state-rt runtime  → Weg 2: Migration beim ersten Aufruf im Worker
import { spawn, spawnSync } from 'node:child_process';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const [prodDir, stateDir, mode] = process.argv.slice(2);
const repo = process.cwd();
const secrets = JSON.parse(fs.readFileSync(path.join(stateDir, '..', 'secrets.json'), 'utf8'));
const blank = { STRIPE_SECRET_KEY: '', RESEND_API_KEY: '', MAIL_FROM: '', SMTP_URL: '', KFZ_API_BASE_URL: '', KFZ_API_LOGIN: '', KFZ_API_PASSWORD: '', PLATE_AVAILABILITY_URL: '' };
const log = (...a) => console.log('•', ...a);

// Nur in dieser lokalen Laufzeit: Checkout wie im Produktivbetrieb freigegeben (Sicherheitsschalter, src/server/checkout.ts)
const legalEnv = { WIDERRUF_AKTIV: '1', BESTELLUNG_AKTIV: '1', ZAHLUNG_PAUSE: '0' };

function startWorker(cwd, port, logName) {
  const envFile = path.join(stateDir, '..', `${logName}.env`);
  fs.writeFileSync(envFile, Object.entries({ ...blank, ...secrets, ...legalEnv, PUBLIC_BASE_URL: `http://127.0.0.1:${port}` }).map(([k, v]) => `${k}=${v}`).join('\n'));
  const p = spawn('npx', ['wrangler', 'dev', '--local', '--port', String(port), '--ip', '127.0.0.1', '--persist-to', stateDir, '--env-file', envFile], { cwd, env: { ...process.env, ...blank }, stdio: ['ignore', 'pipe', 'pipe'] });
  const out = fs.createWriteStream(path.join(stateDir, '..', `${logName}.log`));
  p.stdout.pipe(out);
  p.stderr.pipe(out);
  return p;
}
async function waitUp(base) {
  const t0 = Date.now();
  for (;;) {
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok) return r.json();
    } catch {}
    if (Date.now() - t0 > 120_000) throw new Error('Server nicht erreichbar: ' + base);
    await new Promise((r) => setTimeout(r, 500));
  }
}
const stop = (p) => new Promise((res) => (p.once('exit', res), p.kill('SIGTERM'), setTimeout(res, 5000)));
const d1 = (args) => {
  const r = spawnSync('npx', ['wrangler', 'd1', 'execute', 'easykfz24', '--local', '--persist-to', stateDir, ...args], { cwd: repo, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
};
const d1json = (sql) => {
  const out = d1(['--json', '--command', sql]);
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
};

const PDF = new TextEncoder().encode('%PDF-1.4\n%Migrationstest\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
function order(service, email, fin) {
  return {
    service,
    vehicle: { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin, bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin', eKennzeichen: false, hKennzeichen: false },
    holder: { typ: 'privat', vorname: 'Mia', nachname: 'Migration', geburtsdatum: '1990-01-01', firmenname: '', registernummer: '', ansprechpartner: '', strasse: 'Altweg', hausnummer: '3', plz: '28195', ort: 'Bremen', email, telefon: '0421 123456' },
    plate: { wahl: '', wunschkennzeichen: '', schilder: false, zustellung: 'abholung', versanddienst: '' },
    finish: { evb: '', kontoinhaber: '', iban: '', sepaMandat: false, vollmacht: true, datenschutz: true, vorzeitigerBeginn: true, widerrufErlischt: true, hinweise: '' },
    website: '',
  };
}

// ---------- Phase A: Produktionsstand erzeugt Daten ----------
if (mode === 'seed') {
  const base = 'http://127.0.0.1:8898';
  const p = startWorker(prodDir, 8898, 'prod');
  try {
    const h = await waitUp(base);
    log('Produktionsstand läuft', JSON.stringify(h));
    const numbers = [];
    for (let i = 0; i < 3; i++) {
      const f = new FormData();
      f.set('data', JSON.stringify(order('abmeldung', `mia${i}@example.de`, `WVWZZZ1KZAW00070${i}`)));
      f.append('doc_ausweis', new Blob([PDF], { type: 'application/pdf' }), 'ausweis.pdf');
      f.append('doc_zb1', new Blob([PDF], { type: 'application/pdf' }), 'zb1.pdf');
      const r = await fetch(`${base}/api/auftrag`, { method: 'POST', body: f, headers: { 'x-forwarded-for': `10.1.1.${i}` } });
      const j = await r.json();
      assert.equal(r.status, 200, JSON.stringify(j));
      numbers.push(j.number);
    }
    log('3 Bestellungen mit je 2 Unterlagen (R2) angelegt:', numbers.join(', '));
    // Zahlung (Stripe-Webhook, signiert) für Auftrag 1
    const payload = JSON.stringify({ id: 'evt_mig_1', type: 'checkout.session.completed', data: { object: { id: 'cs_test_mig_1', client_reference_id: numbers[0], payment_status: 'paid', amount_total: 2799 } } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${createHmac('sha256', secrets.STRIPE_WEBHOOK_SECRET).update(`${t}.${payload}`).digest('hex')}`;
    const pr = await fetch(`${base}/api/zahlung/webhook`, { method: 'POST', body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': sig } });
    log('Zahlung Auftrag 1:', pr.status);
    // kfz-api.de: Auftrag 2 beschieden, dazu eine nicht zuordenbare Meldung
    for (const [ev, body] of [
      ['mig-kfz-1', { order: { id: 8801, externalId: numbers[1] }, businessTransaction: 'AB', status: 'APPROVED' }],
      ['mig-kfz-2', { order: { id: 8802, externalId: 'EK-0000-77777' }, businessTransaction: 'AB', status: 'ACCEPTED' }],
    ]) {
      const raw = JSON.stringify(body);
      const r = await fetch(`${base}/api/webhooks/kfz-api`, { method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': createHmac('sha256', secrets.KFZ_API_WEBHOOK_SECRET).update(raw).digest('hex'), 'X-Event-Id': ev } });
      log(`kfz-Meldung ${ev}:`, r.status, await r.text());
    }
    fs.writeFileSync(path.join(stateDir, '..', 'numbers.json'), JSON.stringify(numbers));
  } finally {
    await stop(p);
  }
  log('Schema danach:', JSON.stringify(d1json('SELECT MAX(version) AS v FROM schema_migrations')));
  log('Daten:', JSON.stringify(d1json("SELECT (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM documents) AS docs, (SELECT COUNT(*) FROM events) AS events, (SELECT COUNT(*) FROM kfz_webhook_events) AS kfz")));
  process.exit(0);
}

// ---------- Phase B: Upgrade und Prüfung mit dem neuen Stand ----------
const numbers = JSON.parse(fs.readFileSync(path.join(stateDir, '..', 'numbers.json'), 'utf8'));
const before = d1json("SELECT (SELECT MAX(version) FROM schema_migrations) AS v, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM documents) AS docs, (SELECT COUNT(*) FROM events) AS events")[0];
log(`[${mode}] vorher:`, JSON.stringify(before));
if (mode === 'sql') {
  const sqlFile = path.join(stateDir, '..', 'migration.sql');
  const gen = spawnSync(process.execPath, ['--experimental-strip-types', '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/d1-migration-sql.mjs', String(before.v + 1)], { cwd: repo, encoding: 'utf8' });
  if (gen.status !== 0) throw new Error(gen.stderr);
  fs.writeFileSync(sqlFile, gen.stdout);
  const n = gen.stdout.split('\n').filter((l) => l.trim().endsWith(';')).length;
  log(`Migrations-SQL ab Version ${before.v + 1}: ${n} Anweisungen`);
  const t0 = Date.now();
  d1(['--file', sqlFile]);
  log(`SQL angewendet in ${Date.now() - t0} ms; Schema jetzt:`, JSON.stringify(d1json('SELECT MAX(version) AS v FROM schema_migrations')));
}

const base = 'http://127.0.0.1:8899';
const p = startWorker(repo, 8899, `neu-${mode}`);
let failures = 0;
const check = async (label, fn) => {
  try {
    await fn();
    log('✔', label);
  } catch (e) {
    failures++;
    log('✖', label, '–', e.message.split('\n')[0]);
  }
};
try {
  const h = await waitUp(base);
  await check(`Gesundheit nach Upgrade (${JSON.stringify(h.database ?? h)})`, async () => {
    const d = h.database ?? h;
    // vollständig migriert: tatsächliche Version = vom neuen Stand erwartete Version
    assert.equal(d.schema ?? d.schemaVersion, d.expected);
  });
  let cookie = '';
  const os = async (method, p2, body) => {
    const r = await fetch(`${base}/api/admin/os/${p2}`, { method, headers: { Origin: base, 'Content-Type': 'application/json', ...(cookie ? { Cookie: `ek_admin=${cookie}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const m = /^ek_admin=([^;]*)/.exec(c);
      if (m) cookie = m[1];
    }
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  };
  await check('Anmeldung Inhaber im neuen OS', async () => assert.equal((await os('POST', 'unlock', { username: '', password: secrets.ADMIN_PASSWORD })).status, 200));
  await check('Alle Altaufträge sichtbar, Zahlung und kfz-Stand erhalten', async () => {
    const r = await os('GET', 'orders?status=alle');
    assert.equal(r.status, 200, r.text);
    const byNum = Object.fromEntries(r.json.map((o) => [o.number, o]));
    for (const n of numbers) assert.ok(byNum[n], `fehlt ${n}`);
    assert.equal(byNum[numbers[0]].payment_status, 'bezahlt');
    assert.equal(byNum[numbers[1]].kfz_display, 'abgeschlossen');
  });
  await check('Kunden aus Altaufträgen angelegt (Backfill, begrenzt je Aufruf)', async () => {
    await os('GET', 'dashboard');
    const r = await os('GET', 'customers');
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.items.length >= 3, `nur ${r.json.items.length} Kunden`);
  });
  await check('Alt-Unterlagen aus R2 abrufbar (Dateischlüssel unverändert)', async () => {
    const list = await os('GET', 'orders?status=alle');
    const o = list.json.find((x) => x.number === numbers[2]);
    const files = await os('GET', `documents/files?order=${o.id}`);
    assert.equal(files.status, 200, files.text);
    assert.equal(files.json.length, 2);
    for (const f of files.json) {
      const r = await fetch(`${base}/api/admin/dokumente/${f.id}`, { headers: { Cookie: `ek_admin=${cookie}` } });
      const bytes = new Uint8Array(await r.arrayBuffer());
      assert.equal(r.status, 200);
      assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), '%PDF-');
    }
  });
  await check('KFZ-API-Center zeigt Altmeldungen inkl. nicht zugeordneter', async () => {
    const r = await os('GET', 'kfz');
    assert.equal(r.status, 200, r.text);
    assert.ok(JSON.stringify(r.json).includes('mig-kfz-2'));
  });
  await check('Benachrichtigungen aus der Historie übernommen (einmalig)', async () => {
    const a = await os('GET', 'notifications?limit=100');
    const b = await os('GET', 'notifications?limit=100');
    assert.equal(a.status, 200);
    assert.ok(a.json.items.length >= 3, `nur ${a.json.items.length}`);
    assert.equal(a.json.items.length, b.json.items.length, 'kein zweiter Backfill');
  });
  await check('Finanzcenter und Abgleich mit Altzahlungen', async () => {
    const f = await os('GET', 'finance');
    assert.equal(f.status, 200, f.text);
    const r = await os('GET', 'finance/reconciliation');
    assert.equal(r.status, 200, r.text);
  });
  await check('Neuer Auftrag nach Upgrade: Nummernkreis läuft weiter', async () => {
    const f = new FormData();
    f.set('data', JSON.stringify(order('abmeldung', 'nachher@example.de', 'WVWZZZ1KZAW000799')));
    f.append('doc_ausweis', new Blob([PDF], { type: 'application/pdf' }), 'a.pdf');
    f.append('doc_zb1', new Blob([PDF], { type: 'application/pdf' }), 'b.pdf');
    const r = await fetch(`${base}/api/auftrag`, { method: 'POST', body: f, headers: { 'x-forwarded-for': '10.2.2.2' } });
    const j = await r.json();
    assert.equal(r.status, 200, JSON.stringify(j));
    const seq = (n) => Number(n.split('-').pop());
    assert.equal(seq(j.number), Math.max(...numbers.map(seq)) + 1);
  });
  await check('Kundenstatusseite für Altauftrag', async () => {
    const r = await fetch(`${base}/status?nr=${encodeURIComponent(numbers[1])}`);
    assert.equal(r.status, 200);
  });
  await check('Diagnose: D1/R2-Bindung, Speicher schreiben/lesen/löschen', async () => {
    const r = await os('GET', 'system/diagnose');
    assert.equal(r.status, 200, r.text);
    assert.equal(r.json.storage.ok, true);
    assert.equal(r.json.database.schema, h.expected ?? h.database?.expected);
  });
} finally {
  await stop(p);
}
const after = d1json("SELECT (SELECT MAX(version) FROM schema_migrations) AS v, (SELECT COUNT(*) FROM orders) AS orders, (SELECT COUNT(*) FROM documents) AS docs, (SELECT COUNT(*) FROM customers) AS customers, (SELECT COUNT(*) FROM os_notifications) AS notes")[0];
log(`[${mode}] nachher:`, JSON.stringify(after));
log(failures ? `${failures} Prüfung(en) fehlgeschlagen` : 'Alle Prüfungen bestanden');
process.exit(failures ? 1 : 0);
