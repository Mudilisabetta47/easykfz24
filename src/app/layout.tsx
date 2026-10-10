import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/components.css';

export const metadata: Metadata = {
  metadataBase: new URL(process.env.PUBLIC_BASE_URL || 'http://localhost:3024'),
  title: {
    default: 'EasyKFZ24 – Kfz-Zulassung digital beauftragen',
    template: '%s · EasyKFZ24',
  },
  description:
    'Zulassen, ummelden, wiederzulassen oder abmelden: Vorgang online starten, Unterlagen hochladen, Status jederzeit abrufen. EasyKFZ24 ist ein privater Zulassungsservice.',
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#050a1f',
  width: 'device-width',
  initialScale: 1,
};

// Vor dem ersten Zeichnen: JS-Klasse und Bewegungspräferenz setzen, damit Reveals nicht aufblitzen.
// ?motion=reduced erzwingt den statischen Zustand (QA-Haken, wie prefers-reduced-motion).
const bootScript = `(function(){var d=document.documentElement;d.classList.add('js');try{if(/[?&]motion=reduced/.test(location.search))d.dataset.motionForce='reduced';d.dataset.motion=(d.dataset.motionForce||matchMedia('(prefers-reduced-motion: reduce)').matches)?'reduced':'full'}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
