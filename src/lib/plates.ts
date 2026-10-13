// Kennzeichenschilder: Ausführungen (Standard, Carbon-Optik), Preise und Anzeige – ohne Server-Abhängigkeiten.
// Einkaufspreise laut B2B-Konditionen bei kfz-api.de (netto je Schild): Standard 4,05 € (öffentliche Preisliste),
// Carbon-Optik 5,30 € (B2B-Dashboard, Stand 12.10.2026). Verkaufspreise (brutto) pflegt der Inhaber im Finanzcenter.

export const PLATE_FINISHES = ['standard', 'carbon'] as const;
export type PlateFinish = (typeof PLATE_FINISHES)[number];

export const isPlateFinish = (v: unknown): v is PlateFinish => typeof v === 'string' && (PLATE_FINISHES as readonly string[]).includes(v);

export const PLATE_FINISH: Record<PlateFinish, { label: string; short: string; premium: boolean; text: string }> = {
  standard: {
    label: 'Standard',
    short: 'Standard',
    premium: false,
    text: 'Geprägtes Aluminiumschild, reflektierend – passend zum Fahrzeug.',
  },
  carbon: {
    label: 'Carbon-Optik',
    short: 'Carbon',
    premium: true,
    text: 'Premium-Ausführung in Carbon-Optik – für einen sportlich-hochwertigen Auftritt.',
  },
};

/** Preise je Schild: Verkauf brutto (inkl. MwSt.), Einkauf netto. sellCents null = (noch) nicht im Angebot. */
export interface PlatePriceEntry {
  sellCents: number | null;
  buyCents: number;
  active: boolean;
}
export type PlatePrices = Record<PlateFinish, PlatePriceEntry>;

/** Bestätigungen, ohne die Carbon-Optik nicht angeboten werden kann (Inhaber/Finanzen bestätigt beim Speichern). */
export interface CarbonChecks {
  /** beim Lieferanten (kfz-api.de) als Ausführung bestellbar und lieferbar */
  deliverable: boolean;
  /** für den Straßenverkehr zulässig (DIN-zertifiziertes Schild, Schildfeld weiß reflektierend) */
  permitted: boolean;
}

/** Eine gespeicherte Preisversion der Schilder (Verlauf bleibt erhalten; Aufträge merken sich ihre Version). */
export interface PlatePriceVersion {
  version: number;
  /** gültig ab (ISO) */
  from: string;
  by: string;
  prices: PlatePrices;
  /** Versandkosten des Lieferanten je Schilder-Sendung (netto); null = nicht gepflegt */
  supplierShippingCents: number | null;
  carbonChecks: CarbonChecks;
}

export const PLATE_VERSION_DEFAULT: PlatePriceVersion = {
  version: 0,
  from: '',
  by: 'Ausgangswerte',
  prices: { standard: { sellCents: 1299, buyCents: 405, active: true }, carbon: { sellCents: null, buyCents: 530, active: false } },
  supplierShippingCents: null,
  carbonChecks: { deliverable: false, permitted: false },
};

/** Kosten der Schilder zum Bestellzeitpunkt – im Auftrag gespeichert, ändert sich nie mehr (nur Verwaltung mit Finanzrecht). */
export interface PlateCostSnapshot {
  finish: PlateFinish;
  qty: number;
  unitBuyCents: number;
  buyCents: number;
  /** null = beim Bestellen nicht gepflegt */
  supplierShippingCents: number | null;
  priceVersion: number;
  priceFrom: string;
}

/** Was der Kunde sehen darf: nur Verkaufspreise der angebotenen Ausführungen. */
export type PlateOffer = Record<PlateFinish, number | null>;

/** Ausgangswerte, solange im Finanzcenter nichts gespeichert ist. Carbon erst nach Preisfreigabe im Angebot. */
export const PLATE_PRICE_DEFAULTS: PlatePrices = {
  standard: { sellCents: 1299, buyCents: 405, active: true },
  carbon: { sellCents: null, buyCents: 530, active: false },
};

export function offerOf(prices: PlatePrices, checks: CarbonChecks = { deliverable: true, permitted: true }): PlateOffer {
  return {
    standard: prices.standard.sellCents,
    // Carbon nur mit Preis, „anbieten“ und beiden Bestätigungen (lieferbar, zulässig)
    carbon: prices.carbon.active && prices.carbon.sellCents !== null && checks.deliverable && checks.permitted ? prices.carbon.sellCents : null,
  };
}

/** Ausführung eines (auch älteren) Auftrags: ohne Angabe Standard. */
export function plateFinishOf(plate: { schilder?: boolean; ausfuehrung?: unknown } | undefined): PlateFinish {
  return plate && isPlateFinish(plate.ausfuehrung) ? plate.ausfuehrung : 'standard';
}

/** Kurztext für Akte, Listen, Vorlagen und manuelle Übermittlung: „2 × Carbon-Optik“. */
export function plateSummary(plate: { schilder?: boolean; ausfuehrung?: unknown } | undefined, count: number): string {
  if (!plate?.schilder) return 'keine Schilder bestellt';
  return `${count} × ${PLATE_FINISH[plateFinishOf(plate)].label}`;
}
