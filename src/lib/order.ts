// Auftragsdaten: Struktur (zod), fachliche Prüfung und Normalisierung.
// Wird im Formular (Schritt für Schritt) und auf dem Server (vollständig) verwendet.

import { z } from 'zod';
import { DRIVE_TYPE_IDS, VEHICLE_TYPE_IDS, isEKennzeichenEligible, type DriveTypeId, type VehicleTypeId } from './catalog.ts';
import { MAX_FILES_PER_DOCUMENT } from './files.ts';
import { isCarrierId, type CarrierId } from './shipping.ts';
import {
  DOCUMENTS,
  SERVICES,
  documentsFor,
  isEvbRequired,
  isPlateChange,
  isServiceId,
  DOCUMENT_KINDS,
  type DocumentKind,
  type DocumentOptions,
  type PlateChoice,
  type ServiceId,
} from './services.ts';
import {
  checkBirthDate,
  checkEmail,
  checkEvb,
  checkFin,
  checkIban,
  checkPhone,
  checkPlate,
  checkPlz,
  checkRequired,
  type Check,
} from './validation.ts';

const str = (max: number) => z.string().max(max, `Höchstens ${max} Zeichen`).default('');
const flag = () => z.boolean().default(false);

export const orderInputSchema = z.object({
  service: str(30),
  vehicle: z
    .object({
      art: str(20),
      hersteller: str(60),
      modell: str(80),
      fin: str(30),
      bisherigesKennzeichen: str(20),
      antrieb: str(20),
      eKennzeichen: flag(),
      hKennzeichen: flag(),
    })
    .default({}),
  holder: z
    .object({
      typ: str(10),
      vorname: str(60),
      nachname: str(60),
      geburtsdatum: str(10),
      firmenname: str(120),
      registernummer: str(60),
      ansprechpartner: str(120),
      strasse: str(100),
      hausnummer: str(10),
      plz: str(10),
      ort: str(80),
      email: str(200),
      telefon: str(30),
    })
    .default({}),
  plate: z
    .object({
      wahl: str(10),
      wunschkennzeichen: str(20),
      schilder: flag(),
      zustellung: str(10),
      versanddienst: str(10),
    })
    .default({}),
  finish: z
    .object({
      evb: str(20),
      kontoinhaber: str(120),
      iban: str(50),
      sepaMandat: flag(),
      vollmacht: flag(),
      datenschutz: flag(),
      hinweise: str(1000),
    })
    .default({}),
  /** Honeypot – bleibt bei Menschen leer. */
  website: str(200),
});

export type OrderDraft = z.input<typeof orderInputSchema>;
export type OrderInput = z.output<typeof orderInputSchema>;

export interface ValidatedOrder {
  service: ServiceId;
  vehicle: {
    art: VehicleTypeId;
    hersteller: string;
    modell: string;
    fin: string;
    bisherigesKennzeichen: string;
    antrieb: DriveTypeId;
    eKennzeichen: boolean;
    /** H-Kennzeichen (Oldtimer) – erfordert ein Gutachten nach § 23 StVZO */
    hKennzeichen: boolean;
  };
  holder: {
    typ: 'privat' | 'firma';
    vorname: string;
    nachname: string;
    geburtsdatum: string;
    firmenname: string;
    registernummer: string;
    ansprechpartner: string;
    strasse: string;
    hausnummer: string;
    plz: string;
    ort: string;
    email: string;
    telefon: string;
  };
  plate: {
    wahl: PlateChoice | null;
    wunschkennzeichen: string;
    schilder: boolean;
    zustellung: 'versand' | 'abholung';
    /** Versandpartner, nur bei Versand */
    versanddienst: CarrierId | null;
  };
  finish: {
    evb: string;
    kontoinhaber: string;
    iban: string;
    sepaMandat: boolean;
    vollmacht: boolean;
    datenschutz: boolean;
    hinweise: string;
  };
}

/** Fehler je Feld, Schlüssel z. B. "vehicle.fin" oder "documents.zb1". */
export type FieldErrors = Record<string, string>;

export function emptyDraft(service: ServiceId | '' = ''): OrderInput {
  const draft = orderInputSchema.parse({});
  if (service) applyServiceDefaults(draft, service);
  return draft;
}

/** Setzt beim Wechsel der Leistung passende Vorgaben (z. B. erste Kennzeichen-Option). */
export function applyServiceDefaults(draft: OrderInput, service: ServiceId): OrderInput {
  draft.service = service;
  const choices = SERVICES[service].plateChoices;
  if (!choices.includes(draft.plate.wahl as PlateChoice)) draft.plate.wahl = choices[0] ?? '';
  return draft;
}

