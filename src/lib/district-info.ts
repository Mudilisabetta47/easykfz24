// Zusatzangaben je Kürzel für die Ortsseiten – abgeleitet aus der verifizierten Datenbasis (siehe districts.ts).
// o = Bezeichnung laut KBA (z. B. „Osterholz“), s = Bundesländer der zugeordneten Bezirke (Destatis).

import { PLATE_CODES } from './plate-codes.generated.ts';

export const DISTRICT_INFO: Readonly<Record<string, { o: string; s: readonly string[] }>> = Object.fromEntries(
  Object.entries(PLATE_CODES)
    .filter(([, v]) => v.s === 'v')
    .map(([code, v]) => [code, { o: v.k, s: v.l }]),
);
