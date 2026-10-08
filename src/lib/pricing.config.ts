// ============================================================================
//  PREISE – BEISPIELWERTE
//
//  Alle Beträge in dieser Datei sind BEISPIELWERTE und müssen vor dem Livegang
//  durch die tatsächlichen Preise von EasyKFZ24 ersetzt werden.
//
//  Amtliche Gebühren (Zulassungsstelle, Wunschkennzeichen-Reservierung, Feinstaub-
//  plakette o. Ä.) sind hier bewusst NICHT enthalten. Sie werden nach Beleg in der
//  tatsächlich angefallenen Höhe weiterberechnet.
// ============================================================================

import type { ServiceId } from './services.ts';

/**
 * Erst auf true setzen, wenn die Beträge unten verbindlich festgelegt sind.
 * Solange false: Die Startseite nennt keine Beträge („Preis wird im Vorgang transparent angezeigt“),
 * und im Auftragsformular sind alle Beträge als BEISPIELWERTE gekennzeichnet.
 */
export const PRICES_FINAL = false;
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
  /** Servicepauschale je Leistung – BEISPIELWERTE */
  serviceFeeCents: {
    neuzulassung: 6900,
    halterwechsel: 5900,
    umzug: 4900,
    wiederzulassung: 6900,
    abmeldung: 2900,
  },

  /** Bearbeitung Wunschkennzeichen (unsere Leistung, ohne amtliche Reservierungsgebühr) – BEISPIELWERT */
  wishPlateHandlingCents: 1500,

  /** Kennzeichenschild je Stück, geprägt, inkl. Versand an Sie bzw. zur Abholung – BEISPIELWERT */
  plateSignCents: 1290,

  /** Versand der Unterlagen per Einschreiben – BEISPIELWERT */
  shippingCents: 690,

  /** Abholung in unserer Geschäftsstelle – BEISPIELWERT */
  pickupCents: 0,
};

export const OFFICIAL_FEES_NOTE =
  'Zzgl. amtlicher Gebühren der Zulassungsstelle (und ggf. der Reservierung eines Wunschkennzeichens). ' +
  'Diese richten sich nach der Gebührenordnung und der jeweiligen Behörde und werden in der tatsächlich ' +
  'angefallenen Höhe nach Beleg weiterberechnet.';
