// Ratenbegrenzung im Prozessspeicher. Gilt je Server-Instanz – gegen verteilte Angriffe braucht es einen gemeinsamen Speicher.

import { headers } from 'next/headers';
import { SlidingWindowLimiter } from '../lib/rate-limit.ts';

const g = globalThis as unknown as {
  __ekLimits?: {
    orders: SlidingWindowLimiter;
    status: SlidingWindowLimiter;
    loginPerIp: SlidingWindowLimiter;
    loginGlobal: SlidingWindowLimiter;
  };
};

export function limits() {
  g.__ekLimits ??= {
    orders: new SlidingWindowLimiter(5, 60 * 60 * 1000), // 5 Aufträge pro Stunde und IP
    status: new SlidingWindowLimiter(12, 10 * 60 * 1000), // 12 Statusabfragen pro 10 Minuten und IP
    loginPerIp: new SlidingWindowLimiter(5, 15 * 60 * 1000), // 5 Fehlversuche pro 15 Minuten und IP
    loginGlobal: new SlidingWindowLimiter(30, 15 * 60 * 1000), // insgesamt 30 Fehlversuche pro 15 Minuten
  };
  return g.__ekLimits;
}

/** Client-IP aus dem Proxy-Header (erster Eintrag). Ohne Proxy davor ist der Header fälschbar – siehe README. */
export function ipFrom(h: Headers): string {
  const fwd = h.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim().slice(0, 64);
  return (h.get('x-real-ip') ?? 'unbekannt').slice(0, 64);
}

export async function clientIp(): Promise<string> {
  return ipFrom(await headers());
}
