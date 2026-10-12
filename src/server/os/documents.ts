// Dokumentenmanager: Ordner je Auftrag (+ Unterordner), Kategorien, Versionen, Umbenennen, Prüfvermerk,
// Ablaufdaten, Archiv, Papierkorb. Dateien liegen ausschließlich im privaten Speicher (R2 bzw. lokal) und
// werden nur über /api/admin/dokumente/:id (angemeldet, Recht docs.read, protokolliert) ausgeliefert.

import { createHash, randomBytes } from 'node:crypto';
import { checkUpload, MAX_UPLOAD_BYTES } from '../../lib/files.ts';
import { DOCUMENT_KINDS, DOCUMENTS } from '../../lib/services.ts';
import { getDb, q } from '../db.ts';
import { deleteBlobs, putBlob } from '../blobs.ts';
import { emitSafe } from './events.ts';

const now = () => new Date().toISOString();

export const DOC_CATEGORIES = ['Ausweis', 'Fahrzeugpapiere', 'Nachweise', 'Vollmacht', 'Bescheid', 'Rechnung', 'Korrespondenz', 'Sonstiges'] as const;
export const REVIEW_STATES = ['', 'geprueft', 'unleserlich', 'abgelaufen', 'falsch'] as const;

const KIND_CATEGORY: Record<string, string> = { ausweis: 'Ausweis', zb1: 'Fahrzeugpapiere', zb2: 'Fahrzeugpapiere', coc: 'Fahrzeugpapiere', hu: 'Nachweise', gutachten: 'Nachweise' };

export interface DocRow {
  id: string;
  order_id: number;
  kind: string;
  original_name: string;
  display_name: string;
  category: string;
  folder: string;
  mime: string;
  size: number;
  version: number;
  previous_id: string;
  superseded_at: string;
  expires_at: string;
  archived_at: string;
  deleted_at: string;
  deleted_by: string;
  uploaded_by: string;
  review_state: string;
  review_note: string;
  created_at: string;
  number?: string;
  holder_name?: string;
  customer_id?: number | null;
}

export function docLabel(d: Pick<DocRow, 'kind' | 'display_name' | 'original_name'>): string {
  return d.display_name || d.original_name;
}

export function docCategory(d: Pick<DocRow, 'kind' | 'category'>): string {
  return d.category || KIND_CATEGORY[d.kind] || 'Sonstiges';
}

const COLS =
  'd.id, d.order_id, d.kind, d.original_name, d.display_name, d.category, d.folder, d.mime, d.size, d.version, d.previous_id, d.superseded_at, d.expires_at, d.archived_at, d.deleted_at, d.deleted_by, d.uploaded_by, d.review_state, d.review_note, d.created_at, o.number, o.holder_name, o.customer_id';

/** Übersicht: Aufträge mit Dateizahlen (für den Ordnerbaum). */
export async function folderTree(filter: { q?: string; view?: 'aktiv' | 'archiv' | 'papierkorb' } = {}) {
  const db = await getDb();
  const view = filter.view ?? 'aktiv';
  const cond = view === 'papierkorb' ? "d.deleted_at != ''" : view === 'archiv' ? "d.deleted_at = '' AND d.archived_at != ''" : "d.deleted_at = '' AND d.archived_at = '' AND d.superseded_at = ''";
  const needle = filter.q?.trim().toLowerCase();
  const params: string[] = [];
  let extra = '';
  if (needle) {
    const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    extra = " AND (lower(o.number) LIKE ? ESCAPE '\\' OR lower(o.holder_name) LIKE ? ESCAPE '\\' OR lower(d.original_name) LIKE ? ESCAPE '\\' OR lower(d.display_name) LIKE ? ESCAPE '\\' OR lower(d.category) LIKE ? ESCAPE '\\')";
    params.push(like, like, like, like, like);
  }
  const rows = await db.all<{ order_id: number; number: string; holder_name: string; customer_id: number | null; files: number; size: number; expiring: number }>(
    `SELECT o.id AS order_id, o.number, o.holder_name, o.customer_id, COUNT(d.id) AS files, COALESCE(SUM(d.size), 0) AS size,
       SUM(CASE WHEN d.expires_at != '' AND d.expires_at < ? THEN 1 ELSE 0 END) AS expiring
     FROM documents d JOIN orders o ON o.id = d.order_id WHERE ${cond}${extra}
     GROUP BY o.id ORDER BY MAX(d.created_at) DESC LIMIT 1000`,
    new Date(Date.now() + 30 * 86_400_000).toISOString(),
    ...params,
  );
  const folders = await db.all<{ order_id: number; path: string }>('SELECT order_id, path FROM doc_folders ORDER BY path');
  const totals = await db.first<{ n: number; size: number }>(`SELECT COUNT(*) AS n, COALESCE(SUM(size), 0) AS size FROM documents d WHERE ${cond.replaceAll('d.', '')}`);
  return { orders: rows, folders, totals: { files: totals?.n ?? 0, bytes: totals?.size ?? 0 } };
}

