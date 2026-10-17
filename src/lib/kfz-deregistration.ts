// Außerbetriebsetzung (AB) über kfz-api.de: Antragsaufbau streng nach der offiziellen Spezifikation API 2.3.0
// (spec/api.yaml, POST /vehicleDeregistrations/deregistrations, Schemas VehicleDeregistrationRequest,
// VehicleDeregistrationCustomization, EuroLicensePlateNumberComponents, ContractPartner). Ohne Node-Abhängigkeiten.
//
// Bewusst NICHT gesendet (Phase 1): recycling (Verwertungsnachweis), vehicleRegistrationCertificatePartII,
// vehicleRegistrationCertificateNumber, vehicleHolder (wird laut Spezifikation nicht an das KBA übermittelt),
// gksConfigurationId (kein eigener KBA-Zugang), correctionOf (Korrektur läuft vorerst manuell im Dashboard).

import { VEHICLE_TYPES } from './catalog.ts';
import type { ValidatedOrder } from './order.ts';

/** Muster laut Spezifikation – Groß-/Kleinschreibung gehört bei den Sicherheitscodes zum Wert */
export const AB_PATTERNS = {
  zb1: /^[0-9a-zA-Z]{7}$/,
  plakette: /^[0-9a-zA-Z]{3}$/,
  city: /^[A-Za-zÄÖÜäöü]{1,3}$/,
  middle: /^[A-Za-z]{1,2}$/,
  end: /^[0-9]{1,4}$/,
  contractPartner: /^[UBS][0-9]{6}$/,
  /** KBA-Regel laut Spezifikation: Ziffern und Großbuchstaben, höchstens 25 Stellen (Kleinbuchstaben werden großgeschrieben) */
  fin: /^[0-9A-Z]{1,25}$/,
} as const;

export const EXTERNAL_ID_MAX = 100;

/** Erfasste Sicherheitscodes (nur verschlüsselt gespeichert, nie angezeigt) */
export interface AbCodes {
  /** SicherheitscodeZB1, genau sieben Ziffern oder Buchstaben */
  zb1: string;
  /** hintere Stempelplakette, genau drei Zeichen */
  rear: string;
  /** vordere Stempelplakette – nur bei zwei Kennzeichenschildern, sonst null (bei einem Schild unzulässig) */
  front: string | null;
}

export type AbCodeProblem = { field: 'zb1' | 'rear' | 'front' | 'plates'; text: string };

/** Prüft die Codes nur auf Form (wie der Dienst vor dem Versand); die verbindliche Prüfung macht das KBA. */
export function checkAbCodes(input: {
  zb1?: unknown;
  rear?: unknown;
  front?: unknown;
  plates?: unknown;
}): { ok: true; codes: AbCodes } | { ok: false; problems: AbCodeProblem[] } {
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const zb1 = s(input.zb1);
  const rear = s(input.rear);
  const front = s(input.front);
  const plates = input.plates === 1 || input.plates === 2 ? input.plates : null;
  const problems: AbCodeProblem[] = [];
  if (!AB_PATTERNS.zb1.test(zb1)) problems.push({ field: 'zb1', text: 'Sicherheitscode ZB I: genau sieben Ziffern oder Buchstaben' });
  if (!AB_PATTERNS.plakette.test(rear)) problems.push({ field: 'rear', text: 'Code hintere Plakette: genau drei Ziffern oder Buchstaben' });
  if (!plates) problems.push({ field: 'plates', text: 'Bitte angeben, ob das Fahrzeug ein oder zwei Kennzeichenschilder hat' });
  else if (plates === 2 && !AB_PATTERNS.plakette.test(front))
    problems.push({ field: 'front', text: 'Code vordere Plakette: genau drei Ziffern oder Buchstaben' });
  else if (plates === 1 && front) problems.push({ field: 'front', text: 'Bei nur einem Kennzeichenschild ist kein Code für vorne zulässig' });
  if (problems.length) return { ok: false, problems };
  return { ok: true, codes: { zb1, rear, front: plates === 2 ? front : null } };
}

