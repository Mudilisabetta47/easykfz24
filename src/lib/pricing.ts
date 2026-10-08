// Preisberechnung für einen Auftrag (ohne amtliche Gebühren), inkl. Neukundenrabatt auf die Servicepauschale.

import { VEHICLE_TYPES, isVehicleTypeId } from './catalog.ts';
import { NEW_CUSTOMER_PROMO, PRICE_CONFIG, type PriceConfig, type PromoConfig } from './pricing.config.ts';
import { SERVICES, isPlateChange, type PlateChoice, type ServiceId } from './services.ts';

export interface PriceInput {
  service: ServiceId;
  vehicleType: string;
  plateChoice: PlateChoice | null;
  plateSigns: boolean;
  delivery: 'versand' | 'abholung' | '';
  /** Erste Beauftragung je E-Mail-Adresse? Im Formular angenommen, auf dem Server geprüft. */
  newCustomer?: boolean;
}

export interface PriceLine {
  key: string;
  label: string;
  cents: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  /** Summe ohne Rabatt */
  regularCents: number;
  /** Rabattbetrag (positiv), 0 wenn keiner */
  discountCents: number;
  totalCents: number;
}

export function plateSignCount(vehicleType: string): number {
  return isVehicleTypeId(vehicleType) ? VEHICLE_TYPES[vehicleType].plates : 2;
}

/** Schilder werden nur bei Kennzeichenwechsel benötigt. */
export function needsPlateSigns(service: ServiceId, choice: PlateChoice | null): boolean {
  return isPlateChange(service, choice);
}

export function discountFor(cents: number, promo: PromoConfig = NEW_CUSTOMER_PROMO): number {
  return promo.enabled ? Math.round((cents * promo.percent) / 100) : 0;
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
    lines.push({ key: 'schilder', label: `Kennzeichenschilder (${count} Stück)`, cents: count * config.plateSignCents });
  }

  if (input.delivery === 'versand') {
    lines.push({ key: 'versand', label: 'Versand per Einschreiben', cents: config.shippingCents });
  } else if (input.delivery === 'abholung' && config.pickupCents > 0) {
    lines.push({ key: 'abholung', label: 'Abholung', cents: config.pickupCents });
  }

  const regularCents = lines.reduce((sum, l) => sum + l.cents, 0);
  const discountCents = input.newCustomer !== false && isPromoActive(promo) ? discountFor(serviceFee, promo) : 0;
  if (discountCents > 0) {
    lines.push({ key: 'rabatt', label: `${promo.label} ${promo.percent} % auf die Servicepauschale`, cents: -discountCents });
  }
  return { lines, regularCents, discountCents, totalCents: regularCents - discountCents };
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
