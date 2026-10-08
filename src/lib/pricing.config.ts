// ============================================================================
//  PREISE UND NEUKUNDENRABATT
//
//  Die Beträge sind Preisvorschläge (alle Endungen auf ,99) und vor dem Livegang von
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
  /** Komplett-Paket je Leistung (Leistung + Wunschkennzeichen + Schilder + Versand); null = kein Paket */
  bundleCents: Record<ServiceId, number | null>;
  wishPlateHandlingCents: number;
  plateSignCents: number;
  shippingCents: number;
  pickupCents: number;
}

/** Alle Beträge in Cent, inkl. MwSt. */
export const PRICE_CONFIG: PriceConfig = {
  /** Servicepauschale je Leistung (regulärer Preis) */
  serviceFeeCents: {
    neuzulassung: 8999,
    halterwechsel: 7999,
    umzug: 5599,
    wiederzulassung: 8999,
    abmeldung: 2799,
  },
  /** Komplett-Pakete: Leistung + Wunschkennzeichen + Schilder + Versand */
  bundleCents: {
    neuzulassung: 11999,
    halterwechsel: 10999,
    umzug: 8999,
    wiederzulassung: 11999,
    abmeldung: null,
  },
  /** Bearbeitung Wunschkennzeichen (unsere Leistung, ohne amtliche Reservierungsgebühr) */
  wishPlateHandlingCents: 1499,
  /** Kennzeichenschild je Stück, geprägt */
  plateSignCents: 1299,
  /** Versand der Unterlagen per Einschreiben */
  shippingCents: 699,
  /** Abholung in unserer Geschäftsstelle */
  pickupCents: 0,
};

/** Anzeigenamen der Komplett-Pakete */
export const BUNDLE_NAMES: Record<ServiceId, string> = {
  neuzulassung: 'Zulassung Komplett',
  halterwechsel: 'Ummeldung Komplett',
  umzug: 'Umzug Komplett',
  wiederzulassung: 'Wiederzulassung Komplett',
  abmeldung: '',
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
  'Neukundenrabatt: mindestens 10 % auf die EasyKFZ24-Servicepauschale bei der ersten Beauftragung je E-Mail-Adresse, ' +
  'Neukundenpreis auf ,99 € abgerundet. ' +
  'Gilt nicht für Kennzeichenschilder, Versand und amtliche Gebühren. Nicht mit anderen Aktionen kombinierbar.';
