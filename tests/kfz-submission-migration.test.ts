// Reale Schema-13-Datei mit Bestandsauftrag, Webhook-Ereignis und Vollmacht; Migration 14 legt nur die zwei neuen Tabellen an.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { it } from 'node:test';
import { MIGRATIONS, statements, getDb, schemaVersion } from '../src/server/db.ts';

it('Migration 13 → 14 erhält alle Bestandsdaten unverändert und legt order_secrets/kfz_submissions leer an', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-submission-migration-'));
  process.env.DATA_DIR = dir;
  const old = new DatabaseSync(path.join(dir, 'easykfz24.sqlite'));
  old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (let i = 0; i < 13; i++) {
    for (const sql of statements(MIGRATIONS[i])) old.exec(sql);
    old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(i + 1, '2026-10-17');
  }
  old
    .prepare(
      `INSERT INTO orders (number, created_at, updated_at, status, service, email, holder_name, fin, delivery, data_json, price_json, total_cents, consent_at, kfz_order_id, released_at)
    VALUES ('EK-2026-00001', '2026-10-17', '2026-10-17', 'bei_zulassungsstelle', 'abmeldung', 'test@example.de', 'Synthetisch', 'WVWZZZ1KZAW000001', 'abholung', '{}', '{}', 2999, '2026-10-17', '4711', '2026-10-17')`,
    )
    .run();
  old
    .prepare(
      `INSERT INTO kfz_webhook_events (event_id, received_at, last_seen_at, deliveries, outcome, order_id, kfz_order_id, external_id, business_transaction, status, derived_status, error, body_sha256, event_json)
    VALUES ('ev-1', '2026-10-17', '2026-10-17', 1, 'verarbeitet', 1, '4711', 'EK-2026-00001', 'AB', 'ACCEPTED', 'PENDING', '', 'hash', '{}')`,
    )
    .run();
  const tables = (
    old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'").all() as { name: string }[]
  ).map((r) => r.name);
  const before = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t}`).all()]));
  old.close();
  const db = await getDb();
  assert.equal(await schemaVersion(), MIGRATIONS.length);
  assert.ok(MIGRATIONS.length >= 14);
  for (const table of tables) assert.deepEqual(await db.all(`SELECT * FROM ${table}`), before[table], table);
  for (const table of ['order_secrets', 'kfz_submissions']) assert.deepEqual(await db.all(`SELECT * FROM ${table}`), []);
  assert.equal(((await db.all('PRAGMA integrity_check')) as { integrity_check: string }[])[0].integrity_check, 'ok');
  fs.rmSync(dir, { recursive: true, force: true });
});
