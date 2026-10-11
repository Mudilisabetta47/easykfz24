'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Lädt die Serverdaten der Seite regelmäßig neu, solange der Tab sichtbar ist (z. B. für Webhook-Status). */
export function AutoRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      // Nicht stören, während jemand tippt oder auswählt
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;
      if (document.visibilityState === 'visible' && !typing) router.refresh();
    };
    const t = window.setInterval(tick, seconds * 1000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [router, seconds]);
  return null;
}