/** Übliche Zahl der Schilder je Fahrzeugart (Vorbelegung im OS, die Angabe bestätigt der Mitarbeiter) */
export function defaultPlates(art: string): 1 | 2 {
  return (VEHICLE_TYPES as Record<string, { plates: number }>)[art]?.plates === 1 ? 1 : 2;
}

export interface PlateComponents {
  usageType: 'EURO' | 'ELECTRIC' | 'HISTORIC';
  city: string;
  middle: string;
  end: string;
}

/** Kennzeichen aus dem Auftrag („HN-LL 2418“, „M-AB 12E“) in die Bestandteile laut Spezifikation zerlegen */
export function plateComponents(plate: string, flags: { eKennzeichen: boolean; hKennzeichen: boolean }): PlateComponents | null {
  const m = /^([A-ZÄÖÜ]{1,3})-([A-Z]{1,2}) ([0-9]{1,4})([EH])?$/.exec(plate.trim().toUpperCase());
  if (!m) return null;
  const [, city, middle, end, suffix] = m;
  // Merkmal aus dem Schild selbst (E/H am Ende); passt es nicht zu den Fahrzeugangaben, wird nicht geraten
  const usageType = suffix === 'E' ? 'ELECTRIC' : suffix === 'H' ? 'HISTORIC' : 'EURO';
  if (!suffix && (flags.eKennzeichen || flags.hKennzeichen)) return null;
  return { usageType, city, middle, end };
}

export interface AbRequestOptions {
  externalOrderId: string;
  /** E-Mail-Adresse für den Antrag (Pflichtfeld laut Spezifikation) */
  email: string;
  /**
   * Vertragspartnernummer des KBA (Referenz 28). Ohne eigenen KoPa-Schlüssel Pflicht (kfz-api.de/api: „ohne eigenen
   * KoPa-Schlüssel Pflicht“; spec/api.yaml 403 „NichtFreigegeben“); das Schema nennt sie bei der AB zwar „optional“, die
   * Übermittlung verlangt sie deshalb trotzdem (siehe kfz-submission.ts).
   */
  contractPartner?: string;
  /** Kennzeichen fahrzeugbezogen reservieren (längstens zwölf Monate) */
  reservePlate: boolean;
}

export type AbBuild = { ok: true; body: Record<string, unknown>; plate: PlateComponents } | { ok: false; reasons: string[] };

/** Baut den Antragsrumpf nur aus dokumentierten Feldern; fehlt etwas, wird es benannt statt ergänzt. */
export function buildAbRequest(data: ValidatedOrder, codes: AbCodes, opts: AbRequestOptions): AbBuild {
  const reasons: string[] = [];
  if (data.service !== 'abmeldung') reasons.push('Nur für Abmeldungen');
  const fin = data.vehicle.fin.trim().toUpperCase();
  if (!AB_PATTERNS.fin.test(fin)) reasons.push('FIN entspricht nicht der KBA-Regel (Ziffern und Großbuchstaben, höchstens 25 Stellen)');
  const plate = plateComponents(data.vehicle.bisherigesKennzeichen, data.vehicle);
  if (!plate) reasons.push('Kennzeichen fehlt oder passt nicht zu den Fahrzeugangaben (E-/H-Kennzeichen) – bitte im Auftrag prüfen');
  const email = opts.email.trim();
  if (email.length < 3 || email.length > 255 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) reasons.push('E-Mail-Adresse für den Antrag ungültig');
  if (!opts.externalOrderId || opts.externalOrderId.length > EXTERNAL_ID_MAX) reasons.push('Referenz (externalOrderId) fehlt oder ist zu lang');
  const cp = opts.contractPartner?.trim().toUpperCase();
  if (cp && !AB_PATTERNS.contractPartner.test(cp)) reasons.push('Vertragspartnernummer ungültig (Buchstabe U, B oder S und sechs Ziffern)');
  const c = checkAbCodes({ zb1: codes.zb1, rear: codes.rear, front: codes.front ?? '', plates: codes.front ? 2 : 1 });
  if (!c.ok) reasons.push(...c.problems.map((p) => p.text));
  if (reasons.length || !plate) return { ok: false, reasons };
  const customization: Record<string, unknown> = {
    productType: 'VEHICLE_DEREGISTRATION',
    licensePlateNumberComponents: { usageType: plate.usageType, city: plate.city, middle: plate.middle, end: plate.end },
    ...(codes.front ? { frontLicensePlateSecurityCode: codes.front } : {}),
    rearLicensePlateSecurityCode: codes.rear,
    vehicleIdentificationNumber: fin,
    vehicleRegistrationCertificateSecurityCode: codes.zb1,
    licensePlateReservationIncluded: opts.reservePlate,
    ...(cp ? { contractPartner: cp } : {}),
  };
  return { ok: true, plate, body: { externalOrderId: opts.externalOrderId, email, customization } };
}

