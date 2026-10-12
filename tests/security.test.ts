import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hashPassword, verifyPassword } from '../src/lib/password.ts';
import { can, checkPasswordStrength, checkUsername, ROLE_PERMISSIONS } from '../src/lib/permissions.ts';
import { createUserSession, SESSION_ABSOLUTE_MAX_SECONDS, verifyUserSession } from '../src/lib/session.ts';

const SECRET = 'x'.repeat(40);

describe('Rollen', () => {
  it('Inhaber darf alles, Nur-lesen nichts ändern', () => {
    assert.ok(can('inhaber', 'users.manage'));
    assert.ok(!can('verwaltung', 'users.manage'));
    for (const p of ROLE_PERMISSIONS.lesen) assert.ok(!p.endsWith('.write') && !p.endsWith('.manage'), p);
    assert.ok(!can('sachbearbeitung', 'finance.read'));
    assert.ok(can('buchhaltung', 'finance.write'));
    assert.ok(!can('buchhaltung', 'docs.read'), 'Buchhaltung sieht keine Ausweisdokumente');
  });
  it('prüft Benutzernamen und Passwortstärke', () => {
    assert.equal(checkUsername('anna.m'), null);
    assert.ok(checkUsername('A'));
    assert.ok(checkPasswordStrength('kurz'));
    assert.ok(checkPasswordStrength('nurkleinbuchstaben'));
    assert.equal(checkPasswordStrength('Sicher-Passwort-2026'), null);
  });
});

describe('Passwort-Hash', () => {
  it('verifiziert richtige und lehnt falsche Passwörter ab', async () => {
    const h = await hashPassword('Sicher-Passwort-2026');
    assert.match(h, /^pbkdf2\$100000\$/);
    assert.equal(await verifyPassword('Sicher-Passwort-2026', h), true);
    assert.equal(await verifyPassword('Sicher-Passwort-2027', h), false);
    assert.equal(await verifyPassword('x', 'kaputt'), false);
  });
  it('erzeugt je Aufruf ein anderes Salz', async () => {
    assert.notEqual(await hashPassword('Sicher-Passwort-2026'), await hashPassword('Sicher-Passwort-2026'));
  });
});

describe('Sitzung v2', () => {
  const now = Date.parse('2026-10-12T10:00:00Z');
  it('gilt bis zum Leerlauf-Ablauf', () => {
    const t = createUserSession({ uid: 3, pwv: 'abc' }, SECRET, 15 * 60, now);
    assert.equal(verifyUserSession(t, SECRET, now + 14 * 60_000)?.uid, 3);
    assert.equal(verifyUserSession(t, SECRET, now + 16 * 60_000), null);
  });
  it('lehnt Manipulation und fremde Schlüssel ab', () => {
    const t = createUserSession({ uid: 3, pwv: 'abc' }, SECRET, 900, now);
    assert.equal(verifyUserSession(t.replace('v2.3.', 'v2.0.'), SECRET, now), null);
    assert.equal(verifyUserSession(t, 'y'.repeat(40), now), null);
    assert.equal(verifyUserSession('v1.123.abc.def', SECRET, now), null);
  });
  it('hält beim Verlängern die absolute Höchstdauer ein', () => {
    const iat = Math.floor(now / 1000);
    const late = now + (SESSION_ABSOLUTE_MAX_SECONDS - 60) * 1000;
    const t = createUserSession({ uid: 1, pwv: 'p', iat }, SECRET, 3600, late);
    assert.ok(verifyUserSession(t, SECRET, late));
    assert.equal(verifyUserSession(t, SECRET, late + 120_000), null, 'nach 12 Stunden ist Schluss');
  });
});

describe('Zwei-Faktor (TOTP, RFC 6238)', async () => {
  const { base32Encode, hotp, verifyTotp } = await import('../src/lib/totp.ts');
  const secret = base32Encode(new TextEncoder().encode('12345678901234567890'));
  it('erzeugt die Codes des RFC-Testvektors', async () => {
    assert.equal(secret, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(await hotp(secret, 1), '287082');
    assert.equal(await hotp(secret, 37037036), '081804');
  });
  it('akzeptiert ±1 Zeitfenster und lehnt falsche Codes ab', async () => {
    const t = 1111111109 * 1000;
    assert.equal(await verifyTotp(secret, '081804', t), 37037036);
    assert.equal(await verifyTotp(secret, '081804', t + 30_000), 37037036);
    assert.equal(await verifyTotp(secret, '000000', t), null);
    assert.equal(await verifyTotp(secret, 'abc', t), null);
  });
});

describe('Sitzungskennung', () => {
  it('trägt die registrierte Kennung im signierten Token', () => {
    const token = createUserSession({ uid: 3, pwv: 'abc', sid: 'Sitzung_12345' }, SECRET, 600);
    assert.equal(verifyUserSession(token, SECRET)?.sid, 'Sitzung_12345');
    const fresh = verifyUserSession(createUserSession({ uid: 3, pwv: 'abc' }, SECRET, 600), SECRET);
    assert.match(fresh?.sid ?? '', /^[A-Za-z0-9_-]{16}$/);
  });
});
