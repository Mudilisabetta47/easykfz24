// Benachrichtigungsarten von EasyKFZ24 OS (gemeinsam für Server und Oberfläche).

import type { Permission } from './permissions.ts';

export const NOTIFY_KINDS = [
  'auftrag_neu',
  'bestandskunde',
  'zahlung_ok',
  'zahlung_fehler',
  'unterlagen_fehlen',
  'kfz_status',
  'zulassung_ok',
  'zulassung_abgelehnt',
  'behoerde_rueckfrage',
  'webhook_fehler',
  'aufgabe',
  'frist',
  'mail_fehler',
  'nachricht',
  'system',
] as const;
export type NotifyKind = (typeof NOTIFY_KINDS)[number];

export const PRIORITIES = ['info', 'normal', 'wichtig', 'kritisch'] as const;
export type NotifyPriority = (typeof PRIORITIES)[number];

export const NOTIFY_META: Record<NotifyKind, { label: string; priority: NotifyPriority; permission: Permission; group: 'auftraege' | 'zahlung' | 'api' | 'team' | 'system' }> = {
  auftrag_neu: { label: 'Neue Bestellung', priority: 'normal', permission: 'orders.read', group: 'auftraege' },
  bestandskunde: { label: 'Bestandskunde bestellt erneut', priority: 'info', permission: 'customers.read', group: 'auftraege' },
  zahlung_ok: { label: 'Zahlung eingegangen', priority: 'normal', permission: 'finance.read', group: 'zahlung' },
  zahlung_fehler: { label: 'Zahlung fehlgeschlagen', priority: 'wichtig', permission: 'finance.read', group: 'zahlung' },
  unterlagen_fehlen: { label: 'Unterlagen fehlen', priority: 'wichtig', permission: 'orders.read', group: 'auftraege' },
  kfz_status: { label: 'Neuer API-Status', priority: 'info', permission: 'kfz.read', group: 'api' },
  zulassung_ok: { label: 'Zulassung erfolgreich', priority: 'normal', permission: 'orders.read', group: 'auftraege' },
  zulassung_abgelehnt: { label: 'Zulassung abgelehnt / fehlgeschlagen', priority: 'kritisch', permission: 'orders.read', group: 'api' },
  behoerde_rueckfrage: { label: 'Rückfrage der Behörde', priority: 'wichtig', permission: 'orders.read', group: 'api' },
  webhook_fehler: { label: 'Webhook fehlerhaft / nicht zugeordnet', priority: 'kritisch', permission: 'kfz.read', group: 'api' },
  aufgabe: { label: 'Aufgabe / Zuweisung', priority: 'normal', permission: 'orders.read', group: 'team' },
  frist: { label: 'Überfällige Bearbeitung / Wiedervorlage', priority: 'wichtig', permission: 'orders.read', group: 'team' },
  mail_fehler: { label: 'E-Mail nicht versendet', priority: 'wichtig', permission: 'orders.read', group: 'system' },
  nachricht: { label: 'Kundennachricht vorbereitet', priority: 'info', permission: 'orders.read', group: 'team' },
  system: { label: 'System', priority: 'info', permission: 'settings.manage', group: 'system' },
};

export interface NotifyPrefs {
  /** Hinweis am Desktop (Toast) je Art */
  toast: Partial<Record<NotifyKind, boolean>>;
  /** E-Mail an die eigene Adresse je Art */
  email: Partial<Record<NotifyKind, boolean>>;
  /** Browser-Benachrichtigung (nach Zustimmung des Browsers) für kritische Meldungen */
  browser: boolean;
}

export const DEFAULT_PREFS: NotifyPrefs = { toast: {}, email: {}, browser: false };

export function toastEnabled(p: NotifyPrefs, k: NotifyKind): boolean {
  return p.toast[k] ?? true;
}
export function emailEnabled(p: NotifyPrefs, k: NotifyKind): boolean {
  return p.email[k] ?? false;
}