/** Referenz je Versuch: Auftragsnummer + Vorgangsart + Versuch (Webhooks liefern sie als order.externalId zurück) */
export function abExternalId(orderNumber: string, attempt: number): string {
  return `${orderNumber}-AB${attempt}`;
}

/**
 * Kosten der Außerbetriebsetzung ohne eigenen KoPa-Schlüssel laut öffentlicher Preisliste kfz-api.de/preise (Stand 29.09.2026):
 * Leistung des Partners 2,00 € netto (zzgl. 19 % USt), amtliche Gebühren ohne Aufschlag und ohne USt: Amtsgebühr ab 3,30 €,
 * KBA-Gebühr 0,70 €, Abwicklungsgebühr 0,35 €. Summe ab 6,35 € netto bzw. ab 6,73 € brutto. Die Leistung des Partners fällt
 * nur für erfolgreiche Aufträge an; je vom KBA abgewiesener Übermittlung 0,10 € netto (0,12 € brutto). Amtsgebühren sind
 * Ländersache und je Zulassungsbehörde verschieden („ab“). Die Spezifikation nennt keine Preise; maßgeblich ist die Rechnung.
 */
export const AB_COST = {
  serviceNetCents: 200,
  vatRate: 0.19,
  officialFromCents: 330 + 70 + 35,
  fromNetCents: 635,
  fromGrossCents: 635 + Math.round(200 * 0.19),
  rejectedNetCents: 10,
  rejectedGrossCents: 10 + Math.round(10 * 0.19),
  source: 'Preisliste kfz-api.de/preise, Stand 29.09.2026 (ohne eigenen KoPa-Schlüssel)',
} as const;

export const euroCents = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Hinweise, die vor dem Senden ausdrücklich bestätigt werden müssen */
export function abNotices(p: { plate: string; fin: string; reservePlate: boolean; contractPartner: string }): string[] {
  return [
    `Es wird ein echter Antrag auf Außerbetriebsetzung beim Kraftfahrt-Bundesamt gestellt (Fahrzeug ${p.fin}, Kennzeichen ${p.plate}). Er ist nicht rückholbar.`,
    `Kosten bei Erfolg: ab ${euroCents(AB_COST.fromNetCents)} netto bzw. ab ${euroCents(AB_COST.fromGrossCents)} brutto – Leistung des Partners ${euroCents(AB_COST.serviceNetCents)} netto zzgl. 19 % USt, amtliche Gebühren ab ${euroCents(AB_COST.officialFromCents)} ohne USt (je Zulassungsbehörde verschieden). Je vom KBA abgewiesener Übermittlung ${euroCents(AB_COST.rejectedNetCents)} netto (${euroCents(AB_COST.rejectedGrossCents)} brutto). Quelle: ${AB_COST.source}; maßgeblich ist die Sammelrechnung.`,
    'Eine Wiederholung nach Verbindungsabbruch nutzt dieselbe Referenz und stellt binnen 15 Minuten keinen zweiten Antrag; danach wird erst der Stand beim Partner geprüft.',
    p.reservePlate ? 'Das Kennzeichen wird fahrzeugbezogen reserviert (längstens zwölf Monate).' : 'Das Kennzeichen wird nicht reserviert.',
    `Vertragspartnernummer ${p.contractPartner} wird mitgesendet (Pflicht ohne eigenen KoPa-Schlüssel).`,
    'Die Sicherheitscodes werden nach angenommener Übermittlung gelöscht.',
  ];
}
