// Eine Adresse für Google: http:// und www. leiten dauerhaft auf https://easykfz24.de um (Pfad und Query bleiben).
// Andere Hosts (workers.dev, localhost, Tests) bleiben unberührt.

export const CANONICAL_HOST = 'easykfz24.de';

export function canonicalRedirect(url: string, method = 'GET'): { location: string; status: 301 | 308 } | null {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  if (host !== CANONICAL_HOST && host !== `www.${CANONICAL_HOST}`) return null;
  if (host === CANONICAL_HOST && u.protocol === 'https:') return null;
  const target = new URL(u.pathname + u.search, `https://${CANONICAL_HOST}`);
  // 301 für Seitenaufrufe; 308 erhält bei Formularen/Webhooks die Methode und den Inhalt
  return { location: target.toString(), status: method === 'GET' || method === 'HEAD' ? 301 : 308 };
}
