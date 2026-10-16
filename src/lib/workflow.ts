// Fachliche Abläufe von EasyKFZ24 OS (Server und Oberfläche gemeinsam):
// Arbeitsphasen (Kanban), automatische Fehlererkennung, Vollständigkeits- und Pflichtfeldprüfung je Vorgang.
// Die Phasen sind aus echten Feldern abgeleitet (Status, Zahlung, Checkliste, Freigabe, kfz-api.de-Stand) –
// so gibt es keinen zweiten, widersprüchlich gepflegten Status.

import { isChecklistComplete, type ChecklistItem, type ChecklistState } from './checklist.ts';
import type { DisplayStatus } from './kfz-status.ts';
import type { ValidatedOrder } from './order.ts';
import { DOCUMENTS, isEvbRequired, isPreviousPlateRequired, requiredDocuments, SERVICES, type DocumentKind, type ServiceId } from './services.ts';
import type { StatusId } from './status.ts';
import { POA_ARCHIVE_MISSING, POA_SERVICES, submissionProblems, type PoaGate } from './power-of-attorney.ts';

export const STAGES = ['neu', 'dokumente', 'zahlung_bestaetigt', 'bereit', 'beim_partner', 'in_bearbeitung', 'abgeschlossen'] as const;
export const SIDE_STAGES = ['rueckfrage', 'fehler', 'storniert'] as const;
export type Stage = (typeof STAGES)[number] | (typeof SIDE_STAGES)[number];

export const STAGE_META: Record<Stage, { label: string; hint: string; tone: string }> = {
  neu: { label: 'Neu', hint: 'Eingang, noch nicht geprüft', tone: 'blue' },
  dokumente: { label: 'Dokumente prüfen', hint: 'Unterlagen und Angaben prüfen, Zahlung abwarten', tone: 'blue' },
  zahlung_bestaetigt: { label: 'Zahlung bestätigt', hint: 'Vollständig und bezahlt – Freigabe erforderlich', tone: 'violet' },
  bereit: { label: 'Bereit zur Übermittlung', hint: 'Manuell freigegeben', tone: 'violet' },
  beim_partner: { label: 'Beim Zulassungspartner', hint: 'Übergeben, Rückmeldung ausstehend', tone: 'violet' },
  in_bearbeitung: { label: 'In Bearbeitung', hint: 'Behörde bearbeitet (kfz-api.de)', tone: 'violet' },
  abgeschlossen: { label: 'Abgeschlossen', hint: 'Zugelassen/abgemeldet, Versand oder Abholung', tone: 'green' },
  rueckfrage: { label: 'Rückfrage', hint: 'Unterlagen fehlen oder Behörde fragt nach', tone: 'amber' },
  fehler: { label: 'Fehler / Abgelehnt', hint: 'kfz-api.de meldet Ablehnung oder Fehler', tone: 'red' },
  storniert: { label: 'Storniert', hint: 'Abgebrochen', tone: 'slate' },
};

export interface StageInput {
  status: StatusId;
  payment_status: string;
  kfz_display: string;
  released_at?: string;
  checklistComplete: boolean;
}

export function stageOf(o: StageInput): Stage {
  if (o.status === 'storniert') return 'storniert';
  if (o.kfz_display === 'fehlgeschlagen') return 'fehler';
  if (o.status === 'unterlagen_fehlen' || o.kfz_display === 'angaben_erforderlich') return 'rueckfrage';
  if (o.status === 'zugelassen' || o.status === 'versendet' || o.status === 'abgeholt' || o.status === 'abgeschlossen') return 'abgeschlossen';
  if (o.status === 'bei_zulassungsstelle') return o.kfz_display === 'in_bearbeitung' || o.kfz_display === 'abgeschlossen' ? 'in_bearbeitung' : 'beim_partner';
  if (o.status === 'neu') return 'neu';
  // in_pruefung
  if (!o.checklistComplete || o.payment_status !== 'bezahlt') return 'dokumente';
  return o.released_at ? 'bereit' : 'zahlung_bestaetigt';
}

/* ---------- FIN ---------- */

const VIN_MAP: Record<string, number> = { A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9 };
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export interface FinCheck {
  ok: boolean;
  error?: string;
  /** Prüfziffer an Stelle 9 – nur in Nordamerika vorgeschrieben, in Europa meist nicht vorhanden */
  checkDigit: 'stimmt' | 'abweichend' | 'nicht_pruefbar';
  wmi?: string;
}

