import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { plateSearchSchema, referenceSchema, reservationPayload } from '../src/lib/kennzeichen-api.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-kennzeichen-'));
const api = await import('../src/server/kennzeichen.ts');
const pub = await import('../src/server/kennzeichen-public.ts');
const { getDb } = await import('../src/server/db.ts');
const plate = { ks: '05314', uz: 'BN', buchstaben: 'AB', ziffern: '123', vehicleType: 'PKW' as const };
const catalog = { bezirke: [{ ks: '05314', name: 'Bonn', codes: ['BN'] }, { ks: '05315', name: 'Andere Behörde', codes: ['BN'] }], preise: { abfrageCent: 10, reservierungCent: 400, grundgebuehrCent: 0 } };
const requirements = { customerFields: { private: [{ name: 'vorname', required: true, type: 'text' }, { name: 'geburtsdatum', required: true, type: 'date' }], company: [{ name: 'firmenname', required: true, type: 'text' }] } };
const draft = { plate, kind: 'private', customer: { vorname: 'Synthetisch', geburtsdatum: '1990-01-02' }, einwilligung: true, authorityTermsAccepted: true };
const originalFetch = globalThis.fetch;
let calls: { path: string; options?: RequestInit }[] = [];
let response: (url: string, opts?: RequestInit) => Promise<Response>;
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'Content-Type': 'application/json' } });
async function seed() {
  const db = await getDb();
  for (const [key, value] of [['bezirke', catalog], ['requirements:05314', requirements]] as const)
    await db.run('INSERT OR REPLACE INTO kennzeichen_cache (key, body, expires_at) VALUES (?, ?, ?)', key, JSON.stringify(value), Date.now() + 60_000);
}
beforeEach(async () => {
  const db = await getDb();
  for (const table of ['kennzeichen_cache', 'kennzeichen_operations', 'kennzeichen_limits', 'kennzeichen_budget']) await db.run(`DELETE FROM ${table}`);
  Object.assign(process.env, { KFZ_API_BASE_URL: 'https://api.kfz-api.de/dropshipping-api/10/2.3.0', KFZ_API_LOGIN: 'synthetic-test', KFZ_API_PASSWORD: 'synthetic-secret', KENNZEICHEN_SEARCH_ENABLED: '', KENNZEICHEN_DAILY_BUDGET_CENT: '', KENNZEICHEN_PUBLIC_SEARCH_ENABLED: '', KENNZEICHEN_METADATA_ENABLED: '', SESSION_SECRET: 'synthetic-public-session-secret-123456789', PUBLIC_BASE_URL: 'https://easykfz24.de' });
  calls = [];
  response = async (url) => url.endsWith('/bezirke') ? json(catalog) : url.endsWith('/anforderungen') ? json(requirements) : url.endsWith('/search') ? json({ outcome: 'AVAILABLE', kostenCent: 10, reservierbar: true }) : json({ status: 'reserved', pin: '001234' });
  globalThis.fetch = (async (url, options) => {
    const u = String(url);
    calls.push({ path: u, options });
    assert.ok(u.startsWith('https://api.kfz-api.de/dropshipping-api/10/2.3.0/kennzeichen/'));
    assert.ok(!(options?.method === 'POST' && u.endsWith('/reservations')), 'Keine echte Reservierung, auch im Test nicht');
    return response(u, options);
  }) as typeof fetch;
});
after(() => { globalThis.fetch = originalFetch; fs.rmSync(process.env.DATA_DIR!, { recursive: true, force: true }); });
const enable = (budget = '100') => Object.assign(process.env, { KENNZEICHEN_SEARCH_ENABLED: '1', KENNZEICHEN_DAILY_BUDGET_CENT: budget });

