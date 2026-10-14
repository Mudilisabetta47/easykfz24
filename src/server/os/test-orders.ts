// Testaufträge des Inhabers: den digitalen Vollmachtsprozess vollständig prüfen, ohne den Kunden-Checkout zu öffnen.
//   – nur der angemeldete Inhaber, serverseitig geprüft
//   – nur bei ausdrücklich eingeschaltetem Testmodus (VOLLMACHT_TESTMODUS=1, setzt der Inhaber in Cloudflare) UND in einem
//     vom Inhaber geöffneten, befristeten Testfenster (TEST_WINDOW_MINUTES, höchstens MAX_PER_WINDOW Testaufträge)
//   – eigene Nummernfolge TEST-JJJJ-NNNNN, gekennzeichnet (orders.is_test), nicht im Kundenstamm, nicht in Listen/Statistik
//   – nie Zahlung, Rechnung, Freigabe, Partnerübermittlung, Kundenmail oder Automatisierung
//   – Anlegen fordert KEINE Vollmacht an; ein echter (kostenpflichtiger) Nect-Vorgang braucht zusätzlich die Testfreigabe
//     genau dieses Auftrags (24 h, ein Versuch) und die bestätigte Vorschau mit Kosten (power-of-attorney.ts)
//   – Widerrufsfrist-, QES- und Freigabesperren gelten unverändert

import { POA_SERVICES } from '../../lib/power-of-attorney.ts';
import { validateOrder, type ValidatedOrder } from '../../lib/order.ts';
import type { Role } from '../../lib/permissions.ts';
import { getDb, q } from '../db.ts';
import { deleteBlobs } from '../blobs.ts';
import { createOrder } from '../orders.ts';
import { getExpressOffer } from '../express.ts';
import { getPlateOffer } from '../plates.ts';
import { placeByAgs } from '../regions.ts';
import { poaMode } from '../power-of-attorney.ts';

export const TEST_WINDOW_MINUTES = 120;
export const MAX_PER_WINDOW = 3;
const KEY = 'testauftrag_fenster';
const now = () => new Date().toISOString();

export interface TestActor {
  name: string;
  role: Role;
}
export interface TestWindow {
  openedBy: string;
  openedAt: string;
  expiresAt: string;
  /** im Fenster angelegte Testaufträge */
  created: number;
}

export async function getTestWindow(): Promise<TestWindow | null> {
  const row = await (await getDb()).first<{ value: string }>('SELECT value FROM settings WHERE key = ?', KEY);
  if (!row?.value) return null;
  try {
    const w = JSON.parse(row.value) as TestWindow;
    return typeof w.expiresAt === 'string' && Date.parse(w.expiresAt) > Date.now() ? w : null;
  } catch {
    return null;
  }
}

async function saveWindow(w: TestWindow | null, by: string): Promise<void> {
  const db = await getDb();
  if (!w) {
    await db.run('DELETE FROM settings WHERE key = ?', KEY);
    return;
  }
  await db.run(
    'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
    KEY,
    JSON.stringify(w),
    now(),
    by,
  );
}

/** Warum gerade kein Testauftrag möglich ist (null = möglich) – ohne Fenster-Prüfung */
function modeBlocker(actor: TestActor): string | null {
  if (actor.role !== 'inhaber') return 'Nur der Inhaber kann Testaufträge anlegen.';
  if (poaMode() !== 'test') return 'Testaufträge nur im ausdrücklich eingeschalteten Testmodus (VOLLMACHT_TESTMODUS=1 in Cloudflare, setzt der Inhaber).';
  return null;
}

export async function testOrderState(
  actor: TestActor,
): Promise<{ allowed: boolean; reason: string | null; window: TestWindow | null; minutes: number; maxPerWindow: number }> {
  const reason = modeBlocker(actor);
  return { allowed: !reason, reason, window: reason ? null : await getTestWindow(), minutes: TEST_WINDOW_MINUTES, maxPerWindow: MAX_PER_WINDOW };
}

