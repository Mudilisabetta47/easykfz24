// Integrationstest EasyKFZ24 OS Enterprise (lokale SQLite-Datei, gleiche Schnittstelle wie D1):
// Kundenstamm, Ereignisse ohne Doppelungen, Automatisierungen (idempotent), Freigabe vor Übermittlung,
// Rechnungen/Gutschriften, Webhook-Neuzustellung, Dubletten, Export.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { signKfzBody } from '../src/lib/kfz-api.ts';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { checkFin, stageOf } from '../src/lib/workflow.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-os-'));
process.env.KFZ_API_WEBHOOK_SECRET = 'os-test-secret';

const { getDb } = await import('../src/server/db.ts');
const orders = await import('../src/server/orders.ts');
const actions = await import('../src/server/os/order-actions.ts');
const { emit } = await import('../src/server/os/events.ts');
const finance = await import('../src/server/os/finance.ts');
const company = await import('../src/server/os/company.ts');
const customers = await import('../src/server/os/customers.ts');
const { handleKfzWebhook } = await import('../src/server/kfz-api.ts');
const { toCsv, toXlsx } = await import('../src/server/os/export.ts');

const ACTOR = { id: 0, name: 'Inhaber' };
const wait = () => new Promise((r) => setTimeout(r, 30));

function draft(email = 'max@example.de', fin = 'WVWZZZ1KZAW000001') {
  const d = emptyDraft('halterwechsel');
  d.vehicle = { art: 'pkw', hersteller: 'VW', modell: 'Golf', fin, bisherigesKennzeichen: 'HB-AB 12', antrieb: 'benzin', eKennzeichen: false, hKennzeichen: false };
  d.holder = { ...d.holder, typ: 'privat', vorname: 'Max', nachname: 'Muster', geburtsdatum: '1980-01-01', strasse: 'Weg', hausnummer: '2', plz: '28195', ort: 'Bremen', email, telefon: '0421 999888' };
  d.plate = { wahl: 'behalten', wunschkennzeichen: '', wunschort: '', schilder: false, ausfuehrung: 'standard', zustellung: 'abholung', versanddienst: '' };
  d.finish = { evb: 'a1b2c3d', kontoinhaber: 'Max Muster', iban: 'DE89 3704 0044 0532 0130 00', sepaMandat: true, vollmacht: true, datenschutz: true, hinweise: '' };
  return d;
}

async function newOrder(email?: string, fin?: string) {
  const v = validateOrder(draft(email, fin));
  assert.ok(v.ok);
  if (!v.ok) throw new Error('ungültig');
  // Kunde hat den vorzeitigen Leistungsbeginn verlangt – sonst wäre die Bearbeitung während der Widerrufsfrist gesperrt
  v.order.finish.vorzeitigerBeginnAt = new Date().toISOString();
  const created = await orders.createOrder(v.order, []);
  await actions.afterOrderCreated(created.id, 'website');
  await wait();
  return created;
}

const count = async (sql: string, ...p: (string | number)[]) => (await (await getDb()).first<{ n: number }>(sql, ...p))?.n ?? 0;

describe('Fachlogik', () => {
  it('prüft FIN-Format und Prüfziffer', () => {
    assert.equal(checkFin('WVWZZZ1KZAW00000I').ok, false);
    assert.equal(checkFin('1M8GDM9AXKP042788').checkDigit, 'stimmt');
    assert.equal(checkFin('WVWZZZ1KZAW000001').ok, true);
  });
  it('leitet die Arbeitsphase aus echten Feldern ab', () => {
    const base = { status: 'in_pruefung' as const, payment_status: 'offen', kfz_display: '', checklistComplete: true };
    assert.equal(stageOf(base), 'dokumente');
    assert.equal(stageOf({ ...base, payment_status: 'bezahlt' }), 'zahlung_bestaetigt');
    assert.equal(stageOf({ ...base, payment_status: 'bezahlt', released_at: 'x' }), 'bereit');
    assert.equal(stageOf({ ...base, status: 'bei_zulassungsstelle', kfz_display: 'in_bearbeitung' }), 'in_bearbeitung');
    assert.equal(stageOf({ ...base, kfz_display: 'fehlgeschlagen' }), 'fehler');
  });
});

