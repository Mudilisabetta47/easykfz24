// Widerrufsstrecke (Entwurf): amtliche Muster, § 356a BGB, keine ungeprüften Sonderregeln, Schalter, Speicherung.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { emptyDraft, validateOrder } from '../src/lib/order.ts';
import { PROVIDER, PROVIDER_NAME } from '../src/lib/site.ts';
import {
  CONFIRM_LABEL,
  orderNumberIn,
  receiptMail,
  REVIEW_ITEMS,
  validateWithdrawal,
  WITHDRAW_LABEL,
  WITHDRAWAL_FORM,
  withdrawalNotice,
  withdrawalStatement,
} from '../src/lib/withdrawal.ts';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-widerruf-'));
const { recordWithdrawal, listWithdrawals, withdrawalMode } = await import('../src/server/withdrawal.ts');
const orders = await import('../src/server/orders.ts');

const noticeText = () =>
  withdrawalNotice('https://easykfz24.de')
    .flatMap((s) => [s.heading, ...s.paragraphs])
    .join('\n');

describe('Widerrufsbelehrung nach amtlichem Muster (Anlage 1 zu Art. 246a EGBGB)', () => {
  it('Dienstleistung: 14 Tage ab Vertragsabschluss; Anbieter mit Anschrift, Telefon und E-Mail', () => {
    const t = noticeText();
    assert.match(t, /binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen/);
    assert.match(t, /vierzehn Tage ab dem Tag des Vertragsabschlusses\./);
    for (const v of [PROVIDER_NAME, PROVIDER.street, `${PROVIDER.zip} ${PROVIDER.city}`, PROVIDER.phone!, PROVIDER.email]) assert.ok(t.includes(v), v);
    assert.match(t, /Folgen des Widerrufs/);
    assert.match(t, /spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen/);
  });

  it('Baustein zur Online-Widerrufsfunktion mit Adresse und Eingangsbestätigung (Datum und Uhrzeit)', () => {
    const t = noticeText();
    assert.match(t, /online unter https:\/\/easykfz24\.de\/widerruf/);
    assert.match(t, /Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs/);
  });

  it('keine ungeprüften Sonderregeln zu vorzeitigem Beginn, Wertersatz oder Erlöschen in der Belehrung', () => {
    const t = noticeText();
    assert.ok(!/angemessenen Betrag|Wertersatz|erlischt|Erlöschen|vorzeitig|während der Widerrufsfrist beginnen/i.test(t));
    // nur als Prüfhinweis geführt
    assert.ok(REVIEW_ITEMS.some((r) => /Wertersatz/.test(r.topic)));
    assert.ok(REVIEW_ITEMS.some((r) => /Erlöschen/.test(r.topic)));
    assert.ok(REVIEW_ITEMS.some((r) => /Kennzeichenschilder/.test(r.topic)));
  });

  it('Muster-Widerrufsformular (Anlage 2) vollständig mit Anbieter', () => {
    assert.match(WITHDRAWAL_FORM.addressee, /^An MONVEX UG \(haftungsbeschränkt\) i\. G\., Kirchbachstraße 200, 28211 Bremen, E-Mail: kundenservice@easykfz24\.de:$/);
    assert.equal(WITHDRAWAL_FORM.lines.length, 6);
    assert.match(WITHDRAWAL_FORM.lines[0], /Hiermit widerrufe\(n\) ich\/wir \(\*\)/);
    assert.equal(WITHDRAWAL_FORM.footnote, '(*) Unzutreffendes streichen.');
  });
});

