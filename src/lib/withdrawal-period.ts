// Verzögerter Leistungsbeginn: Ohne ausdrücklich verlangten vorzeitigen Beginn beginnt die Bearbeitung eines Verbraucher-
// auftrags erst nach Ablauf der 14-tägigen Widerrufsfrist. Fristberechnung nach §§ 187 Abs. 1, 188 Abs. 2 BGB in deutscher
// Ortszeit: Der Tag des Vertragsschlusses zählt nicht mit, die Frist endet mit Ablauf des 14. Folgetags; frühester Beginn ist
// der darauffolgende Tag 0:00 Uhr. Als Vertragsschluss gilt der Eingang des Auftrags (created_at) – rechtlich zu bestätigen.
// Gilt nur für Privatpersonen (Verbraucher); Firmenkunden haben kein gesetzliches Widerrufsrecht.

export const WITHDRAWAL_DAYS = 14;

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' });
const WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** Mitternacht (0:00 Uhr deutscher Zeit) eines Kalendertags als Zeitpunkt */
function berlinMidnight(y: number, m: number, d: number): Date {
  const guess = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(WALL.formatToParts(new Date(guess)).map((x) => [x.type, x.value]));
  const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return new Date(guess - (wall - guess));
}

/** Frühester Bearbeitungsbeginn ohne Zustimmung: Tag des Vertragsschlusses + 15 Tage, 0:00 Uhr deutscher Zeit */
export function serviceStartFrom(contractAt: string): Date {
  const [y, m, d] = DAY.format(new Date(contractAt)).split('-').map(Number);
  return berlinMidnight(y, m, d + WITHDRAWAL_DAYS + 1);
}

export interface WaitInput {
  created_at: string;
  data: { holder: { typ: string }; finish: { vorzeitigerBeginnAt?: string } };
}

/** Läuft für diesen Auftrag noch die Wartezeit? null = Bearbeitung zulässig */
export function earlyStartWait(o: WaitInput, now = Date.now()): { until: Date } | null {
  if (o.data.holder.typ !== 'privat') return null;
  if (o.data.finish.vorzeitigerBeginnAt) return null;
  const until = serviceStartFrom(o.created_at);
  return until.getTime() > now ? { until } : null;
}

export function waitMessage(until: Date): string {
  const day = until.toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', year: 'numeric' });
  return `Widerrufsfrist läuft: Der Kunde hat keinen vorzeitigen Beginn verlangt – Bearbeitung erst ab ${day}, 0:00 Uhr. Bis dahin ist nur eine Stornierung möglich.`;
}
