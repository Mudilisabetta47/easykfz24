// Erzeugt die SQL-Datei für noch nicht angewendete Migrationen, damit sie VOR dem Deploy direkt auf D1
// ausgeführt werden können (ohne Abfragegrenze eines Worker-Aufrufs):
//   node --experimental-strip-types scripts/d1-migration-sql.mjs 5 > migration.sql
//   npx wrangler d1 execute easykfz24 --remote --file=migration.sql
// Die Datei trägt die Versionen in schema_migrations ein – die Laufzeit-Migration überspringt sie dann.

const from = Number(process.argv[2] ?? 1);
const { MIGRATIONS, statements } = await import('../src/server/db.ts');
const now = new Date().toISOString();
let out = '-- EasyKFZ24: Migrationen ab Version ' + from + ' (erzeugt ' + now + ')\n';
out += 'CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);\n';
for (let i = from - 1; i < MIGRATIONS.length; i++) {
  out += `\n-- Version ${i + 1}\n`;
  for (const sql of statements(MIGRATIONS[i])) out += sql.replace(/\s+/g, ' ').trim() + ';\n';
  out += `INSERT INTO schema_migrations (version, applied_at) VALUES (${i + 1}, '${now}');\n`;
}
process.stdout.write(out);
