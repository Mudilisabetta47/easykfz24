import type { MetadataRoute } from 'next';
import { publicBaseUrl } from '../server/payments.ts';

export default function robots(): MetadataRoute.Robots {
  const base = publicBaseUrl();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: ['/admin', '/api/', '/zahlung/'] }],
    sitemap: `${base}/sitemap.xml`,
  };
}