export function checkFin(raw: string): FinCheck {
  const fin = raw.trim().toUpperCase();
  if (fin.length !== 17) return { ok: false, error: `FIN muss 17 Zeichen haben (hat ${fin.length})`, checkDigit: 'nicht_pruefbar' };
  if (/[IOQ]/.test(fin)) return { ok: false, error: 'FIN darf die Buchstaben I, O und Q nicht enthalten', checkDigit: 'nicht_pruefbar' };
  if (!/^[A-HJ-NPR-Z0-9]{17}$/.test(fin)) return { ok: false, error: 'FIN enthält ungültige Zeichen', checkDigit: 'nicht_pruefbar' };
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = fin[i];
    sum += (/\d/.test(c) ? Number(c) : VIN_MAP[c]) * VIN_WEIGHTS[i];
  }
  const expected = sum % 11 === 10 ? 'X' : String(sum % 11);
  return { ok: true, checkDigit: fin[8] === expected ? 'stimmt' : 'abweichend', wmi: fin.slice(0, 3) };
}

/* ---------- Sicherheitscodes (i-Kfz) ---------- */

export const SECURITY_CODES = {
  zb1: { label: 'Sicherheitscode ZB I (freigelegt, 7-stellig)' },
  zb2: { label: 'Sicherheitscode ZB II (freigelegt, 12-stellig)' },
  plaketten: { label: 'Plakettencodes vorne/hinten (Stempelplaketten, je 3-stellig)' },
} as const;
export type SecurityCode = keyof typeof SECURITY_CODES;

/**
 * Welche Sicherheitscodes beim internetbasierten Verfahren (i-Kfz) üblicherweise gebraucht werden.
 * Die verbindliche Liste ergibt sich aus der API-Dokumentation des Zulassungspartners – deshalb nur als
 * Prüfpunkt zum Abhaken, die Codes selbst werden hier bewusst NICHT gespeichert.
 */
export function securityCodesFor(service: ServiceId, keepPlate: boolean): SecurityCode[] {
  switch (service) {
    case 'abmeldung':
      return ['zb1', 'plaketten'];
    case 'halterwechsel':
      return keepPlate ? ['zb1', 'zb2', 'plaketten'] : ['zb1', 'zb2'];
    case 'umzug':
      return keepPlate ? ['zb1'] : ['zb1', 'plaketten'];
    case 'wiederzulassung':
      return ['zb1', 'zb2'];
    case 'neuzulassung':
      return ['zb2'];
  }
}

/* ---------- Vollständigkeit und Fehlererkennung ---------- */

export type IssueLevel = 'fehler' | 'warnung' | 'hinweis';
export interface Issue {
  level: IssueLevel;
  code: string;
  text: string;
  /** Wo man es behebt – das OS öffnet den passenden Bereich */
  fix?: 'checkliste' | 'dokumente' | 'angaben' | 'zahlung' | 'kennzeichen' | 'kfz' | 'freigabe' | 'frist';
}

export interface IssueInput {
  status: StatusId;
  service: ServiceId;
  payment_status: string;
  kfz_display: string;
  kfz_status?: string;
  assigned_plate: string;
  due_at?: string;
  released_at?: string;
  data: ValidatedOrder;
  checklistItems: ChecklistItem[];
  checklist: ChecklistState;
  uploadedKinds: DocumentKind[];
  regChecks?: Record<string, boolean>;
  /** andere laufende Aufträge mit derselben FIN */
  sameFinOpen?: { id: number; number: string }[];
  /** Wunschkennzeichen-Kürzel gegen den Wohnort laut amtlicher Zuordnung (KBA/Destatis) */
  wishCode?: { code: string; result: 'ja' | 'nein' | 'unklar'; place: string | null; allowed: string[] };
  /** Auftragsbetrag und Summe der gebuchten Zahlungen (null = keine Buchung vorhanden) */
  totalCents?: number;
  paidCents?: number | null;
  /** Digitale Vollmacht (QES): Pflicht und Partnerstand – siehe poaGate */
  poa?: PoaGate;
  /** Vorgangsnummer bei kfz-api.de (verknüpft oder per Webhook gemeldet) */
  kfz_order_id?: string;
  /** Testauftrag des Inhabers – nie an Partner oder Behörde */
  isTest?: boolean;
  /** Signierte Vollmacht als PDF im Dokumentenmanager (Kategorie „Vollmacht“) abgelegt – undefined = nicht ermittelt */
  poaArchived?: boolean;
}

/** Statusstände, die nur nach einer Übergabe an Partner bzw. Behörde erreichbar sind */
const AT_PARTNER: StatusId[] = ['bei_zulassungsstelle', 'zugelassen', 'versendet', 'abgeholt', 'abgeschlossen'];