export async function listDocs(filter: { orderId?: number; customerId?: number; view?: 'aktiv' | 'archiv' | 'papierkorb'; q?: string; category?: string; expiring?: boolean; limit?: number }) {
  const db = await getDb();
  const where: string[] = [];
  const params: (string | number)[] = [];
  const view = filter.view ?? 'aktiv';
  if (view === 'papierkorb') where.push("d.deleted_at != ''");
  else if (view === 'archiv') where.push("d.deleted_at = '' AND d.archived_at != ''");
  else where.push("d.deleted_at = '' AND d.archived_at = '' AND d.superseded_at = ''");
  if (filter.orderId) {
    where.push('d.order_id = ?');
    params.push(filter.orderId);
  }
  if (filter.customerId) {
    where.push('o.customer_id = ?');
    params.push(filter.customerId);
  }
  if (filter.expiring) {
    where.push("d.expires_at != '' AND d.expires_at < ?");
    params.push(new Date(Date.now() + 30 * 86_400_000).toISOString());
  }
  const needle = filter.q?.trim().toLowerCase();
  if (needle) {
    const like = `%${needle.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push("(lower(o.number) LIKE ? ESCAPE '\\' OR lower(o.holder_name) LIKE ? ESCAPE '\\' OR lower(d.original_name) LIKE ? ESCAPE '\\' OR lower(d.display_name) LIKE ? ESCAPE '\\' OR lower(d.review_note) LIKE ? ESCAPE '\\')");
    params.push(like, like, like, like, like);
  }
  params.push(Math.min(filter.limit ?? 1000, 5000));
  const rows = await db.all<DocRow>(`SELECT ${COLS} FROM documents d JOIN orders o ON o.id = d.order_id WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC LIMIT ?`, ...params);
  const filtered = filter.category ? rows.filter((r) => docCategory(r) === filter.category) : rows;
  return filtered.map((r) => ({ ...r, label: docLabel(r), categoryLabel: docCategory(r), kindLabel: DOCUMENTS[r.kind as keyof typeof DOCUMENTS]?.label ?? '', url: `/api/admin/dokumente/${r.id}` }));
}

export async function versions(id: string) {
  const db = await getDb();
  const chain: DocRow[] = [];
  let cur = await db.first<DocRow>(`SELECT ${COLS} FROM documents d JOIN orders o ON o.id = d.order_id WHERE d.id = ?`, id);
  // Neuere Versionen finden
  while (cur) {
    const newer = await db.first<DocRow>(`SELECT ${COLS} FROM documents d JOIN orders o ON o.id = d.order_id WHERE d.previous_id = ?`, cur.id);
    if (!newer) break;
    cur = newer;
  }
  while (cur && chain.length < 50) {
    chain.push(cur);
    cur = cur.previous_id ? await db.first<DocRow>(`SELECT ${COLS} FROM documents d JOIN orders o ON o.id = d.order_id WHERE d.id = ?`, cur.previous_id) : null;
  }
  return chain.map((r) => ({ ...r, label: docLabel(r), url: `/api/admin/dokumente/${r.id}` }));
}

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Upload im Explorer: Dateityp über den Inhalt geprüft (PDF/Bild), max. 10 MB, privat gespeichert. */
export async function uploadDoc(
  input: { orderId: number; name: string; bytes: Uint8Array; kind: string; category: string; folder: string; replaces?: string; expiresAt?: string },
  actor: string,
): Promise<R<{ id: string }>> {
  if (input.bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: 'Datei zu groß (max. 10 MB)' };
  const check = checkUpload(input.name, input.bytes.byteLength, input.bytes.subarray(0, 32));
  if (!check.ok) return { ok: false, error: check.error };
  const db = await getDb();
  if (!(await db.first('SELECT 1 AS x FROM orders WHERE id = ?', input.orderId))) return { ok: false, error: 'Auftrag nicht gefunden' };
  let previous: DocRow | null = null;
  if (input.replaces) {
    previous = await db.first<DocRow>('SELECT * FROM documents WHERE id = ? AND order_id = ?', input.replaces, input.orderId);
    if (!previous) return { ok: false, error: 'Zu ersetzende Datei nicht gefunden' };
    if (previous.superseded_at || previous.deleted_at) return { ok: false, error: 'Nur die aktuelle Version kann ersetzt werden' };
  }
  const kind = (DOCUMENT_KINDS as readonly string[]).includes(input.kind) ? input.kind : previous?.kind ?? 'sonstiges';
  const folder = cleanFolder(input.folder || previous?.folder || '');
  const id = randomBytes(16).toString('hex');
  // Gleiches Schlüsselformat wie bei Kunden-Uploads (Verzeichnis/Datei als Hex) – vom Speicher erzwungen
  const stored = `${randomBytes(12).toString('hex')}/${id}.${check.type.ext}`;
  await putBlob(stored, input.bytes, check.type.mime);
  const at = now();
  try {
    const stmts = [
      q(
        `INSERT INTO documents (id, order_id, kind, original_name, mime, size, stored_name, sha256, created_at, display_name, category, folder, version, previous_id, expires_at, uploaded_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id,
        input.orderId,
        kind,
        input.name.slice(0, 200),
        check.type.mime,
        input.bytes.byteLength,
        stored,
        createHash('sha256').update(input.bytes).digest('hex'),
        at,
        previous?.display_name ?? '',
        input.category || previous?.category || '',
        folder,
        (previous?.version ?? 0) + 1,
        previous?.id ?? '',
        input.expiresAt ? new Date(input.expiresAt).toISOString() : (previous?.expires_at ?? ''),
        actor,
      ),
      q(
        "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, ?, '', ?)",
        input.orderId,
        at,
        previous ? `Dokument ersetzt (Version ${(previous.version ?? 1) + 1}): ${input.name.slice(0, 120)}` : `Dokument hochgeladen: ${input.name.slice(0, 120)}`,
        actor,
      ),
    ];
    if (previous) stmts.push(q('UPDATE documents SET superseded_at = ? WHERE id = ?', at, previous.id));
    await db.batch(stmts);
  } catch (e) {
    await deleteBlobs([stored]).catch(() => undefined);
    throw e;
  }
  await emitSafe({ type: 'document.uploaded', orderId: input.orderId, actor, payload: { id, name: input.name.slice(0, 120), replaced: !!previous }, dedupeKey: `document.uploaded:${id}` });
  return { ok: true, id };
}