describe('Kennzeichen-Sicherheit und Vertrag', () => {
  it('sperrt alle kostenpflichtigen Abfragen ohne separate Freigabe vor dem Netzwerk', async () => {
    await assert.rejects(api.searchPlate(1, plate, 'search:123'), { status: 423 });
    assert.equal(calls.length, 0);
    enable('0'); await assert.rejects(api.searchPlate(1, plate, 'search:123'), { status: 423 });
  });
  it('validiert Referenzen, vollständige Kombinationen und Saison', () => {
    for (const v of ['kurz', 'mit leerzeichen', 'a'.repeat(121)]) assert.equal(referenceSchema.safeParse(v).success, false);
    for (const v of [{ ...plate, ziffern: '0123' }, { ...plate, buchstaben: '??' }, { ...plate, ks: '0531' }, { ...plate, saisonVon: 3 }, { ...plate, electric: true, historic: true }]) assert.equal(plateSearchSchema.safeParse(v).success, false);
    assert.equal(plateSearchSchema.parse({ ...plate, uz: 'bn' }).uz, 'BN');
  });
  it('lädt Metadaten mit bestehender Basic-Anmeldung und Cache; öffentlich niemals Netzwerk', async () => {
    assert.equal(await api.getCatalog(), null);
    assert.equal(calls.length, 0);
    await api.getCatalog(1, true); await api.getCatalog(2, true);
    assert.equal(calls.length, 1);
    assert.equal((calls[0].options?.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('synthetic-test:synthetic-secret').toString('base64')}`);
    assert.equal(calls[0].options?.redirect, 'error');
  });
  it('weist falsche Anmeldeziele ab und gibt keine Secrets aus', async () => {
    process.env.KFZ_API_BASE_URL = 'https://evil.example/dropshipping-api/10/2.3.0';
    await assert.rejects(api.getCatalog(1, true), { status: 503 });
    assert.equal(calls.length, 0);
    assert.ok(!JSON.stringify(api.kennzeichenPolicy()).includes('synthetic-secret'));
  });
  it('behandelt unbekannte Katalog- und Pflichtfeldformate geschlossen', async () => {
    response = async () => json({ incorrect: true });
    await assert.rejects(api.getCatalog(1, true), { status: 502 });
    await assert.rejects(api.getRequirements('05314', 2, true), { status: 502 });
    await assert.rejects(api.getRequirements('../search'), { status: 400 });
  });
  it('prüft Bezirk und Kürzel ausdrücklich, auch bei geteilten Kürzeln', async () => {
    await seed(); enable();
    await assert.rejects(api.searchPlate(1, { ...plate, ks: '00000' }, 'search:wrong'), { status: 422 });
    await assert.rejects(api.searchPlate(1, { ...plate, uz: 'HB' }, 'search:wrong'), { status: 422 });
    assert.equal(calls.length, 0);
  });
  it('sendet POST /search mit stabiler Referenz, gibt Ergebnis zurück und berechnet Wiederholungen nicht erneut', async () => {
    await seed(); enable();
    const a = await api.searchPlate(1, plate, 'search:123');
    assert.equal(a.frei, true);
    assert.deepEqual(await api.searchPlate(1, plate, 'search:123'), a);
    assert.equal(calls.length, 1);
    assert.equal((calls[0].options?.headers as Record<string, string>)['Idempotency-Key'], 'search:123');
    assert.equal(await api.kennzeichenBudget(), 10);
    await assert.rejects(api.searchPlate(1, { ...plate, ziffern: '124' }, 'search:123'), { status: 409 });
    await assert.rejects(api.searchPlate(2, plate, 'search:123'), { status: 409 });
  });
  it('blockiert parallele gleiche Abfragen und bindet Budget atomar', async () => {
    await seed(); enable('10');
    const results = await Promise.allSettled([api.searchPlate(1, plate, 'search:123'), api.searchPlate(1, plate, 'search:123'), api.searchPlate(2, plate, 'search:456')]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(calls.length, 1);
    assert.equal(await api.kennzeichenBudget(), 10);
    await assert.rejects(api.searchPlate(2, plate, 'search:456'), { status: 429 });
    assert.equal(calls.length, 1, 'Wiederholung darf fehlgeschlagene Budgetprüfung nicht umgehen');
  });
  it('wiederholt nach Timeout mit identischer Referenz und gleichem Budget', async () => {
    await seed(); enable('10'); let n = 0;
    response = async () => { if (!n++) throw new Error('synthetic-secret'); return json({ outcome: 'UNKNOWN', kostenCent: 0 }); };
    await assert.rejects(api.searchPlate(1, plate, 'search:timeout'), { status: 502, message: 'KFZ-API nicht erreichbar. Dieselbe Referenz wiederverwenden.' });
    const r = await api.searchPlate(1, plate, 'search:timeout');
    assert.equal(r.frei, false); assert.equal(await api.kennzeichenBudget(), 10);
    assert.equal((calls[1].options?.headers as Record<string, string>)['Idempotency-Key'], 'search:timeout');
  });
  it('kann eine abgebrochene Worker-Anfrage mit derselben Referenz wiederaufnehmen', async () => {
    await seed(); enable(); await api.searchPlate(1, plate, 'search:crash');
    await (await getDb()).run("UPDATE kennzeichen_operations SET state = 'running', updated_at = ?", new Date(Date.now() - 60_000).toISOString());
    await api.searchPlate(1, plate, 'search:crash');
    assert.equal(calls.length, 2); assert.equal(await api.kennzeichenBudget(), 10);
  });
  it('blockiert Preiserhöhungen, technische und unbekannte Verfügbarkeitsantworten', async () => {
    await seed(); enable();
    await (await getDb()).run("UPDATE kennzeichen_cache SET body = ? WHERE key = 'bezirke'", JSON.stringify({ ...catalog, preise: { ...catalog.preise, abfrageCent: 11 } }));
    await assert.rejects(api.searchPlate(1, plate, 'search:price'), { status: 423 }); assert.equal(calls.length, 0);
    await seed(); response = async () => json({ outcome: 'QUEUED', kostenCent: 0 });
    await assert.rejects(api.searchPlate(1, plate, 'search:unknown'), { status: 502 });
  });
  it('beachtet Anbieter-Rate-Limits ohne automatische Wiederholungen', async () => {
    await seed(); enable(); response = async () => json({ error: 'synthetic-secret' }, 429);
    await assert.rejects(api.searchPlate(1, plate, 'search:limit'), { status: 429 }); assert.equal(calls.length, 1);
  });
  it('begrenzt benutzerbezogen und global über gemeinsame Datenbankzähler', async () => {
    for (let i = 0; i < 10; i++) await api.kennzeichenRate(1);
    await assert.rejects(api.kennzeichenRate(1), { status: 429 });
    for (let i = 0; i < 49; i++) await api.kennzeichenRate(100 + i);
    await assert.rejects(api.kennzeichenRate(1000), { status: 429 });
  });
  it('berücksichtigt unterschiedliche Privat-/Firmenpflichtfelder und echte Zustimmungen', () => {
    assert.throws(() => reservationPayload({ ...draft, customer: { vorname: 'Test' } }, requirements));
    assert.throws(() => reservationPayload({ ...draft, einwilligung: false }, requirements));
    assert.throws(() => reservationPayload({ ...draft, authorityTermsAccepted: false }, requirements));
    const r = reservationPayload({ ...draft, kind: 'company', customer: { firmenname: 'Testfirma', unerwartet: 'wird entfernt' } }, requirements);
    assert.deepEqual(r.customer, { firmenname: 'Testfirma' });
  });
  it('speichert idempotente Reservierungsentwürfe ohne jeden externen Aufruf', async () => {
    await seed(); const a = await api.prepareReservation(1, draft, 'draft:123');
    assert.equal(a.submitted, false); assert.equal(a.state, 'prepared');
    assert.deepEqual(await api.prepareReservation(1, draft, 'draft:123'), a);
    assert.equal(calls.length, 0); assert.equal(await api.kennzeichenBudget(), 0);
    const list = JSON.stringify(await api.listKennzeichen());
    assert.ok(!list.includes('Synthetisch')); assert.ok(!list.includes('1990-01-02'));
  });
  it('legt ohne aktuelle Behördenanforderungen keinen Entwurf an', async () => {
    await seed(); await (await getDb()).run("DELETE FROM kennzeichen_cache WHERE key LIKE 'requirements:%'");
    await assert.rejects(api.prepareReservation(1, draft, 'draft:missing'), { status: 422 });
    assert.equal(calls.length, 0);
  });
  it('liest bestehende Reservierungen ausschließlich per GET, erhält PIN als String', async () => {
    const r = await api.importReservation(1, 'existing-job', 'existing:123');
    assert.equal(r.pin, '001234');
    assert.equal((await api.refreshReservation(1, r.id)).pin, '001234');
    assert.ok(calls.every((c) => c.options?.method === 'GET'));
    assert.ok(!JSON.stringify(await api.listKennzeichen()).includes('001234'));
    await assert.rejects(api.refreshReservation(1, 'missing'), { status: 404 });
  });
  it('übernimmt eine PIN nur bei reserved und lehnt numerische PINs ab', async () => {
    response = async () => json({ status: 'queued', pin: '001234' });
    assert.equal((await api.importReservation(1, 'pending', 'existing:queued')).pin, undefined);
    response = async () => json({ status: 'reserved', pin: 1234 });
    await assert.rejects(api.importReservation(1, 'numeric-pin', 'existing:badpin'), { status: 502 });
  });
  it('hält Wiederholungen nach Browser-Neustart an der gespeicherten Referenz fest', async () => {
    await seed(); enable(); await api.searchPlate(1, plate, 'search:resume');
    const rows = await api.listKennzeichen() as { id: string }[];
    const detail = await api.kennzeichenDetail(rows[0].id);
    assert.equal(detail.reference, 'search:resume');
    await api.retrySearch(1, rows[0].id); assert.equal(calls.length, 1);
    await assert.rejects(api.retrySearch(2, rows[0].id), { status: 404 });
  });
  it('blockiert doppelte Zuordnungen und reserved ohne PIN kontrolliert', async () => {
    await api.importReservation(1, 'existing-job', 'existing:first');
    await assert.rejects(api.importReservation(1, 'existing-job', 'existing:second'), { status: 409 });
    assert.equal((await api.listKennzeichen()).length, 1);
    response = async () => json({ status: 'reserved' });
    await assert.rejects(api.importReservation(1, 'missing-pin', 'existing:nopin'), { status: 502 });
  });
  it('weist fremde/nicht vorhandene Reservierungen und Pfadmanipulationen ab', async () => {
    response = async () => json({ secret: 'synthetic-secret' }, 404);
    await assert.rejects(api.importReservation(1, 'foreign', 'existing:foreign'), { status: 502 });
    assert.equal((await api.listKennzeichen()).length, 0);
    await assert.rejects(api.importReservation(1, '../search', 'existing:attack'), { status: 422 });
  });
});

const publicRequest = (body: unknown = { plate, reference: 'public:reference', confirmed: true }, headers: Record<string, string> = {}) => new Request('https://easykfz24.de/api/kennzeichen/search', { method: 'POST', headers: { Origin: 'https://easykfz24.de', 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
const publicEnable = (budget = '1000') => { enable(budget); process.env.KENNZEICHEN_PUBLIC_SEARCH_ENABLED = '1'; };
describe('Öffentliche Verfügbarkeitsprüfung', () => {
  it('verlangt ein eigenes Freigabetor zusätzlich zum Tagesbudget', async () => {
    enable();
    await assert.rejects(pub.handlePublicSearch(publicRequest(), '192.0.2.1'), { status: 423 });
    assert.equal(calls.length, 0);
  });
  it('kann kostenlose Metadaten ohne Freigabe kostenpflichtiger Suche prüfen', async () => {
    process.env.KENNZEICHEN_METADATA_ENABLED = '1';
    const r = await pub.publicCatalog();
    assert.equal(r.searchEnabled, false); assert.ok(r.catalog);
    assert.equal(calls.length, 1); assert.ok(calls[0].path.endsWith('/bezirke'));
    await assert.rejects(pub.handlePublicSearch(publicRequest(), '192.0.2.1'), { status: 423 });
  });
  it('lehnt fremde Herkunft, falsche Inhalte und unbewusste Aufrufe vor dem Netzwerk ab', async () => {
    publicEnable();
    await assert.rejects(pub.handlePublicSearch(publicRequest(undefined, { Origin: 'https://evil.example' }), '192.0.2.1'), { status: 403 });
    await assert.rejects(pub.handlePublicSearch(publicRequest(undefined, { 'Sec-Fetch-Site': 'cross-site' }), '192.0.2.1'), { status: 403 });
    await assert.rejects(pub.handlePublicSearch(publicRequest(undefined, { 'Content-Type': 'text/plain' }), '192.0.2.1'), { status: 415 });
    await assert.rejects(pub.handlePublicSearch(publicRequest({ plate, reference: 'public:reference' }), '192.0.2.1'), { status: 422 });
    await assert.rejects(pub.handlePublicSearch(publicRequest('{invalid'), '192.0.2.1'), { status: 400 });
    await assert.rejects(pub.handlePublicSearch(publicRequest('x'.repeat(5000)), '192.0.2.1'), { status: 413 });
    assert.equal(calls.length, 0);
  });
  it('prüft nur vollständige Kombinationen nach bewusstem Klick; erhält Referenz und Zeitstempel', async () => {
    publicEnable(); await seed();
    const a = await pub.handlePublicSearch(publicRequest(), '192.0.2.1');
    const b = await pub.handlePublicSearch(publicRequest(), '192.0.2.1');
    assert.deepEqual(a, b); assert.equal(a.outcome, 'AVAILABLE'); assert.ok(a.checkedAt);
    assert.equal(calls.length, 1); assert.equal(await api.kennzeichenBudget(), 10);
    const stored = await (await getDb()).first<{ actor_id: number; request_json: string }>('SELECT actor_id, request_json FROM kennzeichen_operations');
    assert.ok(stored!.actor_id < 0); assert.ok(!stored!.request_json.includes('192.0.2.1'));
    await assert.rejects(pub.handlePublicSearch(publicRequest({ plate: { ...plate, buchstaben: '??' }, confirmed: true, reference: 'public:wildcard' }), '192.0.2.1'), { status: 422 });
  });
  it('teilt das atomare Kostenlimit mit dem OS', async () => {
    publicEnable('10'); await seed();
    await api.searchPlate(1, plate, 'os:budget:first');
    await assert.rejects(pub.handlePublicSearch(publicRequest(), '192.0.2.1'), { status: 429 });
    assert.equal(calls.length, 1); assert.equal(await api.kennzeichenBudget(), 10);
  });
  it('verweigert ohne Servergeheimnis die öffentliche Prüfung', async () => {
    publicEnable(); await seed(); process.env.SESSION_SECRET = '';
    await assert.rejects(pub.handlePublicSearch(publicRequest(), '192.0.2.1'), { status: 503 });
    assert.equal(calls.length, 0);
  });
});
