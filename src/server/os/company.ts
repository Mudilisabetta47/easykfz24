// Unternehmenseinstellungen (Systemsteuerung → Unternehmen): Firmendaten, Steuerstatus, Rechnungsangaben,
// E-Mail-Absender, Geschäftszeiten, Zahlungs- und Dokumentenregeln. Gespeichert als JSON in settings ('company').
// Geheimnisse (API-Schlüssel) gehören NICHT hierher – die liegen ausschließlich als Cloudflare-Secrets vor.

import { z } from 'zod';
import { getDb } from '../db.ts';
import { PROVIDER_NAME } from '../../lib/site.ts';

export const TAX_MODES = ['regel', 'kleinunternehmer'] as const;
export type TaxMode = (typeof TAX_MODES)[number];

const text = (max: number) => z.string().trim().max(max).default('');

export const companySchema = z.object({
  name: text(120),
  legalForm: text(60),
  owner: text(120),
  street: text(120),
  zip: text(10),
  city: text(80),
  country: text(60).default('Deutschland'),
  phone: text(40),
  email: text(120),
  web: text(120),
  register: text(120),
  vatId: text(30),
  taxNumber: text(30),
  /** regel = Umsatzsteuer wird ausgewiesen; kleinunternehmer = § 19 UStG, keine USt */
  taxMode: z.enum(TAX_MODES).default('regel'),
  vatRate: z.number().int().min(0).max(25).default(19),
  bankName: text(80),
  iban: text(40),
  bic: text(20),
  invoicePrefix: text(10).default('RE'),
  creditPrefix: text(10).default('GS'),
  paymentTermDays: z.number().int().min(0).max(90).default(14),
  invoiceFooter: text(600),
  mailFromName: text(80),
  replyTo: text(120),
  notifyEmail: text(120),
  businessHours: text(300),
  /** Zahlungsgebühr, falls kein Ist-Wert vom Zahlungsanbieter vorliegt: nur als Hinweis, nie als Ist-Wert gebucht */
  feeHintPercent: z.number().min(0).max(10).default(0),
  feeHintFixedCents: z.number().int().min(0).max(1000).default(0),
  /** Tage, nach denen gültige Ausweis-/Fahrzeugdokumente erneut geprüft werden sollen */
  docReviewDays: z.number().int().min(0).max(3650).default(0),
});
export type Company = z.infer<typeof companySchema>;

const g = globalThis as unknown as { __ekCompany?: { at: number; value: Company } };

export async function getCompany(fresh = false): Promise<Company> {
  if (!fresh && g.__ekCompany && Date.now() - g.__ekCompany.at < 30_000) return g.__ekCompany.value;
  const row = await (await getDb()).first<{ value: string }>("SELECT value FROM settings WHERE key = 'company'");
  let raw: unknown = {};
  try {
    raw = JSON.parse(row?.value || '{}');
  } catch {
    raw = {};
  }
  const parsed = companySchema.safeParse(raw);
  const value = parsed.success ? parsed.data : companySchema.parse({});
  g.__ekCompany = { at: Date.now(), value };
  return value;
}

export async function setCompany(input: unknown, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  await (await getDb()).run(
    "INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('company', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by",
    JSON.stringify(parsed.data),
    new Date().toISOString(),
    by,
  );
  g.__ekCompany = undefined;
  return { ok: true };
}

/**
 * Abweichungen zum Impressum (nur Hinweis, sperrt nichts): Rechnungen, Kundenmails und Website sollen dieselbe Firma nennen –
 * die Gesellschaft, nicht die Marke.
 */
export function companyWarnings(c: Company): string[] {
  const w: string[] = [];
  if (c.name && c.name !== PROVIDER_NAME) w.push(`Firmenname weicht vom Impressum ab – dort steht „${PROVIDER_NAME}“. Die Marke EasyKFZ24 gehört in die Fußzeile, nicht in den Firmennamen.`);
  return w;
}

/** Fehlende Pflichtangaben für eine ordnungsgemäße Rechnung (§ 14 Abs. 4 UStG) – leer = vollständig. */
export function invoiceReadiness(c: Company): string[] {
  const missing: string[] = [];
  if (!c.name) missing.push('Firmenname');
  if (!c.street || !c.zip || !c.city) missing.push('Anschrift');
  if (!c.vatId && !c.taxNumber) missing.push('Steuernummer oder USt-IdNr.');
  if (c.taxMode === 'regel' && !c.vatRate) missing.push('Umsatzsteuersatz');
  return missing;
}
