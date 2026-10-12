// Zwei-Faktor-Anmeldung: TOTP-Schlüssel verschlüsselt gespeichert (AES-GCM, Schlüssel aus SESSION_SECRET abgeleitet),
// Inhaber in settings ('owner_totp'), weitere Benutzer in users. Jeder Code ist nur einmal gültig (Zeitschritt-Sperre).

import { newSecret, otpauthUri, verifyTotp } from '../../lib/totp.ts';
import { getDb } from '../db.ts';

const enc = new TextEncoder();
const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function key(): Promise<CryptoKey> {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET fehlt');
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(`ekos-totp:${secret}`));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

async function seal(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await key(), enc.encode(plain)));
  return `v1:${b64(iv)}:${b64(ct)}`;
}

async function open(sealed: string): Promise<string | null> {
  const [v, iv, ct] = sealed.split(':');
  if (v !== 'v1' || !iv || !ct) return null;
  try {
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await key(), unb64(ct));
    return new TextDecoder().decode(plain);
  } catch {
    return null;
  }
}

interface State {
  sealed: string;
  enabledAt: string;
}

async function load(userId: number): Promise<State | null> {
  const db = await getDb();
  if (userId === 0) {
    const r = await db.first<{ value: string }>("SELECT value FROM settings WHERE key = 'owner_totp'");
    if (!r?.value) return null;
    try {
      return JSON.parse(r.value) as State;
    } catch {
      return null;
    }
  }
  const r = await db.first<{ totp_secret: string; totp_enabled_at: string }>('SELECT totp_secret, totp_enabled_at FROM users WHERE id = ?', userId);
  return r?.totp_secret ? { sealed: r.totp_secret, enabledAt: r.totp_enabled_at } : null;
}

async function store(userId: number, state: State | null): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  if (userId === 0) {
    await db.run(
      "INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('owner_totp', ?, ?, 'inhaber') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
      state ? JSON.stringify(state) : '',
      now,
    );
    return;
  }
  await db.run('UPDATE users SET totp_secret = ?, totp_enabled_at = ? WHERE id = ?', state?.sealed ?? '', state?.enabledAt ?? '', userId);
}

export async function twoFactorStatus(userId: number): Promise<{ enabled: boolean; pending: boolean; enabledAt: string }> {
  const s = await load(userId);
  return { enabled: !!s?.enabledAt, pending: !!s && !s.enabledAt, enabledAt: s?.enabledAt ?? '' };
}

export async function twoFactorRequired(userId: number): Promise<boolean> {
  return (await twoFactorStatus(userId)).enabled;
}

/** Neuen Schlüssel anlegen (noch nicht aktiv) – Rückgabe nur an den Benutzer selbst. */
export async function setupTwoFactor(userId: number, account: string): Promise<{ secret: string; uri: string } | { error: string }> {
  const cur = await load(userId);
  if (cur?.enabledAt) return { error: 'Zwei-Faktor ist bereits aktiv – erst abschalten' };
  const secret = newSecret();
  await store(userId, { sealed: await seal(secret), enabledAt: '' });
  return { secret, uri: otpauthUri(secret, account) };
}

/** Code prüfen (nur einmal je Zeitschritt nutzbar). */
export async function checkCode(userId: number, code: string): Promise<boolean> {
  const s = await load(userId);
  if (!s) return false;
  const secret = await open(s.sealed);
  if (!secret) return false;
  const used = await verifyTotp(secret, code);
  if (used === null) return false;
  const db = await getDb();
  const k = `totp_last_${userId}`;
  const last = Number((await db.first<{ value: string }>('SELECT value FROM settings WHERE key = ?', k))?.value ?? 0);
  if (used <= last) return false;
  await db.run(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, 'system') ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    k,
    String(used),
    new Date().toISOString(),
  );
  return true;
}

export async function enableTwoFactor(userId: number, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await load(userId);
  if (!s) return { ok: false, error: 'Erst einrichten' };
  if (s.enabledAt) return { ok: false, error: 'Bereits aktiv' };
  if (!(await checkCode(userId, code))) return { ok: false, error: 'Code ist nicht korrekt – Uhrzeit des Smartphones prüfen' };
  await store(userId, { ...s, enabledAt: new Date().toISOString() });
  return { ok: true };
}

export async function disableTwoFactor(userId: number, code: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await load(userId);
  if (!s?.enabledAt) return { ok: false, error: 'Zwei-Faktor ist nicht aktiv' };
  if (!(await checkCode(userId, code))) return { ok: false, error: 'Code ist nicht korrekt' };
  await store(userId, null);
  return { ok: true };
}
