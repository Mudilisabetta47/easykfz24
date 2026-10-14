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

/**
 * Lange ID-Listen in Blöcken abfragen: Cloudflare D1 erlaubt höchstens 100 gebundene Parameter je Abfrage
 * (lokal mit SQLite fällt eine Überschreitung nicht auf). sql erhält die Platzhalter („?,?,…“) eines Blocks.
 */
export async function allIn<T>(db: Db, ids: Param[], sql: (placeholders: string) => string, extra: Param[] = [], size = 90): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const part = ids.slice(i, i + size);
    out.push(...(await db.all<T>(sql(part.map(() => '?').join(',')), ...part, ...extra)));
  }
  return out;
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

export const MIGRATIONS: string[] = [
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
  // v4: EasyKFZ24 OS – Benutzer mit Rollen, Protokoll kritischer Aktionen, Einstellungen
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL,
    pw_hash TEXT NOT NULL,
    pw_version TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    last_login_at TEXT NOT NULL DEFAULT ''
  );

  CREATE TABLE audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    user_id INTEGER,
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    target TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX audit_at ON audit_log(at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  );
  `,
  // v5: Notizen mit Autor und Papierkorb (gelöscht = deleted_at gesetzt, endgültig erst beim Leeren)
  `
  ALTER TABLE notes ADD COLUMN author TEXT NOT NULL DEFAULT '';
  ALTER TABLE notes ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE notes ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
  CREATE INDEX notes_deleted ON notes(deleted_at);
  `,
  // v6: EasyKFZ24 OS Enterprise – gemeinsame Datenbasis (nur Ergänzungen, bestehende Daten bleiben unverändert)
  `
  CREATE TABLE customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'privat',
    name TEXT NOT NULL,
    first_name TEXT NOT NULL DEFAULT '',
    last_name TEXT NOT NULL DEFAULT '',
    company TEXT NOT NULL DEFAULT '',
    register_no TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    email_norm TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    street TEXT NOT NULL DEFAULT '',
    house_no TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    category TEXT NOT NULL DEFAULT '',
    owner_id INTEGER,
    price_group TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    anonymized_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX customers_email ON customers(email_norm);
  CREATE INDEX customers_name ON customers(name);

  CREATE TABLE customer_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    street TEXT NOT NULL DEFAULT '',
    house_no TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX customer_locations_c ON customer_locations(customer_id);

  CREATE TABLE customer_contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    location_id INTEGER,
    name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX customer_contacts_c ON customer_contacts(customer_id);

  CREATE TABLE vehicles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
    fin TEXT NOT NULL,
    make TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    vehicle_type TEXT NOT NULL DEFAULT '',
    plate TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (customer_id, fin)
  );
  CREATE INDEX vehicles_fin ON vehicles(fin);

  ALTER TABLE orders ADD COLUMN customer_id INTEGER;
  ALTER TABLE orders ADD COLUMN vehicle_id INTEGER;
  ALTER TABLE orders ADD COLUMN assignee_id INTEGER;
  ALTER TABLE orders ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal';
  ALTER TABLE orders ADD COLUMN due_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN follow_up_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN released_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN released_by TEXT NOT NULL DEFAULT '';
  ALTER TABLE orders ADD COLUMN source TEXT NOT NULL DEFAULT 'website';
  ALTER TABLE orders ADD COLUMN reg_checks_json TEXT NOT NULL DEFAULT '{}';
  CREATE INDEX orders_customer ON orders(customer_id);
  CREATE INDEX orders_assignee ON orders(assignee_id);
  CREATE INDEX orders_status_created ON orders(status, created_at);
  CREATE INDEX orders_fin ON orders(fin);

  ALTER TABLE documents ADD COLUMN display_name TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN category TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN folder TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
  ALTER TABLE documents ADD COLUMN previous_id TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN superseded_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN expires_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN archived_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN deleted_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN deleted_by TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN uploaded_by TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN review_state TEXT NOT NULL DEFAULT '';
  ALTER TABLE documents ADD COLUMN review_note TEXT NOT NULL DEFAULT '';

  CREATE TABLE doc_folders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (order_id, path)
  );

  ALTER TABLE users ADD COLUMN email TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN totp_secret TEXT NOT NULL DEFAULT '';
  ALTER TABLE users ADD COLUMN totp_enabled_at TEXT NOT NULL DEFAULT '';

  CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    ip TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    revoked_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX sessions_user ON sessions(user_id, last_seen_at);

  CREATE TABLE tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'offen',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_at TEXT NOT NULL DEFAULT '',
    remind_at TEXT NOT NULL DEFAULT '',
    assignee_id INTEGER,
    order_id INTEGER,
    customer_id INTEGER,
    source TEXT NOT NULL DEFAULT 'manuell',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    done_at TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX tasks_assignee ON tasks(assignee_id, status);
  CREATE INDEX tasks_order ON tasks(order_id);

  CREATE TABLE task_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    at TEXT NOT NULL,
    author TEXT NOT NULL,
    text TEXT NOT NULL
  );

  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    at TEXT NOT NULL,
    provider TEXT NOT NULL,
    provider_ref TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'zahlung',
    status TEXT NOT NULL,
    amount_cents INTEGER NOT NULL,
    fee_cents INTEGER,
    method TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX payments_order ON payments(order_id);
  CREATE UNIQUE INDEX payments_ref ON payments(provider, provider_ref, kind, status) WHERE provider_ref != '';

  CREATE TABLE invoice_counters (
    series TEXT NOT NULL,
    year INTEGER NOT NULL,
    last INTEGER NOT NULL,
    PRIMARY KEY (series, year)
  );
  CREATE TABLE invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    number TEXT NOT NULL UNIQUE,
    kind TEXT NOT NULL DEFAULT 'rechnung',
    order_id INTEGER NOT NULL REFERENCES orders(id),
    customer_id INTEGER,
    refers_to INTEGER,
    issued_at TEXT NOT NULL,
    service_date TEXT NOT NULL DEFAULT '',
    net_cents INTEGER NOT NULL,
    vat_cents INTEGER NOT NULL,
    gross_cents INTEGER NOT NULL,
    passthrough_cents INTEGER NOT NULL DEFAULT 0,
    lines_json TEXT NOT NULL,
    seller_json TEXT NOT NULL,
    buyer_json TEXT NOT NULL,
    tax_mode TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX invoices_order ON invoices(order_id);

  CREATE TABLE vouchers (
    code TEXT PRIMARY KEY,
    label TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL DEFAULT 'betrag',
    value INTEGER NOT NULL,
    valid_from TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    max_uses INTEGER,
    used INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE mail_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    order_id INTEGER,
    customer_id INTEGER,
    direction TEXT NOT NULL DEFAULT 'aus',
    kind TEXT NOT NULL DEFAULT 'email',
    to_addr TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL,
    body TEXT NOT NULL,
    template_id TEXT NOT NULL DEFAULT '',
    state TEXT NOT NULL DEFAULT 'entwurf',
    error TEXT NOT NULL DEFAULT '',
    author TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT 'manuell'
  );
  CREATE INDEX messages_order ON messages(order_id, at);
  CREATE INDEX messages_customer ON messages(customer_id, at);

  CREATE TABLE os_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    type TEXT NOT NULL,
    order_id INTEGER,
    customer_id INTEGER,
    task_id INTEGER,
    actor TEXT NOT NULL DEFAULT '',
    payload_json TEXT NOT NULL DEFAULT '{}',
    dedupe_key TEXT NOT NULL UNIQUE
  );
  CREATE INDEX os_events_at ON os_events(at);
  CREATE INDEX os_events_order ON os_events(order_id, at);

  CREATE TABLE automation_rules (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE automation_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_id TEXT NOT NULL,
    run_key TEXT NOT NULL,
    at TEXT NOT NULL,
    event_id INTEGER,
    order_id INTEGER,
    result TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    UNIQUE (rule_id, run_key)
  );
  CREATE INDEX automation_runs_at ON automation_runs(at);

  CREATE TABLE os_notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    kind TEXT NOT NULL,
    priority TEXT NOT NULL DEFAULT 'normal',
    title TEXT NOT NULL,
    text TEXT NOT NULL DEFAULT '',
    order_id INTEGER,
    customer_id INTEGER,
    task_id INTEGER,
    user_id INTEGER,
    permission TEXT NOT NULL DEFAULT 'orders.read',
    dedupe_key TEXT NOT NULL UNIQUE
  );
  CREATE INDEX os_notifications_at ON os_notifications(at);
  CREATE TABLE notification_reads (
    user_id INTEGER NOT NULL,
    notification_id INTEGER NOT NULL,
    at TEXT NOT NULL,
    PRIMARY KEY (user_id, notification_id)
  );
  CREATE TABLE user_prefs (
    user_id INTEGER PRIMARY KEY,
    prefs_json TEXT NOT NULL DEFAULT '{}',
    read_until TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );
  `,
  // v7: Widerrufserklärungen über die elektronische Widerrufsfunktion (§ 356a BGB) – nur neue Tabelle, nichts wird verändert
  `
  CREATE TABLE withdrawals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT NOT NULL UNIQUE,
    received_at TEXT NOT NULL,
    name TEXT NOT NULL,
    contract TEXT NOT NULL,
    email TEXT NOT NULL,
    statement TEXT NOT NULL,
    order_id INTEGER,
    order_number TEXT NOT NULL DEFAULT '',
    confirmation_state TEXT NOT NULL DEFAULT '',
    confirmation_at TEXT NOT NULL DEFAULT '',
    handled_at TEXT NOT NULL DEFAULT '',
    handled_by TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX withdrawals_order ON withdrawals(order_id);
  CREATE INDEX withdrawals_received ON withdrawals(received_at);
  `,
  // v8: Digitale Vollmacht (kfz-api.de/Nect) – Zuordnung Vollmachtsvorgang ↔ Auftrag, verifizierter Stand; nur neue Tabelle
  `
  CREATE TABLE power_of_attorneys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    external_order_id TEXT NOT NULL UNIQUE,
    process_id INTEGER UNIQUE,
    status TEXT NOT NULL DEFAULT '',
    ready INTEGER NOT NULL DEFAULT 0,
    send_email INTEGER NOT NULL DEFAULT 1,
    with_sepa INTEGER NOT NULL DEFAULT 0,
    signature_url TEXT NOT NULL DEFAULT '',
    valid_until TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    missing_json TEXT NOT NULL DEFAULT '[]',
    blocking_json TEXT NOT NULL DEFAULT '[]',
    failure_category TEXT NOT NULL DEFAULT '',
    create_error TEXT NOT NULL DEFAULT '',
    partner_updated_at TEXT NOT NULL DEFAULT '',
    verified_at TEXT NOT NULL DEFAULT '',
    status_changed_at TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT '',
    check_error TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (order_id, attempt)
  );
  CREATE INDEX power_of_attorneys_order ON power_of_attorneys(order_id);
  CREATE INDEX power_of_attorneys_status ON power_of_attorneys(status, checked_at);
  `,
  // v9: Online-Zahlung über Mollie – Zahlungsversuche je Auftrag mit bestätigtem Stand; nur neue Tabelle
  `
  CREATE TABLE payment_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    provider TEXT NOT NULL,
    provider_id TEXT UNIQUE,
    idempotency_key TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL DEFAULT '',
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT '',
    checkout_url TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT '',
    expires_at TEXT NOT NULL DEFAULT '',
    paid_at TEXT NOT NULL DEFAULT '',
    refunded_cents INTEGER NOT NULL DEFAULT 0,
    charged_back_cents INTEGER NOT NULL DEFAULT 0,
    mismatch TEXT NOT NULL DEFAULT '',
    create_error TEXT NOT NULL DEFAULT '',
    checked_at TEXT NOT NULL DEFAULT '',
    check_error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (order_id, attempt)
  );
  CREATE INDEX payment_attempts_order ON payment_attempts(order_id);
  CREATE INDEX payment_attempts_status ON payment_attempts(status, checked_at);
  `,
  // v10: Transaktionsmails über das bestehende Nachrichtenprotokoll – Idempotenz-Schlüssel, HTML, Wiederholung, Nachweis
  `
  ALTER TABLE messages ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN mail_kind TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN html TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE messages ADD COLUMN next_attempt_at TEXT NOT NULL DEFAULT '';
  ALTER TABLE messages ADD COLUMN provider_id TEXT NOT NULL DEFAULT '';
  CREATE UNIQUE INDEX messages_dedupe ON messages(dedupe_key) WHERE dedupe_key != '';
  CREATE INDEX messages_retry ON messages(state, next_attempt_at);
  `,
  // v11: Testaufträge des Inhabers (digitale Vollmacht testen, ohne den Kunden-Checkout zu öffnen) – klar gekennzeichnet,
  // eigene Nummernfolge TEST-JJJJ-NNNNN, nie Zahlung, Freigabe, Partnerübermittlung oder Kundenmail
  `
  ALTER TABLE orders ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX orders_is_test ON orders(is_test);
  `,
];


/** Zerlegt eine Migration in einzelne Befehle (keine Semikolons in Zeichenketten der Migrationen). */
export function statements(sql: string): string[] {
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