/** Welcher Formularschritt ein Feld enthält – für die Navigation zu Fehlern. */
export const STEP_PREFIXES = ['service', 'vehicle.', 'holder.', 'documents.', 'plate.', 'finish.'] as const;

export function errorsForPrefix(errors: FieldErrors, prefix: string): FieldErrors {
  return Object.fromEntries(Object.entries(errors).filter(([k]) => k === prefix || k.startsWith(prefix)));
}

export function validateOrder(raw: unknown): { ok: true; order: ValidatedOrder } | { ok: false; errors: FieldErrors } {
  const parsed = orderInputSchema.safeParse(raw);
  if (!parsed.success) {
    const errors: FieldErrors = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join('.') || 'form';
      errors[key] ??= issue.message;
    }
    return { ok: false, errors };
  }
  const input = parsed.data;
  const errors: FieldErrors = {};

  const take = (key: string, check: Check): string => {
    if (check.ok) return check.value;
    errors[key] ??= check.error;
    return '';
  };
  const optional = (key: string, value: string, fn: (s: string) => Check): string =>
    value.trim() ? take(key, fn(value)) : '';

  // Leistung
  if (!isServiceId(input.service)) {
    return { ok: false, errors: { service: 'Bitte eine Leistung wählen' } };
  }
  const service = input.service;
  const def = SERVICES[service];

  // Kennzeichen-Wahl zuerst, weil andere Regeln davon abhängen
  let wahl: PlateChoice | null = null;
  if (def.plateChoices.length > 0) {
    if (def.plateChoices.includes(input.plate.wahl as PlateChoice)) wahl = input.plate.wahl as PlateChoice;
    else errors['plate.wahl'] = 'Bitte eine Kennzeichen-Option wählen';
  }

  // Fahrzeug
  const v = input.vehicle;
  const art = (VEHICLE_TYPE_IDS as readonly string[]).includes(v.art) ? (v.art as VehicleTypeId) : null;
  if (!art) errors['vehicle.art'] = 'Bitte die Fahrzeugart wählen';
  const antrieb = (DRIVE_TYPE_IDS as readonly string[]).includes(v.antrieb) ? (v.antrieb as DriveTypeId) : null;
  if (!antrieb) errors['vehicle.antrieb'] = 'Bitte die Antriebsart wählen';
  const hersteller = take('vehicle.hersteller', checkRequired(v.hersteller, 'Bitte den Hersteller angeben'));
  const modell = take('vehicle.modell', checkRequired(v.modell, 'Bitte das Modell angeben'));
  const fin = take('vehicle.fin', checkFin(v.fin));

  let bisherigesKennzeichen = '';
  if (def.previousPlate === 'nein') {
    bisherigesKennzeichen = '';
  } else if (def.previousPlate === 'pflicht') {
    bisherigesKennzeichen = take('vehicle.bisherigesKennzeichen', checkPlate(v.bisherigesKennzeichen));
  } else {
    bisherigesKennzeichen = optional('vehicle.bisherigesKennzeichen', v.bisherigesKennzeichen, checkPlate);
    if (wahl === 'behalten' && !v.bisherigesKennzeichen.trim()) {
      errors['vehicle.bisherigesKennzeichen'] ??= 'Zum Behalten bitte das bisherige Kennzeichen angeben';
    }
  }
  const eKennzeichen = v.eKennzeichen && antrieb !== null && isEKennzeichenEligible(antrieb);
  const hKennzeichen = v.hKennzeichen && service !== 'abmeldung';
  if (eKennzeichen && hKennzeichen) errors['vehicle.hKennzeichen'] = 'E- und H-Kennzeichen lassen sich nicht kombinieren – bitte eines wählen';

  // Halter
  const h = input.holder;
  const typ = h.typ === 'privat' || h.typ === 'firma' ? h.typ : null;
  if (!typ) errors['holder.typ'] = 'Bitte Privatperson oder Firma wählen';
  let vorname = '';
  let nachname = '';
  let geburtsdatum = '';
  let firmenname = '';
  let registernummer = '';
  let ansprechpartner = '';
  if (typ === 'privat') {
    vorname = take('holder.vorname', checkRequired(h.vorname, 'Bitte den Vornamen angeben'));
    nachname = take('holder.nachname', checkRequired(h.nachname, 'Bitte den Nachnamen angeben'));
    geburtsdatum = take('holder.geburtsdatum', checkBirthDate(h.geburtsdatum));
  } else if (typ === 'firma') {
    firmenname = take('holder.firmenname', checkRequired(h.firmenname, 'Bitte den Firmennamen angeben'));
    registernummer = h.registernummer.trim();
    ansprechpartner = take('holder.ansprechpartner', checkRequired(h.ansprechpartner, 'Bitte eine Ansprechperson angeben'));
  }
  const strasse = take('holder.strasse', checkRequired(h.strasse, 'Bitte die Straße angeben'));
  const hausnummer = take('holder.hausnummer', checkRequired(h.hausnummer, 'Bitte die Hausnummer angeben'));
  const plz = take('holder.plz', checkPlz(h.plz));
  const ort = take('holder.ort', checkRequired(h.ort, 'Bitte den Ort angeben'));
  const email = take('holder.email', checkEmail(h.email));
  const telefon = take('holder.telefon', checkPhone(h.telefon));

  // Kennzeichen und Zustellung
  const p = input.plate;
  let wunschkennzeichen = '';
  if (wahl === 'wunsch') wunschkennzeichen = take('plate.wunschkennzeichen', checkPlate(p.wunschkennzeichen));
  const schilder = isPlateChange(service, wahl) ? p.schilder : false;
  const zustellung = p.zustellung === 'versand' || p.zustellung === 'abholung' ? p.zustellung : null;
  if (!zustellung) errors['plate.zustellung'] = 'Bitte Versand oder Abholung wählen';
  let versanddienst: CarrierId | null = null;
  if (zustellung === 'versand') {
    if (isCarrierId(p.versanddienst)) versanddienst = p.versanddienst;
    else errors['plate.versanddienst'] = 'Bitte DHL oder UPS wählen';
  }

  // Abschluss
  const f = input.finish;
  const evb = isEvbRequired(service, wahl) ? take('finish.evb', checkEvb(f.evb)) : '';
  let kontoinhaber = '';
  let iban = '';
  let sepaMandat = false;
  if (def.sepa) {
    kontoinhaber = take('finish.kontoinhaber', checkRequired(f.kontoinhaber, 'Bitte den Kontoinhaber angeben'));
    iban = take('finish.iban', checkIban(f.iban));
    sepaMandat = f.sepaMandat;
    if (!sepaMandat) errors['finish.sepaMandat'] = 'Für die Kfz-Steuer ist ein SEPA-Lastschriftmandat erforderlich';
  }
  if (!f.vollmacht) errors['finish.vollmacht'] = 'Ohne Vollmacht können wir nicht für Sie tätig werden';
  if (!f.datenschutz) errors['finish.datenschutz'] = 'Bitte die Datenschutzhinweise bestätigen';

  if (Object.keys(errors).length > 0 || !art || !antrieb || !typ || !zustellung) return { ok: false, errors };

  return {
    ok: true,
    order: {
      service,
      vehicle: { art, hersteller, modell, fin, bisherigesKennzeichen, antrieb, eKennzeichen, hKennzeichen },
      holder: {
        typ,
        vorname,
        nachname,
        geburtsdatum,
        firmenname,
        registernummer,
        ansprechpartner,
        strasse,
        hausnummer,
        plz,
        ort,
        email,
        telefon,
      },
      plate: { wahl, wunschkennzeichen, schilder, zustellung, versanddienst },
      finish: {
        evb,
        kontoinhaber,
        iban,
        sepaMandat,
        vollmacht: true,
        datenschutz: true,
        hinweise: f.hinweise.trim(),
      },
    },
  };
}

