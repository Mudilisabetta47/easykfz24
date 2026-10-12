// Eigene Symbole für EasyKFZ24 OS (keine Fremdgrafiken). App-Symbole: abgerundete Kachel mit Verlauf + weißem Zeichen.

import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;

function Line({ children, ...p }: P) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
      {children}
    </svg>
  );
}

/* ---------- UI ---------- */
export const ISearch = (p: P) => (
  <Line {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Line>
);
export const IClose = (p: P) => (
  <Line {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Line>
);
export const IMin = (p: P) => (
  <Line {...p}>
    <path d="M6 12h12" />
  </Line>
);
export const IMax = (p: P) => (
  <Line {...p}>
    <rect x="5.5" y="5.5" width="13" height="13" rx="2" />
  </Line>
);
export const IRestore = (p: P) => (
  <Line {...p}>
    <rect x="5" y="8.5" width="10.5" height="10.5" rx="2" />
    <path d="M8.5 8.5V7a2 2 0 0 1 2-2H17a2 2 0 0 1 2 2v6.5a2 2 0 0 1-2 2h-1.5" />
  </Line>
);
export const ILock = (p: P) => (
  <Line {...p}>
    <rect x="5" y="10.5" width="14" height="10" rx="2.5" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </Line>
);
export const ISun = (p: P) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" />
  </Line>
);
export const IMoon = (p: P) => (
  <Line {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z" />
  </Line>
);
export const IPower = (p: P) => (
  <Line {...p}>
    <path d="M12 3v8" />
    <path d="M6.3 6.8a8 8 0 1 0 11.4 0" />
  </Line>
);
export const IRefresh = (p: P) => (
  <Line {...p}>
    <path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4" />
    <path d="M4 13a8 8 0 0 0 14.6 4.5L20 16m0 4v-4h-4" />
  </Line>
);
export const IExternal = (p: P) => (
  <Line {...p}>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
  </Line>
);
export const ICheck = (p: P) => (
  <Line {...p}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Line>
);
export const IWarn = (p: P) => (
  <Line {...p}>
    <path d="M12 4 2.8 19.5h18.4Z" />
    <path d="M12 10v4.5M12 17.2v.3" />
  </Line>
);
export const IInfo = (p: P) => (
  <Line {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </Line>
);
export const IGrid = (p: P) => (
  <svg viewBox="0 0 24 24" aria-hidden="true" {...p}>
    <rect x="3.5" y="3.5" width="7.6" height="7.6" rx="2" fill="currentColor" />
    <rect x="12.9" y="3.5" width="7.6" height="7.6" rx="2" fill="currentColor" opacity=".75" />
    <rect x="3.5" y="12.9" width="7.6" height="7.6" rx="2" fill="currentColor" opacity=".75" />
    <rect x="12.9" y="12.9" width="7.6" height="7.6" rx="2" fill="currentColor" opacity=".5" />
  </svg>
);
export const IUser = (p: P) => (
  <Line {...p}>
    <circle cx="12" cy="8.5" r="4" />
    <path d="M4.5 20.5a7.5 7.5 0 0 1 15 0" />
  </Line>
);
export const IDoc = (p: P) => (
  <Line {...p}>
    <path d="M14 3.5H7A2.5 2.5 0 0 0 4.5 6v12A2.5 2.5 0 0 0 7 20.5h10a2.5 2.5 0 0 0 2.5-2.5V9Z" />
    <path d="M14 3.5V9h5.5M8.5 13h7M8.5 16.5h5" />
  </Line>
);
export const IFolder = (p: P) => (
  <Line {...p}>
    <path d="M3.5 7.5A2.5 2.5 0 0 1 6 5h3.6l2 2.2H18a2.5 2.5 0 0 1 2.5 2.5V17a2.5 2.5 0 0 1-2.5 2.5H6A2.5 2.5 0 0 1 3.5 17Z" />
  </Line>
);
export const IChevron = (p: P) => (
  <Line {...p}>
    <path d="m9 6 6 6-6 6" />
  </Line>
);
export const IKeyboard = (p: P) => (
  <Line {...p}>
    <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
    <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
  </Line>
);

export const IWifi = (p: P) => (
  <Line {...p}>
    <path d="M3.5 9.5a12 12 0 0 1 17 0M6.5 12.8a7.5 7.5 0 0 1 11 0M9.5 16a3 3 0 0 1 5 0" />
    <circle cx="12" cy="19" r="0.9" fill="currentColor" />
  </Line>
);
export const IWifiOff = (p: P) => (
  <Line {...p}>
    <path d="M3.5 9.5a12 12 0 0 1 6-3.2M14.5 6.4a12 12 0 0 1 6 3.1M9.5 16a3 3 0 0 1 5 0M4 4l16 16" />
  </Line>
);
export const IBellOff = (p: P) => (
  <Line {...p}>
    <path d="M6.5 16V11a5.5 5.5 0 0 1 9-4.2M17.5 11v5l1.5 2H8M10 20.5a2.2 2.2 0 0 0 4 0M4 4l16 16" />
  </Line>
);
export const IBell = (p: P) => (
  <Line {...p}>
    <path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2H5ZM10 20.5a2.2 2.2 0 0 0 4 0" />
  </Line>
);
export const IMotion = (p: P) => (
  <Line {...p}>
    <path d="M4 12h3l2.5-6 5 12 2.5-6h3" />
  </Line>
);
export const IImage = (p: P) => (
  <Line {...p}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
    <circle cx="9" cy="10" r="1.6" />
    <path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5" />
  </Line>
);
export const IArrowRight = (p: P) => (
  <Line {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Line>
);
export const ISliders = (p: P) => (
  <Line {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Line>
);
export const IShield = (p: P) => (
  <Line {...p}>
    <path d="M12 3.5 5 6v5.5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9V6Z" />
    <path d="m9 12 2 2 4-4" />
  </Line>
);

/* ---------- App-Symbole ---------- */

export type AppId = 'dashboard' | 'orders' | 'customers' | 'registrations' | 'documents' | 'kfz' | 'finance' | 'tasks' | 'messages' | 'notifications' | 'trash' | 'settings';

const TILE: Record<AppId, [string, string]> = {
  dashboard: ['#3b6dff', '#1d3fd1'],
  orders: ['#2f8cff', '#2153e0'],
  customers: ['#21b7a1', '#11806f'],
  registrations: ['#7b5cff', '#4b2fd6'],
  documents: ['#f5b53d', '#d98a0f'],
  kfz: ['#1fc0d8', '#0b7fa6'],
  finance: ['#2fbf71', '#148a4c'],
  notifications: ['#ff7a59', '#e0472b'],
  tasks: ['#e85d9a', '#b8306f'],
  messages: ['#4f7cff', '#6a3fd8'],
  trash: ['#9aa7bd', '#5d6b85'],
  settings: ['#7d8aa6', '#4c5872'],
};

const GLYPH: Record<AppId, React.ReactNode> = {
  dashboard: (
    <>
      <path d="M5 16a7 7 0 1 1 14 0" />
      <path d="m12 16 3.2-4.2" />
      <path d="M5 19h14" />
    </>
  ),
  orders: (
    <>
      <rect x="6" y="5" width="12" height="15" rx="2" />
      <path d="M9.5 3.8h5v2.6h-5zM9 10.5h6M9 14h6M9 17.5h3.5" />
    </>
  ),
  customers: (
    <>
      <circle cx="9.5" cy="9" r="3" />
      <path d="M4.5 19a5 5 0 0 1 10 0" />
      <path d="M15.5 6.2a3 3 0 0 1 0 5.6M17.5 19a5 5 0 0 0-2.6-4.4" />
    </>
  ),
  registrations: (
    <>
      <path d="M5 15.5 6.6 11a2 2 0 0 1 1.9-1.3h7a2 2 0 0 1 1.9 1.3l1.6 4.5" />
      <path d="M4.5 15.5h15v3h-15z" />
      <path d="M7 18.5v1.5M17 18.5v1.5" />
      <circle cx="17.5" cy="6" r="2.5" />
      <path d="m16.4 6 .8.8 1.4-1.5" />
    </>
  ),
  documents: (
    <>
      <path d="M4 8a2 2 0 0 1 2-2h3.5l2 2H18a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2Z" />
      <path d="M4 11h16" />
    </>
  ),
  kfz: (
    <>
      <path d="M8 4v4M16 4v4" />
      <path d="M6 8h12v3a6 6 0 0 1-12 0Z" />
      <path d="M12 17v3.5" />
    </>
  ),
  finance: (
    <>
      <path d="M5 19V9M10 19V5M15 19v-7M20 19v-4" />
      <path d="M3.5 19.5h17" />
    </>
  ),
  notifications: (
    <>
      <path d="M6.5 16V11a5.5 5.5 0 0 1 11 0v5l1.5 2H5Z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </>
  ),
  tasks: (
    <>
      <rect x="5" y="4.5" width="14" height="16" rx="2" />
      <path d="m8.5 10 1.5 1.5 3-3M8.5 15.5l1.5 1.5 3-3M15 10.5h1M15 16h1" />
    </>
  ),
  messages: (
    <>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2.5" />
      <path d="m4.5 7.5 7.5 6 7.5-6" />
    </>
  ),
  trash: (
    <>
      <path d="M5 7h14M9.5 7V5h5v2" />
      <path d="M6.5 7l1 12.5h9l1-12.5" />
      <path d="M10 10.5v6M14 10.5v6" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M6 18l1.6-1.6M16.4 7.6 18 6" />
    </>
  ),
};

export function AppIcon({ app, size = 40 }: { app: AppId; size?: number }) {
  const [a, b] = TILE[app];
  const id = `os-tile-${app}`;
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-hidden="true" className="os-appicon">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill={`url(#${id})`} />
      <rect x="2" y="2" width="44" height="22" rx="12" fill="#fff" opacity=".12" />
      <g transform="translate(12 12)" fill="none" stroke="#fff" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {GLYPH[app]}
      </g>
    </svg>
  );
}

/** Markenzeichen des Systems (EasyKFZ24 OS) – eigenes Signet. */
export function OsMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} aria-hidden="true">
      <defs>
        <linearGradient id="os-mark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5b8cff" />
          <stop offset="1" stopColor="#2a55ff" />
        </linearGradient>
      </defs>
      <rect x="1" y="1" width="30" height="30" rx="9" fill="url(#os-mark)" />
      <path d="M9 11.5h10.5M9 16h8M9 20.5h10.5M9 11.5v9" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
      <circle cx="23" cy="20.5" r="2" fill="#fff" />
    </svg>
  );
}
