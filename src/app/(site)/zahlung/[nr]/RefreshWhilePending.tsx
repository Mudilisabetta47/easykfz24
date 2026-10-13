'use client';

// Lädt die Zahlungsseite in wachsenden Abständen neu, solange die Bestätigung des Zahlungsdienstleisters aussteht
// (der Server gleicht dabei gedrosselt über die Mollie-API ab). Höchstens rund zwei Minuten.

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

const DELAYS = [3000, 5000, 8000, 12000, 15000, 20000, 25000, 30000];

export function RefreshWhilePending({ round }: { round: number }) {
  const router = useRouter();
  useEffect(() => {
    if (round >= DELAYS.length) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.set('runde', String(round + 1));
      router.replace(`${url.pathname}${url.search}`, { scroll: false });
    }, DELAYS[round]);
    return () => clearTimeout(t);
  }, [round, router]);
  return null;
}
