// Systemeinstellungen (D1-Tabelle settings): Sperrzeit bei Inaktivität, Einkaufskosten je Leistung.

import { SERVICE_IDS, type ServiceId } from '../lib/services.ts';
import { getDb } from './db.ts';

export interface SystemSettings {
  /** Automatische Sitzungssperre nach so vielen Minuten ohne Aktivität */
  lockMinutes: number;
  /** Eigene Einkaufskosten je Vorgang (Cent) – z. B. Kosten bei kfz-api.de; null = nicht hinterlegt */
  costs: Record<ServiceId, number | null>;
}

export const LOCK_MINUTES_DEFAULT = 15;
export const LOCK_MINUTES_RANGE = { min: 5, max: 120 } as const;

const g = globalThis as unknown as { __ekSettings?: { at: number; value: SystemSettings } };

export async function getSettings(fresh = false): Promise<SystemSettings> {
  if (!fresh && g.__ekSettings && Date.now() - g.__ekSettings.at < 30_000) return g.__ekSettings.value;
  const rows = await (await getDb()).all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const map = new Map(rows.map((r) => [r.key, r.value]));
  const lock = Number(map.get('lock_minutes'));
  const value: SystemSettings = {
    lockMinutes: Number.isInteger(lock) && lock >= LOCK_MINUTES_RANGE.min && lock <= LOCK_MINUTES_RANGE.max ? lock : LOCK_MINUTES_DEFAULT,
    costs: Object.fromEntries(
      SERVICE_IDS.map((s) => {
        const v = map.get(`cost_${s}`);
        const n = v === undefined || v === '' ? null : Number(v);
        return [s, n !== null && Number.isInteger(n) && n >= 0 ? n : null];
      }),
    ) as Record<ServiceId, number | null>,
  };
  g.__ekSettings = { at: Date.now(), value };
  return value;
}

export async function setSettings(values: Record<string, string>, by: string): Promise<void> {
  const db = await getDb();
  const now = new Date().toISOString();
  await db.batch(
    Object.entries(values).map(([key, value]) => ({
      sql: 'INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by',
      params: [key, value, now, by],
    })),
  );
  g.__ekSettings = undefined;
}
