// Auftragsnummern im Format EK-JJJJ-NNNNN (fortlaufend je Jahr).

export const ORDER_NUMBER_RE = /^EK-(\d{4})-(\d{5})$/;

export function formatOrderNumber(year: number, seq: number): string {
  if (!Number.isInteger(year) || year < 2000 || year > 9999) throw new RangeError(`Ungültiges Jahr: ${year}`);
  if (!Number.isInteger(seq) || seq < 1 || seq > 99999) throw new RangeError(`Laufende Nummer außerhalb 1–99999: ${seq}`);
  return `EK-${year}-${String(seq).padStart(5, '0')}`;
}

/** Normalisiert Eingaben wie " ek-2026-00042 " oder "EK 2026 42"; liefert null bei ungültigem Format. */
export function normalizeOrderNumber(input: string): string | null {
  const compact = input.trim().toUpperCase().replace(/[\s_]+/g, '-');
  const m = /^EK-?(\d{4})-?(\d{1,5})$/.exec(compact);
  if (!m) return null;
  const seq = Number(m[2]);
  if (seq < 1) return null;
  return formatOrderNumber(Number(m[1]), seq);
}

export function parseOrderNumber(input: string): { year: number; seq: number } | null {
  const m = ORDER_NUMBER_RE.exec(input);
  if (!m) return null;
  return { year: Number(m[1]), seq: Number(m[2]) };
}
