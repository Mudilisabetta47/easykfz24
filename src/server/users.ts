// Verwaltungsbenutzer. Der Inhaber (id 0) meldet sich mit ADMIN_PASSWORD an und lässt sich nicht löschen;
// weitere Benutzer mit Rollen liegen in der D1-Tabelle users.

import { randomBytes } from 'node:crypto';
import { checkPasswordStrength, checkUsername, isRole, type Role } from '../lib/permissions.ts';
import { hashPassword, verifyPassword } from '../lib/password.ts';
import { fingerprint, passwordMatches } from '../lib/session.ts';
import { getDb } from './db.ts';

export interface AdminUser {
  id: number;
  username: string;
  displayName: string;
  role: Role;
}

export interface UserRow {
  id: number;
  username: string;
  display_name: string;
  role: string;
  active: number;
  created_at: string;
  last_login_at: string;
}

export const OWNER: AdminUser = { id: 0, username: 'inhaber', displayName: 'Inhaber', role: 'inhaber' };

function ownerPassword(): string | null {
  const pw = process.env.ADMIN_PASSWORD;
  return pw && pw.length >= 12 ? pw : null;
}

/** Benutzer samt Passwortversion für die Sitzung; null wenn unbekannt/deaktiviert. */
export async function loadUser(id: number): Promise<{ user: AdminUser; pwv: string } | null> {
  if (id === 0) {
    const pw = ownerPassword();
    return pw ? { user: OWNER, pwv: fingerprint(pw) } : null;
  }
  const r = await (await getDb()).first<{ id: number; username: string; display_name: string; role: string; pw_version: string; active: number }>(
    'SELECT id, username, display_name, role, pw_version, active FROM users WHERE id = ?',
    id,
  );
  if (!r || !r.active || !isRole(r.role)) return null;
  return { user: { id: r.id, username: r.username, displayName: r.display_name, role: r.role }, pwv: r.pw_version };
}

/** Anmeldung: Inhaber über „inhaber“ (oder leeren Benutzernamen) und ADMIN_PASSWORD, sonst Benutzertabelle. */
export async function authenticate(usernameRaw: string, password: string): Promise<{ user: AdminUser; pwv: string } | null> {
  const username = usernameRaw.trim().toLowerCase();
  if (!username || username === OWNER.username) {
    const pw = ownerPassword();
    if (!pw || !passwordMatches(password, pw)) return null;
    return { user: OWNER, pwv: fingerprint(pw) };
  }
  const db = await getDb();
  const r = await db.first<{ id: number; pw_hash: string; active: number }>('SELECT id, pw_hash, active FROM users WHERE username = ?', username);
  // Auch bei unbekanntem Benutzer einen Hash prüfen, damit die Antwortzeit nichts verrät.
  const ok = await verifyPassword(password, r?.pw_hash ?? 'pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA');
  if (!r || !r.active || !ok) return null;
  await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', new Date().toISOString(), r.id);
  return loadUser(r.id);
}

export async function listUsers(): Promise<UserRow[]> {
  return (await getDb()).all<UserRow>('SELECT id, username, display_name, role, active, created_at, last_login_at FROM users ORDER BY username');
}

type Result = { ok: true } | { ok: false; error: string };

export async function createUser(input: { username: string; displayName: string; role: string; password: string }): Promise<Result> {
  const username = input.username.trim().toLowerCase();
  const err = checkUsername(username) ?? (username === OWNER.username ? 'Dieser Benutzername ist reserviert' : null) ?? checkPasswordStrength(input.password);
  if (err) return { ok: false, error: err };
  if (!isRole(input.role) || input.role === 'inhaber') return { ok: false, error: 'Bitte eine gültige Rolle wählen' };
  const displayName = input.displayName.trim().slice(0, 80) || username;
  const db = await getDb();
  if (await db.first('SELECT 1 AS x FROM users WHERE username = ?', username)) return { ok: false, error: 'Benutzername ist bereits vergeben' };
  await db.run(
    'INSERT INTO users (username, display_name, role, pw_hash, pw_version, active, created_at) VALUES (?, ?, ?, ?, ?, 1, ?)',
    username,
    displayName,
    input.role,
    await hashPassword(input.password),
    randomBytes(6).toString('base64url'),
    new Date().toISOString(),
  );
  return { ok: true };
}

export async function updateUser(id: number, input: { displayName?: string; role?: string; active?: boolean; password?: string }): Promise<Result> {
  const db = await getDb();
  const r = await db.first<{ id: number }>('SELECT id FROM users WHERE id = ?', id);
  if (!r) return { ok: false, error: 'Benutzer nicht gefunden' };
  const sets: string[] = [];
  const params: (string | number)[] = [];
  if (input.displayName !== undefined) {
    sets.push('display_name = ?');
    params.push(input.displayName.trim().slice(0, 80) || 'Benutzer');
  }
  if (input.role !== undefined) {
    if (!isRole(input.role) || input.role === 'inhaber') return { ok: false, error: 'Bitte eine gültige Rolle wählen' };
    sets.push('role = ?');
    params.push(input.role);
  }
  if (input.active !== undefined) {
    sets.push('active = ?');
    params.push(input.active ? 1 : 0);
  }
  if (input.password !== undefined) {
    const err = checkPasswordStrength(input.password);
    if (err) return { ok: false, error: err };
    sets.push('pw_hash = ?', 'pw_version = ?');
    params.push(await hashPassword(input.password), randomBytes(6).toString('base64url'));
  }
  // Rollen-, Status- oder Passwortänderung beendet bestehende Sitzungen des Benutzers.
  if ((input.role !== undefined || input.active !== undefined) && input.password === undefined) {
    sets.push('pw_version = ?');
    params.push(randomBytes(6).toString('base64url'));
  }
  if (!sets.length) return { ok: true };
  await db.run(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`, ...params, id);
  return { ok: true };
}
