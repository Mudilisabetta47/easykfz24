// Digitale Vollmacht über kfz-api.de (Online-Unterschrift mit Nect). Grundlage ausschließlich die Partner-Dokumentation
// (api.kfz-api.de/docs/vollmacht, OpenAPI /spec/api.yaml 2.3.0, gelesen am 13.10.2026):
//   POST /powerOfAttorneys            legt den Vorgang an (kostenpflichtig, rechtsverbindlich) → powerOfAttorney.id, status, signatureUrl
//   GET  /powerOfAttorneys/{processId} liefert den echten Stand (kostenlos). Für Vollmachten gibt es KEIN Webhook-Ereignis.
//   Rücksprung: ?powerOfAttorneyId=…&status=signed|pending|rejected|expired|failed – laut Doku nur ein Anzeige-Hinweis, kein Beleg.

import type { ValidatedOrder } from './order.ts';
import type { ServiceId } from './services.ts';
import { PROVIDER, PROVIDER_NAME } from './site.ts';

/** Stand laut GET /powerOfAttorneys/{processId} (`PowerOfAttorneyProcess.status`) */
export const POA_STATUSES = ['offen', 'signiert', 'abgelehnt', 'verfallen', 'fehlgeschlagen'] as const;
export type PoaStatus = (typeof POA_STATUSES)[number];
export const isPoaStatus = (v: unknown): v is PoaStatus => typeof v === 'string' && (POA_STATUSES as readonly string[]).includes(v);

/** Anzeige-Hinweis im Rücksprung (`status`-Parameter) – nie als Beleg verwenden */
export const RETURN_HINTS = ['signed', 'pending', 'rejected', 'expired', 'failed'] as const;
export type ReturnHint = (typeof RETURN_HINTS)[number];

export const RETURN_PATH = '/vollmacht/abschluss';

/** Leistungen, für die das KBA eine Vollmacht verlangt (Abmeldung kennt keine, laut Doku 400) */
export const POA_SERVICES: ServiceId[] = ['neuzulassung', 'halterwechsel', 'umzug', 'wiederzulassung'];

/** Was der Kunde sieht – abhängig vom serverseitig bestätigten Stand, nie vom Rücksprung-Parameter */
export type CustomerView = 'signed' | 'signed_incomplete' | 'pending' | 'rejected' | 'expired' | 'failed' | 'unknown';

export function customerView(status: PoaStatus | null, ready: boolean): CustomerView {
  switch (status) {
    case 'signiert':
      return ready ? 'signed' : 'signed_incomplete';
    case 'offen':
      return 'pending';
    case 'abgelehnt':
      return 'rejected';
    case 'verfallen':
      return 'expired';
    case 'fehlgeschlagen':
      return 'failed';
    default:
      return 'unknown';
  }
}

