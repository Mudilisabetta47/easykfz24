import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { displayFor, normalizeKfzPlate, parseKfzEvent, signKfzBody, verifyKfzSignature } from '../src/lib/kfz-api.ts';

const SECRET = 'test-secret';
const EXAMPLE = {
  order: { id: 4711, externalId: 'EK-2026-00001' },
  businessTransaction: 'NZ',
  status: 'APPROVED_WITH_DOCUMENTS',
  derivedStatus: 'SUCCESS',
  licensePlate: 'OL-KR 100',
  files: [{ purposeType: 'CERTIFICATE', fileAccessKey: 'abc123' }],
};

describe('kfz-api Signatur', () => {
  it('akzeptiert die HMAC-SHA256-Signatur über den Rohtext', () => {
    const raw = JSON.stringify(EXAMPLE);
    assert.equal(verifyKfzSignature(raw, signKfzBody(raw, SECRET), SECRET), true);
    assert.equal(verifyKfzSignature(raw, signKfzBody(raw, SECRET).toUpperCase(), SECRET), true);
  });
  it('lehnt veränderte Rümpfe, falsche Schlüssel und fehlende Signaturen ab', () => {
    const raw = JSON.stringify(EXAMPLE);
    const sig = signKfzBody(raw, SECRET);
    assert.equal(verifyKfzSignature(raw.replace('4711', '4712'), sig, SECRET), false);
    assert.equal(verifyKfzSignature(raw, sig, 'anderes-secret'), false);
    assert.equal(verifyKfzSignature(raw, null, SECRET), false);
    assert.equal(verifyKfzSignature(raw, sig, ''), false);
  });
});

describe('kfz-api Ereignis', () => {
  it('liest das dokumentierte Beispiel', () => {
    const e = parseKfzEvent(EXAMPLE);
    assert.equal(e.hasOrder, true);
    assert.equal(e.orderId, '4711');
    assert.equal(e.externalId, 'EK-2026-00001');
    assert.equal(e.businessTransaction, 'NZ');
    assert.equal(e.status, 'APPROVED_WITH_DOCUMENTS');
    assert.deepEqual(e.files, [{ purposeType: 'CERTIFICATE', fileAccessKey: 'abc123' }]);
    assert.equal(normalizeKfzPlate(e.licensePlate), 'OL-KR 100');
  });
  it('erkennt Ereignisse ohne Auftrag (PING) und behält unbekannte Statuswerte', () => {
    const ping = parseKfzEvent({ type: 'PING' });
    assert.equal(ping.hasOrder, false);
    const unknown = parseKfzEvent({ order: { id: 1 }, status: 'SOMETHING_NEW' });
    assert.equal(unknown.status, null);
    assert.equal(unknown.rawStatus, 'SOMETHING_NEW');
  });
  it('liest Meldungen mit Code und Klartext', () => {
    const e = parseKfzEvent({ order: { id: 2 }, status: 'REJECTED', messages: [{ code: '00763', text: 'Angaben passen nicht zur eVB.' }, 'nur Text'] });
    assert.deepEqual(e.messages, [
      { code: '00763', text: 'Angaben passen nicht zur eVB.' },
      { code: '', text: 'nur Text' },
    ]);
  });
});

describe('kfz-api Anzeige', () => {
  it('ordnet die dokumentierten Statuswerte zu', () => {
    assert.equal(displayFor('ACCEPTED', null, null), 'in_bearbeitung');
    assert.equal(displayFor('FORWARDED', 'PENDING', null), 'in_bearbeitung');
    assert.equal(displayFor('APPROVED', 'SUCCESS', null), 'abgeschlossen');
    assert.equal(displayFor('REJECTED_WITH_DOCUMENTS', null, null), 'angaben_erforderlich');
    assert.equal(displayFor('FAILED', 'FAILURE', false), 'fehlgeschlagen');
    assert.equal(displayFor('FAILED', null, true), 'in_bearbeitung', 'vorübergehender Fehler');
  });
  it('nutzt derivedStatus, wenn status fehlt oder unbekannt ist', () => {
    assert.equal(displayFor(null, 'SUCCESS', null), 'abgeschlossen');
    assert.equal(displayFor(null, 'FAILURE', null), 'fehlgeschlagen');
    assert.equal(displayFor(null, null, null), null);
  });
});

describe('Kunden-E-Mail', () => {
  it('nennt Auftragsnummer und Stand, aber keine Fahrzeug- oder Halterdaten', async () => {
    const { buildStatusMail } = await import('../src/lib/notification-mail.ts');
    const m = buildStatusMail({ number: 'EK-2026-00002', display: 'abgeschlossen', statusUrl: 'https://easykfz24.de/status?nr=EK-2026-00002' });
    assert.equal(m.subject, 'Ihr Auftrag EK-2026-00002: Erfolgreich abgeschlossen');
    assert.ok(m.text.includes('https://easykfz24.de/status?nr=EK-2026-00002'));
    assert.ok(!/FIN|Kennzeichen [A-Z]|Halter:/.test(m.text));
    assert.ok(m.html.includes('Status ansehen'));
  });
  it('maskiert HTML in Werten', async () => {
    const { buildStatusMail } = await import('../src/lib/notification-mail.ts');
    const m = buildStatusMail({ number: '<b>x</b>', display: 'in_bearbeitung', statusUrl: 'https://x/"y' });
    assert.ok(!m.html.includes('<b>x</b>'));
    assert.ok(m.html.includes('&quot;y'));
  });
});
