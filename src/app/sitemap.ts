import type { MetadataRoute } from 'next';
import { allCodes, slugForCode } from '../lib/district-pages.ts';
import { publicBaseUrl } from '../server/payments.ts';

export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBaseUrl();
  const pages: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'weekly', priority: 1 },
    { url: `${base}/kfz-anmelden`, changeFrequency: 'monthly', priority: 0.9 },
    { url: `${base}/kfz-anmelden/auftrag`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/kennzeichen`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${base}/status`, changeFrequency: 'yearly', priority: 0.3 },
    { url: `${base}/impressum`, changeFrequency: 'yearly', priority: 0.1 },
    { url: `${base}/datenschutz`, changeFrequency: 'yearly', priority: 0.1 },
  ];
  return [
    ...pages,
    ...allCodes().map((c) => ({ url: `${base}/kennzeichen/${slugForCode(c)}`, changeFrequency: 'monthly' as const, priority: 0.6 })),
  ];
}
