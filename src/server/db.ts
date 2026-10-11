// Datenbank: Cloudflare D1 (Produktion) oder SQLite-Datei über node:sqlite (lokal, Tests).
// Einheitliche, asynchrone Schnittstelle; mehrere Schreibbefehle laufen über batch() atomar.
//
// Cloudflare: Bindung „DB“ (D1) in wrangler.jsonc. Die Bindungen stellt der OpenNext-Adapter unter
// globalThis[Symbol.for("__cloudflare-context__")].env bereit – ohne zusätzliche Abhängigkeit gelesen.

import path from 'node:path';

export type Param = string | number | null;
export interface Stmt {
  sql: string;
  params: Param[];
}
export const q = (sql: string, ...params: Param[]): Stmt => ({ sql, params });

export interface Db {
  readonly kind: 'd1' | 'sqlite';
  first<T>(sql: string, ...params: Param[]): Promise<T | null>;
  all<T>(sql: string, ...params: Param[]): Promise<T[]>;
  run(sql: string, ...params: Param[]): Promise<{ changes: number; lastRowId: number }>;
  /** Alle Befehle atomar – entweder alle oder keiner. */
  batch(stmts: Stmt[]): Promise<void>;
}

export function dataDir(): string {
  return path.resolve(process.env.DATA_DIR || path.join(process.cwd(), 'data'));
}

/* ---------- Cloudflare-Bindungen ---------- */

interface D1Result<T> {
  results?: T[];
  meta?: { changes?: number; last_row_id?: number };
}
interface D1Prepared {
  bind(...values: Param[]): D1Prepared;
  first<T>(): Promise<T | null>;
  all<T>(): Promise<D1Result<T>>;
  run(): Promise<D1Result<unknown>>;
}
interface D1Database {
  prepare(sql: string): D1Prepared;
  batch(stmts: D1Prepared[]): Promise<unknown[]>;
}
export interface R2Object {
  arrayBuffer(): Promise<ArrayBuffer>;
  httpMetadata?: { contentType?: string };
}
export interface R2Bucket {
  put(key: string, value: ArrayBuffer | Uint8Array, options?: { httpMetadata?: { contentType?: string } }): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string | string[]): Promise<void>;
}
interface CloudflareEnv {
  DB?: D1Database;
  UPLOADS?: R2Bucket;
}

/** Bindungen, wenn die App auf Cloudflare Workers läuft – sonst null. */
export function cloudflareEnv(): CloudflareEnv | null {
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] as { env?: CloudflareEnv } | undefined;
  return ctx?.env ?? null;
}

/**
 * Arbeit nach der Antwort zu Ende führen (z. B. E-Mail-Versand): Auf Cloudflare über ctx.waitUntil, damit der
 * Worker nicht vorher beendet wird; auf Node läuft das Promise einfach weiter.
 */
export function runAfter(work: Promise<unknown> | undefined): void {
  if (!work) return;
  const ctx = (globalThis as Record<symbol, unknown>)[Symbol.for('__cloudflare-context__')] as { ctx?: { waitUntil(p: Promise<unknown>): void } } | undefined;
  const guarded = work.catch((e) => console.error('[hintergrund]', (e as Error).message));
  if (ctx?.ctx?.waitUntil) ctx.ctx.waitUntil(guarded);
}

export function platform(): 'cloudflare' | 'node' {
  return cloudflareEnv() ? 'cloudflare' : 'node';
}

/* ---------- D1 ---------- */

function d1Db(d1: D1Database): Db {
  const prep = (sql: string, params: Param[]) => (params.length ? d1.prepare(sql).bind(...params) : d1.prepare(sql));
  return {
    kind: 'd1',
    first: <T>(sql: string, ...params: Param[]) => prep(sql, params).first<T>(),
    all: async <T>(sql: string, ...params: Param[]) => (await prep(sql, params).all<T>()).results ?? [],
    run: async (sql, ...params) => {
      const r = await prep(sql, params).run();
      return { changes: r.meta?.changes ?? 0, lastRowId: r.meta?.last_row_id ?? 0 };
    },
    batch: async (stmts) => {
      if (stmts.length) await d1.batch(stmts.map((s) => prep(s.sql, s.params)));
    },
  };
}

/* ---------- SQLite-Datei (lokal) ---------- */

