// Passwort-Hashes für Verwaltungsbenutzer: PBKDF2-SHA256 über WebCrypto (Node und Cloudflare Workers).
// Format: pbkdf2$<iterationen>$<salz base64url>$<hash base64url>. Cloudflare begrenzt PBKDF2 auf 100 000 Iterationen.

const ITERATIONS = 100_000;
const enc = new TextEncoder();

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64url');
const unb64 = (s: string): Uint8Array<ArrayBuffer> => {
  const b = Buffer.from(s, 'base64url');
  const out = new Uint8Array(new ArrayBuffer(b.length));
  out.set(b);
  return out;
};

async function derive(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(await derive(password, salt, ITERATIONS))}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split('$');
  const iterations = Number(iter);
  if (scheme !== 'pbkdf2' || !Number.isInteger(iterations) || iterations < 1 || iterations > ITERATIONS || !salt || !hash) return false;
  const expected = unb64(hash);
  const actual = await derive(password, unb64(salt), iterations);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual[i] ^ expected[i];
  return diff === 0;
}
