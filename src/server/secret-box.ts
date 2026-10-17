// Verschlüsselung kurzlebiger Geheimnisse (Sicherheitscodes für Zulassungsanträge) mit AES-256-GCM über WebCrypto.
//
// Umgebung:
//   KFZ_CODES_KEY   32 Byte, Base64 (z. B. `openssl rand -base64 32`), nur als Cloudflare-Secret – ohne Schlüssel keine Erfassung
//
// Der Klartext verlässt diese Datei nur zum Senden an kfz-api.de. Zusatzdaten (AAD) binden den Geheimtext an Auftrag und
// Zweck: Ein in eine andere Zeile kopierter Geheimtext lässt sich nicht entschlüsseln.

const KEY_BYTES = 32;
const IV_BYTES = 12;

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64');
const unb64 = (s: string): Uint8Array<ArrayBuffer> => new Uint8Array(Buffer.from(s, 'base64'));

function rawKey(): Uint8Array<ArrayBuffer> | null {
  const v = process.env.KFZ_CODES_KEY?.trim();
  if (!v || !/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const k = unb64(v);
  return k.length === KEY_BYTES ? k : null;
}

export function secretBoxConfigured(): boolean {
  return rawKey() !== null;
}

/** Kurze Kennung des Schlüssels (nicht umkehrbar), damit nach einem Schlüsselwechsel alte Geheimtexte erkannt werden */
export async function keyId(): Promise<string | null> {
  const k = rawKey();
  if (!k) return null;
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array([...new TextEncoder().encode('ek-secret-box-v1:'), ...k])));
  return [...d.slice(0, 6)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function cryptoKey(usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> {
  const k = rawKey();
  if (!k) throw new Error('KFZ_CODES_KEY fehlt oder hat nicht 32 Byte');
  return crypto.subtle.importKey('raw', k, { name: 'AES-GCM' }, false, [usage]);
}

export interface Sealed {
  ciphertext: string;
  iv: string;
  keyId: string;
}

export async function seal(plaintext: string, aad: string): Promise<Sealed> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(aad) },
    await cryptoKey('encrypt'),
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: b64(new Uint8Array(ct)), iv: b64(iv), keyId: (await keyId())! };
}

/** Liefert null bei falschem Schlüssel, veränderten Daten oder falscher Zuordnung – ohne Einzelheiten */
export async function open(sealed: { ciphertext: string; iv: string }, aad: string): Promise<string | null> {
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: unb64(sealed.iv), additionalData: new TextEncoder().encode(aad) },
      await cryptoKey('decrypt'),
      unb64(sealed.ciphertext),
    );
    return new TextDecoder().decode(pt);
  } catch {
    return null;
  }
}