/** Testfenster öffnen (befristet) oder sofort schließen – nur Inhaber, nur im Testmodus */
export async function setTestWindow(open: boolean, actor: TestActor): Promise<{ ok: true; window: TestWindow | null } | { ok: false; error: string }> {
  if (actor.role !== 'inhaber') return { ok: false, error: 'Nur der Inhaber kann das Testfenster öffnen oder schließen.' };
  if (!open) {
    await saveWindow(null, actor.name);
    return { ok: true, window: null };
  }
  const blocked = modeBlocker(actor);
  if (blocked) return { ok: false, error: blocked };
  const t = Date.now();
  const w: TestWindow = {
    openedBy: actor.name,
    openedAt: new Date(t).toISOString(),
    expiresAt: new Date(t + TEST_WINDOW_MINUTES * 60_000).toISOString(),
    created: 0,
  };
  await saveWindow(w, actor.name);
  return { ok: true, window: w };
}

/**
 * Testauftrag anlegen: gleiche Prüfung wie die Website mit digitaler Vollmacht (Geburtsort Pflicht, nur Privatperson,
 * nur Zulassung/Ummeldung/Wiederzulassung). Zustimmung zum vorzeitigen Beginn nur, wenn ausdrücklich mitgegeben.
 */
export async function createTestOrder(
  raw: unknown,
  actor: TestActor,
): Promise<{ ok: true; id: number; number: string } | { ok: false; error: string; fields?: Record<string, string> }> {
  const blocked = modeBlocker(actor);
  if (blocked) return { ok: false, error: blocked };
  const w = await getTestWindow();
  if (!w) return { ok: false, error: `Kein offenes Testfenster – bitte zuerst öffnen (gilt ${TEST_WINDOW_MINUTES} Minuten).` };
  if (w.created >= MAX_PER_WINDOW) return { ok: false, error: `Im Testfenster sind höchstens ${MAX_PER_WINDOW} Testaufträge möglich.` };
  const v = validateOrder(raw, {
    plateOffer: await getPlateOffer(),
    expressOffer: await getExpressOffer(),
    wishPlace: placeByAgs,
    requireBirthPlace: true,
    digitalPoa: true,
    // Vollmacht entsteht erst nach dem Anlegen über Nect; SEPA freiwillig (Testauftrag ist nie einreichbar)
    testOrder: true,
  });
  if (!v.ok) return { ok: false, error: 'Bitte die markierten Felder prüfen', fields: v.errors };
  const order: ValidatedOrder = v.order;
  if (!POA_SERVICES.includes(order.service))
    return { ok: false, error: 'Testaufträge nur für Zulassung, Ummeldung oder Wiederzulassung (dort ist die QES-Vollmacht nötig).' };
  if (order.holder.typ !== 'privat') return { ok: false, error: 'Testaufträge nur für Privatpersonen (digitale Vollmacht mit Nect).' };
  const f = (raw as { finish?: { vorzeitigerBeginn?: unknown; widerrufErlischt?: unknown } } | null)?.finish;
  const earlyStart = f?.vorzeitigerBeginn === true && f?.widerrufErlischt === true;
  if (earlyStart) order.finish.vorzeitigerBeginnAt = now();
  // Zähler vor dem Anlegen erhöhen (Doppelklick legt höchstens MAX_PER_WINDOW an)
  await saveWindow({ ...w, created: w.created + 1 }, actor.name);
  const created = await createOrder(order, [], { test: { actor: actor.name } });
  const db = await getDb();
  await db.run("UPDATE orders SET source = 'test' WHERE id = ?", created.id);
  if (earlyStart)
    await db.run(
      "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'Testauftrag: Zustimmung zum vorzeitigen Leistungsbeginn und Kenntnis vom Erlöschen durch den Inhaber erfasst', '', ?)",
      created.id,
      now(),
      actor.name,
    );
  return { ok: true, id: created.id, number: created.number };
}