function cleanFolder(path: string): string {
  return path
    .split('/')
    .map((p) => p.trim().replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 40))
    // Nur Anzeige-Ordner (keine Dateisystempfade) – „.“/„..“ trotzdem nicht als Namen zulassen
    .filter((p) => p && !/^\.+$/.test(p))
    .slice(0, 4)
    .join('/');
}

export async function createFolder(orderId: number, path: string): Promise<R> {
  const p = cleanFolder(path);
  if (!p) return { ok: false, error: 'Ordnername fehlt' };
  if (!(await (await getDb()).first('SELECT 1 AS x FROM orders WHERE id = ?', orderId))) return { ok: false, error: 'Auftrag nicht gefunden' };
  await (await getDb()).run('INSERT INTO doc_folders (order_id, path, created_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING', orderId, p, now());
  return { ok: true };
}

export async function updateDoc(
  id: string,
  patch: { display_name?: string; category?: string; folder?: string; expires_at?: string; review_state?: string; review_note?: string; kind?: string },
  actor: string,
): Promise<R> {
  const db = await getDb();
  const d = await db.first<DocRow>('SELECT * FROM documents WHERE id = ?', id);
  if (!d) return { ok: false, error: 'Dokument nicht gefunden' };
  if (d.deleted_at) return { ok: false, error: 'Dokument liegt im Papierkorb' };
  const next = {
    display_name: patch.display_name !== undefined ? patch.display_name.trim().slice(0, 160) : d.display_name,
    category: patch.category !== undefined ? patch.category.trim().slice(0, 40) : d.category,
    folder: patch.folder !== undefined ? cleanFolder(patch.folder) : d.folder,
    expires_at: patch.expires_at !== undefined ? (patch.expires_at ? new Date(patch.expires_at).toISOString() : '') : d.expires_at,
    review_state: patch.review_state !== undefined ? patch.review_state : d.review_state,
    review_note: patch.review_note !== undefined ? patch.review_note.trim().slice(0, 500) : d.review_note,
    kind: patch.kind !== undefined && ((DOCUMENT_KINDS as readonly string[]).includes(patch.kind) || patch.kind === 'sonstiges') ? patch.kind : d.kind,
  };
  if (!(REVIEW_STATES as readonly string[]).includes(next.review_state)) return { ok: false, error: 'Unbekannter Prüfstatus' };
  if (Number.isNaN(Date.parse(next.expires_at || '2000-01-01'))) return { ok: false, error: 'Ablaufdatum ungültig' };
  await db.run(
    'UPDATE documents SET display_name = ?, category = ?, folder = ?, expires_at = ?, review_state = ?, review_note = ?, kind = ? WHERE id = ?',
    next.display_name,
    next.category,
    next.folder,
    next.expires_at,
    next.review_state,
    next.review_note,
    next.kind,
    id,
  );
  if (patch.review_state !== undefined && patch.review_state !== d.review_state) {
    await db.run(
      "INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'checklist', NULL, NULL, ?, '', ?)",
      d.order_id,
      now(),
      `Dokumentprüfung ${docLabel(d)}: ${next.review_state || 'zurückgesetzt'}${next.review_note ? ` (${next.review_note})` : ''}`,
      actor,
    );
    await emitSafe({ type: 'document.reviewed', orderId: d.order_id, actor, payload: { id, state: next.review_state }, dedupeKey: `document.reviewed:${id}:${now()}` });
  }
  return { ok: true };
}

