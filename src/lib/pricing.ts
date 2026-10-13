// Preisberechnung für einen Auftrag (ohne amtliche Gebühren), inkl. Neukundenrabatt auf die Servicepauschale.

import { VEHICLE_TYPES, isVehicleTypeId } from './catalog.ts';
import { BUNDLE_NAMES, NEW_CUSTOMER_PROMO, PRICE_CONFIG, type PriceConfig, type PromoConfig } from './pricing.config.ts';
import { SERVICES, isPlateChange, type PlateChoice, type ServiceId } from './services.ts';
import { CARRIERS, isCarrierId } from './shipping.ts';
import { PLATE_FINISH, type PlateCostSnapshot, type PlateFinish, type PlateOffer } from './plates.ts';
import { PROCESSING, type ExpressCostSnapshot, type ExpressOffer, type ProcessingLevel } from './express.ts';

export interface PriceInput {
  service: ServiceId;
  vehicleType: string;
  plateChoice: PlateChoice | null;
  plateSigns: boolean;
  delivery: 'versand' | 'abholung' | '';
  /** Erste Beauftragung je E-Mail-Adresse? Im Formular angenommen, auf dem Server geprüft. */
  newCustomer?: boolean;
  /** Versandpartner (nur für die Bezeichnung der Versandposition) */
  carrier?: string;
  /** Ausführung der Schilder (ohne Angabe Standard) */
  plateFinish?: PlateFinish;
  /** Bearbeitung: Standard, Express, Express Plus (ohne Angabe Standard) */
  processing?: ProcessingLevel;
}

export interface PriceLine {
  key: string;
  label: string;
  cents: number;
  /** Bei Schildern: Stückzahl, Einzelpreis und Ausführung (für Auswertung und Übermittlung) */
  qty?: number;
  unitCents?: number;
  finish?: PlateFinish;
}

/** Preiskonfiguration mit den im Finanzcenter gepflegten Schilderpreisen. */
export function withPlateOffer(config: PriceConfig, offer: PlateOffer): PriceConfig {
  return { ...config, plateSignCents: offer.standard ?? config.plateSignCents, plateSignCarbonCents: offer.carbon };
}

/** Preiskonfiguration mit den im Finanzcenter freigegebenen Express-Aufpreisen. */
export function withExpressOffer(config: PriceConfig, offer: ExpressOffer): PriceConfig {
  return { ...config, expressCents: { express: offer.express, express_plus: offer.express_plus } };
}

/** Einzelpreis je Schild der Ausführung – Carbon nur, wenn angeboten (sonst null). */
export function plateUnitCents(finish: PlateFinish, config: PriceConfig = PRICE_CONFIG): number | null {
  return finish === 'carbon' ? config.plateSignCarbonCents : config.plateSignCents;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  /** Summe ohne Rabatt */
  regularCents: number;
  /** Paketvorteil (positiv), 0 wenn kein Paket */
  bundleSaving: number;
  /** Rabattbetrag (positiv), 0 wenn keiner */
  discountCents: number;
  totalCents: number;
  /** Interne Kosten zum Bestellzeitpunkt (nur Verwaltung mit Finanzrecht, nie auf Kundenseiten) */
  cost?: { plates?: PlateCostSnapshot; express?: ExpressCostSnapshot };
}

export function plateSignCount(vehicleType: string): number {
  return isVehicleTypeId(vehicleType) ? VEHICLE_TYPES[vehicleType].plates : 2;
}

/** Schilder werden nur bei Kennzeichenwechsel benötigt. */
export function needsPlateSigns(service: ServiceId, choice: PlateChoice | null): boolean {
  return isPlateChange(service, choice);
}

/**
 * Psychologischer Preis: auf eine Endung ,99 abrunden – bevorzugt auf …9,99, wenn das höchstens 2,50 € tiefer liegt.
 * Es wird nur abgerundet, der Kunde spart also nie weniger als versprochen.
 */
export function charmPrice(cents: number): number {
  const ninetyNine = Math.floor((cents - 99) / 100) * 100 + 99; // größter Betrag ≤ cents mit Endung ,99
  const nineNinetyNine = Math.floor((cents - 999) / 1000) * 1000 + 999; // größter Betrag ≤ cents mit Endung 9,99
  return cents - nineNinetyNine <= 250 ? nineNinetyNine : ninetyNine;
}

/** Mindestrabatt in Cent auf eine Servicepauschale (aufgerundet, damit es nie weniger als promo.percent ist). */
function minimumDiscount(serviceFee: number, promo: PromoConfig): number {
  return Math.ceil((serviceFee * promo.percent) / 100);
}

/** Neukundenrabatt: mindestens promo.percent der Servicepauschale, Ergebnis als psychologischer Preis. */
export function discountFor(cents: number, promo: PromoConfig = NEW_CUSTOMER_PROMO, base: number = cents): number {
  if (!promo.enabled) return 0;
  return base - charmPrice(base - minimumDiscount(cents, promo));
}

/** Ist die Aktion am Stichtag (JJJJ-MM-TT, Europe/Berlin genügt hier tagesgenau) gültig? */
export function isPromoActive(promo: PromoConfig = NEW_CUSTOMER_PROMO, today: string = new Date().toISOString().slice(0, 10)): boolean {
  return promo.enabled && (promo.validUntil === null || today <= promo.validUntil);
}