export const CUSTOMER_TEXT: Record<CustomerView, { tone: 'ok' | 'wait' | 'warn' | 'error' | 'neutral'; title: string; text: string; next: string[] }> = {
  signed: {
    tone: 'ok',
    title: 'Ihre Vollmacht wurde erfolgreich unterschrieben.',
    text: 'Die Unterschrift ist bestätigt. Wir setzen Ihren Auftrag fort.',
    next: [
      'Sie müssen hierfür nichts weiter tun.',
      'Wir reichen Ihren Vorgang ein, sobald alle weiteren Voraussetzungen erfüllt sind (z. B. vollständige Unterlagen und Zahlung).',
      'Den aktuellen Stand sehen Sie jederzeit in der Statusabfrage.',
    ],
  },
  signed_incomplete: {
    tone: 'warn',
    title: 'Ihre Vollmacht wurde unterschrieben.',
    text: 'Für die Zulassung fehlen noch Angaben aus der Identifizierung – zum Beispiel enthält ein Reisepass keine Anschrift.',
    next: ['Wir melden uns bei Ihnen, falls wir noch etwas benötigen.', 'Den aktuellen Stand sehen Sie in der Statusabfrage.'],
  },
  pending: {
    tone: 'wait',
    title: 'Ihre Unterschrift wird noch verarbeitet.',
    text: 'Die Bestätigung des Unterschriftsanbieters liegt noch nicht vor. Diese Seite prüft den Stand automatisch erneut.',
    next: [
      'Haben Sie den Vorgang abgebrochen, können Sie ihn über den Link in Ihrer E-Mail fortsetzen.',
      'Den aktuellen Stand sehen Sie auch in der Statusabfrage.',
    ],
  },
  rejected: {
    tone: 'error',
    title: 'Die Vollmacht wurde nicht unterschrieben.',
    text: 'Die Identifizierung oder Unterschrift wurde nicht abgeschlossen. Häufige Ursache: Name, Geburtsdatum, Geburtsort oder Anschrift weichen vom Ausweis ab.',
    next: ['Bitte melden Sie sich bei uns – wir prüfen die Angaben und senden Ihnen einen neuen Link.'],
  },
  expired: {
    tone: 'warn',
    title: 'Der Unterschriftslink ist abgelaufen.',
    text: 'Der Link konnte nicht mehr verwendet werden.',
    next: ['Bitte melden Sie sich bei uns – wir senden Ihnen einen neuen Unterschriftslink.'],
  },
  failed: {
    tone: 'error',
    title: 'Bei der Verarbeitung ist ein Problem aufgetreten.',
    text: 'Der Vorgang konnte nicht abgeschlossen werden. Wir kümmern uns darum.',
    next: ['Bitte melden Sie sich bei uns, falls Sie Fragen haben – Ihre Bestellung bleibt bestehen.'],
  },
  unknown: {
    tone: 'neutral',
    title: 'Wir konnten diesen Vorgang nicht zuordnen.',
    text: 'Zu diesem Aufruf liegt uns kein Vollmachtsvorgang vor.',
    next: ['Falls Sie gerade unterschrieben haben: Den Stand Ihres Auftrags sehen Sie in der Statusabfrage mit Auftragsnummer und E-Mail-Adresse.'],
  },
};

/** Bezeichnungen für Verwaltung und Statusabfrage */
export const ADMIN_LABEL: Record<'erstellt' | 'link_versendet' | 'ausstehend' | 'unterschrieben' | 'unvollstaendig' | 'abgelehnt' | 'abgelaufen' | 'fehler', string> = {
  erstellt: 'Vollmacht erstellt',
  link_versendet: 'Unterschriftslink versendet',
  ausstehend: 'Vollmacht ausstehend',
  unterschrieben: 'Vollmacht unterschrieben',
  unvollstaendig: 'Unterschrieben, Angaben unvollständig',
  abgelehnt: 'Vollmacht abgelehnt',
  abgelaufen: 'Vollmacht abgelaufen',
  fehler: 'Technischer Fehler',
};
export type AdminState = keyof typeof ADMIN_LABEL;

export function adminState(p: { status: PoaStatus | null; ready: boolean; sendEmail: boolean; note: string; createError: string }): AdminState {
  if (p.createError || p.status === 'fehlgeschlagen') return 'fehler';
  if (p.status === 'signiert') return p.ready ? 'unterschrieben' : 'unvollstaendig';
  if (p.status === 'abgelehnt') return 'abgelehnt';
  if (p.status === 'verfallen') return 'abgelaufen';
  if (p.status === 'offen') return p.sendEmail && !p.note ? 'link_versendet' : 'ausstehend';
  return 'erstellt';
}

/**
 * Freigabe-Voraussetzung (Partnervertrag POWR § 3: Vollmacht mit qualifizierter elektronischer Signatur bzw. Siegel, außer bei
 * der Außerbetriebsetzung). Gilt für jede Zulassung, Ummeldung und Wiederzulassung – unabhängig davon, ob die digitale
 * Vollmacht gerade eingeschaltet ist (ohne sie gibt es eben keinen Weg zur Freigabe). Erfüllt NUR durch den über die
 * Partner-Schnittstelle (GET) abgeglichenen Stand: signiert UND readyForApplication. Eine Bestätigung im Checkout, der
 * Rücksprung-Parameter, ein Webhook oder ein Häkchen in der Checkliste genügen nie.
 */
export interface PoaGate {
  required: boolean;
  signed: boolean;
  /** Stand für die Meldung (ADMIN_LABEL oder „kein Vorgang“) */
  label: string;
}
export function poaGate(service: ServiceId, latest: { status: PoaStatus | '' | null; ready: boolean; sendEmail: boolean; note: string; createError: string } | null): PoaGate {
  const required = POA_SERVICES.includes(service);
  if (!latest) return { required, signed: false, label: 'keine digitale Vollmacht vorhanden' };
  const state = adminState({ ...latest, status: latest.status || null });
  return { required, signed: latest.status === 'signiert' && latest.ready, label: ADMIN_LABEL[state] };
}