/**
 * Testdaten nach dem Test entfernen (nur Inhaber, nur stornierte, nie übermittelte Testaufträge). Ein Testauftrag wird nie
 * eingereicht – es besteht keine Aufbewahrung nach Partnervertrag § 4 Abs. 6. Behalten werden nur Testnummer, Leistung,
 * Zeitpunkte, Verlauf und der Vollmachtsvorgang (Vorgangsnummer, Stand, Zeitpunkte) zur Prüfung der Partnerabrechnung.
 */
export async function anonymizeTestOrder(orderId: number, actor: TestActor): Promise<{ ok: true } | { ok: false; error: string }> {
  if (actor.role !== 'inhaber') return { ok: false, error: 'Nur der Inhaber kann Testdaten löschen.' };
  const db = await getDb();
  const o = await db.first<{ is_test: number; status: string; released_at: string; kfz_order_id: string; data_json: string; holder_name: string }>(
    'SELECT is_test, status, released_at, kfz_order_id, data_json, holder_name FROM orders WHERE id = ?',
    orderId,
  );
  if (!o) return { ok: false, error: 'Auftrag nicht gefunden' };
  if (!o.is_test) return { ok: false, error: 'Kein Testauftrag – echte Aufträge nur über die DSGVO-Löschung im Kundenstamm.' };
  if (o.status !== 'storniert') return { ok: false, error: 'Erst den Testauftrag stornieren (danach läuft nichts mehr).' };
  if (o.released_at || o.kfz_order_id)
    return { ok: false, error: 'Dem Testauftrag ist ein Partnervorgang zugeordnet – erst klären (Aufbewahrung prüfen), nicht löschen.' };
  if (o.holder_name === 'gelöscht (Testauftrag)') return { ok: false, error: 'Testdaten sind bereits gelöscht.' };
  const { getTestRelease } = await import('../power-of-attorney.ts');
  const release = await getTestRelease();
  if (release?.orderId === orderId && Date.parse(release.expiresAt) > Date.now()) return { ok: false, error: 'Erst die Testfreigabe zurückziehen.' };
  const d = JSON.parse(o.data_json) as ValidatedOrder;
  const holder = {
    ...d.holder,
    vorname: '',
    nachname: 'gelöscht',
    geburtsdatum: '',
    geburtsort: '',
    strasse: '',
    hausnummer: '',
    plz: '',
    ort: '',
    email: '',
    telefon: '',
  };
  const vehicle = { ...d.vehicle, fin: '', bisherigesKennzeichen: '' };
  const finish = { ...d.finish, evb: '', kontoinhaber: '', iban: '', hinweise: '' };
  const plate = { ...d.plate, wunschkennzeichen: '' };
  const docs = await db.all<{ id: string; stored_name: string }>('SELECT id, stored_name FROM documents WHERE order_id = ?', orderId);
  const at = now();
  await db.batch([
    q(
      "UPDATE orders SET data_json = ?, holder_name = 'gelöscht (Testauftrag)', email = '', iban = '', fin = '', previous_plate = '', assigned_plate = '', payment_token = '', updated_at = ? WHERE id = ?",
      JSON.stringify({ ...d, holder, vehicle, finish, plate }),
      at,
      orderId,
    ),
    q("UPDATE power_of_attorneys SET signature_url = '', note = '', missing_json = '[]', blocking_json = '[]' WHERE order_id = ?", orderId),
    q("UPDATE messages SET body = '', html = '', to_addr = '' WHERE order_id = ?", orderId),
    q('DELETE FROM documents WHERE order_id = ?', orderId),
    q(
      "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, 'Testdaten gelöscht (Personen-, Fahrzeug- und Kontodaten, Unterlagen); Vorgangsnummer und Stand der Vollmacht bleiben für die Abrechnungsprüfung', '', ?)",
      orderId,
      at,
      actor.name,
    ),
  ]);
  if (docs.length)
    await deleteBlobs(docs.map((x) => x.stored_name)).catch((e: unknown) =>
      console.error('[testauftrag] Dateien nicht vollständig entfernt:', (e as Error).message),
    );
  return { ok: true };
}