export function calculatePrice(
  input: PriceInput,
  config: PriceConfig = PRICE_CONFIG,
  promo: PromoConfig = NEW_CUSTOMER_PROMO,
): PriceBreakdown {
  const serviceFee = config.serviceFeeCents[input.service];
  const lines: PriceLine[] = [{ key: 'service', label: `Servicepauschale ${SERVICES[input.service].title}`, cents: serviceFee }];

  if (input.plateChoice === 'wunsch' && SERVICES[input.service].plateChoices.includes('wunsch')) {
    lines.push({ key: 'wunsch', label: 'Reservierung Wunschkennzeichen (Bearbeitung)', cents: config.wishPlateHandlingCents });
  }

  if (input.plateSigns && needsPlateSigns(input.service, input.plateChoice)) {
    const count = plateSignCount(input.vehicleType);
    // Carbon nur mit freigegebenem Preis; der Server lehnt eine nicht angebotene Ausführung vorher ab
    const finish: PlateFinish = input.plateFinish === 'carbon' && config.plateSignCarbonCents !== null ? 'carbon' : 'standard';
    const unit = plateUnitCents(finish, config) as number;
    lines.push({ key: 'schilder', label: `Kennzeichenschilder ${PLATE_FINISH[finish].label} (${count} Stück)`, cents: count * unit, qty: count, unitCents: unit, finish });
  }

  if (input.delivery === 'versand') {
    const carrier = isCarrierId(input.carrier) ? CARRIERS[input.carrier].name : null;
    lines.push({ key: 'versand', label: carrier ? `Versand mit ${carrier}` : 'Versand mit Sendungsverfolgung', cents: config.shippingCents });
  } else if (input.delivery === 'abholung' && config.pickupCents > 0) {
    lines.push({ key: 'abholung', label: 'Abholung', cents: config.pickupCents });
  }

  let regularCents = lines.reduce((sum, l) => sum + l.cents, 0);

  // Komplett-Paket: Leistung + Wunschkennzeichen + Schilder + Versand zum Paketpreis
  const bundle = bundleFor(input, config);
  let bundleSaving = 0;
  if (bundle !== null) {
    bundleSaving = regularCents - bundle;
    lines.push({ key: 'paket', label: `Paketvorteil ${BUNDLE_NAMES[input.service]}`, cents: -bundleSaving });
  }

  // Express: eigener Aufpreis, nicht Teil des Pakets und nicht rabattiert (nur angebotene Stufen)
  const level = input.processing;
  if (level && level !== 'standard') {
    const cents = config.expressCents[level];
    if (cents) {
      lines.splice(1, 0, { key: 'express', label: `${PROCESSING[level].label}-Bearbeitung (bevorzugt)`, cents });
      regularCents += cents;
    }
  }

  // Neukundenrabatt: mindestens promo.percent der Servicepauschale, Ergebnis endet auf ,99
  let discountCents = 0;
  if (input.newCustomer !== false && isPromoActive(promo)) {
    discountCents = bundle !== null ? discountFor(serviceFee, promo, bundle) : discountFor(serviceFee, promo);
    lines.push({ key: 'rabatt', label: `${promo.label} auf die Servicepauschale`, cents: -discountCents });
  }
  return { lines, regularCents, bundleSaving, discountCents, totalCents: regularCents - bundleSaving - discountCents };
}

/** Paketpreis, wenn alle Bausteine gewählt sind und er günstiger ist als die Einzelpreise. */
export function bundleFor(input: PriceInput, config: PriceConfig = PRICE_CONFIG): number | null {
  const price = config.bundleCents[input.service];
  if (price === null || input.plateChoice !== 'wunsch' || !input.plateSigns || input.delivery !== 'versand') return null;
  // Das Paket enthält Standard-Schilder; Carbon-Optik kostet den Aufpreis je Schild zusätzlich
  if (input.plateFinish === 'carbon' && config.plateSignCarbonCents !== null) {
    return price + plateSignCount(input.vehicleType) * (config.plateSignCarbonCents - config.plateSignCents);
  }
  return price;
}

/** Inhalt und Einzelpreis eines Komplett-Pakets (Pkw, 2 Schilder) – für die Darstellung auf der Website. */
export function bundleInfo(service: ServiceId, config: PriceConfig = PRICE_CONFIG, promo: PromoConfig = NEW_CUSTOMER_PROMO) {
  const price = config.bundleCents[service];
  if (price === null) return null;
  const single = config.serviceFeeCents[service] + config.wishPlateHandlingCents + 2 * config.plateSignCents + config.shippingCents;
  const promoCents = isPromoActive(promo) ? price - discountFor(config.serviceFeeCents[service], promo, price) : price;
  return { singleCents: single, bundleCents: price, promoCents, savingCents: single - promoCents };
}

export interface ServicePrice {
  regularCents: number;
  promoCents: number;
  savingCents: number;
}

/** Servicepauschale einer Leistung – regulär und mit Neukundenrabatt (für Preisangaben auf der Website). */
export function servicePrice(service: ServiceId, config: PriceConfig = PRICE_CONFIG, promo: PromoConfig = NEW_CUSTOMER_PROMO): ServicePrice {
  const regularCents = config.serviceFeeCents[service];
  const savingCents = isPromoActive(promo) ? discountFor(regularCents, promo) : 0;
  return { regularCents, promoCents: regularCents - savingCents, savingCents };
}

/** Günstigste Servicepauschale aus mehreren Leistungen (für „ab“-Preise). */
export function fromPrice(services: ServiceId[], config: PriceConfig = PRICE_CONFIG, promo: PromoConfig = NEW_CUSTOMER_PROMO): ServicePrice {
  return services
    .map((s) => servicePrice(s, config, promo))
    .reduce((min, p) => (p.regularCents < min.regularCents ? p : min));
}
