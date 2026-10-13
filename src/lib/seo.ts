// Gemeinsame SEO-Angaben: Vorschaubild für soziale Netzwerke und OpenGraph-Grundwerte.
// Next.js ersetzt openGraph je Seite vollständig – Seiten mit eigenem openGraph nutzen daher og().

import type { Metadata } from 'next';

export const OG_IMAGE = { url: '/og-image.png', width: 1200, height: 630, alt: 'EasyKFZ24 – Kfz-Zulassung online, deutschlandweit' };

export function og(title: string, description: string, url: string): NonNullable<Metadata['openGraph']> {
  return { title, description, url, type: 'website', locale: 'de_DE', siteName: 'EasyKFZ24', images: [OG_IMAGE] };
}