/**
 * Was einer Übermittlung an Partner bzw. Behörde entgegensteht (für Verknüpfung, Webhook-Prüfung und OS-Warnung).
 * Leere Liste = Freigabe und – soweit nötig – bestätigte QES liegen vor.
 */
export function submissionProblems(p: { releasedAt: string; poa: PoaGate; isTest: boolean; poaArchived?: boolean }): string[] {
  const out: string[] = [];
  if (p.isTest) out.push('Testauftrag – keine Übermittlung an Partner oder Behörde');
  if (!p.releasedAt) out.push('keine interne Freigabe zur Übermittlung');
  if (p.poa.required && !p.poa.signed) out.push(`QES-Vollmacht nicht vom Partner bestätigt (${p.poa.label})`);
  else if (p.poa.required && p.poaArchived === false) out.push(POA_ARCHIVE_MISSING);
  return out;
}

/**
 * Nachweis der QES-Vollmacht (Partnervertrag § 4 Abs. 6: zwei Jahre revisionssicher, dem Antrag zuordenbar): Die API liefert das
 * signierte PDF nicht. Erforderlich ist ein QES-Nachweis im Auftrag – signiertes PDF aus dem POWR-Dashboard (Kategorie
 * „Vollmacht“) UND Prüfbericht eines Validierungsdienstes („gültig – qualifiziert“), der Partnervorgangsnummer zugeordnet,
 * technische Vorprüfung bestanden (server/os/poa-evidence.ts). Ein bloßes PDF zählt nicht.
 */
export const POA_ARCHIVE_MISSING = 'QES-Nachweis fehlt: signiertes PDF (POWR-Dashboard) und Prüfbericht eines Validierungsdienstes im Auftrag erfassen';

/** Rücksprung-Parameter streng prüfen: nur Ziffern (int64), bekannter Hinweis; alles andere wird ignoriert */
export function parseReturnParams(q: { powerOfAttorneyId?: string | string[]; status?: string | string[] }): { processId: number | null; hint: ReturnHint | null } {
  const raw = Array.isArray(q.powerOfAttorneyId) ? q.powerOfAttorneyId[0] : q.powerOfAttorneyId;
  const id = raw && /^[1-9][0-9]{0,15}$/.test(raw) ? Number(raw) : null;
  const h = Array.isArray(q.status) ? q.status[0] : q.status;
  return { processId: id && Number.isSafeInteger(id) ? id : null, hint: (RETURN_HINTS as readonly string[]).includes(h ?? '') ? (h as ReturnHint) : null };
}

// ---------- Aufbau von POST /powerOfAttorneys (PowerOfAttorneyRequest) ----------

/** „12a“ → 12 + „a“; „12 b“ → 12 + „b“. houseNumber ist laut Spezifikation nur ^[0-9]{1,4}$, der Rest gehört in addressSuffix (≤ 21) */
export function splitHouseNumber(v: string): { houseNumber: string; addressSuffix?: string } | null {
  // Bereiche („12-14“) oder freie Angaben sind nicht eindeutig → manuelle Prüfung statt Vermutung
  const m = /^\s*([0-9]{1,4})\s*([A-Za-zÄÖÜäöü]{1,3})?\s*$/.exec(v);
  if (!m) return null;
  return m[2] ? { houseNumber: m[1], addressSuffix: m[2] } : { houseNumber: m[1] };
}

/** „Kirchbachstraße 200“ → Straße + Hausnummer (für den Bevollmächtigten) */
export function splitStreet(v: string): { streetName: string; houseNumber: string; addressSuffix?: string } | null {
  const m = /^(.*\S)\s+([0-9]{1,4}\s*[A-Za-z]{0,3})$/.exec(v.trim());
  if (!m) return null;
  const hn = splitHouseNumber(m[2]);
  return hn ? { streetName: m[1], ...hn } : null;
}

/** Kontoinhaber passt zum Vollmachtgeber (Doku: jeder Nachname, mindestens ein Vorname, kein weiteres Wort; Groß-/Kleinschreibung und Komma egal) */
export function accountHolderMatches(holder: string, firstName: string, lastName: string): boolean {
  const words = (s: string) => s.toLowerCase().replace(/,/g, ' ').split(/\s+/).filter(Boolean);
  const acc = words(holder);
  const last = words(lastName);
  const first = words(firstName);
  if (!last.every((w) => acc.includes(w))) return false;
  if (!first.some((w) => acc.includes(w))) return false;
  return acc.every((w) => last.includes(w) || first.includes(w));
}

