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
import { getDb } from '../db.ts';
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
