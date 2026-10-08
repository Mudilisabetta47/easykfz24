// Preisberechnung für einen Auftrag (ohne amtliche Gebühren).

import { VEHICLE_TYPES, isVehicleTypeId } from './catalog.ts';
import { PRICE_CONFIG, type PriceConfig } from './pricing.config.ts';
import { SERVICES, isPlateChange, type PlateChoice, type ServiceId } from './services.ts';

export interface PriceInput {
  service: ServiceId;
  vehicleType: string;
  plateChoice: PlateChoice | null;
  plateSigns: boolean;
  delivery: 'versand' | 'abholung' | '';
}

export interface PriceLine {
  key: string;
  label: string;
  cents: number;
}

export interface PriceBreakdown {
  lines: PriceLine[];
  totalCents: number;
}

export function plateSignCount(vehicleType: string): number {
  return isVehicleTypeId(vehicleType) ? VEHICLE_TYPES[vehicleType].plates : 2;
}

/** Schilder werden nur bei Kennzeichenwechsel benötigt. */
export function needsPlateSigns(service: ServiceId, choice: PlateChoice | null): boolean {
  return isPlateChange(service, choice);
}

export function calculatePrice(input: PriceInput, config: PriceConfig = PRICE_CONFIG): PriceBreakdown {
  const lines: PriceLine[] = [
    { key: 'service', label: `Servicepauschale ${SERVICES[input.service].title}`, cents: config.serviceFeeCents[input.service] },
  ];

  if (input.plateChoice === 'wunsch' && SERVICES[input.service].plateChoices.includes('wunsch')) {
    lines.push({ key: 'wunsch', label: 'Reservierung Wunschkennzeichen (Bearbeitung)', cents: config.wishPlateHandlingCents });
  }

  if (input.plateSigns && needsPlateSigns(input.service, input.plateChoice)) {
    const count = plateSignCount(input.vehicleType);
    lines.push({
      key: 'schilder',
      label: `Kennzeichenschilder (${count} Stück)`,
      cents: count * config.plateSignCents,
    });
  }

  if (input.delivery === 'versand') {
    lines.push({ key: 'versand', label: 'Versand per Einschreiben', cents: config.shippingCents });
  } else if (input.delivery === 'abholung' && config.pickupCents > 0) {
    lines.push({ key: 'abholung', label: 'Abholung', cents: config.pickupCents });
  }

  return { lines, totalCents: lines.reduce((sum, l) => sum + l.cents, 0) };
}
