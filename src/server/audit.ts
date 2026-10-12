// Protokoll kritischer Aktionen (Anmeldungen, Statuswechsel, Dokumentzugriffe, Benutzer- und Einstellungsänderungen).

import { headers } from 'next/headers';
import { getDb } from './db.ts';
import { ipFrom } from './limits.ts';

export interface AuditActor {
  id: number | null;
  username: string;
}

export interface AuditRow {
  id: number;
  at: string;
  user_id: number | null;
  username: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

export async function audit(actor: AuditActor | null, action: string, target = '', detail = ''): Promise<void> {
  let ip = '';
  try {
    ip = ipFrom(await headers());
  } catch {
    /* außerhalb einer Anfrage */
  }
  try {
    await (await getDb()).run(
      'INSERT INTO audit_log (at, user_id, username, action, target, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?)',
      new Date().toISOString(),
      actor?.id ?? null,
      actor?.username ?? '–',
      action.slice(0, 80),
      target.slice(0, 120),
      detail.slice(0, 500),
      ip,
    );
  } catch (e) {
    // Das Protokoll darf die eigentliche Aktion nicht verhindern – Fehler aber sichtbar machen.
    console.error('[audit] Eintrag fehlgeschlagen:', (e as Error).message);
  }
}

export async function listAudit(limit = 200): Promise<AuditRow[]> {
  return (await getDb()).all<AuditRow>('SELECT * FROM audit_log ORDER BY at DESC, id DESC LIMIT ?', Math.min(limit, 1000));
}

const FAILED_LOGIN_ACTIONS = ['anmeldung.fehlgeschlagen', 'entsperren.fehlgeschlagen', 'anmeldung.2fa_fehlgeschlagen', 'entsperren.2fa_fehlgeschlagen', 'konto.2fa_fehlgeschlagen', 'passwort.aenderung_fehlgeschlagen'];

/**
 * Fehlgeschlagene Anmeldungen der letzten Minuten aus dem Protokoll (gilt über alle Server-Instanzen hinweg –
 * die Sperre im Arbeitsspeicher allein greift auf Cloudflare nur je Instanz).
 */
export async function recentLoginFailures(ip: string, minutes = 15): Promise<{ ip: number; all: number }> {
  try {
    const since = new Date(Date.now() - minutes * 60_000).toISOString();
    const marks = FAILED_LOGIN_ACTIONS.map(() => '?').join(',');
    const r = await (await getDb()).first<{ ip: number | null; total: number }>(
      `SELECT SUM(CASE WHEN ip = ? THEN 1 ELSE 0 END) AS ip, COUNT(*) AS total FROM audit_log WHERE at >= ? AND action IN (${marks})`,
      ip,
      since,
      ...FAILED_LOGIN_ACTIONS,
    );
    return { ip: r?.ip ?? 0, all: r?.total ?? 0 };
  } catch {
    return { ip: 0, all: 0 };
  }
}

/** Grenzwerte der dauerhaften Sperre (großzügiger als die schnelle Sperre im Arbeitsspeicher). */
export const LOGIN_FAILURE_LIMITS = { perIp: 10, global: 60 } as const;