describe('EasyKFZ24 OS Enterprise', () => {
  let first = { id: 0, number: '' };
  it('ordnet Bestellungen einem Kundenprofil zu und erkennt Bestandskunden', async () => {
    first = await newOrder('Max@Example.de');
    const second = await newOrder('max@example.de', 'WVWZZZ1KZAW000002');
    const db = await getDb();
    const a = await db.first<{ customer_id: number; vehicle_id: number }>('SELECT customer_id, vehicle_id FROM orders WHERE id = ?', first.id);
    const b = await db.first<{ customer_id: number }>('SELECT customer_id FROM orders WHERE id = ?', second.id);
    assert.ok(a?.customer_id);
    assert.equal(a?.customer_id, b?.customer_id, 'gleiche E-Mail (ohne Groß/Klein) = gleicher Kunde');
    assert.equal(await count('SELECT COUNT(*) AS n FROM customers'), 1);
    assert.equal(await count('SELECT COUNT(*) AS n FROM vehicles'), 2);
    const c = await db.first<{ category: string; number: string }>('SELECT category, number FROM customers WHERE id = ?', a!.customer_id);
    assert.equal(c?.category, 'Stammkunde', 'Automatisierung „Stammkunde“');
    assert.match(c?.number ?? '', /^K\d{6}$/);
    assert.equal(await count("SELECT COUNT(*) AS n FROM os_notifications WHERE kind = 'auftrag_neu'"), 2);
    assert.equal(await count("SELECT COUNT(*) AS n FROM os_notifications WHERE kind = 'bestandskunde'"), 1);
  });

  it('legt bei fehlenden Pflichtunterlagen genau eine Aufgabe an', async () => {
    assert.equal(await count("SELECT COUNT(*) AS n FROM tasks WHERE order_id = ? AND title LIKE 'Unterlagen anfordern%'", first.id), 1);
  });

  it('verarbeitet ein Ereignis mit gleichem Schlüssel nur einmal', async () => {
    const a = await emit({ type: 'order.overdue', orderId: first.id, dedupeKey: 'test:einmal' });
    const b = await emit({ type: 'order.overdue', orderId: first.id, dedupeKey: 'test:einmal' });
    assert.ok(a);
    assert.equal(b, null);
    assert.equal(await count("SELECT COUNT(*) AS n FROM os_notifications WHERE dedupe_key = 'n:test:einmal'"), 1);
  });

  it('Zahlung bestätigt → Auftrag automatisch in Prüfung (einmalig)', async () => {
    assert.deepEqual(await actions.actPayment(first.id, 'bezahlt', 'TEST', ACTOR), { ok: true });
    await wait();
    assert.equal((await orders.getOrder(first.id))?.status, 'in_pruefung');
    assert.equal(await count("SELECT COUNT(*) AS n FROM automation_runs WHERE rule_id = 'zahlung_zur_pruefung' AND result = 'ausgeführt'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM payments WHERE order_id = ? AND status = 'bezahlt'", first.id), 1);
  });

  it('Verbraucher ohne verlangten vorzeitigen Beginn: Bearbeitung, Freigabe und Partner-Verknüpfung gesperrt, Stornierung möglich', async () => {
    const v = validateOrder(draft('wartet@example.de', 'WVWZZZ1KZAW000777'));
    assert.ok(v.ok);
    if (!v.ok) return;
    const waiting = await orders.createOrder(v.order, []);
    const st = await actions.actStatus(waiting.id, 'in_pruefung', '', '', ACTOR);
    assert.equal(st.ok, false);
    assert.match(String(!st.ok && st.error), /Widerrufsfrist läuft/);
    assert.match(String((await actions.actRelease(waiting.id, true, ACTOR) as { error?: string }).error), /Widerrufsfrist läuft/);
    const { linkKfzOrder } = await import('../src/server/kfz-api.ts');
    assert.match(String((await linkKfzOrder(waiting.id, 'KFZ-WARTET-1') as { error?: string }).error), /Widerrufsfrist läuft/);
    const insights = await actions.orderInsights((await orders.getOrder(waiting.id))!);
    assert.ok(insights.issues.some((i) => i.code === 'widerrufsfrist'));
    assert.deepEqual(await actions.actStatus(waiting.id, 'storniert', '', 'Widerruf', ACTOR), { ok: true });
    // Firmenkunde: kein gesetzliches Widerrufsrecht → keine Sperre
    const f = draft('firma@example.de', 'WVWZZZ1KZAW000778');
    f.holder = { ...f.holder, typ: 'firma', firmenname: 'Muster GmbH', ansprechpartner: 'Max Muster' };
    const fv = validateOrder(f);
    assert.ok(fv.ok, JSON.stringify(!fv.ok && fv.errors));
    if (!fv.ok) return;
    const firm = await orders.createOrder(fv.order, []);
    assert.deepEqual(await actions.actStatus(firm.id, 'in_pruefung', '', '', ACTOR), { ok: true });
  });

  it('verlangt die manuelle Freigabe vor der Übergabe und blockiert unvollständige Aufträge', async () => {
    const blocked = await actions.actStatus(first.id, 'bei_zulassungsstelle', '', '', ACTOR);
    assert.equal(blocked.ok, false);
    const r1 = await actions.actRelease(first.id, true, ACTOR);
    assert.equal(r1.ok, false, 'Checkliste und Sicherheitscodes fehlen');
    const o = await orders.getOrder(first.id);
    for (const item of o!.checklistItems) await actions.actChecklist(first.id, item.key, true, ACTOR);
    for (const key of ['code_zb1', 'code_zb2', 'code_plaketten']) await actions.actRegCheck(first.id, key, true, ACTOR);
    // Halterwechsel: ohne vom Partner bestätigte QES-Vollmacht keine Freigabe (Partnervertrag § 3)
    const noQes = await actions.actRelease(first.id, true, ACTOR);
    assert.ok(!noQes.ok && /Digitale Vollmacht nicht vom Partner/.test(noQes.error));
    // Stand wie nach dem Abgleich über die Partner-Schnittstelle (Ablauf selbst: tests/power-of-attorney.test.ts)
    await (await getDb()).run(
      "INSERT INTO power_of_attorneys (order_id, attempt, external_order_id, process_id, status, ready, created_at, updated_at) VALUES (?, 1, 'T-V1', 4711, 'signiert', 1, ?, ?)",
      first.id,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    // zweiter Auftrag mit anderer FIN läuft parallel – kein Doppelzulassungs-Konflikt
    const r2 = await actions.actRelease(first.id, true, ACTOR);
    assert.deepEqual(r2, { ok: true });
    assert.deepEqual(await actions.actStatus(first.id, 'bei_zulassungsstelle', '', '', ACTOR), { ok: true });
  });

  it('erkennt einen zweiten laufenden Auftrag mit derselben FIN als Fehler', async () => {
    const dup = await newOrder('andere@example.de', 'WVWZZZ1KZAW000001');
    const o = await orders.getOrder(dup.id);
    const insight = await actions.orderInsights(o!);
    assert.ok(insight.issues.some((i) => i.code === 'doppelt'));
  });

  it('stellt Rechnungen nur mit vollständigen Firmendaten aus und korrigiert per Gutschrift', async () => {
    const fail = await finance.issueInvoice(first.id, 'Test');
    assert.equal(fail.ok, false);
    assert.deepEqual(
      await company.setCompany({ name: 'MONVEX UG (haftungsbeschränkt) i. G.', street: 'Teststraße 1', zip: '28195', city: 'Bremen', taxNumber: '12/345/67890', taxMode: 'regel', vatRate: 19 }, 'Test'),
      { ok: true },
    );
    const inv = await finance.issueInvoice(first.id, 'Test');
    assert.ok(inv.ok);
    if (!inv.ok) return;
    assert.match(inv.number, /^RE-\d{4}-00001$/);
    const again = await finance.issueInvoice(first.id, 'Test');
    assert.equal(again.ok, false, 'keine zweite Rechnung ohne Korrektur');
    const detail = await finance.getInvoice(inv.id);
    assert.equal(detail!.net_cents + detail!.vat_cents, detail!.gross_cents);
    assert.equal(detail!.lines.reduce((a, l) => a + l.grossCents, 0), detail!.gross_cents);
    assert.ok(!detail!.lines.some((l) => l.label.startsWith('Abgleich')), 'Positionen ergeben den Betrag ohne Ausgleichszeile');
    assert.equal(detail!.lines.filter((l) => l.grossCents < 0).length, (await orders.getOrder(first.id))!.price.lines.filter((l) => l.cents < 0).length, 'Rabatt nicht doppelt');
    const credit = await finance.issueCredit(inv.id, 'Test-Korrektur', 'Test');
    assert.ok(credit.ok);
    if (credit.ok) assert.match(credit.number, /^GS-\d{4}-00001$/);
    assert.ok((await finance.issueInvoice(first.id, 'Test')).ok, 'nach Gutschrift neue Rechnung möglich');
  });

  it('erzeugt bei Webhook-Neuzustellung weder doppelte Ereignisse noch Benachrichtigungen', async () => {
    const body = JSON.stringify({ order: { id: 777, externalId: first.number }, businessTransaction: 'UG', status: 'FAILED', derivedStatus: 'FAILURE' });
    const headers = new Headers({ 'x-signature': signKfzBody(body, 'os-test-secret'), 'x-event-id': 'evt-os-1' });
    const a = await handleKfzWebhook(body, headers);
    await a.after?.();
    const b = await handleKfzWebhook(body, headers);
    await b.after?.();
    assert.equal(a.result.status, 200);
    assert.equal((b.result.body as { duplicate?: boolean }).duplicate, true);
    assert.equal(await count("SELECT COUNT(*) AS n FROM os_events WHERE dedupe_key = 'kfz:evt-os-1'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM os_notifications WHERE kind = 'zulassung_abgelehnt'"), 1);
    assert.equal(await count("SELECT COUNT(*) AS n FROM tasks WHERE title LIKE 'Zulassung abgelehnt%'"), 1, 'Automatisierung „API-Fehler“ einmalig');
  });

  it('findet Dubletten und führt Kunden zusammen', async () => {
    const r = await customers.createCustomer({ type: 'privat', first_name: 'Max', last_name: 'Muster', phone: '0421-999888', zip: '28195' }, 'Test');
    assert.ok(r.ok);
    if (!r.ok) return;
    const groups = await customers.findDuplicates();
    assert.ok(groups.some((g) => g.ids.includes(r.id)));
    const target = (await (await getDb()).first<{ customer_id: number }>('SELECT customer_id FROM orders WHERE id = ?', first.id))!.customer_id;
    assert.deepEqual(await customers.mergeCustomers(target, r.id, 'Test'), { ok: true });
    assert.equal(await count('SELECT COUNT(*) AS n FROM customers WHERE id = ?', r.id), 0);
  });

  it('exportiert CSV ohne Formel-Injektion und echtes XLSX', () => {
    const csv = new TextDecoder().decode(toCsv(['A', 'B'], [['=1+1', 'x;y']]));
    assert.ok(csv.includes("'=1+1"));
    assert.ok(csv.includes('"x;y"'));
    const x = toXlsx('Test', ['A'], [['Wert'], [12.5]]);
    assert.equal(x[0], 0x50);
    assert.equal(x[1], 0x4b);
  });
});