export interface PoaPayloadResult {
  ok: true;
  body: Record<string, unknown>;
  /** SEPA-Mandat wird im selben Nect-Vorgang mit unterschrieben */
  withSepa: boolean;
}

/**
 * Baut den Rumpf für POST /powerOfAttorneys aus einem geprüften Auftrag – nur dokumentierte Felder.
 * Digitale Vollmacht vorerst nur für Privatpersonen (Firmen brauchen Business Sign, sonst 409 laut Doku).
 */
export function buildPoaRequest(
  order: ValidatedOrder,
  opts: { number: string; attempt: number; birthPlace: string; sendEmail: boolean; redirectUrl?: string; sepa?: boolean },
): PoaPayloadResult | { ok: false; reasons: string[] } {
  const reasons: string[] = [];
  const h = order.holder;
  if (!POA_SERVICES.includes(order.service)) reasons.push('Für diese Leistung ist keine Vollmacht nötig (Abmeldung)');
  if (h.typ !== 'privat') reasons.push('Digitale Vollmacht derzeit nur für Privatpersonen (Firmen: Business Sign bzw. eigene PDF)');
  if (!h.vorname || !h.nachname) reasons.push('Vor- und Nachname fehlen');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(h.geburtsdatum)) reasons.push('Geburtsdatum fehlt');
  const birthPlace = opts.birthPlace.trim();
  if (!birthPlace) reasons.push('Geburtsort fehlt (wie im Ausweis)');
  if (birthPlace.length > 105) reasons.push('Geburtsort zu lang (höchstens 105 Zeichen)');
  const hn = splitHouseNumber(h.hausnummer);
  if (!hn) reasons.push('Hausnummer nicht eindeutig (nur Ziffern mit optionalem Zusatz, z. B. 12a)');
  if (!/^\d{5}$/.test(h.plz)) reasons.push('Postleitzahl muss fünfstellig sein');
  if (!h.strasse || !h.ort) reasons.push('Straße oder Ort fehlen');
  const fin = order.vehicle.fin.replace(/\s/g, '');
  if (!/^[0-9A-Za-z]{1,25}$/.test(fin)) reasons.push('FIN fehlt oder ist ungültig');
  if (!h.email) reasons.push('E-Mail-Adresse fehlt');
  const rep = splitStreet(PROVIDER.street);
  if (!rep) reasons.push('Anschrift des Bevollmächtigten nicht zerlegbar');
  // SEPA-Mandat (Kfz-Steuer) nur auf ausdrückliche Wahl – und nur, wenn Kontodaten und Kontoinhaber passen
  const sepa = sepaOption(order);
  if (opts.sepa && !sepa.available) reasons.push(`SEPA-Mandat gewählt, aber nicht möglich: ${sepa.reason}`);
  if (reasons.length || !hn || !rep) return { ok: false, reasons };

  const principal = {
    address: {
      firstName: h.vorname,
      lastName: h.nachname,
      streetName: h.strasse,
      houseNumber: hn.houseNumber,
      ...(hn.addressSuffix ? { addressSuffix: hn.addressSuffix } : {}),
      zipCode: h.plz,
      cityName: h.ort,
    },
    dateOfBirth: h.geburtsdatum,
    placeOfBirth: birthPlace,
  };
  const representative = {
    address: { companyName: PROVIDER_NAME, ...rep, zipCode: PROVIDER.zip, cityName: PROVIDER.city },
  };
  const iban = order.finish.iban.replace(/\s/g, '').toUpperCase();
  const withSepa = !!opts.sepa && sepa.available;
  const body: Record<string, unknown> = {
    principal,
    representative,
    email: h.email,
    vehicles: [{ vehicleIdentificationNumber: fin.toUpperCase() }],
    externalOrderId: `${opts.number}-V${opts.attempt}`,
    sendEmail: opts.sendEmail,
    ...(withSepa ? { bankAccount: { iban, accountHolder: order.finish.kontoinhaber.trim() } } : {}),
    ...(opts.redirectUrl ? { redirectUrl: opts.redirectUrl } : {}),
  };
  return { ok: true, body, withSepa };
}

