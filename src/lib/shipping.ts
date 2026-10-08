// Versandpartner für Fahrzeugpapiere und Kennzeichen.
// Logos: offizielle Dateien aus den Presseportalen der Anbieter unter public/brands/ ablegen und hier eintragen.
// Ohne Logo wird der Name als neutrale Schriftmarke angezeigt.

export const CARRIER_IDS = ['dhl', 'ups'] as const;
export type CarrierId = (typeof CARRIER_IDS)[number];

export interface Carrier {
  id: CarrierId;
  name: string;
  service: string;
  /** Pfad unter public/, z. B. "/brands/dhl.svg" – null, solange keine offizielle Datei vorliegt */
  logo: string | null;
  trackingUrl: (trackingNumber: string) => string;
}

export const CARRIERS: Record<CarrierId, Carrier> = {
  dhl: {
    id: 'dhl',
    name: 'DHL',
    service: 'Versand mit Sendungsverfolgung',
    logo: null,
    trackingUrl: (nr) => `https://www.dhl.de/de/privatkunden/pakete-empfangen/verfolgen.html?piececode=${encodeURIComponent(nr)}`,
  },
  ups: {
    id: 'ups',
    name: 'UPS',
    service: 'Versand mit Sendungsverfolgung',
    logo: null,
    trackingUrl: (nr) => `https://www.ups.com/track?loc=de_DE&tracknum=${encodeURIComponent(nr)}`,
  },
};

export function isCarrierId(v: unknown): v is CarrierId {
  return typeof v === 'string' && (CARRIER_IDS as readonly string[]).includes(v);
}

/** Sendungsnummern: 8–40 Zeichen, Buchstaben und Ziffern. */
export function normalizeTrackingNumber(input: string): string | null {
  const v = input.toUpperCase().replace(/[\s-]/g, '');
  return /^[A-Z0-9]{8,40}$/.test(v) ? v : null;
}
