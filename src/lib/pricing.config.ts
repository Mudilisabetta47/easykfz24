// ============================================================================
//  PREISE UND NEUKUNDENRABATT
//
//  Die Beträge sind Preisvorschläge (Endungen auf ,90) und vor dem Livegang von
//  EasyKFZ24 zu bestätigen. Sie erscheinen auf der Website, solange PRICES_FINAL
//  true ist.
//
//  Amtliche Gebühren (Zulassungsstelle, Wunschkennzeichen-Reservierung o. Ä.) sind
//  hier bewusst NICHT enthalten. Sie werden nach Beleg in der tatsächlich
//  angefallenen Höhe weiterberechnet und nie rabattiert.
// ============================================================================

import type { ServiceId } from './services.ts';

/**
 * true: Beträge werden auf der Website genannt.
 * false: Startseite zeigt „Preis wird im Vorgang transparent angezeigt“, im Auftrag stehen Beispielwerte.
 */
export const PRICES_FINAL = true;
export const PRICES_ARE_EXAMPLE_VALUES = !PRICES_FINAL;

export interface PriceConfig {
  serviceFeeCents: Record<ServiceId, number>;
  wishPlateHandlingCents: number;
  plateSignCents: number;
  shippingCents: number;
  pickupCents: number;
}

/** Alle Beträge in Cent, inkl. MwSt. */
export const PRICE_CONFIG: PriceConfig = {
  /** Servicepauschale je Leistung (regulärer Preis) */
  serviceFeeCents: {
    neuzulassung: 8990,
    halterwechsel: 7990,
    umzug: 5990,
    wiederzulassung: 8990,
    abmeldung: 2990,
  },
  /** Bearbeitung Wunschkennzeichen (unsere Leistung, ohne amtliche Reservierungsgebühr) */
  wishPlateHandlingCents: 1490,
  /** Kennzeichenschild je Stück, geprägt */
  plateSignCents: 1290,
  /** Versand der Unterlagen per Einschreiben */
  shippingCents: 690,
  /** Abholung in unserer Geschäftsstelle */
  pickupCents: 0,
};

export interface PromoConfig {
  enabled: boolean;
  percent: number;
  /** Kurzbezeichnung in Preisaufstellungen */
  label: string;
  /**
   * Optionales Enddatum (JJJJ-MM-TT). Nur wenn gesetzt, darf mit zeitlicher Begrenzung
   * („nur bis …“) geworben werden – ohne echtes Enddatum wäre das irreführend.
   */
  validUntil: string | null;
}

/**
 * Neukundenrabatt: gilt ausschließlich auf die Servicepauschale der ersten Beauftragung je E-Mail-Adresse.
 * Nicht auf Kennzeichenschilder, Versand oder amtliche Gebühren. Der Server prüft beim Absenden.
 */
export const NEW_CUSTOMER_PROMO: PromoConfig = {
  enabled: true,
  percent: 10,
  label: 'Neukundenrabatt',
  validUntil: null,
};

export const OFFICIAL_FEES_NOTE =
  'Zzgl. amtlicher Gebühren der Zulassungsstelle (und ggf. der Reservierung eines Wunschkennzeichens). ' +
  'Diese richten sich nach der Gebührenordnung und der jeweiligen Behörde und werden in der tatsächlich ' +
  'angefallenen Höhe nach Beleg weiterberechnet.';

export const PROMO_FINE_PRINT =
  'Neukundenrabatt: 10 % auf die EasyKFZ24-Servicepauschale bei der ersten Beauftragung je E-Mail-Adresse. ' +
  'Gilt nicht für Kennzeichenschilder, Versand und amtliche Gebühren. Nicht mit anderen Aktionen kombinierbar.';
