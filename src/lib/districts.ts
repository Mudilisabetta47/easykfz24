// Unterscheidungszeichen (Ortskennzeichen) für den allgemeinen Fahrzeugverkehr in Deutschland mit Zulassungsbezirk.
// Eine einzige Quelle: abgeleitet aus der verifizierten Datenbasis (KBA-Faltblatt, KBA-Anschriftenverzeichnis AV 1,
// Destatis-Gemeindeverzeichnis), erzeugt von scripts/regions/build-regions.mjs → plate-codes.generated.ts.
// Enthalten sind nur Kürzel mit mindestens einer verifizierten Zuordnung. Kürzel „zu prüfen“ bzw. „festgelegt ohne
// Zulassungsbehörde“ werden bis zur Bestätigung im Programm „SEO & Regionen“ nicht verwendet. Sonderkennzeichen für
// Behörden (z. B. BD, BP, THW) und aufgehobene Kürzel sind nicht enthalten.

import { PLATE_CODES } from './plate-codes.generated.ts';

export const DISTRICTS: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(PLATE_CODES)
    .filter(([, v]) => v.s === 'v')
    .map(([code, v]) => [code, v.b.join('; ')]),
);
