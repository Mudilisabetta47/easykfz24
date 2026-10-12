'use client';

// Datenzugriff für EasyKFZ24 OS. Alle Anfragen gehen an /api/admin/os/* (Sitzung + Berechtigung serverseitig).
// 401 = Sitzung abgelaufen → Sperrbildschirm (Ereignis „os:locked“).

import { useCallback, useEffect, useRef, useState } from 'react';

export class OsError extends Error {
  constructor(
    public status: number,
    message: string,
    public data: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export async function osFetch<T>(path: string, opts: { method?: 'GET' | 'POST'; body?: unknown; background?: boolean } = {}): Promise<T> {
  const res = await fetch(`/api/admin/os/${path}`, {
    method: opts.method ?? 'GET',
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.background ? { 'x-os-background': '1' } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    cache: 'no-store',
    credentials: 'same-origin',
  }).catch(() => {
    throw new OsError(0, 'Keine Verbindung zum Server');
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; locked?: boolean };
  if (res.status === 401 && data.locked) window.dispatchEvent(new CustomEvent('os:locked'));
  if (!res.ok) throw new OsError(res.status, data.error ?? `Fehler ${res.status}`, data as Record<string, unknown>);
  return data as T;
}

/** Daten laden mit Ladezustand, Fehler und Neu-Laden; reagiert auf globales „Aktualisieren“ (os:refresh). */
export function useOsData<T>(path: string | null, opts: { pollMs?: number } = {}) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!path);
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (background = false) => {
      if (!path) return;
      if (!background) setLoading(true);
      try {
        const d = await osFetch<T>(path, { background });
        if (current.current === path) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (current.current === path && !(e instanceof OsError && e.status === 401)) setError((e as Error).message);
      } finally {
        if (current.current === path) setLoading(false);
      }
    },
    [path],
  );

  useEffect(() => {
    void load();
    const onRefresh = () => void load(true);
    window.addEventListener('os:refresh', onRefresh);
    const t = opts.pollMs ? window.setInterval(() => document.visibilityState === 'visible' && void load(true), opts.pollMs) : 0;
    return () => {
      window.removeEventListener('os:refresh', onRefresh);
      if (t) window.clearInterval(t);
    };
  }, [load, opts.pollMs]);

  return { data, error, loading, reload: load, setData };
}

export const euro = (cents: number | null | undefined) =>
  cents === null || cents === undefined ? '–' : (cents / 100).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';

export const relTime = (iso: string) => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.floor(s / 60)} Min.`;
  if (s < 86_400) return `vor ${Math.floor(s / 3600)} Std.`;
  return `vor ${Math.floor(s / 86_400)} Tg.`;
};
