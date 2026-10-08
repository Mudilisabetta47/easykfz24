import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildChecklist, isChecklistComplete } from '../src/lib/checklist.ts';
import { checkUpload, detectFileType, MAX_UPLOAD_BYTES, safeFileName } from '../src/lib/files.ts';
import { formatOrderNumber, normalizeOrderNumber, parseOrderNumber } from '../src/lib/order-number.ts';
import { SlidingWindowLimiter } from '../src/lib/rate-limit.ts';
import { checkAdminConfig, createSessionToken, passwordMatches, verifySessionToken } from '../src/lib/session.ts';

const bytes = (...b: (number | string)[]) =>
  new Uint8Array(b.flatMap((x) => (typeof x === 'string' ? [...x].map((c) => c.charCodeAt(0)) : [x])));

describe('Auftragsnummer', () => {
  it('formatiert EK-JJJJ-NNNNN', () => {
    assert.equal(formatOrderNumber(2026, 42), 'EK-2026-00042');
    assert.equal(formatOrderNumber(2026, 99999), 'EK-2026-99999');
    assert.throws(() => formatOrderNumber(2026, 0));
    assert.throws(() => formatOrderNumber(2026, 100000));
  });
  it('normalisiert Eingaben', () => {
    assert.equal(normalizeOrderNumber(' ek-2026-00042 '), 'EK-2026-00042');
    assert.equal(normalizeOrderNumber('EK 2026 42'), 'EK-2026-00042');
    assert.equal(normalizeOrderNumber('EK-2026-00000'), null);
    assert.equal(normalizeOrderNumber('XY-2026-00001'), null);
    assert.deepEqual(parseOrderNumber('EK-2026-00007'), { year: 2026, seq: 7 });
  });
});

describe('Dateityp über Magic Bytes', () => {
  it('erkennt PDF, JPEG, PNG, WebP, HEIC', () => {
    assert.equal(detectFileType(bytes('%PDF-1.7'))?.mime, 'application/pdf');
    assert.equal(detectFileType(bytes(0xff, 0xd8, 0xff, 0xe0))?.ext, 'jpg');
    assert.equal(detectFileType(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))?.ext, 'png');
    assert.equal(detectFileType(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))?.ext, 'webp');
    assert.equal(detectFileType(bytes(0, 0, 0, 24, 'ftyp', 'heic'))?.ext, 'heic');
  });
  it('lehnt getarnte und gefährliche Dateien ab', () => {
    assert.equal(detectFileType(bytes('<svg xmlns=')), null);
    assert.equal(detectFileType(bytes('<html>')), null);
    assert.equal(detectFileType(bytes('MZ', 0x90, 0)), null);
    assert.equal(detectFileType(bytes('PK', 3, 4)), null);
    assert.equal(detectFileType(bytes(0, 0, 0, 24, 'ftyp', 'avif')), null);
  });
  it('prüft Größe und Inhalt', () => {
    assert.equal(checkUpload('a.pdf', MAX_UPLOAD_BYTES + 1, bytes('%PDF-')).ok, false);
    assert.equal(checkUpload('a.pdf', 0, bytes('%PDF-')).ok, false);
    assert.equal(checkUpload('rechnung.pdf', 1000, bytes('<html>')).ok, false);
    assert.equal(checkUpload('scan.pdf', MAX_UPLOAD_BYTES, bytes('%PDF-')).ok, true);
  });
  it('säubert Dateinamen', () => {
    assert.equal(safeFileName('Führerschein "neu".pdf'), 'Fuhrerschein_neu_.pdf');
    assert.equal(safeFileName('../../etc/passwd'), 'etc_passwd');
    assert.equal(safeFileName('…'), 'dokument');
  });
});

describe('Ratenbegrenzung', () => {
  it('lässt N Versuche im Fenster zu und gibt danach wieder frei', () => {
    let t = 0;
    const l = new SlidingWindowLimiter(3, 1000, () => t);
    assert.equal(l.hit('ip').allowed, true);
    assert.equal(l.hit('ip').allowed, true);
    assert.equal(l.hit('ip').allowed, true);
    const blocked = l.hit('ip');
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.retryAfterMs, 1000);
    assert.equal(l.hit('andere-ip').allowed, true);
    t = 1001;
    assert.equal(l.check('ip').allowed, true);
    l.reset('andere-ip');
    assert.equal(l.check('andere-ip').remaining, 3);
  });
});

describe('Admin-Sitzung', () => {
  const secret = 'x'.repeat(40);
  const pw = 'sehr-geheimes-passwort';
  it('signiert und prüft Tokens', () => {
    const now = 1_800_000_000_000;
    const token = createSessionToken(secret, pw, now, 60);
    assert.equal(verifySessionToken(token, secret, pw, now + 1000), true);
    assert.equal(verifySessionToken(token, secret, pw, now + 61_000), false, 'abgelaufen');
    assert.equal(verifySessionToken(token, 'y'.repeat(40), pw, now), false, 'anderes Secret');
    assert.equal(verifySessionToken(token, secret, 'neues-passwort-123', now), false, 'Passwortwechsel beendet Sitzungen');
    const parts = token.split('.');
    parts[1] = String(Number(parts[1]) + 9999);
    assert.equal(verifySessionToken(parts.join('.'), secret, pw, now), false, 'manipuliertes Ablaufdatum');
    assert.equal(verifySessionToken(undefined, secret, pw, now), false);
    assert.equal(verifySessionToken('abc', secret, pw, now), false);
  });
  it('vergleicht Passwörter und prüft die Konfiguration', () => {
    assert.equal(passwordMatches(pw, pw), true);
    assert.equal(passwordMatches('falsch', pw), false);
    assert.notEqual(checkAdminConfig('kurz', secret), null);
    assert.notEqual(checkAdminConfig(pw, 'kurz'), null);
    assert.equal(checkAdminConfig(pw, secret), null);
  });
});

describe('Unterlagen-Checkliste', () => {
  it('enthält immer „Vollmacht im Original“', () => {
    for (const s of ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung', 'abmeldung'] as const) {
      assert.ok(buildChecklist(s, null).some((i) => i.key === 'vollmacht_original' && i.required), s);
    }
  });
  it('passt sich Leistung und Kennzeichenwahl an', () => {
    const behalten = buildChecklist('umzug', 'behalten').map((i) => i.key);
    const neu = buildChecklist('umzug', 'neu').map((i) => i.key);
    assert.ok(!behalten.includes('evb'));
    assert.ok(neu.includes('evb'));
    assert.ok(neu.includes('schilder_alt'));
    assert.ok(!behalten.includes('zb2_original'));
    assert.ok(buildChecklist('abmeldung', null).some((i) => i.key === 'schilder_alt'));
    assert.ok(buildChecklist('neuzulassung', 'neu').some((i) => i.key === 'coc_original'));
  });
  it('ist vollständig, wenn alle Pflichtpunkte abgehakt sind', () => {
    const items = buildChecklist('umzug', 'behalten');
    const state = Object.fromEntries(items.filter((i) => i.required).map((i) => [i.key, { checked: true, at: '' }]));
    assert.equal(isChecklistComplete(items, state), true);
    const first = items.find((i) => i.required)?.key ?? '';
    assert.equal(isChecklistComplete(items, { ...state, [first]: { checked: false, at: '' } }), false);
  });
});
