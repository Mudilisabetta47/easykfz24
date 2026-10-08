// Prüfregeln für einzelne Eingaben. Jede Prüfung liefert den normalisierten Wert oder eine Fehlermeldung.

export type Check = { ok: true; value: string } | { ok: false; error: string };

const ok = (value: string): Check => ({ ok: true, value });
const fail = (error: string): Check => ({ ok: false, error });

/* ---------- FIN (Fahrzeug-Identifizierungsnummer) ---------- */

export function normalizeFin(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** 17 Zeichen, nur A–Z und 0–9 ohne I, O und Q (ISO 3779). */
export function checkFin(input: string): Check {
  const fin = normalizeFin(input);
  if (!fin) return fail('Bitte die FIN angeben');
  if (/[IOQ]/.test(fin)) return fail('Die FIN enthält nie die Buchstaben I, O oder Q – bitte prüfen (oft 1 oder 0)');
  if (!/^[A-Z0-9]+$/.test(fin)) return fail('Die FIN darf nur Buchstaben und Ziffern enthalten');
  if (fin.length !== 17) return fail(`Die FIN hat 17 Zeichen – eingegeben: ${fin.length}`);
  if (/^(.)\1{16}$/.test(fin)) return fail('Diese FIN ist nicht plausibel');
  return ok(fin);
}

/* ---------- IBAN (ISO 13616, Prüfziffer mod 97) ---------- */

/** IBAN-Längen der SEPA-Länder. */
export const SEPA_IBAN_LENGTHS: Record<string, number> = {
  AD: 24, AT: 20, BE: 16, BG: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18, EE: 20, ES: 24, FI: 18,
  FR: 27, GB: 22, GI: 23, GR: 27, HR: 21, HU: 28, IE: 22, IS: 26, IT: 27, LI: 21, LT: 20, LU: 20,
  LV: 21, MC: 27, MT: 31, NL: 18, NO: 15, PL: 28, PT: 25, RO: 24, SE: 24, SI: 19, SK: 24, SM: 27, VA: 22,
};

export function normalizeIban(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

/** Rest der IBAN modulo 97 (Ländercode und Prüfziffer ans Ende, Buchstaben als Zahlen). */
export function ibanMod97(iban: string): number {
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const ch of rearranged) {
    const code = ch.charCodeAt(0);
    const digits = code >= 65 && code <= 90 ? String(code - 55) : ch;
    for (const d of digits) remainder = (remainder * 10 + (d.charCodeAt(0) - 48)) % 97;
  }
  return remainder;
}

export function checkIban(input: string): Check {
  const iban = normalizeIban(input);
  if (!iban) return fail('Bitte die IBAN angeben');
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return fail('Die IBAN beginnt mit Ländercode und zwei Prüfziffern, z. B. DE12 …');
  const expected = SEPA_IBAN_LENGTHS[iban.slice(0, 2)];
  if (!expected) return fail('Für die Kfz-Steuer ist ein Konto in einem SEPA-Land erforderlich');
  if (iban.length !== expected) return fail(`Eine IBAN aus ${iban.slice(0, 2)} hat ${expected} Zeichen – eingegeben: ${iban.length}`);
  if (ibanMod97(iban) !== 1) return fail('Die Prüfziffer der IBAN stimmt nicht – bitte auf Tippfehler prüfen');
  return ok(iban);
}

export function formatIban(iban: string): string {
  return normalizeIban(iban).replace(/(.{4})/g, '$1 ').trim();
}

/** Zeigt nur Ländercode/Prüfziffer und die letzten vier Zeichen. */
export function maskIban(iban: string): string {
  const v = normalizeIban(iban);
  if (v.length <= 8) return v.replace(/./g, '*');
  const masked = v
    .split('')
    .map((c, i) => (i < 4 || i >= v.length - 4 ? c : '*'))
    .join('');
  return masked.replace(/(.{4})/g, '$1 ').trim();
}

/* ---------- eVB-Nummer ---------- */

export function checkEvb(input: string): Check {
  const evb = input.toUpperCase().replace(/[\s-]/g, '');
  if (!evb) return fail('Bitte die eVB-Nummer Ihrer Versicherung angeben');
  if (!/^[A-Z0-9]{7}$/.test(evb)) return fail('Die eVB-Nummer besteht aus 7 Buchstaben und Ziffern');
  return ok(evb);
}

/* ---------- Kennzeichen ---------- */

const PLATE_RE = /^([A-ZÄÖÜ]{1,3})[\s-]+([A-Z]{1,2})[\s-]*([1-9][0-9]{0,3})([EH])?$/;

/**
 * Deutsches Kennzeichen: Unterscheidungszeichen (1–3 Buchstaben), Erkennungsbuchstaben (1–2),
 * Zahl (1–4 Ziffern, ohne führende Null), optional E oder H. Höchstens 8 Zeichen ohne Zusatz.
 * Normalform: "M-AB 1234".
 */
export function checkPlate(input: string): Check {
  const raw = input.toUpperCase().trim();
  if (!raw) return fail('Bitte das Kennzeichen angeben');
  const m = PLATE_RE.exec(raw);
  if (!m) return fail('Format z. B. „M-AB 1234“ – Ort, Bindestrich, Buchstaben, Zahl');
  const [, district, letters, digits, suffix] = m;
  if (district.length + letters.length + digits.length > 8) return fail('Ein Kennzeichen hat höchstens 8 Zeichen');
  return ok(`${district}-${letters} ${digits}${suffix ?? ''}`);
}

/* ---------- Halter / Kontakt ---------- */

export function checkPlz(input: string): Check {
  const v = input.trim();
  if (!v) return fail('Bitte die Postleitzahl angeben');
  if (!/^\d{5}$/.test(v)) return fail('Die Postleitzahl hat 5 Ziffern');
  return ok(v);
}

export function checkEmail(input: string): Check {
  const v = input.trim().toLowerCase();
  if (!v) return fail('Bitte die E-Mail-Adresse angeben');
  if (v.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return fail('Bitte eine gültige E-Mail-Adresse angeben');
  return ok(v);
}

export function checkPhone(input: string): Check {
  const v = input.trim().replace(/\s+/g, ' ');
  if (!v) return fail('Bitte eine Telefonnummer für Rückfragen angeben');
  const digits = v.replace(/\D/g, '');
  if (!/^[+0-9 ()/-]+$/.test(v) || digits.length < 6 || digits.length > 16) return fail('Bitte eine gültige Telefonnummer angeben');
  return ok(v);
}

/** Geburtsdatum im Format JJJJ-MM-TT; mindestens 16 Jahre alt, nicht vor 1900. */
export function checkBirthDate(input: string, today: Date = new Date()): Check {
  const v = input.trim();
  if (!v) return fail('Bitte das Geburtsdatum angeben');
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return fail('Bitte ein gültiges Datum angeben');
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return fail('Dieses Datum gibt es nicht');
  if (y < 1900) return fail('Bitte das Geburtsdatum prüfen');
  const limit = new Date(Date.UTC(today.getUTCFullYear() - 16, today.getUTCMonth(), today.getUTCDate()));
  if (date > limit) return fail('Halter müssen mindestens 16 Jahre alt sein – bitte kontaktieren Sie uns');
  return ok(v);
}

export function checkRequired(input: string, message: string): Check {
  const v = input.trim().replace(/\s+/g, ' ');
  return v ? ok(v) : fail(message);
}
