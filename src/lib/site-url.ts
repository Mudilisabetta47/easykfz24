// Öffentliche Basisadresse der Website (Canonicals, Sitemap, Webhook-URL, Links in E-Mails).
// PUBLIC_BASE_URL hat Vorrang; in Produktion ohne Angabe die Hauptdomain, damit nie „localhost“ veröffentlicht wird.

export const PRODUCTION_URL = 'https://easykfz24.de';

export function siteUrl(): string {
  const env = process.env.PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, '');
  return process.env.NODE_ENV === 'production' ? PRODUCTION_URL : 'http://localhost:3024';
}
