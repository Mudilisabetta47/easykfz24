// End-to-End-Tests der Verwaltungs-Schnittstelle (alle Endpunkte, siehe EXPECTED_ROUTES) gegen den gebauten Server.
// Start über: node scripts/e2e.mjs node|worker   (setzt E2E_* und startet einen isolierten Server)
//
// Je Endpunkt: ohne Anmeldung → 401, Rolle ohne Recht → 403, berechtigte Rolle → Erfolg, ungültige Eingaben → 4xx
// (nie 500). Dazu: vollständiger Auftragsablauf, Stripe-Webhook (Signatur, Wiederholung, Manipulation),
// Sicherheit (Rollen, 2FA, Sitzungen, Dokumentzugriff, CSRF, Sperre), Rechnungen (Rechnung, Pflichtangaben),
// Verknüpfungen und Automatisierungen. Keine externen Dienste: kein Stripe-, E-Mail- oder kfz-api.de-Schlüssel.

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import { after, describe, it } from 'node:test';
import { ROLE_PERMISSIONS } from '../src/lib/permissions.ts';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:3199';
const ADMIN_PW = process.env.E2E_ADMIN_PASSWORD ?? '';
const KFZ_SECRET = process.env.E2E_KFZ_SECRET ?? '';
const STRIPE_SECRET = process.env.E2E_STRIPE_SECRET ?? '';
const MODE = process.env.E2E_MODE ?? 'node';
/** Anzahl der Verwaltungs-Endpunkte (inkl. Entsperren) – bei neuen Endpunkten bewusst anpassen und Tests ergänzen */
const EXPECTED_ROUTES = 107;
if (!ADMIN_PW) throw new Error('Über scripts/e2e.mjs starten');

/* ---------- Abdeckung: alle Routen aus dem Quelltext ---------- */

interface RouteDef {
  key: string;
  method: string;
  path: string;
  perm: string | null;
  re: RegExp;
}
const ROUTES: RouteDef[] = [];
for (const f of fs.readdirSync('src/server/os/routes')) {
  const src = fs.readFileSync(`src/server/os/routes/${f}`, 'utf8');
  const re = /method: '(GET|POST)',\s*path: '([^']+)',\s*(?:perm: (\[[^\]]*\]|'[^']+'),)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    const pattern = m[2]
      .split('/')
      .map((p) => (p.startsWith(':') ? '[^/]+' : p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/');
    ROUTES.push({ key: `${m[1]} ${m[2]}`, method: m[1], path: m[2], perm: m[3] ?? null, re: new RegExp(`^${pattern}$`) });
  }
}
ROUTES.push({ key: 'POST unlock', method: 'POST', path: 'unlock', perm: null, re: /^unlock$/ });
// Feste Pfade vor Platzhaltern (wie im Router)
const ordered = [...ROUTES].sort((a, b) => (a.path.match(/:/g)?.length ?? 0) - (b.path.match(/:/g)?.length ?? 0));
/** Erfolg nur mit echtem externem Dienst möglich – im Test bewusst ohne Schlüssel (keine echten Aktionen). */
const NEEDS_EXTERNAL: Record<string, string> = {
  'POST finance/payments/:id/refresh': 'Stripe-API (Abruf der Zahlung)',
  'POST messages/send': 'E-Mail-Dienst (Resend/SMTP)',
  'POST orders/:id/vollmacht': 'kfz-api.de Vollmachtsvorgang (kostenpflichtig, nur mit VOLLMACHT_DIGITAL) – Ablauf im Testnachbau: tests/power-of-attorney.test.ts',
  'POST orders/:id/vollmacht/abgleich': 'kfz-api.de GET /powerOfAttorneys (nur mit vorhandenem Vorgang) – Ablauf im Testnachbau: tests/power-of-attorney.test.ts',
};
const hits: Record<string, Set<string>> = Object.fromEntries(ROUTES.map((r) => [r.key, new Set<string>()]));
const fivehundreds: string[] = [];

function routeOf(method: string, path: string): string | null {
  const p = path.replace(/^\/api\/admin\/os\//, '').split('?')[0];
  return ordered.find((r) => r.method === method && r.re.test(p))?.key ?? null;
}

/* ---------- HTTP-Client mit Sitzung ---------- */

interface Res {
  status: number;
  json: Record<string, unknown> & { [k: string]: unknown };
  text: string;
  headers: Headers;
  bytes: Uint8Array;
}

class Client {
  cookie = '';
  name: string;
  ip: string;
  constructor(name: string, ip: string) {
    this.name = name;
    this.ip = ip;
  }
  async req(method: 'GET' | 'POST', path: string, opts: { body?: unknown; form?: FormData; headers?: Record<string, string>; tag?: string; raw?: boolean } = {}): Promise<Res> {
    const url = path.startsWith('/') ? `${BASE}${path}` : `${BASE}/api/admin/os/${path}`;
    const headers: Record<string, string> = { Origin: BASE, 'cf-connecting-ip': this.ip, 'x-forwarded-for': this.ip, ...(this.cookie ? { Cookie: `ek_admin=${this.cookie}` } : {}) };
    if (opts.body !== undefined && !opts.form) headers['Content-Type'] = 'application/json';
    Object.assign(headers, opts.headers ?? {});
    const res = await fetch(url, { method, headers, body: opts.form ?? (opts.body !== undefined ? (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)) : undefined), redirect: 'manual' });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const m = /^ek_admin=([^;]*)/.exec(c);
      if (m) this.cookie = /Max-Age=0|Expires=Thu, 01 Jan 1970/i.test(c) ? '' : m[1];
    }
    const bytes = new Uint8Array(await res.arrayBuffer());
    const text = new TextDecoder().decode(bytes);
    let json = {} as Res['json'];
    try {
      json = JSON.parse(text);
    } catch {
      /* keine JSON-Antwort */
    }
    if (!path.startsWith('/')) {
      const key = routeOf(method, path);
      if (key && opts.tag) hits[key].add(opts.tag);
    }
    if (res.status >= 500) fivehundreds.push(`${this.name} ${method} ${path} → ${res.status} ${text.slice(0, 160)}`);
    return { status: res.status, json, text, headers: res.headers, bytes };
  }
  get(path: string, tag = 'ok') {
    return this.req('GET', path, { tag });
  }
  post(path: string, body: unknown = {}, tag = 'ok') {
    return this.req('POST', path, { body, tag });
  }
}

const sign = (raw: string, secret: string) => createHmac('sha256', secret).update(raw).digest('hex');
const stripeSig = (payload: string, t = Math.floor(Date.now() / 1000)) => `t=${t},v1=${createHmac('sha256', STRIPE_SECRET).update(`${t}.${payload}`).digest('hex')}`;

async function login(name: string, username: string, password: string, ip: string, code?: string): Promise<Client> {
  const c = new Client(name, ip);
  const r = await c.req('POST', 'unlock', { body: { username, password, ...(code ? { code } : {}) }, tag: 'ok' });
  assert.equal(r.status, 200, `Anmeldung ${name}: ${r.status} ${r.text.slice(0, 120)}`);
  assert.ok(c.cookie, `Sitzungs-Cookie für ${name}`);
  return c;
}

/** Erwartet einen Status, merkt sich die Kategorie für die Abdeckung. */
async function expect(c: Client, method: 'GET' | 'POST', path: string, status: number | number[], body?: unknown, tag?: string): Promise<Res> {
  const list = Array.isArray(status) ? status : [status];
  const t = tag ?? (list.includes(403) ? 'denied' : list.includes(401) ? 'unauth' : list.every((s) => s >= 400) ? 'invalid' : 'ok');
  const r = await c.req(method, path, { body: method === 'POST' ? (body ?? {}) : undefined, tag: t });
  assert.ok(list.includes(r.status), `${c.name} ${method} ${path}: erwartet ${list.join('/')} erhalten ${r.status} ${r.text.slice(0, 200)}`);
  return r;
}