const ACTIVE: StatusId[] = ['neu', 'in_pruefung', 'unterlagen_fehlen', 'bei_zulassungsstelle'];

/** Automatische Fehlererkennung für einen Auftrag – Grundlage für Warnhinweise, Kanban-Markierungen und Dashboard. */
export function orderIssues(o: IssueInput): Issue[] {
  const out: Issue[] = [];
  if (o.wishCode?.result === 'nein') {
    out.push({
      level: 'warnung',
      code: 'wunsch_ort',
      text: `Wunschkennzeichen ${o.wishCode.code} passt laut amtlicher Zuordnung nicht zum Wohnort ${o.wishCode.place}${o.wishCode.allowed.length ? ` (zulässig: ${o.wishCode.allowed.join(', ')})` : ''}`,
    });
  } else if (o.wishCode?.result === 'unklar') {
    out.push({ level: 'hinweis', code: 'wunsch_ort', text: `Wohnort für das Wunschkennzeichen ${o.wishCode.code} nicht eindeutig zuordenbar – Kürzel manuell prüfen` });
  }
  const d = o.data;
  const svc = SERVICES[o.service];
  const active = ACTIVE.includes(o.status);
  const fin = checkFin(d.vehicle.fin);
  if (!fin.ok) out.push({ level: 'fehler', code: 'fin', text: fin.error ?? 'FIN ungültig', fix: 'angaben' });
  if (o.sameFinOpen?.length && active) {
    out.push({
      level: 'fehler',
      code: 'doppelt',
      text: `Weiterer laufender Auftrag mit derselben FIN: ${o.sameFinOpen.map((x) => x.number).join(', ')} – Mehrfachzulassung vermeiden`,
    });
  }
  if (active) {
    const missingDocs = requiredDocuments(o.service, { hKennzeichen: d.vehicle.hKennzeichen }).filter((k) => !o.uploadedKinds.includes(k));
    if (missingDocs.length) out.push({ level: 'warnung', code: 'unterlagen', text: `Nicht hochgeladen: ${missingDocs.map((k) => DOCUMENTS[k].label).join(', ')}`, fix: 'dokumente' });
    if (isEvbRequired(o.service, d.plate.wahl) && !d.finish.evb) out.push({ level: 'fehler', code: 'evb', text: 'eVB-Nummer fehlt', fix: 'angaben' });
    if (isPreviousPlateRequired(o.service, d.plate.wahl) && !d.vehicle.bisherigesKennzeichen) out.push({ level: 'fehler', code: 'kennzeichen_alt', text: 'Bisheriges Kennzeichen fehlt', fix: 'angaben' });
    if (svc.sepa && (!d.finish.iban || !d.finish.sepaMandat))
      out.push(
        o.isTest
          ? { level: 'hinweis', code: 'sepa', text: 'Testauftrag ohne SEPA-Mandat (SEPA: Nein) – nie als Zulassungsantrag einreichbar' }
          : { level: 'fehler', code: 'sepa', text: 'SEPA-Mandat bzw. IBAN für die Kfz-Steuer fehlt', fix: 'angaben' },
      );
    // Vollmacht noch nicht erteilt: kein Fehler – Zulassung, Ummeldung, Wiederzulassung sichert die QES-Prüfung (digital über
    // Nect), die Abmeldung das Pflicht-Häkchen „Vollmacht im Original eingegangen“ in der Checkliste
    if (!d.finish.vollmacht)
      out.push({
        level: 'hinweis',
        code: 'vollmacht',
        text: POA_SERVICES.includes(o.service)
          ? 'Digitale Vollmacht wird über Nect angefordert – gilt erst nach Partnerabgleich (signiert + vollständig)'
          : 'Vollmacht noch nicht bestätigt – Original über die Checkliste bestätigen',
      });
    if (d.holder.typ === 'privat' && !d.holder.geburtsdatum) out.push({ level: 'warnung', code: 'geburtsdatum', text: 'Geburtsdatum des Halters fehlt', fix: 'angaben' });
    if (o.payment_status !== 'bezahlt' && (o.status === 'bei_zulassungsstelle' || o.released_at)) out.push({ level: 'warnung', code: 'zahlung', text: 'Zahlung noch offen, Vorgang aber schon freigegeben/übergeben', fix: 'zahlung' });
    const complete = isChecklistComplete(o.checklistItems, o.checklist);
    if (o.status === 'bei_zulassungsstelle' && !complete) out.push({ level: 'fehler', code: 'checkliste', text: 'Beim Partner, aber Pflichtpunkte der Checkliste offen', fix: 'checkliste' });
    const codes = securityCodesFor(o.service, d.plate.wahl === 'behalten');
    const missingCodes = codes.filter((c) => !o.regChecks?.[`code_${c}`]);
    if (missingCodes.length && (o.released_at || o.status === 'bei_zulassungsstelle'))
      out.push({ level: 'warnung', code: 'codes', text: `Sicherheitscodes nicht bestätigt: ${missingCodes.map((c) => SECURITY_CODES[c].label).join(', ')}`, fix: 'freigabe' });
    if (o.due_at && o.due_at < new Date().toISOString()) out.push({ level: 'warnung', code: 'frist', text: 'Bearbeitungsfrist überschritten', fix: 'frist' });
  }
  // Beim Partner bzw. der Behörde, obwohl intern nicht freigegeben, ohne bestätigte QES oder als Testauftrag (z. B. direkt im
  // Partnerportal eingereicht): echte externe Stände bleiben stehen, werden aber sofort als Fehler markiert
  if (o.kfz_order_id || o.kfz_display || AT_PARTNER.includes(o.status)) {
    const problems = submissionProblems({ releasedAt: o.released_at ?? '', poa: o.poa ?? { required: false, signed: true, label: '' }, isTest: !!o.isTest, poaArchived: o.poaArchived });
    if (problems.length) out.push({ level: 'fehler', code: 'extern_ohne_freigabe', text: `Beim Partner bzw. der Behörde, aber: ${problems.join('; ')}`, fix: 'freigabe' });
  }
  if (o.kfz_display === 'fehlgeschlagen') out.push({ level: 'fehler', code: 'kfz_fehler', text: `kfz-api.de meldet ${o.kfz_status || 'Fehler/Ablehnung'}`, fix: 'kfz' });
  if (o.kfz_display === 'angaben_erforderlich') out.push({ level: 'warnung', code: 'kfz_rueckfrage', text: 'Behörde benötigt weitere Angaben', fix: 'kfz' });
  if (o.status === 'zugelassen' && o.service !== 'abmeldung' && !o.assigned_plate) out.push({ level: 'fehler', code: 'kennzeichen', text: 'Zugelassen, aber kein Kennzeichen eingetragen', fix: 'kennzeichen' });
  if (d.plate.wahl === 'wunsch' && !d.plate.wunschkennzeichen && active) out.push({ level: 'warnung', code: 'wunsch', text: 'Wunschkennzeichen gewählt, aber nicht angegeben', fix: 'angaben' });
  return out;
}

