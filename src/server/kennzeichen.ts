// Alle externen Zugriffe hier. Suche nur nach separater Kostenfreigabe; Reservierungen bleiben Entwürfe.
import { createHash, randomUUID } from 'node:crypto';
import { catalogSchema, plateSearchSchema, referenceSchema, requirementsSchema, reservationPayload } from '../lib/kennzeichen-api.ts';
import { getDb } from './db.ts';

export class KennzeichenError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const fail = (status: number, message: string): never => { throw new KennzeichenError(status, message); };
const now = () => new Date().toISOString();
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const ksValue = (ks: string) => /^\d{5}$/.test(ks) ? ks : fail(400, 'Ungültiger Kreisschlüssel.');
const positiveInt = (s: string | undefined) => /^\d{1,7}$/.test(s ?? '') ? Number(s) : 0;

export function kennzeichenPolicy() {
  return { searchEnabled: process.env.KENNZEICHEN_SEARCH_ENABLED === '1' && positiveInt(process.env.KENNZEICHEN_DAILY_BUDGET_CENT) >= 10,
    dailyBudgetCent: positiveInt(process.env.KENNZEICHEN_DAILY_BUDGET_CENT), reservationEnabled: false,
    reason: 'Reservierungen werden nur vorbereitet. Kostenpflichtige Abfragen benötigen eine gesonderte Freigabe.', searchMaxCent: 10 };
}
function auth() {
  // Keine vom Browser gelieferten URLs. Vorhandene serverseitige Zugangsdaten und Mandantennummer wiederverwenden.
  const base = process.env.KFZ_API_BASE_URL?.replace(/\/$/, '');
  if (!base || !/^https:\/\/api\.kfz-api\.de\/dropshipping-api\/[1-9]\d*\/2\.3\.0$/.test(base) || !process.env.KFZ_API_LOGIN || !process.env.KFZ_API_PASSWORD) fail(503, 'KFZ-API-Zugang nicht eingerichtet.');
  return { base: `${base}/kennzeichen`, header: `Basic ${Buffer.from(`${process.env.KFZ_API_LOGIN}:${process.env.KFZ_API_PASSWORD}`).toString('base64')}` };
}
async function external(path: string, body?: unknown, reference?: string): Promise<unknown> {
  const a = auth();
  try {
    const r = await fetch(`${a.base}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
      headers: { Authorization: a.header, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'Idempotency-Key': reference! }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000) });
    // Niemals den Anbieterfehler oder Zugangsdaten in Browser oder Logs übernehmen.
    if (!r.ok) fail(r.status === 429 ? 429 : r.status === 409 ? 409 : 502, r.status === 429 ? 'Anbieterlimit erreicht. Später erneut versuchen.' : 'KFZ-API derzeit nicht verfügbar. Dieselbe Referenz wiederverwenden.');
    const text = await r.text();
    if (text.length > 2_000_000) fail(502, 'API-Antwort zu groß.');
    return JSON.parse(text);
  } catch (e) {
    if (e instanceof KennzeichenError) throw e;
    return fail(502, 'KFZ-API nicht erreichbar. Dieselbe Referenz wiederverwenden.');
  }
}

/** Bedingtes UPSERT ist über alle Worker hinweg atomar; keine Prozesszähler für Kosten oder Limits. */
async function consume(key: string, amount: number, max: number) {
  if (max < amount) fail(429, 'Kosten- oder Anfragelimit erreicht.');
  const r = await (await getDb()).run(`INSERT INTO kennzeichen_limits (key, used, expires_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET used = used + excluded.used WHERE used + excluded.used <= ?`, key, amount, Date.now() + 300_000, max);
  if (!r.changes) fail(429, 'Kosten- oder Anfragelimit erreicht.');
}
export async function kennzeichenRate(actor: number | string) {
  await (await getDb()).run('DELETE FROM kennzeichen_limits WHERE expires_at < ?', Date.now());
  const bucket = Math.floor(Date.now() / 60_000);
  await consume(`minute:${bucket}:global`, 1, 60);
  await consume(`minute:${bucket}:actor:${hash(actor)}`, 1, 10);
}
async function cached<T>(key: string, parse: (v: unknown) => T, path: string, actor: number, refresh: boolean): Promise<T | null> {
  const db = await getDb();
  const c = await db.first<{ body: string; expires_at: number }>('SELECT body, expires_at FROM kennzeichen_cache WHERE key = ?', key);
  if (c && c.expires_at > Date.now()) return parse(JSON.parse(c.body));
  if (!refresh) return null;
  await kennzeichenRate(actor);
  // Ein einziger Metadatenabruf je Minute; öffentliche Aufrufe lösen nie einen Abruf aus.
  await consume(`metadata:${Math.floor(Date.now() / 60_000)}:${key}`, 1, 1);
  let result: T;
  try { result = parse(await external(path)); } catch (e) {
    if (e instanceof KennzeichenError) throw e;
    return fail(502, 'Unbekanntes Anbieterformat. Keine Freigabe möglich.');
  }
  await db.run('INSERT INTO kennzeichen_cache (key, body, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET body = excluded.body, expires_at = excluded.expires_at', key, JSON.stringify(result), Date.now() + 3_600_000);
  return result;
}
export const getCatalog = (actor = 0, refresh = false) => cached('bezirke', (v) => catalogSchema.parse(v), '/bezirke', actor, refresh);
export const getRequirements = async (ks: string, actor = 0, refresh = false) => cached(`requirements:${ksValue(ks)}`, (v) => requirementsSchema.parse(v), `/bezirke/${ksValue(ks)}/anforderungen`, actor, refresh);
async function checkedPlate(input: unknown) {
  const p = plateSearchSchema.safeParse(input);
  if (!p.success) fail(422, 'Ungültige Kennzeichenangaben. Vollständige Kombination und Behörde erforderlich.');
  const plate = p.data!;
  const catalog = await getCatalog();
  if (!catalog || !catalog.bezirke.some((d) => d.ks === plate.ks && d.codes.includes(plate.uz))) fail(422, 'Bezirk und Kürzel im aktuellen Katalog auswählen.');
  return { plate, catalog: catalog! };
}
interface Operation { id: string; kind: string; actor_id: number; reference: string; fingerprint: string; request_json: string; response_json: string; state: string; job_id: string; created_at: string; updated_at: string }
async function operation(actor: number, kind: string, reference: unknown, payload: unknown, jobId = '') {
  const k = referenceSchema.safeParse(reference);
  if (!k.success) fail(422, 'Referenz muss 8–120 gültige Zeichen enthalten.');
  const db = await getDb(); const fingerprint = hash({ base: process.env.KFZ_API_BASE_URL, login: process.env.KFZ_API_LOGIN, payload });
  const id = randomUUID(); const at = now();
  const r = await db.run(`INSERT OR IGNORE INTO kennzeichen_operations
    (id, kind, actor_id, reference, fingerprint, request_json, state, job_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?)`, id, kind, actor, k.data!, fingerprint, JSON.stringify(payload), jobId, at, at);
  const row = (await db.first<Operation>('SELECT * FROM kennzeichen_operations WHERE reference = ?', k.data!))!;
  if (!row || row.actor_id !== actor || row.kind !== kind || row.fingerprint !== fingerprint) fail(409, 'Referenz bereits für andere Angaben verwendet.');
  return { row, created: !!r.changes };
}
export async function searchPlate(actor: number, input: unknown, reference: unknown) {
  if (!kennzeichenPolicy().searchEnabled) fail(423, 'Kostenpflichtige Kennzeichenabfragen sind gesperrt.');
  await kennzeichenRate(actor);
  const { plate, catalog } = await checkedPlate(input);
  if (catalog.preise.abfrageCent > 10 || catalog.preise.grundgebuehrCent !== 0) fail(423, 'Anbieterpreis überschreitet die Kostenfreigabe.');
  const { row } = await operation(actor, 'search', reference, plate);
  if (row.state === 'answered') return JSON.parse(row.response_json) as Record<string, unknown>;
  const db = await getDb();
  const claimed = await db.run("UPDATE kennzeichen_operations SET state = 'running', updated_at = ? WHERE id = ? AND (state IN ('prepared', 'uncertain') OR (state = 'running' AND updated_at < ?))", now(), row.id, new Date(Date.now() - 30_000).toISOString());
  if (!claimed.changes) fail(409, 'Anfrage läuft oder Annahme ist ungeklärt. Dieselbe Referenz beibehalten.');
  try {
    // Wiederholungen derselben Referenz belegen dasselbe Budget. Ein Timeout gibt Budget nicht frei.
    await db.run(`INSERT OR IGNORE INTO kennzeichen_budget (reference, day, cents)
      SELECT ?, ?, 10 WHERE (SELECT COALESCE(SUM(cents), 0) FROM kennzeichen_budget WHERE day = ?) + 10 <= ?`,
      row.reference, now().slice(0, 10), now().slice(0, 10), kennzeichenPolicy().dailyBudgetCent);
    if (!await db.first('SELECT reference FROM kennzeichen_budget WHERE reference = ?', row.reference)) fail(429, 'Tagesbudget ausgeschöpft.');
    const value = await external('/search', plate, row.reference) as Record<string, unknown>;
    if (!value || typeof value !== 'object' || !['AVAILABLE', 'NOT_AVAILABLE', 'UNKNOWN'].includes(String(value.outcome)) || !Number.isInteger(value.kostenCent) || Number(value.kostenCent) < 0 || Number(value.kostenCent) > 10) fail(502, 'Unbekannte Verfügbarkeitsantwort.');
    const result = { outcome: value.outcome, frei: value.outcome === 'AVAILABLE', reservierbar: value.reservierbar === true, kostenCent: value.kostenCent, reference: row.reference };
    await db.run("UPDATE kennzeichen_operations SET state = 'answered', response_json = ?, updated_at = ? WHERE id = ?", JSON.stringify(result), now(), row.id);
    return result;
  } catch (e) {
    await db.run("UPDATE kennzeichen_operations SET state = 'uncertain', updated_at = ? WHERE id = ?", now(), row.id);
    throw e;
  }
}
export async function prepareReservation(actor: number, input: unknown, reference: unknown) {
  await kennzeichenRate(actor);
  const v = input as { plate?: unknown };
  await checkedPlate(v?.plate);
  const ks = plateSearchSchema.parse(v.plate).ks;
  const requirements = await getRequirements(ks);
  if (!requirements) fail(422, 'Aktuelle Behördenanforderungen zuerst laden.');
  let payload: ReturnType<typeof reservationPayload>;
  try { payload = reservationPayload(input, requirements!); } catch { return fail(422, 'Halterdaten oder Zustimmungen fehlen bzw. sind ungültig.'); }
  const { row } = await operation(actor, 'reservation', reference, payload);
  return { id: row.id, reference: row.reference, state: 'prepared', submitted: false, message: 'Entwurf gespeichert. Keine Reservierung ausgelöst.' };
}
export async function listKennzeichen() {
  // Keine Halterdaten oder PINs in Übersichtsantworten.
  return (await getDb()).all('SELECT id, kind, reference, state, job_id, created_at, updated_at FROM kennzeichen_operations ORDER BY created_at DESC LIMIT 100');
}
export async function importReservation(actor: number, jobId: string, reference: unknown) {
  if (!/^[A-Za-z0-9_-]{1,120}$/.test(jobId)) fail(422, 'Ungültige Vorgangsnummer.');
  if (!referenceSchema.safeParse(reference).success) fail(422, 'Ungültige Referenz.');
  await kennzeichenRate(actor);
  // Erst nach erfolgreicher Prüfung der Mandantenzuordnung speichern. POST wird nie an den Anbieter gesendet.
  const status = await reservationStatus(jobId);
  const { row } = await operation(actor, 'existing-reservation', reference, { jobId }, jobId);
  await (await getDb()).run('UPDATE kennzeichen_operations SET job_id = ?, state = ?, response_json = ?, updated_at = ? WHERE id = ?', jobId, status.status, JSON.stringify(status), now(), row.id);
  return { id: row.id, ...status };
}
async function reservationStatus(jobId: string) {
  const v = await external(`/reservations/${encodeURIComponent(jobId)}`) as Record<string, unknown>;
  if (!v || typeof v !== 'object' || typeof v.status !== 'string' || !/^[a-z_]{1,40}$/.test(v.status) || (v.pin !== undefined && typeof v.pin !== 'string')) fail(502, 'Unbekanntes Reservierungsformat.');
  if (v.status === 'reserved' && (typeof v.pin !== 'string' || !v.pin || v.pin.length > 200)) fail(502, 'Reservierung noch ohne gültige PIN.');
  return { status: v.status as string, ...(v.status === 'reserved' && typeof v.pin === 'string' && v.pin ? { pin: v.pin } : {}) };
}
export async function refreshReservation(actor: number, id: string) {
  const db = await getDb();
  const row = await db.first<Operation>('SELECT * FROM kennzeichen_operations WHERE id = ?', id);
  if (!row?.job_id) fail(404, 'Keine bestehende Reservierung zugeordnet.');
  await kennzeichenRate(actor);
  const result = await reservationStatus(row!.job_id);
  await db.run('UPDATE kennzeichen_operations SET state = ?, response_json = ?, updated_at = ? WHERE id = ?', result.status, JSON.stringify(result), now(), id);
  return result;
}
export async function kennzeichenBudget() {
  return (await (await getDb()).first<{ used: number }>('SELECT COALESCE(SUM(cents), 0) AS used FROM kennzeichen_budget WHERE day = ?', now().slice(0, 10)))?.used ?? 0;
}

/** Nach einem Browser-/Worker-Abbruch dieselbe gespeicherte Suche fortsetzen, ohne neue Kostenreferenz. */
export async function retrySearch(actor: number, id: string) {
  const row = await (await getDb()).first<Operation>('SELECT * FROM kennzeichen_operations WHERE id = ?', id);
  if (!row || row.kind !== 'search' || row.actor_id !== actor) fail(404, 'Eigene Abfrage nicht gefunden.');
  return searchPlate(actor, JSON.parse(row!.request_json), row!.reference);
}
export async function kennzeichenDetail(id: string) {
  const row = await (await getDb()).first<Operation>('SELECT * FROM kennzeichen_operations WHERE id = ?', id);
  if (!row) fail(404, 'Vorgang nicht gefunden.');
  return { id: row!.id, kind: row!.kind, reference: row!.reference, state: row!.state, request: JSON.parse(row!.request_json), result: JSON.parse(row!.response_json) };
}
