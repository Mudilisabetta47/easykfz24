// Reale Schema-12-Datei mit Bestandsauftrag und Dokument; App migriert lokal auf den aktuellen Stand (13 und folgende).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { it } from 'node:test';
import { MIGRATIONS, statements, getDb, schemaVersion } from '../src/server/db.ts';

it('Migration 12 → 13 erhält Bestandsauftrag, Dokument, Zahlungsfelder und Sperren unverändert', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ek-plate-migration-'));
  process.env.DATA_DIR = dir;
  const old = new DatabaseSync(path.join(dir, 'easykfz24.sqlite'));
  old.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (let i = 0; i < 12; i++) {
    for (const sql of statements(MIGRATIONS[i])) old.exec(sql);
    old.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(i + 1, '2026-10-14');
  }
  old.prepare(`INSERT INTO orders (number, created_at, updated_at, status, service, email, holder_name, fin, delivery, data_json, price_json, total_cents, consent_at)
    VALUES ('EK-2026-00001', '2026-10-14', '2026-10-14', 'neu', 'halterwechsel', 'test@example.de', 'Synthetisch', 'WVWZZZ1KZAW000001', 'abholung', '{}', '{}', 4999, '2026-10-14')`).run();
  old.prepare("INSERT INTO documents (id, order_id, kind, original_name, mime, size, stored_name, sha256, created_at) VALUES ('doc-1', 1, 'ausweis', 'test.pdf', 'application/pdf', 100, 'test.pdf', 'synthetic-hash', '2026-10-14')").run();
  // Zeilenabzug sämtlicher vorhandener Tabellen prüft auch Freigaben, Zahlungs-/QES-Spalten und Defaults.
  const tables = (old.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != 'schema_migrations'").all() as { name: string }[]).map((r) => r.name);
  const before = Object.fromEntries(tables.map((t) => [t, old.prepare(`SELECT * FROM ${t}`).all()]));
  old.close();
  const db = await getDb();
  assert.equal(await schemaVersion(), MIGRATIONS.length);
  for (const table of tables) assert.deepEqual(await db.all(`SELECT * FROM ${table}`), before[table], table);
  assert.equal((await db.all('PRAGMA integrity_check') as { integrity_check: string }[])[0].integrity_check, 'ok');
  for (const table of ['kennzeichen_cache', 'kennzeichen_operations', 'kennzeichen_budget', 'kennzeichen_limits']) assert.deepEqual(await db.all(`SELECT * FROM ${table}`), []);
  fs.rmSync(dir, { recursive: true, force: true });
});
