// Eigenständige Kennzeichen-API 2.3.0. Keine Kompatibilitätsendpunkte und keine Platzhaltersuchen.
import { z } from 'zod';

export const plateSearchSchema = z.object({
  ks: z.string().regex(/^\d{5}$/),
  uz: z.string().trim().toUpperCase().regex(/^[A-ZÄÖÜ]{1,3}$/),
  buchstaben: z.string().trim().toUpperCase().regex(/^[A-Z]{1,2}$/),
  ziffern: z.string().regex(/^[1-9]\d{0,3}$/),
  vehicleType: z.enum(['PKW', 'MOTORRAD', 'LEICHTKRAFTRAD', 'ANHAENGER', 'ZUGMASCHINE', 'LKW']).default('PKW'),
  electric: z.boolean().optional(), historic: z.boolean().optional(),
  saisonVon: z.number().int().min(1).max(12).optional(), saisonBis: z.number().int().min(1).max(12).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.electric && v.historic) ctx.addIssue({ code: 'custom', message: 'Elektro- und Oldtimermerkmal schließen sich aus.' });
  if ((v.saisonVon === undefined) !== (v.saisonBis === undefined)) ctx.addIssue({ code: 'custom', message: 'Beide Saisonmonate angeben.' });
  if (v.uz.length + v.buchstaben.length + v.ziffern.length + (v.electric || v.historic ? 1 : 0) > 8) ctx.addIssue({ code: 'custom', message: 'Kennzeichen ist zu lang.' });
});
export type PlateSearch = z.infer<typeof plateSearchSchema>;
export const referenceSchema = z.string().regex(/^[A-Za-z0-9._:-]{8,120}$/);
export const fieldSchema = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), required: z.boolean(), type: z.string() });
export const requirementsSchema = z.object({ customerFields: z.object({ private: z.array(fieldSchema), company: z.array(fieldSchema) }) });
export type Requirements = z.infer<typeof requirementsSchema>;
export const catalogSchema = z.object({
  bezirke: z.array(z.object({ ks: z.string().regex(/^\d{5}$/), name: z.string(), codes: z.array(z.string().regex(/^[A-ZÄÖÜ]{1,3}$/)) })),
  preise: z.object({ abfrageCent: z.number().int().nonnegative(), reservierungCent: z.number().int().nonnegative(), grundgebuehrCent: z.number().int().nonnegative() }),
});
export type Catalog = z.infer<typeof catalogSchema>;

export function reservationPayload(input: unknown, requirements: Requirements) {
  const schema = z.object({
    plate: plateSearchSchema,
    kind: z.enum(['private', 'company']),
    einwilligung: z.literal(true), authorityTermsAccepted: z.literal(true),
    customer: z.record(z.union([z.string().trim().max(300), z.boolean()])),
  }).strict();
  const v = schema.parse(input);
  const fields = requirements.customerFields[v.kind];
  if (!fields.length) throw new Error('Behördenanforderungen fehlen.');
  const customer: Record<string, string | boolean> = {};
  for (const f of fields) {
    const value = v.customer[f.name];
    if (f.required && (value === undefined || value === '' || (f.type === 'boolean' && value !== true))) throw new Error(`Pflichtfeld fehlt: ${f.name}`);
    if (value !== undefined) {
      if ((f.type === 'boolean') !== (typeof value === 'boolean')) throw new Error(`Ungültiger Feldtyp: ${f.name}`);
      if (typeof value === 'string' && f.type === 'email' && !z.string().email().safeParse(value).success) throw new Error(`Ungültige E-Mail: ${f.name}`);
      if (typeof value === 'string' && f.type === 'date' && !z.string().date().safeParse(value).success) throw new Error(`Ungültiges Datum: ${f.name}`);
      customer[f.name] = value;
    }
  }
  return { ...v.plate, einwilligung: true as const, authorityTermsAccepted: true as const, customer };
}

export const CUSTOMER_FIELD_LABELS: Record<string, string> = {
  vorname: 'Vorname', nachname: 'Nachname', firmenname: 'Firmenname', strasse: 'Straße', hausnummer: 'Hausnummer',
  plz: 'Postleitzahl', ort: 'Ort', email: 'E-Mail', telefon: 'Telefon', geburtsdatum: 'Geburtsdatum', geburtsort: 'Geburtsort',
};
export const OPERATION_LABELS: Record<string, string> = { search: 'Verfügbarkeitsabfrage', reservation: 'Reservierungsentwurf', 'existing-reservation': 'Bestehende Reservierung' };
export const RESERVATION_STATUS_LABELS: Record<string, string> = { prepared: 'Entwurf', running: 'Läuft', uncertain: 'Annahme ungeklärt', answered: 'Beantwortet', reserved: 'Reserviert', queued: 'In Warteschlange', failed: 'Fehlgeschlagen', pending: 'In Bearbeitung', cancelled: 'Abgebrochen' };