export async function setDocFlag(id: string, action: 'delete' | 'restore' | 'archive' | 'unarchive', actor: string): Promise<R> {
  const db = await getDb();
  const d = await db.first<DocRow>('SELECT * FROM documents WHERE id = ?', id);
  if (!d) return { ok: false, error: 'Dokument nicht gefunden' };
  const at = now();
  const sql = {
    delete: ["UPDATE documents SET deleted_at = ?, deleted_by = ? WHERE id = ? AND deleted_at = ''", at, actor, id],
    restore: ["UPDATE documents SET deleted_at = '', deleted_by = '' WHERE id = ?", id],
    archive: ["UPDATE documents SET archived_at = ? WHERE id = ? AND deleted_at = ''", at, id],
    unarchive: ["UPDATE documents SET archived_at = '' WHERE id = ?", id],
  }[action] as [string, ...(string | number)[]];
  const r = await db.run(...sql);
  if (!r.changes) return { ok: false, error: 'Keine Änderung' };
  const label = { delete: 'in den Papierkorb verschoben', restore: 'wiederhergestellt', archive: 'archiviert', unarchive: 'aus dem Archiv geholt' }[action];
  await db.run("INSERT INTO events (order_id, at, type, from_status, to_status, message, public_message, actor) VALUES (?, ?, 'note', NULL, NULL, ?, '', ?)", d.order_id, at, `Dokument ${label}: ${docLabel(d)}`, actor);
  return { ok: true };
}

/** Endgültig löschen: nur aus dem Papierkorb, Datei wird aus dem Speicher entfernt. */
export async function purgeDoc(id: string): Promise<R> {
  const db = await getDb();
  const d = await db.first<{ stored_name: string; deleted_at: string; previous_id: string }>('SELECT stored_name, deleted_at, previous_id FROM documents WHERE id = ?', id);
  if (!d) return { ok: false, error: 'Dokument nicht gefunden' };
  if (!d.deleted_at) return { ok: false, error: 'Erst in den Papierkorb verschieben' };
  await db.batch([q("UPDATE documents SET previous_id = ? WHERE previous_id = ?", d.previous_id, id), q('DELETE FROM documents WHERE id = ?', id)]);
  await deleteBlobs([d.stored_name]).catch((e) => console.error('[dokumente] Datei konnte nicht entfernt werden:', (e as Error).message));
  return { ok: true };
}

/** Zugriffsprotokoll eines Dokuments bzw. aller Dokumente (aus dem Audit-Protokoll). */
export async function accessLog(filter: { docId?: string; limit?: number } = {}) {
  const db = await getDb();
  if (filter.docId) {
    return db.all<{ at: string; username: string; action: string; detail: string; ip: string }>(
      "SELECT at, username, action, detail, ip FROM audit_log WHERE action IN ('dokument.geoeffnet', 'dokument.heruntergeladen', 'beleg.geoeffnet') AND detail LIKE ? ORDER BY at DESC LIMIT 200",
      `%${filter.docId}%`,
    );
  }
  return db.all<{ at: string; username: string; action: string; target: string; detail: string; ip: string }>(
    "SELECT at, username, action, target, detail, ip FROM audit_log WHERE action IN ('dokument.geoeffnet', 'dokument.heruntergeladen', 'beleg.geoeffnet', 'dokument.hochgeladen', 'dokument.geloescht', 'dokument.endgueltig_geloescht') ORDER BY at DESC LIMIT ?",
    Math.min(filter.limit ?? 300, 1000),
  );
}