describe('Elektronische Widerrufsfunktion (§ 356a BGB)', () => {
  it('Beschriftungen „Vertrag widerrufen“ und „Widerruf bestätigen“', () => {
    assert.equal(WITHDRAW_LABEL, 'Vertrag widerrufen');
    assert.equal(CONFIRM_LABEL, 'Widerruf bestätigen');
  });

  it('Angaben: Name, Vertrag, E-Mail für die Eingangsbestätigung – geprüft und bereinigt', () => {
    const bad = validateWithdrawal({ name: ' ', contract: 'x', email: 'kein' });
    assert.ok(!bad.ok);
    assert.deepEqual(Object.keys(!bad.ok ? bad.errors : {}).sort(), ['contract', 'email', 'name']);
    const ok = validateWithdrawal({ name: '  Erika   Muster ', contract: 'Auftrag ek-2026-00012', email: 'Erika@Example.DE ' });
    assert.ok(ok.ok);
    assert.deepEqual(ok.ok && ok.value, { name: 'Erika Muster', contract: 'Auftrag ek-2026-00012', email: 'erika@example.de' });
    assert.equal(orderNumberIn('Auftrag ek-2026-00012 vom 1.10.'), 'EK-2026-00012');
    assert.equal(orderNumberIn('ohne Nummer'), '');
  });

  it('Eingangsbestätigung enthält Inhalt der Erklärung sowie Datum und Uhrzeit des Eingangs', () => {
    const v = { name: 'Erika Muster', contract: 'EK-2026-00012', email: 'erika@example.de' };
    const m = receiptMail(v, '2026-10-13T08:05:09.000Z', 'WR-20261013-ABC123');
    assert.match(m.subject, /Eingangsbestätigung/);
    assert.ok(m.text.includes(withdrawalStatement(v)));
    assert.match(m.text, /Eingegangen am: 13\. Oktober 2026 um 10:05:09 Uhr/);
    assert.ok(m.text.includes(PROVIDER_NAME));
  });

  it('Schalter: im Produktivbetrieb ohne Freischaltung aus, mit WIDERRUF_AKTIV=1 aktiv, lokal Vorschau', () => {
    const env = { ...process.env };
    // NODE_ENV ist im Typ schreibgeschützt – für den Test über einen veränderbaren Verweis setzen
    const e = process.env as Record<string, string | undefined>;
    try {
      e.NODE_ENV = 'production';
      delete process.env.WIDERRUF_AKTIV;
      assert.equal(withdrawalMode(), 'aus');
      process.env.WIDERRUF_AKTIV = '1';
      assert.equal(withdrawalMode(), 'aktiv');
      delete process.env.WIDERRUF_AKTIV;
      e.NODE_ENV = 'development';
      assert.equal(withdrawalMode(), 'vorschau');
    } finally {
      e.NODE_ENV = env.NODE_ENV;
      if (env.WIDERRUF_AKTIV === undefined) delete process.env.WIDERRUF_AKTIV;
      else process.env.WIDERRUF_AKTIV = env.WIDERRUF_AKTIV;
    }
  });

  it('speichert den Widerruf mit Eingangszeit, ordnet die Auftragsnummer zu und verändert den Auftrag nicht', async () => {
    const d = emptyDraft('abmeldung');
    d.vehicle = { ...d.vehicle, art: 'pkw', hersteller: 'VW', modell: 'Golf', fin: 'WVWZZZ1KZAW000777', bisherigesKennzeichen: 'HB-EK 12', antrieb: 'benzin' };
    d.holder = { ...d.holder, typ: 'privat', vorname: 'Erika', nachname: 'Muster', geburtsdatum: '1984-03-07', strasse: 'Weg', hausnummer: '1', plz: '28195', ort: 'Bremen', email: 'erika@example.de', telefon: '0421 123456' };
    d.plate = { ...d.plate, wahl: '', zustellung: 'abholung' };
    d.finish = { ...d.finish, vollmacht: true, datenschutz: true };
    const v = validateOrder(d);
    assert.ok(v.ok, JSON.stringify(!v.ok && v.errors));
    if (!v.ok) return;
    const created = await orders.createOrder(v.order, []);
    const before = await orders.getOrder(created.id);

    const r = await recordWithdrawal({ name: 'Erika Muster', contract: `Auftrag ${created.number.toLowerCase()}`, email: 'erika@example.de' });
    assert.ok(r.ok);
    if (!r.ok) return;
    assert.match(r.receipt.reference, /^WR-\d{8}-[0-9A-F]{6}$/);
    assert.ok(Math.abs(Date.parse(r.receipt.receivedAt) - Date.now()) < 60_000, 'Eingangszeit = jetzt');
    assert.equal(r.receipt.confirmation, 'nicht_konfiguriert', 'ohne E-Mail-Dienst kein Versand – Zustand wird festgehalten');
    const rows = await listWithdrawals();
    assert.equal(rows[0].order_id, created.id);
    assert.equal(rows[0].order_number, created.number);
    assert.equal(rows[0].confirmation_state, 'nicht_konfiguriert');
    const after = await orders.getOrder(created.id);
    assert.equal(after?.status, before?.status, 'Auftragsstatus unverändert');
    assert.equal(after?.payment_status, before?.payment_status, 'Zahlungsstatus unverändert');

    const unknown = await recordWithdrawal({ name: 'Max Muster', contract: 'Bestellung von letzter Woche', email: 'max@example.de' });
    assert.ok(unknown.ok, 'auch ohne Auftragsnummer angenommen');
    assert.equal((await listWithdrawals())[0].order_id, null);
    const invalid = await recordWithdrawal({ name: 'M', contract: '', email: 'x' });
    assert.ok(!invalid.ok);
  });
});
