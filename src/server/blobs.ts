// Dateien (Kunden-Uploads): Cloudflare R2 (Bindung „UPLOADS“) oder lokal unter DATA_DIR/uploads.
// Schlüssel sind zufällig erzeugt; Dateien sind nie öffentlich erreichbar, nur über die Admin-Route.

import fs from 'node:fs';
import path from 'node:path';
import { cloudflareEnv, dataDir } from './db.ts';

const KEY = /^[a-f0-9]{24}\/[a-f0-9]{32}\.[a-z0-9]{1,5}$/;

function localPath(key: string): string {
  if (!KEY.test(key)) throw new Error('Ungültiger Dateischlüssel');
  const base = path.join(dataDir(), 'uploads');
  const full = path.resolve(base, key);
  if (!full.startsWith(base + path.sep)) throw new Error('Ungültiger Dateipfad');
  return full;
}

function bucket() {
  const env = cloudflareEnv();
  if (!env) return null;
  if (!env.UPLOADS) throw new Error('Cloudflare-Bindung „UPLOADS“ (R2) fehlt – in wrangler.jsonc bzw. im Dashboard anlegen');
  return env.UPLOADS;
}

export async function putBlob(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
  const b = bucket();
  if (b) {
    await b.put(key, bytes, { httpMetadata: { contentType } });
    return;
  }
  const full = localPath(key);
  fs.mkdirSync(path.dirname(full), { recursive: true, mode: 0o700 });
  fs.writeFileSync(full, bytes, { mode: 0o600 });
}

export async function getBlob(key: string): Promise<Uint8Array | null> {
  const b = bucket();
  if (b) {
    const obj = await b.get(key);
    return obj ? new Uint8Array(await obj.arrayBuffer()) : null;
  }
  try {
    return new Uint8Array(fs.readFileSync(localPath(key)));
  } catch {
    return null;
  }
}

export async function deleteBlobs(keys: string[]): Promise<void> {
  if (!keys.length) return;
  const b = bucket();
  if (b) {
    await b.delete(keys);
    return;
  }
  for (const k of keys) fs.rmSync(localPath(k), { force: true });
}

export function storageInfo(): { platform: 'cloudflare' | 'node'; db: boolean; uploads: boolean } {
  const env = cloudflareEnv();
  if (!env) return { platform: 'node', db: true, uploads: true };
  return { platform: 'cloudflare', db: !!env.DB, uploads: !!env.UPLOADS };
}