type SqliteDb = {
  prepare(sql: string): {
    get(...p: Param[]): unknown;
    all(...p: Param[]): unknown[];
    run(...p: Param[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  };
  exec(sql: string): void;
};

const g = globalThis as unknown as { __ekSqlite?: SqliteDb; __ekReady?: Promise<Db> };

async function sqliteDb(): Promise<Db> {
  if (!g.__ekSqlite) {
    const fs = await import('node:fs');
    // Erst zur Laufzeit laden: Auf Cloudflare Workers gibt es node:sqlite nicht.
    const { DatabaseSync } = await import('node:sqlite');
    fs.mkdirSync(path.join(dataDir(), 'uploads'), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(dataDir(), 'easykfz24.sqlite')) as unknown as SqliteDb;
    db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    g.__ekSqlite = db;
  }
  const db = g.__ekSqlite;
  return {
    kind: 'sqlite',
    first: async <T>(sql: string, ...params: Param[]) => (db.prepare(sql).get(...params) as T | undefined) ?? null,
    all: async <T>(sql: string, ...params: Param[]) => db.prepare(sql).all(...params) as T[],
    run: async (sql, ...params) => {
      const r = db.prepare(sql).run(...params);
      return { changes: Number(r.changes), lastRowId: Number(r.lastInsertRowid) };
    },
    batch: async (stmts) => {
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const s of stmts) db.prepare(s.sql).run(...s.params);
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

/* ---------- Schema ---------- */

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
  // v3: kfz-api.de – Vorgang bei der Zulassungsschnittstelle, Webhook-Protokoll, Benachrichtigungen
  `
  ALTER TABLE orders ADD COLUMN kfz_order_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN kfz_transaction TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN kfz_status TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN kfz_display TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN kfz_updated_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN kfz_files_json TEXT NOT NULL DEFAULT '[]';
  ALTER TABLE orders ADD COLUMN kfz_messages_json TEXT NOT NULL DEFAULT '[]';
  CREATE INDEX orders_kfz ON orders(kfz_order_id);

  CREATE TABLE kfz_webhook_events (
    event_id TEXT PRIMARY KEY,
    received_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    deliveries INTEGER NOT NULL DEFAULT 1,
    outcome TEXT NOT NULL,
    order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
    kfz_order_id TEXT NOT NULL DEFAULT '',
    external_id TEXT NOT NULL DEFAULT '',
    business_transaction TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    derived_status TEXT NOT NULL DEFAULT '',
    error TEXT NOT NULL DEFAULT '',
    body_sha256 TEXT NOT NULL,
    event_json TEXT NOT NULL DEFAULT '{}'
  );
  CREATE INDEX kfz_events_received ON kfz_webhook_events(received_at);
  CREATE INDEX kfz_events_order ON kfz_webhook_events(order_id);

  CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    topic TEXT NOT NULL,
    subject TEXT NOT NULL,
    state TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX notifications_order ON notifications(order_id, at);
  `,
];


/** Zerlegt eine Migration in einzelne Befehle (keine Semikolons in Zeichenketten der Migrationen). */
function statements(sql: string): string[] {
  return sql
    .split(/;\s*(?:\n|$)/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function migrate(db: Db): Promise<void> {
  await db.run('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)');
  // Bestehende lokale Datenbanken wurden früher über PRAGMA user_version versioniert – einmalig übernehmen.
  if (db.kind === 'sqlite') {
    const legacy = (await db.first<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
    for (let v = 1; v <= legacy; v++) {
      await db.run('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)', v, new Date().toISOString());
    }
  }
  const done = new Set((await db.all<{ version: number }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  for (let i = 0; i < MIGRATIONS.length; i++) {
    const version = i + 1;
    if (done.has(version)) continue;
    try {
      await db.batch([
        ...statements(MIGRATIONS[i]).map((sql) => q(sql)),
        q('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', version, new Date().toISOString()),
      ]);
    } catch (e) {
      // Eine parallele Instanz kann dieselbe Migration gerade ausgeführt haben.
      const now = await db.first<{ version: number }>('SELECT version FROM schema_migrations WHERE version = ?', version);
      if (!now) throw e;
    }
  }
}

/** Datenbank mit aktuellem Schema. Auf Cloudflare D1 (Bindung „DB“), sonst die lokale SQLite-Datei. */
export async function getDb(): Promise<Db> {
  const env = cloudflareEnv();
  if (env) {
    if (!env.DB) throw new Error('Cloudflare-Bindung „DB“ (D1) fehlt – in wrangler.jsonc bzw. im Dashboard anlegen');
    const db = d1Db(env.DB);
    g.__ekReady ??= migrate(db).then(() => db);
    try {
      return await g.__ekReady;
    } catch (e) {
      g.__ekReady = undefined;
      throw e;
    }
  }
  const db = await sqliteDb();
  g.__ekReady ??= migrate(db).then(() => db);
  try {
    await g.__ekReady;
  } catch (e) {
    g.__ekReady = undefined;
    throw e;
  }
  return db;
}

/** Höchste ausgeführte Migration. */
export async function schemaVersion(): Promise<number> {
  const db = await getDb();
  return (await db.first<{ v: number }>('SELECT MAX(version) AS v FROM schema_migrations'))?.v ?? 0;
}

export const SCHEMA_VERSION = MIGRATIONS.length;
