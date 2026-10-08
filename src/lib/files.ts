// Upload-Regeln: Dateityp anhand der ersten Bytes (Magic Bytes), nicht anhand von Name oder Browser-Angabe.

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_DOCUMENT = 3;
export const ACCEPT_ATTRIBUTE = '.pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/jpeg,image/png,image/webp,image/heic';
export const ALLOWED_TYPES_TEXT = 'PDF, JPG, PNG, WebP oder HEIC, je Datei max. 10 MB';

export interface DetectedType {
  mime: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp' | 'image/heic';
  ext: 'pdf' | 'jpg' | 'png' | 'webp' | 'heic';
}

function startsWith(bytes: Uint8Array, sig: number[], offset = 0): boolean {
  if (bytes.length < offset + sig.length) return false;
  return sig.every((b, i) => bytes[offset + i] === b);
}

function ascii(bytes: Uint8Array, from: number, to: number): string {
  return String.fromCharCode(...bytes.slice(from, to));
}

/** Erkennt erlaubte Dateitypen; benötigt mindestens die ersten 16 Bytes. */
export function detectFileType(bytes: Uint8Array): DetectedType | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return { mime: 'application/pdf', ext: 'pdf' }; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { mime: 'image/jpeg', ext: 'jpg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { mime: 'image/png', ext: 'png' };
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') return { mime: 'image/webp', ext: 'webp' };
  if (ascii(bytes, 4, 8) === 'ftyp' && ['heic', 'heix', 'heim', 'heis', 'hevc'].includes(ascii(bytes, 8, 12))) {
    return { mime: 'image/heic', ext: 'heic' };
  }
  return null;
}

export type FileCheck = { ok: true; type: DetectedType } | { ok: false; error: string };

export function checkUpload(name: string, size: number, head: Uint8Array): FileCheck {
  if (size === 0) return { ok: false, error: `„${name}“ ist leer` };
  if (size > MAX_UPLOAD_BYTES) return { ok: false, error: `„${name}“ ist größer als 10 MB` };
  const type = detectFileType(head);
  if (!type) return { ok: false, error: `„${name}“ ist kein erlaubter Dateityp (${ALLOWED_TYPES_TEXT})` };
  return { ok: true, type };
}

/** Dateiname für Content-Disposition: nur unbedenkliche Zeichen. */
export function safeFileName(name: string, fallback = 'dokument'): string {
  const cleaned = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 80);
  return cleaned || fallback;
}
