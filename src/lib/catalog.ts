// Stammdaten für Fahrzeugangaben im Auftragsformular.

export const VEHICLE_TYPE_IDS = ['pkw', 'motorrad', 'lkw', 'wohnmobil', 'anhaenger'] as const;
export type VehicleTypeId = (typeof VEHICLE_TYPE_IDS)[number];

export const VEHICLE_TYPES: Record<VehicleTypeId, { label: string; plates: number }> = {
  pkw: { label: 'Pkw', plates: 2 },
  motorrad: { label: 'Motorrad / Leichtkraftrad', plates: 1 },
  lkw: { label: 'Lkw / Transporter', plates: 2 },
  wohnmobil: { label: 'Wohnmobil', plates: 2 },
  anhaenger: { label: 'Anhänger', plates: 1 },
};

export const DRIVE_TYPE_IDS = [
  'benzin',
  'diesel',
  'elektro',
  'plugin_hybrid',
  'hybrid',
  'gas',
  'wasserstoff',
  'sonstige',
] as const;
export type DriveTypeId = (typeof DRIVE_TYPE_IDS)[number];

export const DRIVE_TYPES: Record<DriveTypeId, string> = {
  benzin: 'Benzin',
  diesel: 'Diesel',
  elektro: 'Elektro',
  plugin_hybrid: 'Plug-in-Hybrid',
  hybrid: 'Hybrid (ohne Stecker)',
  gas: 'Gas (LPG/CNG)',
  wasserstoff: 'Wasserstoff / Brennstoffzelle',
  sonstige: 'Sonstiger Antrieb',
};

/** Antriebe, für die ein E-Kennzeichen grundsätzlich in Frage kommt (Prüfung im Einzelfall durch die Behörde). */
export function isEKennzeichenEligible(drive: string): boolean {
  return drive === 'elektro' || drive === 'plugin_hybrid' || drive === 'wasserstoff';
}

export function isVehicleTypeId(v: string): v is VehicleTypeId {
  return (VEHICLE_TYPE_IDS as readonly string[]).includes(v);
}

export function isDriveTypeId(v: string): v is DriveTypeId {
  return (DRIVE_TYPE_IDS as readonly string[]).includes(v);
}

export const MANUFACTURER_SUGGESTIONS = [
  'Audi', 'BMW', 'BYD', 'Citroën', 'Cupra', 'Dacia', 'Fiat', 'Ford', 'Honda', 'Hyundai', 'Kia',
  'Mazda', 'Mercedes-Benz', 'MG', 'Mini', 'Mitsubishi', 'Nissan', 'Opel', 'Peugeot', 'Porsche',
  'Renault', 'Seat', 'Skoda', 'Smart', 'Subaru', 'Suzuki', 'Tesla', 'Toyota', 'Volkswagen', 'Volvo',
  'Harley-Davidson', 'KTM', 'Yamaha', 'Kawasaki', 'Ducati', 'Hymer', 'Knaus', 'Humbaur', 'Böckmann',
];
