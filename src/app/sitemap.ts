import type { MetadataRoute } from 'next';
import { allCodes, slugForCode } from '../lib/district-pages.ts';
import { PLATE_CODES_CHECKED } from '../lib/plate-codes.generated.ts';
import { SERVICE_LANDINGS } from '../lib/service-landings.ts';
import { publicBaseUrl } from '../server/payments.ts';

// Nur indexierbare Seiten. Bewusst NICHT enthalten (noindex): Auftrag/Checkout, Statusabfrage, Zahlung, Vollmacht,
// Widerruf, Impressum, Datenschutz sowie Verwaltung und Schnittstellen.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBaseUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/kfz-anmelden`, changeFrequency: 'monthly', priority: 0.9 },
    ...Object.values(SERVICE_LANDINGS).map((p) => ({ url: `${base}${p.path}`, changeFrequency: 'monthly' as const, priority: 0.9 })),
    { url: `${base}/kennzeichen`, changeFrequency: 'monthly', priority: 0.8, lastModified: PLATE_CODES_CHECKED },
  ];
  return [
    ...pages,
    ...allCodes().map((c) => ({
      url: `${base}/kennzeichen/${slugForCode(c)}`,
      changeFrequency: 'monthly' as const,
      priority: 0.6,
      lastModified: PLATE_CODES_CHECKED,
    })),
  ];
}
