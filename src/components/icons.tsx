// Inline-Icons (1–3 Pfade, currentColor). Keine Icon-Bibliothek.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const ArrowRight = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);
export const Check = (p: P) => (
  <svg {...base} strokeWidth={2} {...p}>
    <path d="M5 12.5l4.2 4.2L19 7" />
  </svg>
);
export const Close = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const Plus = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const Shield = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3l7.5 3v5.6c0 4.4-3.1 8.2-7.5 9.4-4.4-1.2-7.5-5-7.5-9.4V6L12 3z" />
    <path d="M8.8 12.2l2.2 2.2 4.2-4.4" />
  </svg>
);
export const Pulse = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 12h4l2.5-6 5 12 2.5-6H21" />
  </svg>
);
export const Receipt = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" />
    <path d="M9 8h6M9 12h6M9 16h3" />
  </svg>
);
export const Cloud = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 18a4.5 4.5 0 01-.6-9 6 6 0 0111.5 1.6A3.8 3.8 0 0117.5 18H7z" />
    <path d="M12 11v5M9.8 13.2L12 11l2.2 2.2" />
  </svg>
);
export const Headset = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 14v-2a8 8 0 0116 0v2" />
    <path d="M4 14h3v5H5a1 1 0 01-1-1v-4zM20 14h-3v5h2a1 1 0 001-1v-4z" />
    <path d="M17 19c0 1.1-1.8 2-4 2" />
  </svg>
);
export const Flag = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 21V4M5 4h12l-2 4 2 4H5" />
  </svg>
);
export const Car = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 15.5V13l2-4.5A2 2 0 016.8 7h10.4a2 2 0 011.8 1.5L21 13v2.5a1 1 0 01-1 1h-1.2M3 15.5a1 1 0 001 1h1.2M8.8 16.5h6.4" />
    <circle cx="7" cy="16.5" r="1.8" />
    <circle cx="17" cy="16.5" r="1.8" />
    <path d="M5 13h14" />
  </svg>
);
export const Swap = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 8h13l-3.5-3.5M20 16H7l3.5 3.5" />
  </svg>
);
export const Restart = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6" />
  </svg>
);
export const PowerOff = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3v8" />
    <path d="M6.4 6.4a8 8 0 1 0 11.2 0" />
  </svg>
);
export const Doc = (p: P) => (
  <svg {...base} {...p}>
    <path d="M7 3h7l4 4v14H7V3z" />
    <path d="M14 3v4h4M10 12h5M10 16h5" />
  </svg>
);
export const Truck = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 6h11v10H3zM14 10h4l3 3v3h-7" />
    <circle cx="7" cy="17.5" r="1.7" />
    <circle cx="17.5" cy="17.5" r="1.7" />
  </svg>
);
export const Sparkle = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
  </svg>
);
export const Bolt = (p: P) => (
  <svg {...base} {...p}>
    <path d="M13 3L5 13.5h6L10 21l8-10.5h-6L13 3z" />
  </svg>
);
export const Menu = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 8h16M4 16h16" />
  </svg>
);