/* ---------- TOTP für 2FA-Tests ---------- */

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
function b32(text: string): Buffer {
  let bits = 0;
  let v = 0;
  const out: number[] = [];
  for (const ch of text) {
    v = (v << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((v >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}
function totp(secret: string, offset = 0): string {
  const counter = Math.floor(Date.now() / 30_000) + offset;
  const msg = Buffer.alloc(8);
  msg.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  msg.writeUInt32BE(counter >>> 0, 4);
  const mac = createHmac('sha1', b32(secret)).update(msg).digest();
  const off = mac[mac.length - 1] & 15;
  return String((((mac[off] & 127) << 24) | (mac[off + 1] << 16) | (mac[off + 2] << 8) | mac[off + 3]) % 1_000_000).padStart(6, '0');
}

/* ---------- Testdaten ---------- */

const PDF = new TextEncoder().encode('%PDF-1.4\n%EasyKFZ24 E2E\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');
const PW = { vw: 'Verwaltung-E2e-2026!', sb: 'Sachbearb-E2e-2026!', bh: 'Buchhaltg-E2e-2026!', le: 'NurLesen-E2e-2026!' };

function orderData(over: { service?: string; email?: string; fin?: string; delivery?: 'versand' | 'abholung' } = {}) {
  const service = over.service ?? 'halterwechsel';
  return {
    service,
    vehicle: { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: over.fin ?? 'WVWZZZ1KZAW000101', bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin', eKennzeichen: false, hKennzeichen: false },
    holder: { typ: 'privat', vorname: 'Erika', nachname: 'Test', geburtsdatum: '1984-03-07', firmenname: '', registernummer: '', ansprechpartner: '', strasse: 'Testweg', hausnummer: '1', plz: '28195', ort: 'Bremen', email: over.email ?? 'erika.test@example.de', telefon: '0421 123456' },
    plate: service === 'abmeldung' ? { wahl: '', wunschkennzeichen: '', schilder: false, zustellung: over.delivery ?? 'abholung', versanddienst: over.delivery === 'versand' ? 'dhl' : '' } : { wahl: 'behalten', wunschkennzeichen: '', schilder: false, zustellung: over.delivery ?? 'abholung', versanddienst: over.delivery === 'versand' ? 'dhl' : '' },
    finish: service === 'abmeldung' ? { evb: '', kontoinhaber: '', iban: '', sepaMandat: false, vollmacht: true, datenschutz: true, hinweise: '' } : { evb: 'A1B2C3D', kontoinhaber: 'Erika Test', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true, hinweise: '<script>alert(1)</script>' },
    website: '',
  };
}

/* ---------- Gemeinsamer Zustand ---------- */

const anon = new Client('anonym', '10.0.0.1');
let owner: Client;
let vw: Client;
let sb: Client;
let bh: Client;
let le: Client;
const ids: Record<string, number> = {};
const strs: Record<string, string> = {};

after(() => {
  // Abdeckung ausgeben (für den Testbericht)
  const report = ROUTES.map((r) => ({ route: r.key, perm: r.perm, tested: [...hits[r.key]].sort() }));
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(`test-results/e2e-${MODE}-coverage.json`, JSON.stringify({ mode: MODE, routes: report, errors500: fivehundreds }, null, 2));
});

/* =====================================================================
   1. Einrichtung: Inhaber, Benutzer je Rolle, Testaufträge
   ===================================================================== */

describe('Einrichtung', () => {
  it('Inhaber meldet sich an (Entsperren-Endpunkt) und legt Benutzer je Rolle an', async () => {
    owner = await login('inhaber', '', ADMIN_PW, '10.0.1.1');
    for (const [u, role] of [
      ['e2e.vw', 'verwaltung'],
      ['e2e.sb', 'sachbearbeitung'],
      ['e2e.bh', 'buchhaltung'],
      ['e2e.le', 'lesen'],
    ] as const) {
      const key = u.slice(4) as keyof typeof PW;
      await expect(owner, 'POST', 'users', 200, { username: u, displayName: `E2E ${role}`, role, password: PW[key], email: `${u}@example.de` });
    }
    vw = await login('verwaltung', 'e2e.vw', PW.vw, '10.0.1.2');
    sb = await login('sachbearbeitung', 'e2e.sb', PW.sb, '10.0.1.3');
    bh = await login('buchhaltung', 'e2e.bh', PW.bh, '10.0.1.4');
    le = await login('lesen', 'e2e.le', PW.le, '10.0.1.5');
    const users = await expect(owner, 'GET', 'users', 200);
    ids.userSb = (users.json.users as { id: number; username: string }[]).find((x) => x.username === 'e2e.sb')!.id;
    ids.userLe = (users.json.users as { id: number; username: string }[]).find((x) => x.username === 'e2e.le')!.id;
  });

  it('Kunde bestellt über die Website (mit Unterlagen) – Auftrag, Kunde und Ereignis entstehen', async () => {
    const form = new FormData();
    form.set('data', JSON.stringify(orderData({ service: 'abmeldung', email: 'website.kunde@example.de', fin: 'WVWZZZ1KZAW000201' })));
    form.append('doc_ausweis', new Blob([PDF], { type: 'application/pdf' }), 'ausweis.pdf');
    form.append('doc_zb1', new Blob([PDF], { type: 'application/pdf' }), 'zb1.pdf');
    const r = await anon.req('POST', '/api/auftrag', { form, headers: { 'x-forwarded-for': '10.9.9.9' } });
    assert.equal(r.status, 200, r.text);
    strs.webNumber = String(r.json.number);
    await new Promise((x) => setTimeout(x, 400));
    const list = await expect(vw, 'GET', `orders?status=alle&q=${strs.webNumber}`, 200);
    const o = (list.json as unknown as { id: number; customer_id: number; stage: string }[])[0];
    ids.web = o.id;
    assert.ok(o.customer_id, 'Kunde zugeordnet');
    ids.webCustomer = o.customer_id;
  });

  it('Verwaltung legt Aufträge an (gleiche Prüfung wie Website) – ungültig ergibt 422 mit Feldern', async () => {
    const a = await expect(sb, 'POST', 'orders', 200, { data: orderData({ email: 'admin.kunde@example.de', fin: 'WVWZZZ1KZAW000301' }) });
    ids.a = Number(a.json.id);
    const b = await expect(sb, 'POST', 'orders', 200, { data: orderData({ email: 'versand.kunde@example.de', fin: 'WVWZZZ1KZAW000401', delivery: 'versand' }) });
    ids.b = Number(b.json.id);
    const c = await expect(sb, 'POST', 'orders', 200, { data: orderData({ email: 'kfz.kunde@example.de', fin: 'WVWZZZ1KZAW000601' }) });
    ids.c = Number(c.json.id);
    strs.cNumber = String(c.json.number);
    const bad = await expect(sb, 'POST', 'orders', 422, { data: { service: 'halterwechsel' } });
    assert.ok(Object.keys(bad.json.fields as object).length > 3, 'Feldfehler geliefert');
    await expect(sb, 'POST', 'orders', 422, { data: 'kaputt' });
    await expect(le, 'POST', 'orders', 403, { data: orderData() });
  });
});

/* =====================================================================
   2. Jeder Endpunkt ohne Anmeldung → 401; fremde Herkunft / falscher Typ
   ===================================================================== */

describe('Zugriffsschutz ohne Sitzung', () => {
  it('alle Endpunkte (außer Entsperren) verlangen eine Sitzung', async () => {
    for (const r of ROUTES) {
      if (r.key === 'POST unlock') continue;
      const p = r.path.replace(/:id/g, '1').replace(/:kind/g, 'contacts').replace(/:action/g, 'delete');
      const res = await anon.req(r.method as 'GET' | 'POST', p, { body: r.method === 'POST' ? {} : undefined, tag: 'unauth' });
      assert.equal(res.status, 401, `${r.key} ohne Sitzung → ${res.status}`);
      assert.equal(res.json.locked, true);
    }
  });

  it('manipuliertes Cookie → 401', async () => {
    const fake = new Client('fälscher', '10.0.2.1');
    fake.cookie = `${vw.cookie.slice(0, -4)}AAAA`;
    assert.equal((await fake.req('GET', 'session')).status, 401);
    fake.cookie = 'v2.0.x.1.9999999999.abcdefghijklmn.zzz';
    assert.equal((await fake.req('GET', 'session')).status, 401);
  });

  it('Schutz vor Cross-Site-Anfragen: fremde Herkunft 403, falscher Inhaltstyp 415, Sec-Fetch-Site 403', async () => {
    const evil = await vw.req('POST', 'settings', { body: { lockMinutes: 20 }, headers: { Origin: 'https://evil.example' } });
    assert.equal(evil.status, 403);
    const plain = await vw.req('POST', 'settings', { body: '{"lockMinutes":20}', headers: { 'Content-Type': 'text/plain' } });
    assert.equal(plain.status, 415);
    const cross = await vw.req('POST', 'settings', { body: { lockMinutes: 20 }, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(cross.status, 403);
  });
});

/* =====================================================================
   3. System, Sitzung, Benutzer, Einstellungen, Automatisierung
   ===================================================================== */

describe('System-Endpunkte', () => {
  it('Sitzung, Einstellungen pro Benutzer, Mitarbeiterliste, Suche, Kontrollzentrum', async () => {
    const s = await expect(le, 'GET', 'session', 200);
    assert.equal((s.json.user as { role: string }).role, 'lesen');
    assert.ok(!(s.json.permissions as string[]).includes('orders.write'));
    await expect(le, 'GET', 'prefs', 200);
    await expect(le, 'POST', 'prefs', 200, { notify: { toast: { auftrag_neu: false, unbekannt: true }, email: {}, browser: false }, desktop: { theme: 'dark' } });
    const p = await expect(le, 'GET', 'prefs', 200);
    assert.equal((p.json.notify as { toast: Record<string, boolean> }).toast.auftrag_neu, false);
    assert.equal((p.json.notify as { toast: Record<string, boolean> }).toast.unbekannt, undefined, 'unbekannte Arten werden verworfen');
    await expect(le, 'POST', 'prefs', 413, { desktop: { x: 'a'.repeat(70_000) } });
    await expect(le, 'GET', 'staff', 200);
    const q = await expect(le, 'GET', `search?q=${strs.webNumber}`, 200);
    assert.equal((q.json.orders as unknown[]).length, 1);
    assert.equal((q.json.documents as unknown[]).length, 0, 'ohne Dokumentrecht keine Dateitreffer');
    await expect(le, 'GET', 'search?q=a', 200, undefined, 'invalid');
    const d = await expect(le, 'GET', 'dashboard?range=7', 200);
    assert.equal(d.json.range, 7);
    await expect(le, 'GET', 'dashboard?range=abc', 200, undefined, 'invalid');
  });

  it('Benutzerverwaltung nur für Inhaber, mit Eingabeprüfung', async () => {
    await expect(vw, 'GET', 'users', 403);
    await expect(vw, 'POST', 'users', 403, { username: 'x.y', role: 'lesen', password: 'Abcdefghijk1!' });
    await expect(owner, 'POST', 'users', 422, { username: 'A', role: 'lesen', password: 'Abcdefghijk1!' });
    await expect(owner, 'POST', 'users', 422, { username: 'schwach.pw', role: 'lesen', password: 'kurz' });
    await expect(owner, 'POST', 'users', 422, { username: 'zweiter.inhaber', role: 'inhaber', password: 'Abcdefghijk1!' });
    await expect(owner, 'POST', 'users', 422, { username: 'e2e.vw', role: 'lesen', password: 'Abcdefghijk1!' });
    await expect(vw, 'POST', `users/${ids.userLe}`, 403, { role: 'buchhaltung' });
    await expect(owner, 'POST', 'users/abc', 400, { role: 'lesen' });
    await expect(owner, 'POST', 'users/99999', 422, { role: 'lesen' });
    await expect(owner, 'POST', `users/${ids.userLe}`, 422, { role: 'inhaber' });
    await expect(owner, 'POST', `users/${ids.userLe}`, 200, { email: 'neu.lesen@example.de' });
    await expect(owner, 'POST', `users/${ids.userLe}`, 422, { email: 'keine-mail' });
    await expect(owner, 'GET', 'audit', 200);
    await expect(sb, 'GET', 'audit', 403);
  });

  it('Systemeinstellungen, Unternehmen, Diagnose mit Rechteprüfung', async () => {
    const s = await expect(le, 'GET', 'settings', 200);
    assert.ok(!JSON.stringify(s.json).match(/whsec_|sk_|re_[A-Za-z0-9]{8}/), 'keine Geheimnisse in den Einstellungen');
    await expect(vw, 'POST', 'settings', 200, { lockMinutes: 20 });
    await expect(vw, 'POST', 'settings', 422, { lockMinutes: 1 });
    await expect(vw, 'POST', 'settings', 422, { lockMinutes: 'x' });
    await expect(sb, 'POST', 'settings', 403, { lockMinutes: 20 });
    await expect(bh, 'GET', 'company', 200);
    await expect(sb, 'GET', 'company', 403);
    await expect(bh, 'POST', 'company', 403, { name: 'X' });
    await expect(vw, 'POST', 'company', 422, { vatRate: 99 });
    await expect(vw, 'POST', 'company', 422, { taxMode: 'irgendwas' });
    const diag = await expect(vw, 'GET', 'system/diagnose', 200);
    assert.equal((diag.json.storage as { ok: boolean }).ok, true, 'Speicher schreiben/lesen/löschen');
    assert.equal((diag.json.database as { schema: number; expected: number }).schema, (diag.json.database as { expected: number }).expected);
    if (MODE === 'worker') assert.deepEqual(diag.json.cloudflare, { worker: true, d1Binding: true, r2Binding: true });
    await expect(sb, 'GET', 'system/diagnose', 403);
  });

  it('Automatisierungen: lesen, ändern, Zeitregeln, Rechteprüfung', async () => {
    const a = await expect(le, 'GET', 'automation', 200);
    assert.equal((a.json.rules as unknown[]).length, 12);
    await expect(le, 'GET', 'automation/runs', 200);
    await expect(sb, 'POST', 'automation/scan', 403);
    await expect(vw, 'POST', 'automation/scan', 200);
    await expect(vw, 'POST', 'automation/wiedervorlage', 200, { enabled: true, values: { tage: 5 } });
    await expect(vw, 'POST', 'automation/wiedervorlage', 422, { enabled: true, values: { tage: 999 } });
    await expect(vw, 'POST', 'automation/gibts-nicht', 422, { enabled: true });
    await expect(sb, 'POST', 'automation/wiedervorlage', 403, { enabled: false });
  });
});

/* =====================================================================
   4. Aufträge: Liste, Akte, Aktionen, Sammelaktionen, Export
   ===================================================================== */

describe('Auftrags-Endpunkte', () => {
  it('Liste mit Filtern, Akte, Vorlage, Export', async () => {
    const l = await expect(le, 'GET', 'orders?status=alle&service=halterwechsel&payment=offen', 200);
    assert.ok((l.json as unknown as unknown[]).length >= 2);
    await expect(le, 'GET', 'orders?status=alle&customer=abc', 400);
    await expect(le, 'GET', 'orders?status=gibtsnicht', 200, undefined, 'invalid');
    const d = await expect(le, 'GET', `orders/${ids.a}`, 200);
    assert.equal((d.json.order as { payment_token?: string }).payment_token, undefined, 'Zahlungstoken nie an die Oberfläche');
    assert.equal(d.json.canWrite, false);
    assert.ok((d.json.insights as { issues: { code: string }[] }).issues.some((i) => i.code === 'unterlagen'), 'fehlende Unterlagen erkannt');
    await expect(le, 'GET', 'orders/abc', 400);
    await expect(le, 'GET', 'orders/99999', 404);
    await expect(sb, 'GET', `orders/${ids.a}/template`, 200);
    await expect(le, 'GET', `orders/${ids.a}/template`, 403);
    await expect(sb, 'GET', 'orders/99999/template', 404);
    const x = await le.req('GET', 'orders/export?format=xlsx&status=alle', { tag: 'ok' });
    assert.equal(x.status, 200);
    assert.equal(String.fromCharCode(x.bytes[0], x.bytes[1]), 'PK');
    const csv = await le.req('GET', 'orders/export?format=csv&status=alle', { tag: 'ok' });
    assert.match(csv.headers.get('content-type') ?? '', /text\/csv/);
    assert.ok(!/;\s*=/.test(csv.text), 'keine ungeschützte Formel in der CSV');
  });

  it('Aktionen je Auftrag mit Rechten und Eingabeprüfung', async () => {
    const A = `orders/${ids.a}/action`;
    await expect(le, 'POST', A, 403, { type: 'status', to: 'in_pruefung' });
    await expect(sb, 'POST', A, 400, { type: 'gibtsnicht' });
    await expect(sb, 'POST', 'orders/99999/action', 404, { type: 'note', text: 'x' });
    await expect(sb, 'POST', A, 422, { type: 'status', to: 'xyz' });
    await expect(sb, 'POST', A, 422, { type: 'status', to: 'zugelassen' });
    await expect(sb, 'POST', A, 200, { type: 'status', to: 'in_pruefung' });
    await expect(sb, 'POST', A, 422, { type: 'checklist', key: 'gibtsnicht', checked: true });
    await expect(sb, 'POST', A, 422, { type: 'plate', plate: 'XXXX' });
    await expect(sb, 'POST', A, 200, { type: 'plate', plate: 'HB-EK 123' });
    await expect(sb, 'POST', A, 422, { type: 'note', text: '   ' });
    const n = await expect(sb, 'POST', A, 200, { type: 'note', text: '<img src=x onerror=alert(1)> interne Notiz' });
    assert.equal(n.json.ok, true);
    const notes = (await expect(sb, 'GET', `orders/${ids.a}`, 200)).json.notes as { id: number; text: string }[];
    assert.equal(notes[0].text, '<img src=x onerror=alert(1)> interne Notiz', 'als Text gespeichert (Ausgabe maskiert React)');
    ids.note = notes[0].id;
    await expect(sb, 'POST', A, 422, { type: 'noteDelete', noteId: 99999 });
    await expect(sb, 'POST', A, 200, { type: 'noteDelete', noteId: ids.note });
    await expect(sb, 'POST', A, 422, { type: 'shipment', carrier: 'dhl', tracking: '123456789' });
    await expect(sb, 'POST', `orders/${ids.b}/action`, 200, { type: 'shipment', carrier: 'dhl', tracking: 'JJD000390007882345' });
    await expect(sb, 'POST', `orders/${ids.b}/action`, 422, { type: 'shipment', carrier: 'post', tracking: 'x' });
    await expect(sb, 'POST', A, 403, { type: 'payment', status: 'bezahlt' });
    await expect(bh, 'POST', A, 422, { type: 'payment', status: 'irgendwas' });
    await expect(bh, 'POST', A, 422, { type: 'adjustPrice', percent: 200, reason: 'x' });
    await expect(bh, 'POST', A, 422, { type: 'adjustPrice', percent: 10, reason: '' });
    await expect(bh, 'POST', A, 422, { type: 'adjustPrice', voucher: 'GIBTSNICHT', reason: '' });
    await expect(sb, 'POST', A, 403, { type: 'adjustPrice', percent: 10, reason: 'x' });
    await expect(le, 'POST', A, 403, { type: 'kfzLink', kfzOrderId: '4711' });
    await expect(sb, 'POST', A, 422, { type: 'kfzLink', kfzOrderId: '../etc' });
    await expect(sb, 'POST', A, 200, { type: 'kfzLink', kfzOrderId: 'E2E-4711' });
    await expect(sb, 'POST', `orders/${ids.b}/action`, 422, { type: 'kfzLink', kfzOrderId: 'E2E-4711' });
    await expect(sb, 'POST', A, 422, { type: 'assign', assigneeId: 99999 });
    await expect(sb, 'POST', A, 200, { type: 'assign', assigneeId: ids.userSb });
    await expect(sb, 'POST', A, 422, { type: 'planning', priority: 'superwichtig' });
    await expect(sb, 'POST', A, 422, { type: 'planning', due_at: 'kein-datum' });
    await expect(sb, 'POST', A, 200, { type: 'planning', priority: 'hoch', due_at: new Date(Date.now() - 86_400_000).toISOString() });
    await expect(sb, 'POST', A, 422, { type: 'regCheck', key: 'drop table', value: true });
    await expect(sb, 'POST', A, 200, { type: 'regCheck', key: 'code_zb1', value: true });
    await expect(bh, 'POST', A, 403, { type: 'release' });
    const rel = await expect(sb, 'POST', A, 422, { type: 'release' });
    assert.match(String(rel.json.error), /Checkliste|Zahlung/);
    const hand = await expect(sb, 'POST', A, 422, { type: 'status', to: 'bei_zulassungsstelle' });
    assert.match(String(hand.json.error), /freigeben|Checkliste/);
  });

  it('Sammelaktionen', async () => {
    await expect(le, 'POST', 'orders/bulk', 403, { ids: [ids.a], action: { type: 'priority', priority: 'hoch' } });
    await expect(sb, 'POST', 'orders/bulk', 400, { ids: [], action: { type: 'priority', priority: 'hoch' } });
    await expect(sb, 'POST', 'orders/bulk', 400, { ids: ['x'], action: { type: 'priority' } });
    const r = await expect(sb, 'POST', 'orders/bulk', 200, { ids: [ids.a, ids.b], action: { type: 'priority', priority: 'dringend' } });
    assert.equal(r.json.done, 2);
    const s = await expect(sb, 'POST', 'orders/bulk', 200, { ids: [ids.b], action: { type: 'status', to: 'storniert' } });
    assert.equal((s.json.failed as unknown[]).length, 1, 'Stornieren nur einzeln');
  });
});

/* =====================================================================
   5. Kunden (CRM)
   ===================================================================== */

describe('Kunden-Endpunkte', () => {
  it('Liste, Akte, Export, Dubletten', async () => {
    const l = await expect(le, 'GET', 'customers', 200);
    assert.ok((l.json.items as unknown[]).length >= 3);
    await expect(bh, 'GET', 'customers?q=Test', 200);
    await expect(le, 'GET', `customers/${ids.webCustomer}`, 200);
    await expect(le, 'GET', 'customers/abc', 400);
    await expect(le, 'GET', 'customers/99999', 404);
    const csv = await le.req('GET', 'customers/export?format=csv', { tag: 'ok' });
    assert.equal(csv.status, 200);
    await expect(le, 'GET', 'customers/duplicates', 200);
  });

  it('Anlegen, Bearbeiten, Ansprechpartner, Standorte, Fahrzeuge, Zusammenführen', async () => {
    await expect(le, 'POST', 'customers', 403, { type: 'privat', first_name: 'A', last_name: 'B' });
    await expect(sb, 'POST', 'customers', 422, { type: 'privat', first_name: '', last_name: '' });
    await expect(sb, 'POST', 'customers', 422, { type: 'privat', first_name: 'A', last_name: 'B', email: 'keine' });
    await expect(sb, 'POST', 'customers', 422, { type: 'alien', first_name: 'A' });
    const c = await expect(sb, 'POST', 'customers', 200, { type: 'firma', company: 'E2E Autohaus GmbH', email: 'info@e2e-autohaus.example', phone: '0421 999000', zip: '28195', city: 'Bremen' });
    ids.firm = Number(c.json.id);
    const dup = await expect(sb, 'POST', 'customers', 200, { type: 'firma', company: 'E2E-Autohaus GmbH', phone: '0421-999000' });
    assert.ok((dup.json.duplicates as number[]).includes(ids.firm), 'Dublette sofort erkannt');
    ids.dup = Number(dup.json.id);
    await expect(sb, 'POST', `customers/${ids.firm}`, 200, { type: 'firma', company: 'E2E Autohaus GmbH', category: 'Autohaus', price_group: 'Händler' });
    await expect(sb, 'POST', `customers/${ids.firm}`, 422, { type: 'firma', company: '' });
    await expect(sb, 'POST', 'customers/99999', 422, { type: 'privat', first_name: 'A', last_name: 'B' });
    const loc = await expect(sb, 'POST', `customers/${ids.firm}/locations`, 200, { data: { label: 'Filiale Nord', city: 'Bremen' } });
    await expect(sb, 'POST', `customers/${ids.firm}/contacts`, 200, { data: { name: 'Fuhrparkleitung', location_id: loc.json.id } });
    await expect(sb, 'POST', `customers/${ids.firm}/contacts`, 422, { data: { name: '' } });
    await expect(sb, 'POST', `customers/${ids.firm}/vehicles`, 422, { data: { fin: 'ZU-KURZ' } });
    await expect(sb, 'POST', `customers/${ids.firm}/vehicles`, 200, { data: { fin: 'WVWZZZ1KZAW000501', make: 'VW', model: 'Caddy' } });
    await expect(sb, 'POST', `customers/${ids.firm}/vehicles`, 422, { data: { fin: 'WVWZZZ1KZAW000501' } });
    await expect(sb, 'POST', `customers/${ids.firm}/irgendwas`, 404, { data: {} });
    await expect(bh, 'POST', `customers/${ids.firm}`, 403, { type: 'firma', company: 'X' });
    await expect(le, 'POST', `customers/${ids.firm}/contacts`, 403, { data: { name: 'X' } });
    await expect(sb, 'POST', `customers/${ids.firm}/locations`, 200, { id: loc.json.id, delete: true });
    await expect(sb, 'POST', 'customers/merge', 422, { target: ids.firm, source: ids.firm });
    await expect(sb, 'POST', 'customers/merge', 400, { target: 'x', source: 1 });
    await expect(le, 'POST', 'customers/merge', 403, { target: ids.firm, source: ids.dup });
    await expect(sb, 'POST', 'customers/merge', 200, { target: ids.firm, source: ids.dup });
    await expect(sb, 'GET', `customers/${ids.dup}`, 404);
  });

  it('DSGVO: Auskunft, Löschprüfung, Anonymisierung mit Bestätigung und Aufbewahrungsschutz', async () => {
    const ex = await le.req('GET', `customers/${ids.webCustomer}/gdpr-export`, { tag: 'ok' });
    assert.equal(ex.status, 200);
    assert.match(ex.headers.get('content-disposition') ?? '', /attachment/);
    assert.ok(JSON.parse(ex.text).auftraege.length >= 1);
    await expect(sb, 'GET', `customers/${ids.webCustomer}/erasure`, 403);
    const er = await expect(vw, 'GET', `customers/${ids.webCustomer}/erasure`, 200);
    assert.ok((er.json.blockers as string[]).length > 0, 'laufender Auftrag blockiert');
    await expect(vw, 'POST', `customers/${ids.firm}/anonymize`, 400, { confirm: 'ja' });
    await expect(sb, 'POST', `customers/${ids.firm}/anonymize`, 403, { confirm: 'ANONYMISIEREN' });
    await expect(vw, 'POST', `customers/${ids.webCustomer}/anonymize`, 422, { confirm: 'ANONYMISIEREN' });
    await expect(vw, 'POST', `customers/${ids.firm}/anonymize`, 200, { confirm: 'ANONYMISIEREN' });
    const after = await expect(vw, 'GET', `customers/${ids.firm}`, 200);
    assert.equal((after.json.customer as { name: string }).name, 'Gelöschter Kunde');
    await expect(vw, 'POST', `customers/${ids.firm}`, 422, { type: 'firma', company: 'wieder da' });
  });
});

/* =====================================================================
   6. Dokumente (privater Speicher)
   ===================================================================== */

describe('Dokument-Endpunkte und geschützte Dateiauslieferung', () => {
  it('Upload mit Typprüfung, Versionen, Eigenschaften, Ordner', async () => {
    const up = (order: number, file: Blob, name: string, extra: Record<string, string> = {}, c: Client = sb) => {
      const f = new FormData();
      f.set('orderId', String(order));
      for (const [k, v] of Object.entries(extra)) f.set(k, v);
      f.append('file', file, name);
      return c.req('POST', 'documents/upload', { form: f, tag: 'ok' });
    };
    const r = await up(ids.a, new Blob([PDF], { type: 'application/pdf' }), 'zb2.pdf', { kind: 'zb2' });
    assert.equal(r.status, 200);
    const res = r.json.results as { ok: boolean; id: string }[];
    assert.equal(res[0].ok, true);
    strs.doc = res[0].id;
    const html = await up(ids.a, new Blob(['<script>alert(1)</script>'], { type: 'application/pdf' }), 'boese.pdf');
    assert.equal((html.json.results as { ok: boolean }[])[0].ok, false, 'Inhalt entscheidet, nicht Endung/MIME');
    const leDenied = await up(ids.a, new Blob([PDF], { type: 'application/pdf' }), 'x.pdf', {}, le);
    assert.equal(leDenied.status, 403);
    hits['POST documents/upload'].add('denied');
    const noFile = new FormData();
    noFile.set('orderId', String(ids.a));
    assert.equal((await sb.req('POST', 'documents/upload', { form: noFile, tag: 'invalid' })).status, 400);
    const noOrder = new FormData();
    noOrder.append('file', new Blob([PDF]), 'a.pdf');
    assert.equal((await sb.req('POST', 'documents/upload', { form: noOrder, tag: 'invalid' })).status, 400);
    const json = await sb.req('POST', 'documents/upload', { body: { orderId: ids.a }, tag: 'invalid' });
    assert.equal(json.status, 400);
    const v2 = await up(ids.a, new Blob([PDF], { type: 'application/pdf' }), 'zb2-neu.pdf', { replaces: strs.doc });
    strs.doc2 = (v2.json.results as { id: string }[])[0].id;
    const vers = await expect(sb, 'GET', `documents/${strs.doc2}/versions`, 200);
    assert.deepEqual((vers.json as unknown as { version: number }[]).map((x) => x.version), [2, 1]);
    await expect(sb, 'GET', 'documents/abc/versions', 400);
    await expect(sb, 'POST', `documents/${strs.doc2}`, 200, { display_name: 'ZB II (geprüft)', review_state: 'geprueft', expires_at: '2027-01-01T00:00:00Z' });
    await expect(sb, 'POST', `documents/${strs.doc2}`, 422, { review_state: 'erfunden' });
    await expect(sb, 'POST', `documents/${'0'.repeat(32)}`, 422, { display_name: 'x' });
    await expect(sb, 'POST', 'documents/folder', 200, { orderId: ids.a, path: 'Belege/2026' });
    await expect(sb, 'POST', 'documents/folder', 422, { orderId: ids.a, path: '../../' });
    await expect(sb, 'POST', 'documents/folder', 422, { orderId: 99999, path: 'Belege' });
    await expect(le, 'POST', 'documents/folder', 403, { orderId: ids.a, path: 'Belege' });
    await expect(le, 'POST', `documents/${strs.doc2}`, 403, { display_name: 'x' });
    await expect(le, 'GET', `documents/${strs.doc2}/versions`, 403);
  });

  it('Übersicht, Dateiliste, Protokolle mit Rechten', async () => {
    await expect(sb, 'GET', 'documents', 200);
    await expect(le, 'GET', 'documents', 403);
    await expect(bh, 'GET', 'documents', 403);
    const files = await expect(sb, 'GET', `documents/files?order=${ids.a}`, 200);
    assert.ok((files.json as unknown as unknown[]).length >= 1);
    await expect(sb, 'GET', 'documents/files?order=abc', 400);
    await expect(le, 'GET', `documents/files?order=${ids.a}`, 403);
    await expect(bh, 'GET', `documents/${strs.doc2}/log`, 403);
    await expect(vw, 'GET', 'documents/log', 200);
    await expect(sb, 'GET', 'documents/log', 403);
    await expect(sb, 'GET', `documents/${strs.doc2}/log`, 200);
  });

  it('Datei nur mit Recht, Abruf protokolliert, Papierkorb verborgen', async () => {
    const url = `/api/admin/dokumente/${strs.doc2}`;
    assert.equal((await anon.req('GET', url)).status, 401);
    assert.equal((await le.req('GET', url)).status, 403);
    assert.equal((await bh.req('GET', url)).status, 403);
    const ok = await sb.req('GET', url);
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'application/pdf');
    assert.match(ok.headers.get('content-security-policy') ?? '', /default-src 'none'/);
    assert.equal(ok.headers.get('cache-control'), 'private, no-store');
    const dl = await sb.req('GET', `${url}?download=1`);
    assert.match(dl.headers.get('content-disposition') ?? '', /^attachment/);
    assert.equal((await sb.req('GET', '/api/admin/dokumente/..%2F..%2Fetc')).status, 404);
    const log = await expect(sb, 'GET', `documents/${strs.doc2}/log`, 200);
    assert.ok((log.json as unknown as { action: string }[]).some((x) => x.action === 'dokument.heruntergeladen'));
    await expect(sb, 'POST', `documents/${strs.doc2}/delete`, 200);
    await expect(sb, 'POST', `documents/${strs.doc2}/archive`, 422);
    await expect(sb, 'POST', `documents/${strs.doc2}/purge`, 403);
    await expect(sb, 'POST', `documents/${strs.doc2}/zerstoeren`, 404);
    const trash = await expect(sb, 'GET', 'trash', 200);
    assert.ok((trash.json.documents as { id: string }[]).some((d) => d.id === strs.doc2));
    await expect(sb, 'POST', `documents/${strs.doc2}/restore`, 200);
    await expect(sb, 'POST', `documents/${strs.doc2}/archive`, 200);
    await expect(sb, 'POST', `documents/${strs.doc2}/unarchive`, 200);
    // Ältere Version einzeln in den Papierkorb und zurück – aktuelle Version bleibt unberührt
    await expect(sb, 'POST', `documents/${strs.doc}/delete`, 200);
    await expect(sb, 'POST', `documents/${strs.doc}/delete`, 422);
    await expect(sb, 'POST', `documents/${strs.doc}/restore`, 200);
    assert.equal((await sb.req('GET', url)).status, 200);
  });
});

/* =====================================================================
   7. KFZ-API: Webhook (Signatur, Wiederholung), Zuordnung, Center
   ===================================================================== */

describe('KFZ-API', () => {
  const hook = (body: unknown, eventId: string, secret = KFZ_SECRET) => {
    const raw = JSON.stringify(body);
    return anon.req('POST', '/api/webhooks/kfz-api', { body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(raw, secret), 'X-Event-Id': eventId } });
  };

  it('Webhook lehnt falsche Signatur ab, PING wird bestätigt, unbekannter Vorgang landet zur Zuordnung', async () => {
    assert.equal((await hook({ order: { id: 1 } }, 'e2e-falsch', 'falscher-schluessel')).status, 401);
    const ping = await hook({}, 'e2e-ping');
    assert.equal(ping.status, 200);
    assert.equal(ping.json.ping, true);
    const unk = await hook({ order: { id: 9001, externalId: 'EK-0000-99999' }, businessTransaction: 'AB', status: 'ACCEPTED' }, 'e2e-unbekannt');
    assert.equal(unk.json.matched, false);
  });

  it('Center, Abgleich, Statusverlauf, Tests, Zuordnung, Wiederholung', async () => {
    const k = await expect(le, 'GET', 'kfz', 200);
    assert.equal((k.json.submission as { enabled: boolean }).enabled, false, 'Übermittlung gesperrt');
    await expect(bh, 'GET', 'kfz', 403);
    await expect(le, 'GET', 'kfz/compare', 200);
    await expect(le, 'GET', `kfz/order/${ids.a}`, 200);
    await expect(le, 'GET', 'kfz/order/abc', 400);
    await expect(le, 'POST', 'kfz/check', 403);
    const chk = await expect(sb, 'POST', 'kfz/check', 200);
    assert.equal(chk.json.ok, false, 'ohne API-Zugang kein externer Aufruf');
    const self = await expect(sb, 'POST', 'kfz/selftest', 200);
    assert.equal(self.json.ok, true, `Selbsttest: ${JSON.stringify(self.json)}`);
    await expect(bh, 'GET', 'kfz/compare', 403);
    await expect(bh, 'GET', `kfz/order/${ids.a}`, 403);
    await expect(le, 'POST', 'kfz/selftest', 403);
    await expect(sb, 'POST', 'kfz/assign', 422, { eventId: 'gibts-nicht', number: strs.cNumber });
    await expect(sb, 'POST', 'kfz/assign', 422, { eventId: 'e2e-unbekannt', number: 'EK-0000-00000' });
    await expect(le, 'POST', 'kfz/assign', 403, { eventId: 'e2e-unbekannt', number: strs.cNumber });
    await expect(sb, 'POST', 'kfz/assign', 200, { eventId: 'e2e-unbekannt', number: strs.cNumber });
    await expect(sb, 'POST', 'kfz/assign', 422, { eventId: 'e2e-unbekannt', number: strs.cNumber });
    // Rückfrage der Behörde: Status folgt, Aufgabe „Unterlagen anfordern“ genau einmal, eine Benachrichtigung
    const rej = JSON.stringify({ order: { id: 9001, externalId: strs.cNumber }, businessTransaction: 'AB', status: 'REJECTED' });
    assert.equal((await anon.req('POST', '/api/webhooks/kfz-api', { body: rej, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(rej, KFZ_SECRET), 'X-Event-Id': 'e2e-rejected' } })).status, 200);
    await new Promise((r) => setTimeout(r, 600));
    const co = (await vw.get(`orders/${ids.c}`)).json.order as { status: string };
    assert.equal(co.status, 'unterlagen_fehlen', 'Status nach Rückfrage');
    const tasks = (await expect(vw, 'GET', 'tasks?scope=team', 200)).json.items as { order_id: number; title: string; status: string }[];
    assert.equal(tasks.filter((t) => t.order_id === ids.c && t.title.startsWith('Unterlagen anfordern')).length, 1, 'keine doppelte Aufgabe');
    const notes = (await vw.get('notifications?limit=200')).json.items as { kind: string; order_id: number }[];
    assert.equal(notes.filter((x) => x.order_id === ids.c && x.kind === 'behoerde_rueckfrage').length, 1);
    assert.equal(notes.filter((x) => x.order_id === ids.c && x.kind === 'unterlagen_fehlen').length, 0, 'keine Doppelmeldung');
    const c = await expect(le, 'GET', `kfz/order/${ids.c}`, 200);
    assert.ok((c.json as unknown as { event_id: string }[]).some((e) => e.event_id === 'e2e-unbekannt'), 'Meldung nach Zuordnung am Auftrag');
    await expect(sb, 'POST', 'kfz/retry', 422, { eventId: 'e2e-unbekannt' });
    await expect(sb, 'POST', 'kfz/retry', 422, { eventId: 'gibts-nicht' });
    await expect(le, 'POST', 'kfz/retry', 403, { eventId: 'x' });
    // Meldung zu einem noch unbekannten Vorgang → nach Verknüpfung erneut verarbeiten
    const raw = JSON.stringify({ order: { id: 9002 }, businessTransaction: 'AB', status: 'ACCEPTED' });
    const r = await anon.req('POST', '/api/webhooks/kfz-api', { body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(raw, KFZ_SECRET), 'X-Event-Id': 'e2e-retry' } });
    assert.equal(r.json.matched, false);
    const still = await expect(sb, 'POST', 'kfz/retry', 200, { eventId: 'e2e-retry' });
    assert.equal(still.json.matched, false, 'ohne Verknüpfung weiterhin offen');
    await expect(sb, 'POST', `orders/${ids.b}/action`, 200, { type: 'kfzLink', kfzOrderId: '9002' });
    const done = await expect(sb, 'POST', 'kfz/retry', 200, { eventId: 'e2e-retry' });
    assert.equal(done.json.matched, true);
    await expect(sb, 'POST', 'kfz/retry', 422, { eventId: 'e2e-retry' });
    await expect(sb, 'POST', 'kfz/contract', 200, { limits: '100 Anfragen/Minute (lt. Vertrag)', fees: 'AB 5,00 €' });
    await expect(le, 'POST', 'kfz/contract', 403, {});
  });
});

/* =====================================================================
   8. Vollständiger Ablauf: Bestellung → Zahlung → Prüfung → Zulassung → Abschluss
   ===================================================================== */

describe('Arbeitsablauf Website-Bestellung bis Abschluss', () => {
  const stripe = (type: string, session: Record<string, unknown>, opts: { t?: number; secret?: boolean } = {}) => {
    const payload = JSON.stringify({ id: `evt_${type}_${session.id}`, type, data: { object: session } });
    return anon.req('POST', '/api/zahlung/webhook', { body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': opts.secret === false ? 't=1,v1=00' : stripeSig(payload, opts.t) } });
  };

  it('Zahlung per Stripe-Webhook: Signatur, Replay-Schutz, doppelte Zustellung, Automatisierung', async () => {
    const session = { id: 'cs_test_e2e_1', client_reference_id: strs.webNumber, payment_status: 'paid', amount_total: 2799 };
    assert.equal((await stripe('checkout.session.completed', session, { secret: false })).status, 400, 'falsche Signatur');
    assert.equal((await stripe('checkout.session.completed', session, { t: Math.floor(Date.now() / 1000) - 3600 })).status, 400, 'alte Signatur (Replay)');
    assert.equal((await stripe('checkout.session.completed', session)).status, 200);
    assert.equal((await stripe('checkout.session.completed', session)).status, 200, 'Neuzustellung angenommen');
    await new Promise((r) => setTimeout(r, 800));
    const d = await expect(vw, 'GET', `orders/${ids.web}`, 200);
    const o = d.json.order as { payment_status: string; status: string };
    assert.equal(o.payment_status, 'bezahlt');
    assert.equal(o.status, 'in_pruefung', 'Automatisierung „Zahlung → In Prüfung“');
    const pays = (d.json.payments as { provider: string; status: string }[]).filter((p) => p.provider === 'stripe' && p.status === 'bezahlt');
    assert.equal(pays.length, 1, 'genau eine Buchung trotz doppelter Zustellung');
    const runs = await expect(vw, 'GET', 'automation/runs', 200);
    assert.equal((runs.json as unknown as { rule_id: string; order_id: number; result: string }[]).filter((r) => r.rule_id === 'zahlung_zur_pruefung' && r.order_id === ids.web && r.result === 'ausgeführt').length, 1);
  });

  it('Fremde Auftragsnummer und unbezahlte Session ändern nichts', async () => {
    assert.equal((await stripe('checkout.session.completed', { id: 'cs_test_e2e_x', client_reference_id: 'EK-0000-99999', payment_status: 'paid', amount_total: 1 })).status, 200);
    const aNumber = String(((await vw.get(`orders/${ids.a}`)).json.order as { number: string }).number);
    assert.equal((await stripe('checkout.session.completed', { id: 'cs_test_e2e_2', client_reference_id: aNumber, payment_status: 'unpaid', amount_total: 100 })).status, 200);
    const a = await expect(vw, 'GET', `orders/${ids.a}`, 200);
    assert.equal((a.json.order as { payment_status: string }).payment_status, 'offen');
  });

  it('Dokumentprüfung, Sicherheitscodes, Freigabe, Übergabe', async () => {
    const W = `orders/${ids.web}/action`;
    const d = await expect(sb, 'GET', `orders/${ids.web}`, 200);
    for (const item of (d.json.order as { checklistItems: { key: string }[] }).checklistItems) await expect(sb, 'POST', W, 200, { type: 'checklist', key: item.key, checked: true });
    const before = await expect(sb, 'POST', W, 422, { type: 'release' });
    assert.match(String(before.json.error), /Sicherheitscode|Plakett/, 'Codes vor Freigabe nötig');
    for (const code of (d.json.insights as { codes: string[] }).codes) await expect(sb, 'POST', W, 200, { type: 'regCheck', key: `code_${code}`, value: true });
    await expect(sb, 'POST', W, 200, { type: 'release' });
    await expect(sb, 'POST', W, 422, { type: 'release' }, 'invalid');
    await expect(sb, 'POST', W, 422, { type: 'regCheck', key: 'code_zb1', value: false });
    await expect(sb, 'POST', W, 200, { type: 'status', to: 'bei_zulassungsstelle' });
    const st = await expect(sb, 'GET', `orders?status=alle&q=${strs.webNumber}`, 200);
    assert.equal((st.json as unknown as { stage: string }[])[0].stage, 'beim_partner');
  });

  it('Meldungen von kfz-api.de: in Bearbeitung → abgeschlossen; doppelte Zustellung ohne Wirkung', async () => {
    const send = (status: string, ev: string) => {
      const raw = JSON.stringify({ order: { id: 7001, externalId: strs.webNumber }, businessTransaction: 'AB', status });
      return anon.req('POST', '/api/webhooks/kfz-api', { body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(raw, KFZ_SECRET), 'X-Event-Id': ev } });
    };
    assert.equal((await send('ACCEPTED', 'e2e-acc')).status, 200);
    const mid = await expect(vw, 'GET', `orders?status=alle&q=${strs.webNumber}`, 200);
    assert.equal((mid.json as unknown as { stage: string }[])[0].stage, 'in_bearbeitung');
    assert.equal((await send('APPROVED', 'e2e-app')).status, 200);
    const dupl = await send('APPROVED', 'e2e-app');
    assert.equal(dupl.json.duplicate, true);
    await new Promise((r) => setTimeout(r, 500));
    const n = await expect(vw, 'GET', 'notifications?limit=200', 200);
    const kfzNotes = (n.json.items as { kind: string; order_id: number; title: string }[]).filter((x) => x.order_id === ids.web && x.kind === 'kfz_status');
    assert.equal(kfzNotes.filter((x) => x.title.includes('beschieden')).length, 1, 'Benachrichtigung genau einmal');
  });

  it('Zulassung abgeschlossen → Nachricht als Entwurf, Abholung, Abschluss, Statusabfrage für Kunden', async () => {
    const W = `orders/${ids.web}/action`;
    // APPROVED von kfz-api.de setzt den Auftrag selbst auf „Zugelassen“ – ein zweites Setzen ist kein gültiger Übergang
    assert.equal(((await sb.get(`orders/${ids.web}`)).json.order as { status: string }).status, 'zugelassen');
    await expect(sb, 'POST', W, 422, { type: 'status', to: 'zugelassen' });
    const m = await expect(sb, 'GET', `messages?order=${ids.web}`, 200);
    const drafts = (m.json.messages as { state: string; source: string; id: number }[]).filter((x) => x.state === 'entwurf' && x.source === 'automatisierung');
    assert.equal(drafts.length, 1, 'Kundenmail vorbereitet, nicht versendet');
    ids.draft = drafts[0].id;
    await expect(sb, 'POST', W, 422, { type: 'status', to: 'versendet' });
    await expect(sb, 'POST', W, 200, { type: 'status', to: 'abgeholt' });
    await expect(sb, 'POST', W, 200, { type: 'status', to: 'abgeschlossen' });
    await expect(sb, 'POST', W, 422, { type: 'status', to: 'storniert' });
    const final = await expect(le, 'GET', `orders?status=alle&q=${strs.webNumber}`, 200);
    assert.equal((final.json as unknown as { stage: string }[])[0].stage, 'abgeschlossen');
  });
});

/* =====================================================================
   9. Finanzen, Rechnungen, Gutschriften (rechnerisch und Pflichtangaben)
   ===================================================================== */

describe('Finanzen und Rechnungen', () => {
  it('Lesen mit Rechten, Export, Gutscheine, Kosten, Gebühren', async () => {
    for (const p of ['finance', 'finance/contributions', 'finance/contributions?from=2020-01-01&to=2099-01-01', 'finance/invoices', 'finance/open-items', 'finance/reconciliation', 'finance/payments', 'finance/vouchers', 'finance/tax', 'finance/tax?year=2020']) {
      await expect(bh, 'GET', p, 200);
      await expect(sb, 'GET', p, 403);
    }
    for (const kind of ['deckungsbeitrag', 'invoices', 'payments']) {
      const x = await bh.req('GET', `finance/export?kind=${kind}&format=xlsx`, { tag: 'ok' });
      assert.equal(x.status, 200);
      assert.equal(String.fromCharCode(x.bytes[0], x.bytes[1]), 'PK');
    }
    await expect(sb, 'GET', 'finance/export?kind=payments&format=csv', 403);
    await expect(bh, 'POST', 'finance/vouchers', 200, { code: 'E2E-10', label: 'Test', kind: 'prozent', value: 10 });
    await expect(bh, 'POST', 'finance/vouchers', 422, { code: 'a', kind: 'prozent', value: 10 });
    await expect(bh, 'POST', 'finance/vouchers', 422, { code: 'E2E-200', kind: 'prozent', value: 200 });
    await expect(sb, 'POST', 'finance/vouchers', 403, { code: 'E2E-X', kind: 'betrag', value: 100 });
    await expect(bh, 'POST', 'finance/costs', 200, { costs: { abmeldung: 1200, halterwechsel: 2500 } });
    await expect(bh, 'POST', 'finance/costs', 422, { costs: { abmeldung: -1 } });
    await expect(sb, 'POST', 'finance/costs', 403, { costs: {} });
    const pays = await expect(bh, 'GET', 'finance/payments', 200);
    const stripePay = (pays.json as unknown as { id: number; provider: string }[]).find((p) => p.provider === 'stripe')!;
    await expect(bh, 'POST', `finance/payments/${stripePay.id}/fee`, 200, { feeCents: 64 });
    await expect(bh, 'POST', `finance/payments/${stripePay.id}/fee`, 422, { feeCents: -5 });
    await expect(bh, 'POST', 'finance/payments/99999/fee', 422, { feeCents: 1 });
    await expect(sb, 'POST', `finance/payments/${stripePay.id}/fee`, 403, { feeCents: 1 });
    await expect(sb, 'POST', `finance/payments/${stripePay.id}/refresh`, 403);
    const refresh = await expect(bh, 'POST', `finance/payments/${stripePay.id}/refresh`, 422);
    assert.match(String(refresh.json.error), /Stripe/, 'ohne Schlüssel kein Abruf bei Stripe');
    await expect(bh, 'POST', 'finance/payments/99999/refresh', 422);
  });

  it('Gutschein und Preisanpassung je Auftrag (nur offen, nachvollziehbar)', async () => {
    const before = Number(((await bh.get(`orders/${ids.a}`)).json.order as { total_cents: number }).total_cents);
    const r = await expect(bh, 'POST', `orders/${ids.a}/action`, 200, { type: 'adjustPrice', voucher: 'E2E-10', reason: '' });
    assert.ok(Number(r.json.newTotal) < before);
    await expect(bh, 'POST', `orders/${ids.web}/action`, 422, { type: 'adjustPrice', percent: 5, reason: 'nach Zahlung' });
  });

  it('Rechnung nur mit Firmendaten, rechnerisch korrekt, Pflichtangaben, keine Doppelrechnung, Gutschrift', async () => {
    const noCompany = await expect(bh, 'POST', 'finance/invoices', 422, { orderId: ids.web });
    assert.match(String(noCompany.json.error), /Unternehmensdaten/);
    await expect(vw, 'POST', 'company', 200, { name: 'E2E Zulassungsdienst UG (haftungsbeschränkt)', owner: 'Max Muster', street: 'Hauptstraße 1', zip: '28195', city: 'Bremen', taxNumber: '60/123/45678', vatId: 'DE123456789', taxMode: 'regel', vatRate: 19, iban: 'DE89370400440532013000', paymentTermDays: 14 });
    await expect(sb, 'POST', 'finance/invoices', 403, { orderId: ids.web });
    await expect(bh, 'POST', 'finance/invoices', 422, { orderId: 99999 });
    await expect(bh, 'POST', 'finance/invoices', 400, { orderId: 'x' });
    const inv = await expect(bh, 'POST', 'finance/invoices', 200, { orderId: ids.web });
    ids.inv = Number(inv.json.id);
    assert.match(String(inv.json.number), /^RE-\d{4}-\d{5}$/);
    await expect(bh, 'POST', 'finance/invoices', 422, { orderId: ids.web });
    const d = await expect(bh, 'GET', `finance/invoices/${ids.inv}`, 200);
    const I = d.json as unknown as { net_cents: number; vat_cents: number; gross_cents: number; issued_at: string; service_date: string; lines: { grossCents: number; netCents: number; vatCents: number; label: string }[]; seller: Record<string, unknown>; buyer: Record<string, string>; number: string };
    assert.equal(I.net_cents + I.vat_cents, I.gross_cents, 'netto + USt = brutto');
    assert.equal(I.lines.reduce((a, l) => a + l.grossCents, 0), I.gross_cents, 'Summe Positionen = Rechnungsbetrag');
    assert.equal(I.lines.reduce((a, l) => a + l.vatCents, 0), I.vat_cents, 'USt der Positionen = Gesamt-USt');
    for (const l of I.lines) assert.equal(l.netCents + l.vatCents, l.grossCents, `Position ${l.label}`);
    assert.equal(I.vat_cents, Math.round((I.gross_cents * 19) / 119), 'USt 19 % aus Brutto');
    assert.ok(!I.lines.some((l) => l.label.startsWith('Abgleich')), 'keine Ausgleichsposition');
    // § 14 Abs. 4 UStG: Name/Anschrift beider Seiten, Steuernummer/USt-IdNr., Datum, Nummer, Leistung, Leistungszeitpunkt, Entgelt, Steuersatz/-betrag
    assert.ok(I.seller.name && I.seller.street && I.seller.zip && I.seller.city);
    assert.ok(I.seller.taxNumber || I.seller.vatId);
    assert.ok(I.buyer.name && I.buyer.street && I.buyer.city);
    assert.ok(I.issued_at && I.service_date, 'Rechnungs- und Leistungsdatum');
    const page = await bh.req('GET', `/admin/rechnungen/${ids.inv}`);
    assert.equal(page.status, 200);
    const text = page.text.replace(/<!-- -->/g, '');
    for (const must of [I.number, 'E2E Zulassungsdienst UG', '60/123/45678', 'DE123456789', 'Rechnungsdatum', 'Leistungsdatum', 'Umsatzsteuer 19 %', 'Rechnungsbetrag', 'durchlaufende Posten', 'Bremen']) assert.ok(text.includes(must), `Pflichtangabe/Text fehlt: ${must}`);
    assert.equal((await le.req('GET', `/admin/rechnungen/${ids.inv}`)).status, 307, 'Rechnungsseite nur mit Finanzrecht');
    await expect(sb, 'GET', `finance/invoices/${ids.inv}`, 403);
    await expect(bh, 'GET', 'finance/invoices/99999', 404);
    await expect(bh, 'GET', 'finance/invoices/abc', 400);
    await expect(bh, 'POST', `finance/invoices/${ids.inv}/credit`, 422, { reason: '' });
    await expect(sb, 'POST', `finance/invoices/${ids.inv}/credit`, 403, { reason: 'x' });
    const cr = await expect(bh, 'POST', `finance/invoices/${ids.inv}/credit`, 200, { reason: 'E2E-Korrektur' });
    assert.match(String(cr.json.number), /^GS-\d{4}-\d{5}$/);
    await expect(bh, 'POST', `finance/invoices/${ids.inv}/credit`, 422, { reason: 'zweimal' });
    const c = (await bh.get(`finance/invoices/${cr.json.id}`)).json as unknown as { gross_cents: number; vat_cents: number; net_cents: number; ref_number: string };
    assert.equal(c.gross_cents, -I.gross_cents);
    assert.equal(c.vat_cents, -I.vat_cents);
    assert.equal(c.ref_number, I.number);
    const tax = await expect(bh, 'GET', 'finance/tax', 200);
    const m = (tax.json.months as { net: number; vat: number; gross: number; n: number }[]).reduce((a, x) => ({ net: a.net + x.net, vat: a.vat + x.vat, gross: a.gross + x.gross, n: a.n + x.n }), { net: 0, vat: 0, gross: 0, n: 0 });
    assert.deepEqual([m.net, m.vat, m.gross, m.n], [0, 0, 0, 2], 'Rechnung und Gutschrift heben sich auf');
  });

  it('Kleinunternehmer: keine USt, Hinweis nach § 19 UStG', async () => {
    await expect(vw, 'POST', 'company', 200, { name: 'E2E Klein', street: 'Weg 2', zip: '28195', city: 'Bremen', taxNumber: '60/000/00001', taxMode: 'kleinunternehmer', vatRate: 19 });
    const inv = await expect(bh, 'POST', 'finance/invoices', 200, { orderId: ids.web });
    const d = (await bh.get(`finance/invoices/${inv.json.id}`)).json as unknown as { vat_cents: number; net_cents: number; gross_cents: number };
    assert.equal(d.vat_cents, 0);
    assert.equal(d.net_cents, d.gross_cents);
    const page = (await bh.req('GET', `/admin/rechnungen/${inv.json.id}`)).text.replace(/<!-- -->/g, '');
    assert.ok(page.includes('§ 19 UStG'));
    assert.ok(!page.includes('Umsatzsteuer 19 %'));
  });

  it('Zahlungsabgleich erkennt Abweichungen und abgebrochene/fehlgeschlagene Zahlungen', async () => {
    const num = String(((await bh.get(`orders/${ids.b}`)).json.order as { number: string }).number);
    const send = (type: string, session: Record<string, unknown>) => {
      const payload = JSON.stringify({ id: `evt_${session.id}_${type}`, type, data: { object: session } });
      return anon.req('POST', '/api/zahlung/webhook', { body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSig(payload) } });
    };
    await send('checkout.session.expired', { id: 'cs_test_e2e_exp', client_reference_id: num, payment_status: 'unpaid' });
    await send('checkout.session.async_payment_failed', { id: 'cs_test_e2e_fail', client_reference_id: num, payment_status: 'unpaid' });
    await send('checkout.session.async_payment_failed', { id: 'cs_test_e2e_fail', client_reference_id: num, payment_status: 'unpaid' });
    await send('checkout.session.completed', { id: 'cs_test_e2e_wenig', client_reference_id: num, payment_status: 'paid', amount_total: 100 });
    await new Promise((r) => setTimeout(r, 600));
    const rec = await expect(bh, 'GET', 'finance/reconciliation', 200);
    const R = rec.json as unknown as { amountMismatch: { number: string }[]; abandoned: { number: string }[]; failed: { number: string }[] };
    assert.ok(R.amountMismatch.some((x) => x.number === num), 'Betrag von Stripe ≠ Auftragsbetrag wird gemeldet');
    const bd = await expect(bh, 'GET', `orders/${ids.b}`, 200);
    assert.ok((bd.json.insights as { releaseBlockers: string[] }).releaseBlockers.some((x) => x.includes('Gezahlter Betrag')), 'Unterzahlung blockiert die Freigabe');
    const n = await expect(bh, 'GET', 'notifications?limit=200', 200);
    assert.equal((n.json.items as { kind: string; order_id: number }[]).filter((x) => x.kind === 'zahlung_fehler' && x.order_id === ids.b).length, 1, 'Fehlschlag nur einmal gemeldet');
  });
});

describe('Kennzeichenschilder Standard und Carbon-Optik', () => {
  type Plat = { sellCents: number | null; buyCents: number; active: boolean };
  const plateOrder = (email: string, fin: string, finish: string, art = 'pkw') => {
    const d = orderData({ email, fin });
    return { data: { ...d, vehicle: { ...d.vehicle, art }, plate: { wahl: 'neu', wunschkennzeichen: '', schilder: true, ausfuehrung: finish, zustellung: 'abholung', versanddienst: '' } } };
  };
  const body = (carbon: Plat, shipping: number | null = null, checks = { deliverable: true, permitted: true }) => ({
    prices: { standard: { sellCents: 1299, buyCents: 405, active: true }, carbon },
    supplierShippingCents: shipping,
    carbonChecks: checks,
  });
  type PlateLine = { key: string; cents: number; label: string; finish: string; qty: number; unitCents: number };
  type Snap = { finish: string; qty: number; unitBuyCents: number; buyCents: number; supplierShippingCents: number | null; priceVersion: number };
  const detail = async (c: Client, id: unknown) => (await expect(c, 'GET', `orders/${id}`, 200)).json.order as { data: { plate: { ausfuehrung: string } }; price: { lines: PlateLine[]; cost?: { plates?: Snap } } };
  const created: Record<string, number> = {};

  it('Preise je Ausführung: Ausgangswerte, Rechte, Prüfung, Freigabe nur mit Bestätigungen', async () => {
    const g = await expect(bh, 'GET', 'finance/plates', 200);
    const cur = g.json.current as { version: number; prices: { standard: Plat; carbon: Plat }; supplierShippingCents: number | null };
    assert.deepEqual([cur.version, cur.prices.standard.sellCents, cur.prices.standard.buyCents, cur.prices.carbon.active, cur.prices.carbon.buyCents, cur.supplierShippingCents], [0, 1299, 405, false, 530, null]);
    await expect(sb, 'GET', 'finance/plates', 403);
    const rej = await expect(sb, 'POST', 'orders', 422, plateOrder('carbon.vorher@example.de', 'WVWZZZ1KZAW000711', 'carbon'));
    assert.match(String((rej.json.fields as Record<string, string>)['plate.ausfuehrung']), /nicht verfügbar/);
    await expect(bh, 'POST', 'finance/plates', 422, body({ sellCents: null, buyCents: 530, active: true }));
    await expect(bh, 'POST', 'finance/plates', 422, body({ sellCents: -1, buyCents: 530, active: true }));
    const noCheck = await expect(bh, 'POST', 'finance/plates', 422, body({ sellCents: 1499, buyCents: 530, active: true }, null, { deliverable: true, permitted: false }));
    assert.match(String(noCheck.json.error), /Lieferbarkeit.*Zulässigkeit/);
    await expect(sb, 'POST', 'finance/plates', 403, body({ sellCents: 1499, buyCents: 530, active: true }));
    const v1 = await expect(bh, 'POST', 'finance/plates', 200, body({ sellCents: 1499, buyCents: 530, active: true }));
    assert.equal((v1.json.version as { version: number }).version, 1);
    const st = await expect(le, 'GET', 'settings', 200);
    assert.deepEqual(st.json.plateOffer, { standard: 1299, carbon: 1499 }, 'Verkaufspreise für alle, Einkauf nicht');
  });

  it('Website zeigt beide Ausführungen mit den gepflegten Preisen', async () => {
    const pr = (await anon.req('GET', '/kfz-anmelden')).text.replace(/<!-- -->/g, '');
    assert.ok(pr.includes('Carbon-Optik') && pr.includes('14,99'), 'Preistabelle mit Carbon-Optik');
    assert.ok((await anon.req('GET', '/')).text.replace(/<!-- -->/g, '').includes('Carbon-Optik je'), 'Startseite');
    assert.ok((await anon.req('GET', '/kennzeichen/hb')).text.replace(/<!-- -->/g, '').includes('Carbon-Optik (Premium)'), 'Ortsseite');
  });

  it('Standard und Carbon mit je einem (Motorrad) und zwei Schildern (Pkw): Preis, Kosten-Momentaufnahme, Akte, Liste', async () => {
    const cases = [
      ['std2', 'standard', 'pkw', 2, 1299, 405],
      ['std1', 'standard', 'motorrad', 1, 1299, 405],
      ['cb2', 'carbon', 'pkw', 2, 1499, 530],
      ['cb1', 'carbon', 'motorrad', 1, 1499, 530],
    ] as const;
    let n = 0;
    for (const [key, finish, art, qty, sell, buy] of cases) {
      const c = await expect(sb, 'POST', 'orders', 200, plateOrder(`${key}@example.de`, `WVWZZZ1KZAW000${750 + n++}`, finish, art));
      created[key] = Number(c.json.id);
      const o = await detail(bh, c.json.id);
      assert.equal(o.data.plate.ausfuehrung, finish);
      const line = o.price.lines.find((l) => l.key === 'schilder')!;
      assert.deepEqual([line.finish, line.qty, line.unitCents, line.cents], [finish, qty, sell, qty * sell], key);
      assert.match(line.label, new RegExp(`${finish === 'carbon' ? 'Carbon-Optik' : 'Standard'} \\(${qty} Stück\\)`));
      assert.deepEqual(o.price.cost?.plates, { finish, qty, unitBuyCents: buy, buyCents: qty * buy, supplierShippingCents: null, priceVersion: 1, priceFrom: (o.price.cost?.plates as Snap & { priceFrom: string }).priceFrom }, `${key}: Kosten gespeichert`);
      assert.equal((await detail(sb, c.json.id)).price.cost, undefined, 'ohne Finanzrecht keine Einkaufspreise');
    }
    const list = (await expect(sb, 'GET', 'orders?status=alle', 200)).json as unknown as { id: number; plate_signs: string }[];
    assert.deepEqual(['std2', 'std1', 'cb2', 'cb1'].map((k) => list.find((x) => x.id === created[k])?.plate_signs), ['standard', 'standard', 'carbon', 'carbon']);
  });

  it('Rechnung übernimmt die Ausführung unverändert', async () => {
    const inv = await expect(bh, 'POST', 'finance/invoices', 200, { orderId: created.cb2 });
    const d = (await bh.get(`finance/invoices/${inv.json.id}`)).json as unknown as { lines: { label: string; grossCents: number }[] };
    const l = d.lines.find((x) => x.label.startsWith('Kennzeichenschilder'))!;
    assert.equal(l.label, 'Kennzeichenschilder Carbon-Optik (2 Stück)');
    assert.equal(l.grossCents, 2998);
  });

  it('Wirtschaftlichkeit: ohne Lieferanten-Versand kein Deckungsbeitrag; mit Versand korrekt; Preisänderung lässt alte Aufträge unverändert', async () => {
    const c0 = (await expect(bh, 'GET', 'finance/contributions', 200)).json as unknown as { orderId: number; plateBuyCents: number; plateShippingCents: number | null; contributionCents: number | null; platePriceVersion: number }[];
    const cb2 = c0.find((x) => x.orderId === created.cb2)!;
    assert.deepEqual([cb2.plateBuyCents, cb2.plateShippingCents, cb2.contributionCents, cb2.platePriceVersion], [1060, null, null, 1], 'Versand unbekannt → kein DB');
    // Neue Preisversion: Einkauf Carbon teurer, Versand des Lieferanten gepflegt
    const v2 = await expect(bh, 'POST', 'finance/plates', 200, body({ sellCents: 1599, buyCents: 560, active: true }, 390));
    assert.equal((v2.json.version as { version: number }).version, 2);
    const after = await detail(bh, created.cb2);
    assert.deepEqual([after.price.cost?.plates?.buyCents, after.price.cost?.plates?.priceVersion, after.price.lines.find((l) => l.key === 'schilder')?.cents], [1060, 1, 2998], 'historischer Auftrag unverändert');
    const n = await expect(sb, 'POST', 'orders', 200, plateOrder('cb-neu@example.de', 'WVWZZZ1KZAW000790', 'carbon'));
    const no = await detail(bh, n.json.id);
    assert.deepEqual([no.price.lines.find((l) => l.key === 'schilder')?.cents, no.price.cost?.plates?.buyCents, no.price.cost?.plates?.supplierShippingCents, no.price.cost?.plates?.priceVersion], [3198, 1120, 390, 2]);
    const c1 = (await expect(bh, 'GET', 'finance/contributions', 200)).json as unknown as { orderId: number; netCents: number; costCents: number | null; feeCents: number | null; plateCostCents: number; contributionCents: number | null }[];
    const row = c1.find((x) => x.orderId === Number(n.json.id))!;
    assert.equal(row.plateCostCents, 1120 + 390);
    if (row.costCents !== null && row.feeCents !== null) assert.equal(row.contributionCents, row.netCents - row.costCents - row.plateCostCents - row.feeCents, 'Netto − Vorgangskosten − Schilder − Gebühr');
    const r = await expect(bh, 'GET', 'finance/plates', 200);
    const rows = (r.json.report as { rows: { finish: string; orders: number; plates: number; buyCents: number; shippingCents: number; completeOrders: number; completeNetCents: number; contributionCents: number; feeCents: number }[] }).rows;
    const cb = rows.find((x) => x.finish === 'carbon')!;
    assert.deepEqual([cb.orders, cb.plates, cb.buyCents, cb.shippingCents, cb.completeOrders], [3, 5, 1060 + 530 + 1120, 390, 1], 'Carbon: 2+1+2 Schilder, nur der neue Auftrag vollständig');
    assert.equal(cb.contributionCents, cb.completeNetCents - 1120 - 390 - 0, 'unbezahlt: Gebühr 0');
    const sd = rows.find((x) => x.finish === 'standard')!;
    assert.ok(sd.plates >= 3 && sd.buyCents === sd.plates * 405);
  });

  it('Carbon wieder aus dem Angebot: neue Carbon-Bestellungen abgelehnt, Website ohne Carbon', async () => {
    await expect(bh, 'POST', 'finance/plates', 200, body({ sellCents: 1599, buyCents: 560, active: false }, 390, { deliverable: true, permitted: true }));
    await expect(sb, 'POST', 'orders', 422, plateOrder('carbon.danach@example.de', 'WVWZZZ1KZAW000741', 'carbon'));
    assert.ok(!(await anon.req('GET', '/kfz-anmelden')).text.includes('Carbon-Optik, Premium'));
    assert.equal(((await expect(bh, 'GET', 'finance/plates', 200)).json.history as unknown[]).length, 3, 'Preisverlauf');
  });
});

describe('Express-Bearbeitung', () => {
  const xBody = (exActive: boolean, plusActive: boolean, plus = ['Feste persönliche Ansprechperson für Ihren Auftrag']) => ({
    levels: {
      express: { sellCents: 1990, active: exActive, internalCostCents: 300, internalHours: 24 },
      express_plus: { sellCents: 2990, active: plusActive, internalCostCents: 500, internalHours: 12 },
    },
    plusServices: plus,
  });
  const web = async (email: string, fin: string, bearbeitung: string) => {
    const form = new FormData();
    form.set('data', JSON.stringify({ ...orderData({ service: 'abmeldung', email, fin }), bearbeitung }));
    form.append('doc_ausweis', new Blob([PDF], { type: 'application/pdf' }), 'ausweis.pdf');
    form.append('doc_zb1', new Blob([PDF], { type: 'application/pdf' }), 'zb1.pdf');
    return anon.req('POST', '/api/auftrag', { form, headers: { 'x-forwarded-for': `10.9.${Math.floor(Math.random() * 200)}.${Math.floor(Math.random() * 200)}` } });
  };
  const idOf = async (number: string) => ((await vw.get(`orders?status=alle&q=${number}`)).json as unknown as { id: number }[])[0].id;
  type M = { key: string; label: string; at: string | null; note?: string };
  const bundle = async (id: number) => (await expect(bh, 'GET', `orders/${id}`, 200)).json as { processing: string; milestones: M[]; order: { priority: string; due_at: string; status: string; total_cents: number; price: { lines: { key: string; cents: number; label: string }[]; cost?: { express?: unknown } } } };
  const x: Record<string, { id: number; number: string }> = {};

  it('Einstellungen: Ausgangswerte nicht im Angebot, Rechte, Prüfung, Freigabe', async () => {
    const g = await expect(bh, 'GET', 'finance/express', 200);
    const cur = g.json.current as { version: number; levels: { express: { active: boolean; sellCents: number } } };
    assert.deepEqual([cur.version, cur.levels.express.active, cur.levels.express.sellCents], [0, false, 1990]);
    await expect(sb, 'GET', 'finance/express', 403);
    const before = await web('x.vorher@example.de', 'WVWZZZ1KZAW000801', 'express');
    assert.equal(before.status, 422);
    assert.match(String((before.json.errors as Record<string, string>).bearbeitung), /nicht verfügbar/);
    await expect(bh, 'POST', 'finance/express', 422, { ...xBody(true, false), levels: { ...xBody(true, false).levels, express: { sellCents: null, active: true, internalCostCents: 0, internalHours: 24 } } });
    await expect(bh, 'POST', 'finance/express', 422, xBody(false, true, []));
    await expect(bh, 'POST', 'finance/express', 422, { ...xBody(true, false), levels: { ...xBody(true, false).levels, express: { sellCents: 1990, active: true, internalCostCents: 0, internalHours: 0 } } });
    await expect(sb, 'POST', 'finance/express', 403, xBody(true, true));
    const ok = await expect(bh, 'POST', 'finance/express', 200, xBody(true, true));
    assert.equal((ok.json.version as { version: number }).version, 1);
    const st = await expect(le, 'GET', 'settings', 200);
    assert.deepEqual(st.json.expressOffer, { express: 1990, express_plus: 2990, plusServices: ['Feste persönliche Ansprechperson für Ihren Auftrag'] });
  });

  it('Startseite: Express mit Sternchen und Einschränkung direkt daneben, ohne Fristzusage', async () => {
    const home = (await anon.req('GET', '/')).text.replace(/<!-- -->/g, '');
    assert.ok(home.includes('Bevorzugte Bearbeitung*'));
    assert.ok(home.includes('+ 19,90'));
    assert.ok(home.includes('Keine Fristzusage'));
    assert.doesNotMatch(home, /24 Stunden|24h|garantiert/i);
  });

  it('Bestellung Express Plus: Aufpreis, Kosten-Momentaufnahme, Warteschlange, Priorisierung nach Zahlung', async () => {
    const r = await web('x.plus@example.de', 'WVWZZZ1KZAW000811', 'express_plus');
    assert.equal(r.status, 200, r.text);
    x.plus = { number: String(r.json.number), id: await idOf(String(r.json.number)) };
    const s = await web('x.std@example.de', 'WVWZZZ1KZAW000812', 'standard');
    x.std = { number: String(s.json.number), id: await idOf(String(s.json.number)) };
    const b = await bundle(x.plus.id);
    assert.equal(b.processing, 'express_plus');
    const line = b.order.price.lines.find((l) => l.key === 'express')!;
    assert.deepEqual([line.cents, line.label], [2990, 'Express Plus-Bearbeitung (bevorzugt)']);
    assert.deepEqual(b.order.price.cost?.express, { level: 'express_plus', internalCostCents: 500, internalHours: 12, version: 1 });
    assert.equal((await bundle(x.std.id)).order.price.lines.some((l) => l.key === 'express'), false);
    const queue = (await expect(sb, 'GET', 'orders?status=laufend&express=1', 200)).json as unknown as { id: number; processing: string; paid_at: string | null }[];
    assert.ok(queue.some((q) => q.id === x.plus.id && q.processing === 'express_plus' && q.paid_at === null));
    assert.ok(!queue.some((q) => q.id === x.std.id), 'Standard nicht in der Express-Warteschlange');
    // Zahlung per signiertem Stripe-Webhook → Automatisierung priorisiert
    const payload = JSON.stringify({ id: 'evt_x_plus', type: 'checkout.session.completed', data: { object: { id: 'cs_test_x_plus', client_reference_id: x.plus.number, payment_status: 'paid', amount_total: b.order.total_cents } } });
    assert.equal((await anon.req('POST', '/api/zahlung/webhook', { body: payload, headers: { 'Content-Type': 'application/json', 'Stripe-Signature': stripeSig(payload) } })).status, 200);
    await new Promise((res) => setTimeout(res, 800));
    const a = await bundle(x.plus.id);
    assert.equal(a.order.priority, 'dringend');
    assert.equal(a.order.status, 'in_pruefung');
    const dueH = (Date.parse(a.order.due_at) - Date.now()) / 3_600_000;
    assert.ok(dueH > 11 && dueH <= 12.1, `interne Frist ~12 h, ist ${dueH.toFixed(2)} h`);
    const runs = (await expect(vw, 'GET', 'automation/runs', 200)).json as unknown as { rule_id: string; order_id: number; result: string }[];
    assert.ok(runs.some((u) => u.rule_id === 'express_priorisierung' && u.order_id === x.plus.id && u.result === 'ausgeführt'));
    const at = Object.fromEntries(a.milestones.map((m) => [m.key, m.at]));
    assert.ok(at.eingang && at.zahlung && at.unterlagen && at.pruefung, 'Eingang, Zahlung, Unterlagen, Prüfung mit Zeitstempel');
    assert.equal(at.freigabe, null);
    const q2 = (await expect(sb, 'GET', 'orders?status=laufend&express=1', 200)).json as unknown as { id: number; paid_at: string | null }[];
    assert.ok(q2.find((q) => q.id === x.plus.id)?.paid_at, 'Warteschlange kennt den Zahlungszeitpunkt');
  });

  it('Freigabe, Übertragung, Behörde (manuelle Prüfung) und Ergebnis – nur echte Zeitpunkte', async () => {
    const W = `orders/${x.plus.id}/action`;
    const d = await expect(sb, 'GET', `orders/${x.plus.id}`, 200);
    for (const item of (d.json.order as { checklistItems: { key: string }[] }).checklistItems) await expect(sb, 'POST', W, 200, { type: 'checklist', key: item.key, checked: true });
    for (const code of (d.json.insights as { codes: string[] }).codes) await expect(sb, 'POST', W, 200, { type: 'regCheck', key: `code_${code}`, value: true });
    await expect(sb, 'POST', W, 200, { type: 'release' });
    await expect(sb, 'POST', W, 200, { type: 'status', to: 'bei_zulassungsstelle' });
    const send = (status: string, ev: string) => {
      const raw = JSON.stringify({ order: { id: 8811, externalId: x.plus.number }, businessTransaction: 'AB', status });
      return anon.req('POST', '/api/webhooks/kfz-api', { body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(raw, KFZ_SECRET), 'X-Event-Id': ev } });
    };
    assert.equal((await send('FORWARDED', 'x-plus-fwd')).status, 200);
    let m = (await bundle(x.plus.id)).milestones;
    const beh = m.find((y) => y.key === 'behoerde')!;
    assert.ok(beh.at);
    assert.match(String(beh.note), /von Hand/);
    assert.equal(m.find((y) => y.key === 'ergebnis')!.at, null, 'kein Ergebnis erfunden');
    assert.equal((await send('APPROVED', 'x-plus-ok')).status, 200);
    m = (await bundle(x.plus.id)).milestones;
    assert.deepEqual(m.map((y) => !!y.at), [true, true, true, true, true, true, true, true]);
    assert.equal(m.at(-1)!.label, 'Zulassung erfolgreich');
    const times = m.map((y) => y.at as string);
    assert.ok(times[0] <= times[1] && times[4] <= times[5] && times[5] <= times[7], 'Reihenfolge der Zeitpunkte plausibel');
  });

  it('Express Plus: Rückfrage der Behörde erzeugt genau eine Rückruf-Aufgabe', async () => {
    const r = await web('x.plus2@example.de', 'WVWZZZ1KZAW000821', 'express_plus');
    x.plus2 = { number: String(r.json.number), id: await idOf(String(r.json.number)) };
    const raw = JSON.stringify({ order: { id: 8821, externalId: x.plus2.number }, businessTransaction: 'AB', status: 'REJECTED' });
    assert.equal((await anon.req('POST', '/api/webhooks/kfz-api', { body: raw, headers: { 'Content-Type': 'application/json', 'X-Signature': sign(raw, KFZ_SECRET), 'X-Event-Id': 'x-plus2-rej' } })).status, 200);
    await new Promise((res) => setTimeout(res, 800));
    const tasks = (await expect(vw, 'GET', 'tasks?scope=team', 200)).json.items as { order_id: number; title: string }[];
    assert.equal(tasks.filter((t) => t.order_id === x.plus2.id && t.title.startsWith('Kunde zurückrufen (Express Plus)')).length, 1);
  });

  it('Finanzcenter: Aufpreis, Zusatzkosten, Gebühr, Deckungsbeitrag und tatsächliche Dauer je Stufe', async () => {
    const pays = (await expect(bh, 'GET', 'finance/payments', 200)).json as unknown as { id: number; order_id: number; provider: string }[];
    const pay = pays.find((p) => p.order_id === x.plus.id && p.provider === 'stripe')!;
    await expect(bh, 'POST', `finance/payments/${pay.id}/fee`, 200, { feeCents: 89 });
    const rep = await expect(bh, 'GET', 'finance/express', 200);
    const rows = rep.json.report as { level: string; orders: number; paid: number; completed: number; surchargeGrossCents: number; surchargeNetCents: number; internalCostCents: number; feeCents: number; contributionCents: number; durations: Record<string, { n: number }>; internalTarget: { met: number; missed: number; open: number } | null }[];
    const plus = rows.find((r) => r.level === 'express_plus')!;
    assert.deepEqual([plus.orders, plus.paid, plus.completed, plus.surchargeGrossCents, plus.internalCostCents], [2, 1, 1, 5980, 1000]);
    const total = (await bundle(x.plus.id)).order.total_cents;
    const share = Math.round((89 * 2990) / total);
    assert.equal(plus.feeCents, share);
    assert.equal(plus.contributionCents, plus.surchargeNetCents - 1000 - share, 'Aufpreis netto − Zusatzkosten − Gebührenanteil');
    assert.equal(plus.durations.gesamt.n, 2, 'Dauer bis zum Ergebnis der Behörde: Zulassung und Rückfrage');
    assert.equal(plus.durations.freigabe_uebertragen.n, 1);
    assert.deepEqual(plus.internalTarget, { met: 1, missed: 0, open: 0 });
    const std = rows.find((r) => r.level === 'standard')!;
    assert.ok(std.orders > 0 && std.internalTarget === null);
  });
});

/* =====================================================================
   10. Aufgaben, Kommunikation, Benachrichtigungen, Papierkorb
   ===================================================================== */

describe('Team, Kommunikation, Benachrichtigungen, Papierkorb', () => {
  it('Aufgaben: eigene und fremde, Team-Recht, Kommentare, Prüfung', async () => {
    const t = await expect(vw, 'POST', 'tasks', 200, { title: 'E2E Aufgabe für Sachbearbeitung', assignee_id: ids.userSb, order_id: ids.a, priority: 'hoch', due_at: new Date(Date.now() + 86_400_000).toISOString() });
    ids.task = Number(t.json.id);
    const own = await expect(le, 'POST', 'tasks', 200, { title: 'Eigene Notiz', assignee_id: ids.userSb });
    const leTask = await expect(le, 'GET', `tasks/${own.json.id}`, 200);
    assert.notEqual((leTask.json.task as { assignee_id: number }).assignee_id, ids.userSb, 'ohne Team-Recht nur an sich selbst');
    await expect(vw, 'POST', 'tasks', 422, { title: '' });
    await expect(vw, 'POST', 'tasks', 422, { title: 'ok', due_at: 'morgen' });
    await expect(vw, 'POST', 'tasks', 422, { title: 'ok', order_id: 99999 });
    await expect(sb, 'GET', 'tasks', 200);
    await expect(sb, 'GET', `tasks/${ids.task}`, 200);
    await expect(le, 'GET', `tasks/${ids.task}`, 403);
    await expect(le, 'POST', `tasks/${ids.task}`, 403, { status: 'erledigt' });
    await expect(le, 'POST', `tasks/${ids.task}/comment`, 403, { text: 'x' });
    await expect(sb, 'GET', 'tasks/99999', 404);
    await expect(sb, 'POST', `tasks/${ids.task}`, 422, { status: 'vielleicht' });
    await expect(sb, 'POST', `tasks/${ids.task}`, 403, { assignee_id: ids.userLe });
    await expect(sb, 'POST', `tasks/${ids.task}/comment`, 422, { text: '' });
    await expect(sb, 'POST', `tasks/${ids.task}/comment`, 200, { text: 'Kunde erreicht' });
    await expect(sb, 'POST', `tasks/${ids.task}`, 200, { status: 'erledigt' });
    await expect(vw, 'GET', 'tasks?scope=team', 200);
    await expect(vw, 'GET', 'tasks/team', 200);
    await expect(sb, 'GET', 'tasks/team', 403);
    const mine = await expect(sb, 'GET', 'tasks?scope=team&status=erledigt', 200);
    assert.ok((mine.json.items as { id: number }[]).every((x) => x.id !== own.json.id), 'ohne Team-Recht keine fremden Aufgaben');
  });

  it('Kommunikation: Vorlagen, Vorschau, Entwurf, Versand ohne E-Mail-Dienst (kein externer Versand)', async () => {
    const tpl = await expect(le, 'GET', 'messages/templates', 200);
    assert.ok((tpl.json as unknown as unknown[]).length >= 5);
    await expect(le, 'POST', 'messages/templates', 403, { id: 'e2e_vorlage', name: 'x', subject: 'xx', body: 'xx' });
    await expect(sb, 'POST', 'messages/templates', 422, { id: 'Mit Leerzeichen', name: 'x', subject: 'xx', body: 'xx' });
    await expect(sb, 'POST', 'messages/templates', 200, { id: 'e2e_vorlage', name: 'E2E', subject: 'Auftrag {{auftrag}}', body: 'Hallo {{anrede_name}}, {{unbekannt}}' });
    await expect(le, 'POST', 'messages/templates/e2e_vorlage/reset', 403);
    await expect(le, 'POST', 'messages/preview', 403, { orderId: ids.a, templateId: 'rueckfrage' });
    await expect(le, 'POST', 'messages/draft', 403, { orderId: ids.a, templateId: 'rueckfrage' });
    await expect(sb, 'POST', 'messages/templates/e2e_vorlage/reset', 200);
    const pv = await expect(sb, 'POST', 'messages/preview', 200, { orderId: ids.a, templateId: 'unterlagen_anfordern', missing: 'ZB II' });
    assert.ok(String(pv.json.body).includes('ZB II'));
    await expect(sb, 'POST', 'messages/preview', 404, { orderId: ids.a, templateId: 'gibts_nicht' });
    await expect(sb, 'POST', 'messages/preview', 400, { orderId: 'x', templateId: 'rueckfrage' });
    const dr = await expect(sb, 'POST', 'messages/draft', 200, { orderId: ids.a, templateId: 'rueckfrage' });
    await expect(sb, 'POST', 'messages/draft', 422, { orderId: ids.a, templateId: 'gibts_nicht' });
    const send = await expect(sb, 'POST', 'messages/send', 422, { orderId: ids.a, to: 'kunde@example.de', subject: 'Test', body: 'Test', draftId: dr.json.id });
    assert.match(String(send.json.error), /nicht eingerichtet/);
    await expect(sb, 'POST', 'messages/send', 422, { orderId: ids.a, to: 'keine-mail', subject: 'Test', body: 'Test' });
    await expect(le, 'POST', 'messages/send', 403, { orderId: ids.a, to: 'a@b.de', subject: 'x', body: 'x' });
    await expect(le, 'GET', `messages/${dr.json.id}`, 200);
    await expect(le, 'GET', 'messages/99999', 404);
    await expect(le, 'GET', `messages?order=${ids.a}`, 200);
    await expect(le, 'POST', `messages/${dr.json.id}/discard`, 403);
    await expect(sb, 'POST', `messages/${dr.json.id}/discard`, 200);
    await expect(sb, 'POST', `messages/${dr.json.id}/discard`, 422);
  });

  it('Benachrichtigungen je Benutzer gelesen/ungelesen, nach Rechten gefiltert', async () => {
    const le1 = await expect(le, 'GET', 'notifications', 200);
    assert.ok(!(le1.json.items as { kind: string }[]).some((x) => x.kind.startsWith('zahlung')), 'ohne Finanzrecht keine Zahlungsmeldungen');
    const first = (le1.json.items as { id: number }[])[0];
    await expect(le, 'POST', 'notifications/read', 200, { ids: [first.id] });
    await expect(le, 'POST', 'notifications/read', 400, { ids: ['x'] });
    await expect(le, 'POST', 'notifications/read-all', 200);
    assert.equal((await le.get('notifications')).json.unread, 0);
    assert.ok(Number((await vw.get('notifications')).json.unread) > 0, 'Lesestatus je Benutzer');
  });

  it('Papierkorb: Notiz wiederherstellen und endgültig löschen nur mit Recht', async () => {
    await expect(le, 'GET', 'trash', 200);
    await expect(le, 'POST', `trash/${ids.note}/restore`, 403);
    await expect(sb, 'POST', 'trash/abc/restore', 400);
    await expect(sb, 'POST', 'trash/99999/restore', 422);
    await expect(sb, 'POST', `trash/${ids.note}/restore`, 200);
    await expect(sb, 'POST', `orders/${ids.a}/action`, 200, { type: 'noteDelete', noteId: ids.note });
    await expect(sb, 'POST', `trash/${ids.note}/purge`, 403);
    await expect(vw, 'POST', 'trash/99999/purge', 404);
    await expect(vw, 'POST', `trash/${ids.note}/purge`, 200);
    await expect(sb, 'POST', 'trash/empty', 403);
    await expect(vw, 'POST', 'trash/empty', 200);
  });
});

/* =====================================================================
   11. Sicherheit: 2FA, Sitzungen, Passwort, Sperre
   ===================================================================== */

describe('Sicherheit', () => {
  it('Zwei-Faktor: Einrichten, falscher Code, Aktivieren, Anmeldung verlangt Code, Wiederverwendung gesperrt', async () => {
    await expect(sb, 'GET', 'security', 200);
    const setup = await expect(sb, 'POST', 'security/2fa/setup', 200);
    const secret = String(setup.json.secret);
    assert.match(String(setup.json.uri), /^otpauth:\/\/totp\//);
    await expect(sb, 'POST', 'security/2fa/enable', 422, { code: '000000' });
    await expect(sb, 'POST', 'security/2fa/enable', 200, { code: totp(secret) });
    await expect(sb, 'POST', 'security/2fa/setup', 422);
    const c = new Client('sb-2fa', '10.0.3.1');
    const noCode = await c.req('POST', 'unlock', { body: { username: 'e2e.sb', password: PW.sb }, tag: 'invalid' });
    assert.equal(noCode.status, 401);
    assert.equal(noCode.json.needCode, true);
    assert.equal(c.cookie, '', 'ohne Code keine Sitzung');
    const wrong = await c.req('POST', 'unlock', { body: { username: 'e2e.sb', password: PW.sb, code: '123456' }, tag: 'invalid' });
    assert.equal(wrong.status, 401);
    const ok = await c.req('POST', 'unlock', { body: { username: 'e2e.sb', password: PW.sb, code: totp(secret, 1) }, tag: 'ok' });
    assert.equal(ok.status, 200);
    const replay = await new Client('sb-replay', '10.0.3.2').req('POST', 'unlock', { body: { username: 'e2e.sb', password: PW.sb, code: totp(secret, 1) } });
    assert.equal(replay.status, 401, 'derselbe Code nicht zweimal');
    await expect(sb, 'POST', 'security/2fa/disable', 422, { code: '000000' });
    strs.sbSecret = secret;
    // Abschalten nur mit gültigem Code (eigener Ablauf mit der Verwaltung)
    const vs = String((await expect(vw, 'POST', 'security/2fa/setup', 200)).json.secret);
    await expect(vw, 'POST', 'security/2fa/enable', 200, { code: totp(vs, 0) });
    await expect(vw, 'POST', 'security/2fa/disable', 200, { code: totp(vs, 1) });
    assert.equal(((await vw.get('security')).json.twoFactor as { enabled: boolean }).enabled, false);
    // Inhaber setzt 2FA zurück (Gerät verloren) → alle Sitzungen enden
    await expect(owner, 'POST', `users/${ids.userSb}`, 200, { resetTwoFactor: true });
    assert.equal((await sb.req('GET', 'session')).status, 401);
    assert.equal((await c.req('GET', 'session')).status, 401);
    sb = await login('sachbearbeitung', 'e2e.sb', PW.sb, '10.0.1.3');
  });

  it('Sitzungen: Liste, fremde Sitzung nicht beendbar, andere abmelden, Sperren beendet Sitzung', async () => {
    const second = await login('sb-zweit', 'e2e.sb', PW.sb, '10.0.3.3');
    const sec = await expect(sb, 'GET', 'security', 200);
    const sessions = sec.json.sessions as { id: string; current: boolean }[];
    assert.ok(sessions.length >= 2);
    const other = sessions.find((x) => !x.current)!;
    const current = sessions.find((x) => x.current)!;
    await expect(sb, 'POST', `security/sessions/${current.id}/revoke`, 400);
    const vwSessions = (await vw.get('security')).json.sessions as { id: string; current: boolean }[];
    await expect(sb, 'POST', `security/sessions/${vwSessions[0].id}/revoke`, 404, undefined, 'invalid');
    await expect(sb, 'POST', `security/sessions/${other.id}/revoke`, 200);
    assert.equal((await second.req('GET', 'session')).status, 401, 'widerrufene Sitzung ungültig');
    const third = await login('sb-dritt', 'e2e.sb', PW.sb, '10.0.3.4');
    await expect(sb, 'POST', 'security/sessions/revoke-others', 200);
    assert.equal((await third.req('GET', 'session')).status, 401);
    const locker = await login('sb-sperre', 'e2e.sb', PW.sb, '10.0.3.5');
    const cookieBefore = locker.cookie;
    assert.equal((await locker.req('POST', 'lock', { body: {}, tag: 'ok' })).status, 200);
    locker.cookie = cookieBefore;
    assert.equal((await locker.req('GET', 'session')).status, 401, 'nach Sperren ist das alte Cookie wertlos');
  });

  it('Passwort ändern: falsches Passwort abgelehnt, andere Sitzungen beendet, Inhaber nur über Server-Geheimnis', async () => {
    await expect(owner, 'POST', 'security/password', 400, { current: 'x', next: 'y' });
    const other = await login('le-zweit', 'e2e.le', PW.le, '10.0.4.1');
    await expect(le, 'POST', 'security/password', 422, { current: 'falsch', next: 'NeuesPasswort-2026!' });
    await expect(le, 'POST', 'security/password', 422, { current: PW.le, next: 'kurz' });
    await expect(le, 'POST', 'security/password', 200, { current: PW.le, next: 'NeuesPasswort-2026!' });
    assert.equal((await other.req('GET', 'session')).status, 401, 'andere Sitzung nach Passwortwechsel beendet');
    assert.equal((await le.req('GET', 'session')).status, 200, 'eigene Sitzung läuft weiter');
    PW.le = 'NeuesPasswort-2026!';
  });

  it('Rollen- und Statusänderung beenden Sitzungen; deaktivierter Benutzer kann sich nicht anmelden', async () => {
    const tmp = await login('le-tmp', 'e2e.le', PW.le, '10.0.4.2');
    await expect(owner, 'POST', `users/${ids.userLe}`, 200, { role: 'buchhaltung' });
    assert.equal((await tmp.req('GET', 'session')).status, 401);
    await expect(owner, 'POST', `users/${ids.userLe}`, 200, { active: false, role: 'lesen' });
    const r = await new Client('le-gesperrt', '10.0.4.3').req('POST', 'unlock', { body: { username: 'e2e.le', password: PW.le } });
    assert.equal(r.status, 401);
    await expect(owner, 'POST', `users/${ids.userLe}`, 200, { active: true });
    le = await login('lesen', 'e2e.le', PW.le, '10.0.1.5');
  });

  it('Anmeldesperre nach Fehlversuchen – gefälschter X-Forwarded-For hilft nicht', async () => {
    const attacker = new Client('angreifer', '10.66.66.66');
    let blocked = false;
    for (let i = 0; i < 8; i++) {
      const r = await attacker.req('POST', 'unlock', { body: { username: 'e2e.vw', password: `falsch-${i}` }, headers: { 'x-forwarded-for': `1.2.3.${i}` }, tag: 'invalid' });
      if (r.status === 429) {
        blocked = true;
        break;
      }
      assert.equal(r.status, 401);
    }
    assert.ok(blocked, 'nach wiederholten Fehlversuchen gesperrt');
    const real = await new Client('angreifer-richtig', '10.66.66.66').req('POST', 'unlock', { body: { username: 'e2e.vw', password: PW.vw } });
    assert.equal(real.status, 429, 'auch mit richtigem Passwort bis zum Ablauf gesperrt');
  });
});

/* =====================================================================
   12. Abschluss: Abdeckung und keine Serverfehler
   ===================================================================== */

describe('Ortsauswahl und Wunschkennzeichen (verifizierte KBA-/Destatis-Daten)', () => {
  type PlaceView = { ags: string; name: string; zusatz?: string; kreis: string; land: string; codes: string[]; pending: string[] };
  const orte = async (q: string) => (await anon.req('GET', `/api/orte?q=${encodeURIComponent(q)}`)).json as { ok: boolean; places: PlaceView[]; more: boolean };
  const wishOrder = (email: string, fin: string, plate: string, ags: string) => {
    const d = orderData({ service: 'neuzulassung', email, fin });
    return { data: { ...d, holder: { ...d.holder, plz: '28865', ort: 'Lilienthal' }, plate: { wahl: 'wunsch', wunschkennzeichen: plate, wunschort: ags, schilder: false, zustellung: 'abholung', versanddienst: '' } } };
  };
  let lilienthal = '';

  it('Ortssuche: Name, Kreis und Land; gleichnamige Gemeinden getrennt; Eingrenzung über Kreis', async () => {
    const l = await orte('Lilienthal');
    const p = l.places.find((x) => x.name === 'Lilienthal')!;
    assert.deepEqual([p.kreis, p.land, p.codes], ['Landkreis Osterholz', 'Niedersachsen', ['OHZ']]);
    lilienthal = p.ags;
    assert.deepEqual((await orte('Bremen')).places.find((x) => x.name === 'Bremen')?.codes, ['HB']);
    const neu = (await orte('Neuenkirchen')).places.filter((x) => x.name === 'Neuenkirchen');
    assert.ok(neu.length >= 8);
    assert.equal(new Set(neu.map((x) => `${x.name}|${x.zusatz ?? ''}|${x.kreis}`)).size, neu.length, 'jede Gemeinde eindeutig beschriftet');
    // zweimal Neuenkirchen im selben Kreis: Unterscheidung über die PLZ des Verwaltungssitzes
    const vg = (await orte('Neuenkirchen Greifswald')).places;
    assert.deepEqual(vg.map((x) => x.zusatz).sort(), ['PLZ 17392', 'PLZ 17498']);
    const dh = await orte('Neuenkirchen Diepholz');
    assert.deepEqual(dh.places.map((x) => [x.kreis, x.codes]), [['Landkreis Diepholz', ['DH', 'SY']]]);
    assert.equal((await anon.req('GET', '/api/orte?ags=00000000')).status, 404);
    assert.equal(((await anon.req('GET', `/api/orte?ags=${lilienthal}`)).json.place as PlaceView).name, 'Lilienthal');
  });

  it('Bestellung: Kürzel muss zum gewählten Ort passen; erfundene Kürzel abgelehnt; Ort bleibt am Auftrag', async () => {
    const wrong = await expect(sb, 'POST', 'orders', 422, wishOrder('ort.falsch@example.de', 'WVWZZZ1KZAW000911', 'HB-EZ 24', lilienthal));
    assert.match(String((wrong.json.fields as Record<string, string>)['plate.wunschkennzeichen']), /HB gehört laut Kraftfahrt-Bundesamt nicht zu Lilienthal – zulässig: OHZ/);
    const fake = await expect(sb, 'POST', 'orders', 422, wishOrder('ort.fake@example.de', 'WVWZZZ1KZAW000912', 'LIL-EZ 24', lilienthal));
    assert.match(String((fake.json.fields as Record<string, string>)['plate.wunschkennzeichen']), /kein amtlich vergebenes Ortskennzeichen/);
    const unknown = await expect(sb, 'POST', 'orders', 422, wishOrder('ort.unbekannt@example.de', 'WVWZZZ1KZAW000913', 'OHZ-EZ 24', '99999999'));
    assert.match(String((unknown.json.fields as Record<string, string>)['plate.wunschkennzeichen']), /Ort ist nicht bekannt/);
    const good = await expect(sb, 'POST', 'orders', 200, wishOrder('ort.richtig@example.de', 'WVWZZZ1KZAW000914', 'OHZ-EZ 24', lilienthal));
    const d = await expect(sb, 'GET', `orders/${good.json.id}`, 200);
    assert.equal((d.json.order as { data: { plate: { wunschort: string } } }).data.plate.wunschort, lilienthal);
    assert.deepEqual(d.json.wishPlace, { ags: lilienthal, name: 'Lilienthal', kreis: 'Landkreis Osterholz', land: 'Niedersachsen', codes: ['OHZ'], fits: true });
  });
});

describe('Digitale Vollmacht: Rücksprungseite und Verwaltung', () => {
  it('Rücksprung ohne, mit unbekannten oder manipulierten Parametern: neutraler Hinweis, keine Erfolgsmeldung, keine Auftragsdaten', async () => {
    for (const q of ['', '?powerOfAttorneyId=4711&status=signed', '?powerOfAttorneyId=abc&status=signed', '?powerOfAttorneyId=1%27%20OR%201%3D1&status=signed', '?status=signed']) {
      const r = await anon.req('GET', `/vollmacht/abschluss${q}`);
      assert.equal(r.status, 200, q);
      const t = r.text.replace(/<!-- -->/g, '');
      assert.ok(t.includes('Wir konnten diesen Vorgang nicht zuordnen.'), q);
      assert.ok(!t.includes('erfolgreich unterschrieben'), `keine Erfolgsmeldung: ${q}`);
      assert.ok(!/EK-\d{4}-\d{5}/.test(t), `keine Auftragsnummer: ${q}`);
    }
    const api = await anon.req('GET', '/api/vollmacht/status?powerOfAttorneyId=4711');
    assert.equal(api.status, 200);
    assert.deepEqual([api.json.view, api.json.known], ['unknown', false]);
  });

  it('OS: Anforderung ohne Freischaltung sauber abgelehnt, Leserecht reicht nicht; Abgleich ohne Vorgang', async () => {
    const r = await expect(sb, 'POST', `orders/${ids.a}/vollmacht`, 422);
    assert.match(String(r.json.error), /nicht freigeschaltet/);
    await expect(le, 'POST', `orders/${ids.a}/vollmacht`, 403);
    const a = await expect(le, 'POST', `orders/${ids.a}/vollmacht/abgleich`, 422);
    assert.match(String(a.json.error), /keinen Vollmachtsvorgang/);
    const d = await expect(sb, 'GET', `orders/${ids.a}`, 200);
    assert.deepEqual([d.json.poas, d.json.poaEnabled], [[], false]);
  });
});

describe('Widerrufsstrecke (Entwurf) ist ohne Freischaltung nicht öffentlich', () => {
  it('Seiten, Schnittstelle und Footer-Link sind im Produktivbetrieb ohne WIDERRUF_AKTIV nicht erreichbar', async () => {
    assert.equal((await anon.req('GET', '/widerruf')).status, 404);
    assert.equal((await anon.req('GET', '/widerrufsbelehrung')).status, 404);
    const api = await anon.req('POST', '/api/widerruf', { body: { name: 'Erika Muster', contract: 'EK-2026-00001', email: 'erika@example.de' } });
    assert.equal(api.status, 404);
    const home = (await anon.req('GET', '/impressum')).text;
    assert.ok(!home.includes('Vertrag widerrufen'), 'kein Widerrufslink vor der Freischaltung');
  });
});

describe('Abdeckung', () => {
  it('jeder Endpunkt wurde mit Erfolg und ohne Anmeldung getestet, mit Recht zusätzlich verweigert', () => {
    assert.equal(ROUTES.length, EXPECTED_ROUTES, `erwartet ${EXPECTED_ROUTES} Endpunkte, gefunden ${ROUTES.length}`);
    const missing: string[] = [];
    for (const r of ROUTES) {
      const h = hits[r.key];
      // Erfolg nur mit externem Dienst möglich (bewusst abgeschaltet): dort wird die saubere Ablehnung geprüft
      if (!h.has('ok') && !(r.key in NEEDS_EXTERNAL && h.has('invalid'))) missing.push(`${r.key}: kein erfolgreicher Aufruf`);
      if (r.key !== 'POST unlock' && !h.has('unauth')) missing.push(`${r.key}: nicht ohne Anmeldung geprüft`);
      // Hat mindestens eine Rolle das Recht nicht, muss die Ablehnung (403) getestet sein
      const perms = r.perm ? (r.perm.match(/'([a-z.]+)'/g) ?? []).map((x) => x.slice(1, -1)) : [];
      const someRoleLacks = perms.length > 0 && Object.values(ROLE_PERMISSIONS).some((list) => !perms.some((p) => (list as readonly string[]).includes(p)));
      if (someRoleLacks && !h.has('denied')) missing.push(`${r.key}: Rechteprüfung (403) nicht getestet`);
    }
    assert.deepEqual(missing, []);
  });

  it('kein einziger Serverfehler (5xx) im gesamten Lauf', () => {
    assert.deepEqual(fivehundreds, []);
  });
});