/**
 * Freigabe vor der Übermittlung („Bereit zur Übermittlung“): nur wenn vollständig, bezahlt, keine Fehler und
 * alle Sicherheitscodes bestätigt. Die Freigabe selbst übermittelt nichts – sie ist die bewusste Entscheidung.
 */
export function releaseBlockers(o: IssueInput): string[] {
  const blockers: string[] = [];
  if (o.isTest) blockers.push('Testauftrag – keine Übermittlung an Partner oder Behörde');
  if (o.status !== 'in_pruefung') blockers.push('Auftrag muss „In Prüfung“ sein');
  if (!isChecklistComplete(o.checklistItems, o.checklist)) blockers.push('Checkliste unvollständig');
  if (o.payment_status !== 'bezahlt') blockers.push('Zahlung nicht bestätigt');
  else if (o.paidCents != null && o.totalCents != null && o.paidCents < o.totalCents) blockers.push('Gezahlter Betrag liegt unter dem Auftragsbetrag – im Finanzcenter (Zahlungsabgleich) klären');
  for (const i of orderIssues(o)) if (i.level === 'fehler') blockers.push(i.text);
  // QES-Pflicht: ohne Partnerstand (z. B. Liste ohne Vollmachtsdaten) gilt sie als nicht erfüllt
  const poa = o.poa ?? { required: POA_SERVICES.includes(o.service), signed: false, label: 'Stand unbekannt' };
  if (poa.required && !poa.signed) blockers.push(`Digitale Vollmacht nicht vom Partner als unterschrieben und vollständig bestätigt (${poa.label})`);
  else if (poa.required && o.poaArchived !== true) blockers.push(POA_ARCHIVE_MISSING);
  const codes = securityCodesFor(o.service, o.data.plate.wahl === 'behalten');
  for (const c of codes) if (!o.regChecks?.[`code_${c}`]) blockers.push(`${SECURITY_CODES[c].label} nicht bestätigt`);
  return [...new Set(blockers)];
}

export type { DisplayStatus };
