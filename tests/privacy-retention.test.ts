// Datenschutzerklärung ↔ umgesetzte Löschfristen: Texte nennen genau die im Code verwendeten Fristen; die Löschroutine
// der Kennzeichenprüfung löscht nur öffentliche (pseudonyme) Vorgänge nach Ablauf und behält den Kostennachweis.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-privacy-'));
const { PRIVACY_SECTIONS } = await import('../src/lib/privacy.ts');
const { PUBLIC_SEARCH_RETENTION_DAYS, purgeKennzeichenData } = await import('../src/server/kennzeichen.ts');
const { PARTNER_RETENTION_DAYS } = await import('../src/server/os/partner-retention.ts');
const { getDb } = await import('../src/server/db.ts');

const text = PRIVACY_SECTIONS.flatMap((s) => [s.heading, ...s.blocks.map((b) => ('p' in b ? b.p : JSON.stringify(b)))]).join('\n');

describe('Datenschutzerklärung entspricht den umgesetzten Fristen', () => {
  it('nennt 90 Tage (Kennzeichenprüfung) und mindestens zwei Jahre (Antragsunterlagen) wie im Code', () => {
    assert.equal(PUBLIC_SEARCH_RETENTION_DAYS, 90);
    assert.ok(PARTNER_RETENTION_DAYS >= 2 * 365);
    assert.match(text, /löschen diese Angaben nach 90 Tagen/);
    assert.match(text, /mindestens zwei Jahre ab Antragstellung/);
    assert.match(text, /Eine gesetzliche Aufbewahrungspflicht machen wir hierfür nicht geltend/);
    assert.match(text, /Art\. 6 Abs\. 1 lit\. f DSGVO; unser berechtigtes Interesse besteht in diesem Nachweis/);
    assert.match(text, /IP-Adresse selbst speichern wir hierfür nicht/);
    assert.match(text, /kostenpflichtig; für Sie entstehen keine Kosten/);
    assert.match(text, /keine automatische Löschung eingerichtet/);
  });
});

describe('Löschroutine der Kennzeichenprüfung', () => {
  it('löscht öffentliche Vorgänge nach 90 Tagen, behält OS-Vorgänge, laufende Vorgänge und den Kostennachweis', async () => {
    const db = await getDb();
    const old = new Date(Date.now() - 91 * 86_400_000).toISOString();
    const recent = new Date(Date.now() - 5 * 86_400_000).toISOString();
    const add = (id: string, actor: number, at: string, state = 'answered') =>
      db.run(
        'INSERT INTO kennzeichen_operations (id, kind, actor_id, reference, fingerprint, request_json, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        id,
        'search',
        actor,
        `ref-${id}`,
        'fp',
        '{}',
        state,
        at,
        at,
      );
    await add('public-old', -12345, old);
    await add('public-new', -12345, recent);
    await add('public-running', -12345, old, 'running');
    await add('staff-old', 7, old);
    await db.run("INSERT INTO kennzeichen_budget (reference, day, cents) VALUES ('ref-public-old', '2026-07-01', 10)");
    await db.run(
      "INSERT INTO kennzeichen_limits (key, used, expires_at) VALUES ('minute:x', 1, ?), ('minute:y', 1, ?)",
      Date.now() - 1000,
      Date.now() + 60_000,
    );
    const r = await purgeKennzeichenData();
    assert.equal(r.operations, 1);
    const left = (await db.all<{ id: string }>('SELECT id FROM kennzeichen_operations ORDER BY id')).map((x) => x.id);
    assert.deepEqual(left, ['public-new', 'public-running', 'staff-old']);
    assert.equal(
      (await db.first<{ n: number }>("SELECT COUNT(*) AS n FROM kennzeichen_budget WHERE reference = 'ref-public-old'"))?.n,
      1,
      'Kostennachweis bleibt',
    );
    assert.deepEqual(
      (await db.all<{ key: string }>('SELECT key FROM kennzeichen_limits')).map((x) => x.key),
      ['minute:y'],
    );
  });
});