/**
 * SEPA-Lastschriftmandat für die Kfz-Steuer (Generalzolldirektion, BMF-Formular 032021) im selben Nect-Vorgang – laut Doku
 * optional über bankAccount. Möglich nur mit IBAN, Zustimmung im Auftrag und Kontoinhaber = Vollmachtgeber.
 */
export function sepaOption(order: ValidatedOrder): { available: boolean; reason: string; ibanMasked: string; accountHolder: string } {
  const iban = order.finish.iban.replace(/\s/g, '').toUpperCase();
  const ibanMasked = iban ? `${iban.slice(0, 4)} •••• ${iban.slice(-4)}` : '';
  const accountHolder = order.finish.kontoinhaber.trim();
  const h = order.holder;
  let reason = '';
  if (!iban) reason = 'keine IBAN im Auftrag';
  else if (!order.finish.sepaMandat) reason = 'Kunde hat dem SEPA-Mandat im Auftrag nicht zugestimmt';
  else if (h.typ !== 'privat' || !accountHolderMatches(accountHolder, h.vorname, h.nachname)) reason = 'Kontoinhaber ist nicht der Vollmachtgeber';
  return { available: !reason, reason, ibanMasked, accountHolder };
}

/** Preis laut kfz-api.de/preise (Stand 13.10.2026): Signatur 6,95 € netto zzgl. 19 % USt, monatliche Sammelrechnung */
export const POA_COST = { netCents: 695, grossCents: Math.round(695 * 1.19), source: 'kfz-api.de/preise (Stand 13.10.2026)' } as const;

export const euro = (cents: number) => `${(cents / 100).toFixed(2).replace('.', ',')} €`;

/** Hinweise, die vor dem Anlegen eines echten Vorgangs bestätigt werden müssen */
export function poaNotices(p: { name: string; fin: string; email: string; sendEmail: boolean; withSepa: boolean; ibanMasked: string }): string[] {
  return [
    `Rechtsverbindlich: ${p.name} bevollmächtigt ${PROVIDER_NAME} (Marke EasyKFZ24), für das Fahrzeug mit der FIN ${p.fin} Zulassungsvorgänge zu beantragen. Unterschrieben wird qualifiziert elektronisch nach Identifizierung mit dem Ausweis bei Nect.`,
    p.withSepa
      ? `Mit SEPA-Mandat: Zusätzlich wird das SEPA-Lastschriftmandat der Generalzolldirektion für die Kfz-Steuer (Konto ${p.ibanMasked}) mit unterschrieben. Es ist keine Zahlung an EasyKFZ24; übermittelt wird es erst mit einem Zulassungsantrag.`
      : 'Ohne SEPA-Mandat: Es wird kein Lastschriftmandat erteilt.',
    `Kosten beim Partner kfz-api.de: ${euro(POA_COST.netCents)} netto (${euro(POA_COST.grossCents)} brutto) für die Signatur, Abrechnung monatlich per Sammelrechnung. Ein offener oder unterschriebener Vorgang wird wiederverwendet; eine Wiederholung nach Verbindungsabbruch nutzt dieselbe Referenz und legt keinen zweiten Vorgang an.`,
    p.sendEmail ? `Den Unterschriftslink schickt der Partner per E-Mail (in Ihrer Marke) an ${p.email}.` : 'Es wird keine E-Mail verschickt – den Unterschriftslink im OS kopieren und selbst weitergeben.',
    'Es wird kein Zulassungsantrag eingereicht und nichts bezahlt: Unterschrift, Zahlung und Zulassung bleiben getrennte Schritte.',
    'Für eine vollständige Vollmacht mit dem Personalausweis identifizieren – ein Reisepass enthält keine Anschrift, der Vorgang bliebe dann unvollständig.',
  ];
}

/** Rücksprung je Vorgang nur mit HTTPS und demselben Origin wie die im Partner-Dashboard hinterlegte Adresse (sonst 400 laut Doku) */
export function safeRedirectUrl(configured: string, candidate: string): string | null {
  try {
    const a = new URL(configured);
    const b = new URL(candidate);
    if (a.protocol !== 'https:' || b.protocol !== 'https:') return null;
    if (a.origin !== b.origin || b.username || b.password) return null;
    return b.toString().slice(0, 500);
  } catch {
    return null;
  }
}
