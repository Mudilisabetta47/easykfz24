// Verzögerter Leistungsbeginn: Fristberechnung (deutsche Ortszeit) und Sperre für Verbraucher ohne Zustimmung.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { earlyStartWait, serviceStartFrom } from '../src/lib/withdrawal-period.ts';

const order = (created_at: string, typ = 'privat', vorzeitigerBeginnAt?: string) => ({
  created_at,
  data: { holder: { typ }, finish: { vorzeitigerBeginnAt } },
});

describe('Frist bis zum Bearbeitungsbeginn', () => {
  it('Vertragsschluss 1.10. → Frist endet 15.10. 24:00 → Beginn ab 16.10. 0:00 Uhr (Sommerzeit)', () => {
    assert.equal(serviceStartFrom('2026-10-01T10:00:00.000Z').toISOString(), '2026-10-15T22:00:00.000Z');
  });
  it('kurz vor Mitternacht deutscher Zeit zählt der deutsche Kalendertag', () => {
    // 31.10. 23:30 Uhr MEZ = 22:30 UTC → Beginn ab 15.11. 0:00 MEZ
    assert.equal(serviceStartFrom('2026-10-31T22:30:00.000Z').toISOString(), '2026-11-14T23:00:00.000Z');
  });
  it('über den Wechsel auf Winterzeit (25.10.2026) und den Monatswechsel', () => {
    assert.equal(serviceStartFrom('2026-10-20T08:00:00.000Z').toISOString(), '2026-11-03T23:00:00.000Z');
  });
});

describe('Sperre', () => {
  const created = '2026-10-01T10:00:00.000Z';
  it('Verbraucher ohne Zustimmung: gesperrt bis Fristende, danach frei', () => {
    assert.ok(earlyStartWait(order(created), Date.parse('2026-10-15T21:59:59Z')));
    assert.equal(earlyStartWait(order(created), Date.parse('2026-10-15T22:00:00Z')), null);
  });
  it('mit verlangtem vorzeitigem Beginn oder als Firma: nicht gesperrt', () => {
    assert.equal(earlyStartWait(order(created, 'privat', '2026-10-01T10:00:00.000Z'), Date.parse('2026-10-02T00:00:00Z')), null);
    assert.equal(earlyStartWait(order(created, 'firma'), Date.parse('2026-10-02T00:00:00Z')), null);
  });
});

describe('Bestellbestätigung nennt den verzögerten Beginn', () => {
  it('ohne Zustimmung: frühester Bearbeitungsbeginn statt „sobald vollständig“', async () => {
    const { orderContractInfo } = await import('../src/lib/mail-templates.ts');
    const base = {
      createdAt: '2026-10-01T10:00:00.000Z',
      serviceTitle: 'Abmeldung',
      lines: [],
      discountCents: 0,
      totalCents: 0,
      paymentStatus: 'offen' as const,
      payUrl: null,
      withdrawal: null,
      formUrl: null,
      earlyStartAt: null,
    };
    const waiting = orderContractInfo({ ...base, serviceStartFrom: serviceStartFrom(base.createdAt).toISOString() }).join(' ');
    assert.match(waiting, /erst nach Ablauf der Widerrufsfrist, frühestens am 16\.10\.2026/);
    assert.match(orderContractInfo(base).join(' '), /beginnt, sobald Angaben und Unterlagen vollständig vorliegen/);
  });
});
