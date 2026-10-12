'use client';

import { createContext, useContext } from 'react';
import type { Permission } from '../../lib/permissions.ts';
import type { AppId } from './icons.tsx';

export interface OsSession {
  user: { id: number; username: string; displayName: string; role: string; roleLabel: string };
  permissions: Permission[];
  lockMinutes: number;
  prefs?: { notify: { toast: Record<string, boolean>; email: Record<string, boolean>; browser: boolean }; desktop: Record<string, unknown>; readUntil: string };
}

export interface Toast {
  id: string;
  title: string;
  text?: string;
  tone?: 'info' | 'ok' | 'warn' | 'error';
  orderId?: number | null;
}

export const ACCENTS: Record<string, { label: string; color: string; strong: string }> = {
  blau: { label: 'Blau', color: '#2a5bff', strong: '#1d43d6' },
  violett: { label: 'Violett', color: '#6d4aff', strong: '#5432e0' },
  petrol: { label: 'Petrol', color: '#0b8a8a', strong: '#076a6a' },
  gruen: { label: 'Grün', color: '#178a4d', strong: '#106b3a' },
  orange: { label: 'Orange', color: '#d9580f', strong: '#b4460a' },
  rot: { label: 'Rot', color: '#d23a4b', strong: '#ad2a39' },
  graphit: { label: 'Graphit', color: '#4b5a72', strong: '#374459' },
};

export interface DesktopPrefs {
  accent?: string;
  iconSize?: 'klein' | 'mittel' | 'gross' | string;
  snap?: boolean;
  openMaximized?: boolean;
  [k: string]: unknown;
}

export interface OsApi {
  session: OsSession;
  desktop: DesktopPrefs;
  setDesktop: (patch: Partial<DesktopPrefs>) => void;
  can: (p: Permission) => boolean;
  openApp: (app: AppId, params?: Record<string, unknown>) => void;
  toast: (t: Omit<Toast, 'id'>) => void;
  theme: 'light' | 'dark';
  setTheme: (t: 'light' | 'dark') => void;
  wallpaper: number;
  setWallpaper: (w: number) => void;
  lock: () => void;
}

export const OsContext = createContext<OsApi | null>(null);

export function useOs(): OsApi {
  const v = useContext(OsContext);
  if (!v) throw new Error('useOs außerhalb von EasyKFZ24 OS');
  return v;
}

export interface AppDef {
  id: AppId;
  title: string;
  /** Titel mit weichen Trennstellen für Desktop-Symbole (sauberer Umbruch) */
  label: string;
  /** Immer in der Taskleiste (sonst nur, solange geöffnet) */
  pinned: boolean;
  description: string;
  permission: Permission | null;
  size: { w: number; h: number };
  keywords: string;
}

export const APPS: AppDef[] = [
  { id: 'dashboard', title: 'Kontrollzentrum', label: 'Kontroll\u00ADzentrum', pinned: true, description: 'Kennzahlen, Umsätze, API-Status', permission: 'orders.read', size: { w: 1080, h: 720 }, keywords: 'dashboard übersicht kpi start' },
  { id: 'orders', title: 'Auftragscenter', label: 'Auftrags\u00ADcenter', pinned: true, description: 'Aufträge verwalten und bearbeiten', permission: 'orders.read', size: { w: 1120, h: 720 }, keywords: 'aufträge bestellungen status' },
  { id: 'customers', title: 'Kundenverwaltung', label: 'Kunden\u00ADverwaltung', pinned: true, description: 'Kunden, Fahrzeuge, Historie', permission: 'customers.read', size: { w: 1000, h: 660 }, keywords: 'kunden halter kontakte' },
  { id: 'registrations', title: 'Zulassungsmanager', label: 'Zulassungs\u00ADmanager', pinned: true, description: 'Vorgänge nach Art und Stand', permission: 'orders.read', size: { w: 1180, h: 700 }, keywords: 'zulassung neuzulassung umschreibung abmeldung wiederzulassung' },
  { id: 'documents', title: 'Dokumentenmanager', label: 'Dokumenten\u00ADmanager', pinned: true, description: 'Uploads und Bescheide (privat)', permission: 'docs.read', size: { w: 1060, h: 680 }, keywords: 'dokumente dateien explorer r2 ausweis' },
  { id: 'kfz', title: 'KFZ-API Center', label: 'KFZ-API Center', pinned: true, description: 'Webhooks, PING, Protokoll', permission: 'kfz.read', size: { w: 1040, h: 680 }, keywords: 'kfz api webhook ping kba' },
  { id: 'finance', title: 'Finanzcenter', label: 'Finanz\u00ADcenter', pinned: true, description: 'Umsätze, Kosten, Margen, Zahlungen', permission: 'finance.read', size: { w: 1080, h: 700 }, keywords: 'finanzen umsatz zahlung marge kosten' },
  { id: 'tasks', title: 'Aufgabencenter', label: 'Aufgaben\u00ADcenter', pinned: true, description: 'Aufgaben, Wiedervorlagen, Team', permission: null, size: { w: 1080, h: 680 }, keywords: 'aufgaben wiedervorlage team mitarbeiter erinnerung' },
  { id: 'messages', title: 'Kommunikationszentrale', label: 'Kommuni\u00ADkation', pinned: true, description: 'Kunden-E-Mails, Vorlagen, Verlauf', permission: 'orders.read', size: { w: 1100, h: 700 }, keywords: 'kommunikation email nachricht vorlage kunde' },
  { id: 'notifications', title: 'Benachrichtigungscenter', label: 'Benachrich\u00ADtigungs\u00ADcenter', pinned: true, description: 'Neue Aufträge, Fehler, Abschlüsse', permission: 'orders.read', size: { w: 720, h: 620 }, keywords: 'benachrichtigungen meldungen' },
  { id: 'trash', title: 'Papierkorb', label: 'Papierkorb', pinned: false, description: 'Gelöschte interne Notizen', permission: 'orders.read', size: { w: 860, h: 580 }, keywords: 'papierkorb gelöscht wiederherstellen notizen' },
  { id: 'settings', title: 'Systemeinstellungen', label: 'System\u00ADeinstellungen', pinned: true, description: 'Benutzer, Rollen, Sicherheit, Design', permission: null, size: { w: 980, h: 660 }, keywords: 'einstellungen benutzer rollen sicherheit design' },
];

export const appById = (id: AppId) => APPS.find((a) => a.id === id) as AppDef;