/** Prüft, ob alle Pflicht-Unterlagen vorhanden sind und keine unbekannten/zu vielen Dateien kommen. */
export function validateDocuments(service: ServiceId, counts: Partial<Record<string, number>>, opts: DocumentOptions = {}): FieldErrors {
  const errors: FieldErrors = {};
  const allowed = new Set<string>(documentsFor(service, opts).map((d) => d.kind));
  for (const [kind, count] of Object.entries(counts)) {
    if (!count) continue;
    if (!allowed.has(kind)) errors[`documents.${kind}`] = 'Diese Unterlage wird für die Leistung nicht benötigt';
    else if (count > MAX_FILES_PER_DOCUMENT) errors[`documents.${kind}`] = `Höchstens ${MAX_FILES_PER_DOCUMENT} Dateien je Unterlage`;
  }
  for (const d of documentsFor(service, opts)) {
    if (d.requirement === 'pflicht' && !counts[d.kind]) {
      errors[`documents.${d.kind}`] = `Bitte ${DOCUMENTS[d.kind].short} hochladen`;
    }
  }
  return errors;
}

export function holderDisplayName(h: Pick<ValidatedOrder['holder'], 'typ' | 'vorname' | 'nachname' | 'firmenname'>): string {
  return h.typ === 'firma' ? h.firmenname : `${h.vorname} ${h.nachname}`.trim();
}

export function isDocumentKind(v: string): v is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(v);
}
