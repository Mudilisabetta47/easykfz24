// SQLite über node:sqlite. Eine Verbindung pro Prozess (auch über Hot-Reloads hinweg).

import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

export function uploadsDir(): string {
  return path.join(dataDir(), 'uploads');
}

const MIGRATIONS: string[] = [
  `
  CREATE TABLE orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    status TEXT NOT NULL,
    service TEXT NOT NULL,
    email TEXT NOT NULL,
    holder_name TEXT NOT NULL,
    fin TEXT NOT NULL,
    previous_plate TEXT NOT NULL DEFAULT '',
    assigned_plate TEXT NOT NULL DEFAULT '',
    iban TEXT NOT NULL DEFAULT '',
    delivery TEXT NOT NULL,
    data_json TEXT NOT NULL,
    price_json TEXT NOT NULL,
    total_cents INTEGER NOT NULL,
    checklist_json TEXT NOT NULL DEFAULT '{}',
    consent_at TEXT NOT NULL
  );
  CREATE INDEX orders_status ON orders(status, created_at);
  CREATE INDEX orders_email ON orders(email);

  CREATE TABLE order_counters (
    year INTEGER PRIMARY KEY,
    last INTEGER NOT NULL
  );

  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    original_name TEXT NOT NULL,
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    stored_name TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX documents_order ON documents(order_id);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    type TEXT NOT NULL,
    from_status TEXT,
    to_status TEXT,
    message TEXT NOT NULL DEFAULT '',
    public_message TEXT NOT NULL DEFAULT '',
    actor TEXT NOT NULL
  );
  CREATE INDEX events_order ON events(order_id, at);

  CREATE TABLE notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    text TEXT NOT NULL
  );
  CREATE INDEX notes_order ON notes(order_id, at);
  `,
  // v2: Versandpartner, Sendungsnummer, Zahlung
  `
  ALTER TABLE orders ADD COLUMN carrier TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN tracking_number TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT 'offen';
  ALTER TABLE orders ADD COLUMN payment_ref TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN payment_token TEXT NOT NULL DEFAULT '';
  `,
];

function migrate(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as { user_version: number };
  for (let v = row.user_version; v < MIGRATIONS.length; v++) {
    db.exec('BEGIN');
    try {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
      db.exec('COMMIT');
    } catch (e) {
      db.exec('ROLLBACK');
      throw e;
    }
  }
}

const g = globalThis as unknown as { __ekDb?: DatabaseSync; __ekSchema?: number };

export function getDb(): DatabaseSync {
  if (!g.__ekDb) {
    fs.mkdirSync(uploadsDir(), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(dataDir(), 'easykfz24.sqlite'));
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    g.__ekDb = db;
  }
  // Auch nach Hot-Reloads mit neuen Migrationen sicherstellen, dass das Schema aktuell ist.
  if (g.__ekSchema !== MIGRATIONS.length) {
    migrate(g.__ekDb);
    g.__ekSchema = MIGRATIONS.length;
  }
  return g.__ekDb;
}

/** Führt fn in einer Schreibtransaktion aus (BEGIN IMMEDIATE verhindert doppelte Auftragsnummern). */
export function transaction<T>(fn: (db: DatabaseSync) => T): T {
  const db = getDb();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}
