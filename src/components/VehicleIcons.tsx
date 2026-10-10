// Linien-Symbole für die Fahrzeugauswahl (32 × 32, Strichstärke folgt der Schriftfarbe).

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Base({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

/** Auto von vorn */
export function CarFront(p: P) {
  return (
    <Base {...p}>
      <path d="M6.5 15.5 8.6 10a2.6 2.6 0 0 1 2.4-1.7h10a2.6 2.6 0 0 1 2.4 1.7l2.1 5.5" />
      <path d="M5 15.5h22a1 1 0 0 1 1 1V22a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5.5a1 1 0 0 1 1-1Z" />
      <path d="M7 23v2.2h3V23M22 23v2.2h3V23" />
      <circle cx="8.6" cy="19.2" r="1.4" />
      <circle cx="23.4" cy="19.2" r="1.4" />
      <path d="M13 20h6" />
      <path d="M8.2 13.5h15.6" />
    </Base>
  );
}

/** Elektroauto: Auto mit Blitz */
export function CarElectric(p: P) {
  return (
    <Base {...p}>
      <path d="M4.5 18.5 6.2 14a2.4 2.4 0 0 1 2.2-1.5h8.2a2.4 2.4 0 0 1 2.2 1.5l1.7 4.5" />
      <path d="M3.5 18.5h18a1 1 0 0 1 1 1V24a1 1 0 0 1-1 1h-18a1 1 0 0 1-1-1v-4.5a1 1 0 0 1 1-1Z" />
      <path d="M5 25v1.8h2.6V25M17.4 25v1.8H20V25" />
      <circle cx="6.4" cy="21.7" r="1.1" />
      <circle cx="18.6" cy="21.7" r="1.1" />
      <circle cx="24.5" cy="9" r="5.2" />
      <path d="m25.4 5.8-2.6 3.6h3.3l-2.2 3.6" />
    </Base>
  );
}

/** Oldtimer von vorn mit hohem Kühlergrill und runden Scheinwerfern */
export function CarClassic(p: P) {
  return (
    <Base {...p}>
      <path d="M9 7h14M10 7v4M22 7v4" />
      <rect x="13" y="9" width="6" height="11" rx="1.2" />
      <path d="M14.8 11.5v6M17.2 11.5v6" />
      <path d="M3.5 20.5c0-3.3 1.6-5 4.5-5h5M28.5 20.5c0-3.3-1.6-5-4.5-5h-5" />
      <circle cx="7" cy="13" r="2.2" />
      <circle cx="25" cy="13" r="2.2" />
      <path d="M3.5 20.5h25V23H3.5z" />
      <path d="M6 23v2.5h3V23M23 23v2.5h3V23" />
    </Base>
  );
}

/** Traktor von der Seite */
export function Tractor(p: P) {
  return (
    <Base {...p}>
      <circle cx="10" cy="21" r="6" />
      <circle cx="10" cy="21" r="2" />
      <circle cx="25" cy="23.5" r="3.5" />
      <path d="M5.5 15.5V6.5h9.5v8.6" />
      <path d="M8 6.5v5h7" />
      <path d="M15 13h8.5l2.5 6.6" />
      <path d="M16 23.5h5.5" />
      <path d="M20.5 13V8.5" />
    </Base>
  );
}

/** Motorrad */
export function Motorcycle(p: P) {
  return (
    <Base {...p}>
      <circle cx="7" cy="21.5" r="4.8" />
      <circle cx="25" cy="21.5" r="4.8" />
      <path d="M7 21.5 11.5 15h9l4.5 6.5" />
      <path d="M10 15.2c.4-1.8 1.8-2.7 4-2.7h4.5c1.6 0 2.6.8 3 2.4" />
      <path d="m21.5 12.5-1.2-4h3.4" />
      <path d="M13.5 21.5h5" />
    </Base>
  );
}

/** Leichtkraftrad / Roller-ähnlich, kleiner und leichter */
export function LightBike(p: P) {
  return (
    <Base {...p}>
      <circle cx="8" cy="22.5" r="3.8" />
      <circle cx="24" cy="22.5" r="3.8" />
      <path d="M8 22.5h8.5l3.8-6.5" />
      <path d="M9 16.5h7.5" />
      <path d="M24 22.5 21 10.5h-3" />
      <path d="M21.5 13.5h3" />
    </Base>
  );
}
