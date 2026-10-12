'use client';

// EasyKFZ24 OS – Desktop, Fensterverwaltung, Taskleiste, Startmenü, Schnellmenü, Suche, Benachrichtigungen,
// Kalender, Programmwechsler, virtuelle Arbeitsflächen, Kontextmenüs, Startbildschirm und Sperrbildschirm.
// Persönliche Einstellungen werden pro Benutzer auf dem Server gespeichert (lokal zusätzlich als schneller Start).

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '../../styles/os.css';
import { logoutAction } from '../../app/admin/actions.ts';
import type { Permission } from '../../lib/permissions.ts';
import { osFetch, relTime } from './api.ts';
import { BootScreen } from './BootScreen.tsx';
import { ACCENTS, APPS, appById, OsContext, useOs, type AppDef, type DesktopPrefs, type OsApi, type OsSession, type Toast } from './context.ts';
import { DesktopIcons, ICON_GRID, layoutIcons, type IconCells, type IconSize } from './DesktopIcons.tsx';
import {
  AppIcon,
  IBell,
  IBellOff,
  IChevron,
  IGrid,
  IImage,
  ILock,
  IMoon,
  IMotion,
  IPower,
  IRefresh,
  ISearch,
  IShield,
  ISliders,
  ISun,
  IWifi,
  IWifiOff,
  OsMark,
  type AppId,
} from './icons.tsx';
import { LockScreen } from './LockScreen.tsx';
import { OsWindow, ZONES, type Rect, type WinState, type Zone } from './Window.tsx';
import { DashboardApp } from './apps/Dashboard.tsx';
import { OrdersApp } from './apps/Orders.tsx';
import { CustomersApp } from './apps/Customers.tsx';
import { RegistrationsApp } from './apps/Registrations.tsx';
import { DocumentsApp } from './apps/Documents.tsx';
import { KfzApp } from './apps/KfzCenter.tsx';
import { FinanceApp } from './apps/Finance.tsx';
import { TasksApp } from './apps/Tasks.tsx';
import { MessagesApp } from './apps/Messages.tsx';
import { NotificationsApp, openTarget, type NotificationList, type OsNotification } from './apps/Notifications.tsx';
import { TrashApp } from './apps/Trash.tsx';
import { SettingsApp } from './apps/Settings.tsx';

const TASKBAR_H = 52;
const COMPACT_BELOW = 760;
const WORKSPACES = 3;
export const WALLPAPERS = ['Aurora', 'Nacht', 'Morgen', 'Graphit'] as const;

const APP_COMPONENTS: Record<AppId, (p: { params?: Record<string, unknown>; nonce: number }) => ReactNode> = {
  dashboard: DashboardApp,
  orders: OrdersApp,
  customers: CustomersApp,
  registrations: RegistrationsApp,
  documents: DocumentsApp,
  kfz: KfzApp,
  finance: FinanceApp,
  tasks: TasksApp,
  messages: MessagesApp,
  notifications: NotificationsApp,
  trash: TrashApp,
  settings: SettingsApp,
};

interface Saved extends DesktopPrefs {
  theme?: 'light' | 'dark';
  wallpaper?: number;
  wins?: WinState[];
  icons?: IconCells;
  dnd?: boolean;
  calm?: boolean;
  ws?: number;
}

const storageKey = (uid: number) => `ekos:${uid}:layout`;
const bootKey = (uid: number) => `ekos:${uid}:booted`;
const read = <T,>(k: string, fallback: T, store: 'local' | 'session' = 'local'): T => {
  try {
    const v = (store === 'local' ? localStorage : sessionStorage).getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (k: string, v: unknown, store: 'local' | 'session' = 'local') => {
  try {
    (store === 'local' ? localStorage : sessionStorage).setItem(k, JSON.stringify(v));
  } catch {
    /* Speicher nicht verfügbar – nur Komfort */
  }
};

type Panel = null | 'start' | 'search' | 'notifications' | 'quick';
type Menu = { x: number; y: number; kind: 'desktop' | 'icon' | 'start'; app?: AppId } | null;

export function OsShell({ initialSession }: { initialSession: OsSession }) {
  const [session, setSession] = useState(initialSession);
  const [wins, setWins] = useState<WinState[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [theme, setThemeState] = useState<'light' | 'dark'>('light');
  const [wallpaper, setWallpaperState] = useState(0);
  const [lockedAt, setLockedAt] = useState<Date | null>(null);
  const [booting, setBooting] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [notes, setNotes] = useState<NotificationList | null>(null);
  const [area, setArea] = useState({ w: 1280, h: 760 });
  const [now, setNow] = useState<Date | null>(null);
  const [selectedIcon, setSelectedIcon] = useState<AppId | null>(null);
  const [iconCells, setIconCells] = useState<IconCells>({});
  const [preview, setPreview] = useState<Zone | 'max' | null>(null);
  const [dnd, setDnd] = useState(false);
  const [calm, setCalm] = useState(false);
  const [online, setOnline] = useState(true);
  const [idleLeft, setIdleLeft] = useState<number | null>(null);
  const [desktop, setDesktopState] = useState<DesktopPrefs>({ accent: 'blau', iconSize: 'mittel', snap: true, openMaximized: false });
  const [ws, setWs] = useState(0);
  const [switcher, setSwitcher] = useState<{ ids: string[]; index: number } | null>(null);
  const zTop = useRef(10);
  const ready = useRef(false);
  const lastActivity = useRef(Date.now());
  const knownNotes = useRef<Set<number> | null>(null);
  const notifyPrefs = useRef(initialSession.prefs?.notify ?? { toast: {}, email: {}, browser: false });
  const locked = lockedAt !== null;

  const compact = area.w < COMPACT_BELOW;
  const can = useCallback((p: Permission) => session.permissions.includes(p), [session]);
  const apps = useMemo(() => APPS.filter((a) => !a.permission || session.permissions.includes(a.permission)), [session]);
  const iconSize = ((desktop.iconSize as IconSize) in ICON_GRID ? desktop.iconSize : 'mittel') as IconSize;
  const grid = ICON_GRID[iconSize];
  const rows = Math.max(1, Math.floor((area.h - 24) / grid.h));
  const cols = Math.max(1, Math.floor((area.w - 24) / grid.w));
  const cells = useMemo(() => layoutIcons(apps, iconCells, rows), [apps, iconCells, rows]);
  const visibleWins = useMemo(() => wins.filter((w) => (w.ws ?? 0) === ws), [wins, ws]);

  /* ---------- Größe, Uhr, Verbindung ---------- */
  useEffect(() => {
    const measure = () => setArea({ w: window.innerWidth, h: window.innerHeight - TASKBAR_H });
    measure();
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('resize', measure);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    setNow(new Date());
    const t = window.setInterval(() => setNow(new Date()), 15_000);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      window.clearInterval(t);
    };
  }, []);

  /* ---------- Gespeicherter Zustand pro Benutzer (Server zuerst, lokal als Rückfall) ---------- */
  useEffect(() => {
    const server = (session.prefs?.desktop ?? {}) as Saved;
    const local = read<Saved>(storageKey(session.user.id), {});
    const saved: Saved = Object.keys(server).length ? server : local;
    setThemeState(saved.theme ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
    setWallpaperState(saved.wallpaper ?? 0);
    setIconCells(saved.icons ?? {});
    setDnd(!!saved.dnd);
    setCalm(!!saved.calm);
    setWs(Math.min(WORKSPACES - 1, Math.max(0, saved.ws ?? 0)));
    setDesktopState({ accent: saved.accent ?? 'blau', iconSize: saved.iconSize ?? 'mittel', snap: saved.snap !== false, openMaximized: !!saved.openMaximized });
    setBooting(!read<boolean>(bootKey(session.user.id), false, 'session'));
    const allowed = new Set(APPS.filter((a) => !a.permission || session.permissions.includes(a.permission)).map((a) => a.id));
    const fixSnap = (sn: unknown): Zone | null =>
      sn === 'left' ? ZONES.left : sn === 'right' ? ZONES.right : sn && typeof sn === 'object' && 'w' in sn ? (sn as Zone) : null;
    const restored = (saved.wins ?? []).filter((w) => allowed.has(w.app)).map((w, i) => ({ ...w, snap: fixSnap(w.snap), z: 10 + i, nonce: 0 }));
    zTop.current = 10 + restored.length;
    if (restored.length) {
      setWins(restored);
      setActiveId(restored[restored.length - 1].id);
    } else if (allowed.has('dashboard')) {
      // Kontrollzentrum startet beim Einloggen automatisch
      openAppRef.current?.('dashboard');
    }
    ready.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.user.id]);

  const serverSave = useRef<number>(0);
  useEffect(() => {
    if (!ready.current) return;
    const state: Saved = {
      ...desktop,
      theme,
      wallpaper,
      icons: iconCells,
      dnd,
      calm,
      ws,
      wins: wins.map(({ params, ...w }) => ({ ...w, params: w.app === 'orders' ? params : undefined })),
    };
    write(storageKey(session.user.id), state);
    window.clearTimeout(serverSave.current);
    serverSave.current = window.setTimeout(() => {
      void osFetch('prefs', { method: 'POST', body: { desktop: state }, background: true }).catch(() => undefined);
    }, 2000);
  }, [wins, theme, wallpaper, iconCells, dnd, calm, ws, desktop, session.user.id]);

  useEffect(() => {
    document.documentElement.dataset.osTheme = theme;
  }, [theme]);

  /* ---------- Fensterverwaltung ---------- */
  const focus = useCallback((id: string) => {
    setActiveId(id);
    setWins((ws0) => ws0.map((w) => (w.id === id ? { ...w, z: ++zTop.current, mode: w.mode === 'min' ? 'normal' : w.mode } : w)));
  }, []);

  const wsRef = useRef(ws);
  wsRef.current = ws;
  const desktopRef = useRef(desktop);
  desktopRef.current = desktop;

  const openApp = useCallback(
    (app: AppId, params?: Record<string, unknown>) => {
      setPanel(null);
      setMenu(null);
      const def = appById(app);
      if (def.permission && !session.permissions.includes(def.permission)) return;
      setWins((list) => {
        const existing = list.find((w) => w.app === app);
        if (existing) {
          setActiveId(existing.id);
          if ((existing.ws ?? 0) !== wsRef.current) setWs(existing.ws ?? 0);
          return list.map((w) =>
            w.id === existing.id
              ? { ...w, z: ++zTop.current, mode: w.mode === 'min' ? 'normal' : w.mode, params: params ?? w.params, nonce: params ? w.nonce + 1 : w.nonce }
              : w,
          );
        }
        const n = list.length;
        const w = Math.min(def.size.w, window.innerWidth - 40);
        const h = Math.min(def.size.h, window.innerHeight - TASKBAR_H - 40);
        const x = Math.max(12, Math.round((window.innerWidth - w) / 2) + ((n % 5) - 2) * 28);
        const y = Math.max(8, Math.round((window.innerHeight - TASKBAR_H - h) / 2) + ((n % 5) - 2) * 24);
        const id = `${app}-${Date.now().toString(36)}`;
        setActiveId(id);
        return [...list, { id, app, x, y, w, h, z: ++zTop.current, mode: desktopRef.current.openMaximized ? 'max' : 'normal', snap: null, params, nonce: 1, ws: wsRef.current }];
      });
    },
    [session.permissions],
  );
  const openAppRef = useRef(openApp);
  openAppRef.current = openApp;

  const setMode = useCallback((id: string, mode: WinState['mode']) => {
    setWins((list) =>
      list.map((w) => (w.id === id ? { ...w, mode, snap: mode === 'normal' && w.mode !== 'min' ? null : w.snap, z: mode === 'min' ? w.z : ++zTop.current } : w)),
    );
    if (mode === 'min') setActiveId((cur) => (cur === id ? null : cur));
    else setActiveId(id);
  }, []);

  const setRect = useCallback((id: string, r: Rect) => {
    setWins((list) => list.map((w) => (w.id === id ? { ...w, ...r, snap: null, mode: 'normal' } : w)));
  }, []);

  const snapTo = useCallback((id: string, zone: Zone) => {
    setActiveId(id);
    setWins((list) => list.map((w) => (w.id === id ? { ...w, snap: zone, mode: 'normal', z: ++zTop.current } : w)));
  }, []);

  const close = useCallback((id: string) => {
    setWins((list) => {
      const rest = list.filter((w) => w.id !== id);
      const top = [...rest].filter((w) => w.mode !== 'min' && (w.ws ?? 0) === wsRef.current).sort((a, b) => b.z - a.z)[0];
      setActiveId(top?.id ?? null);
      return rest;
    });
  }, []);

  const moveToWorkspace = (id: string, target: number) => {
    setWins((list) => list.map((w) => (w.id === id ? { ...w, ws: target } : w)));
    if (target !== ws) setActiveId(null);
  };

  const switchWorkspace = (target: number) => {
    setWs(target);
    const top = wins.filter((w) => (w.ws ?? 0) === target && w.mode !== 'min').sort((a, b) => b.z - a.z)[0];
    setActiveId(top?.id ?? null);
    setPanel(null);
    setMenu(null);
  };

  const taskbarClick = (app: AppId) => {
    const w = wins.find((x) => x.app === app);
    if (!w) return openApp(app);
    if ((w.ws ?? 0) !== ws) {
      setWs(w.ws ?? 0);
      return focus(w.id);
    }
    if (w.mode === 'min') return focus(w.id);
    if (activeId === w.id) return setMode(w.id, 'min');
    focus(w.id);
  };

  const showDesktop = () => {
    const anyVisible = visibleWins.some((w) => w.mode !== 'min');
    setWins((list) => list.map((w) => ((w.ws ?? 0) !== ws ? w : { ...w, mode: anyVisible ? 'min' : w.mode === 'min' ? 'normal' : w.mode })));
    setActiveId(null);
    setMenu(null);
    setPanel(null);
  };

  const cascade = () => {
    let i = 0;
    setWins((list) =>
      list.map((w) => {
        if ((w.ws ?? 0) !== ws) return w;
        const k = i++;
        return {
          ...w,
          mode: 'normal',
          snap: null,
          x: 40 + k * 32,
          y: 24 + k * 28,
          w: Math.min(appById(w.app).size.w, window.innerWidth - 80),
          h: Math.min(appById(w.app).size.h, area.h - 60),
          z: ++zTop.current,
        };
      }),
    );
  };

  /** Sichtbare Fenster nebeneinander (2) bzw. im Raster (3–4) anordnen. */
  const tile = () => {
    const visible = visibleWins.filter((w) => w.mode !== 'min').sort((a, b) => a.z - b.z);
    const layouts: Zone[][] = [
      [],
      [{ x: 0, y: 0, w: 1, h: 1 }],
      [ZONES.left, ZONES.right],
      [ZONES.left, ZONES.topRight, ZONES.bottomRight],
      [ZONES.topLeft, ZONES.topRight, ZONES.bottomLeft, ZONES.bottomRight],
    ];
    const zones = layouts[Math.min(4, visible.length)];
    setWins((list) =>
      list.map((w) => {
        const i = visible.findIndex((v) => v.id === w.id);
        return i >= 0 && i < zones.length ? { ...w, snap: zones[i], mode: 'normal' } : w;
      }),
    );
  };

  /* ---------- Hinweise ---------- */
  const dndRef = useRef(dnd);
  dndRef.current = dnd;
  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    if (dndRef.current) return;
    const id = Math.random().toString(36).slice(2);
    setToasts((ts) => [...ts.slice(-3), { ...t, id }]);
    window.setTimeout(() => setToasts((ts) => ts.filter((x) => x.id !== id)), 6000);
  }, []);

  useEffect(() => {
    const onPrefs = (e: Event) => {
      const d = (e as CustomEvent<{ notify?: typeof notifyPrefs.current }>).detail;
      if (d?.notify) notifyPrefs.current = d.notify;
    };
    window.addEventListener('os:prefs', onPrefs);
    return () => window.removeEventListener('os:prefs', onPrefs);
  }, []);

  /* ---------- Benachrichtigungen (alle 20 s, ohne die Sitzung zu verlängern) ---------- */
  const pollNotes = useCallback(async () => {
    try {
      const list = await osFetch<NotificationList>('notifications?limit=60', { background: true });
      if (knownNotes.current) {
        const fresh = list.items.filter((n) => !n.read && !knownNotes.current!.has(n.id)).slice(0, 3);
        for (const n of [...fresh].reverse()) {
          if (notifyPrefs.current.toast[n.kind] !== false) {
            toast({ title: n.title, text: n.text, tone: n.priority === 'kritisch' ? 'error' : n.priority === 'wichtig' ? 'warn' : n.kind === 'zulassung_ok' ? 'ok' : 'info', orderId: n.order_id });
          }
          if (notifyPrefs.current.browser && (n.priority === 'kritisch' || n.priority === 'wichtig') && document.visibilityState !== 'visible' && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            try {
              new Notification(`EasyKFZ24 OS: ${n.title}`, { body: n.text, tag: `ekos-${n.id}` });
            } catch {
              /* Browser ohne Unterstützung */
            }
          }
        }
        if (fresh.length) window.dispatchEvent(new CustomEvent('os:refresh'));
      }
      knownNotes.current = new Set(list.items.map((n) => n.id));
      setNotes(list);
    } catch {
      /* nächster Versuch */
    }
  }, [toast]);

  useEffect(() => {
    if (locked) return;
    let stop = false;
    void pollNotes();
    const t = window.setInterval(() => !stop && document.visibilityState === 'visible' && void pollNotes(), 20_000);
    const onRead = () => void pollNotes();
    window.addEventListener('os:notifications-read', onRead);
    return () => {
      stop = true;
      window.clearInterval(t);
      window.removeEventListener('os:notifications-read', onRead);
    };
  }, [locked, pollNotes]);
  const unread = notes?.unread ?? 0;

  /* ---------- Sperre: Inaktivität und abgelaufene Sitzung ---------- */
  const lock = useCallback(() => {
    setPanel(null);
    setMenu(null);
    setLockedAt((d) => d ?? new Date());
    void osFetch('lock', { method: 'POST', body: {} }).catch(() => undefined);
  }, []);

  useEffect(() => {
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    const onLocked = () => setLockedAt((d) => d ?? new Date());
    window.addEventListener('pointerdown', onActivity);
    window.addEventListener('keydown', onActivity);
    window.addEventListener('pointermove', onActivity, { passive: true });
    window.addEventListener('os:locked', onLocked);
    const t = window.setInterval(() => {
      const left = session.lockMinutes * 60_000 - (Date.now() - lastActivity.current);
      setIdleLeft(Math.max(0, Math.ceil(left / 60_000)));
      if (!locked && left <= 0) lock();
    }, 5_000);
    return () => {
      window.removeEventListener('pointerdown', onActivity);
      window.removeEventListener('keydown', onActivity);
      window.removeEventListener('pointermove', onActivity);
      window.removeEventListener('os:locked', onLocked);
      window.clearInterval(t);
    };
  }, [locked, lock, session.lockMinutes]);

  /* ---------- Tastenkombinationen ---------- */
  const switcherRef = useRef(switcher);
  switcherRef.current = switcher;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked || booting) return;
      const mod = e.metaKey || e.ctrlKey;
      // Mit Alt/⌥ zählt die physische Taste: auf dem Mac ergibt ⌥Q sonst „œ“, ⌥S „ß“, ⌥1 „¡“ …
      const k =
        e.altKey && /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : e.altKey && /^Digit\d$/.test(e.code) ? e.code.slice(5) : e.key.toLowerCase();
      const typing = !!(e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]');
      if (switcherRef.current && (e.key === 'Enter' || e.key === 'Escape')) {
        e.preventDefault();
        const s = switcherRef.current;
        switcherRef.current = null;
        setSwitcher(null);
        if (e.key === 'Enter' && s.ids[s.index]) focus(s.ids[s.index]);
        return;
      }
      if (e.altKey && (k === 'q' || e.code === 'Backquote')) {
        // Programmwechsler (wie Alt+Tab): Alt halten, Q wiederholt drücken, Alt loslassen
        e.preventDefault();
        const order = [...visibleWins].sort((a, b) => b.z - a.z).map((w) => w.id);
        if (!order.length) return;
        const cur = switcherRef.current;
        const next = cur ? { ...cur, index: (cur.index + (e.shiftKey ? cur.ids.length - 1 : 1)) % cur.ids.length } : { ids: order, index: order.length > 1 ? 1 : 0 };
        // Sofort im Ref ablegen: das Loslassen von Alt kann vor dem nächsten Rendern eintreffen
        switcherRef.current = next;
        setSwitcher(next);
        return;
      }
      if (mod && k === 'k') {
        e.preventDefault();
        setPanel((p) => (p === 'search' ? null : 'search'));
      } else if (mod && e.shiftKey && k === 'l') {
        e.preventDefault();
        lock();
      } else if (e.altKey && k === 's') {
        e.preventDefault();
        setPanel((p) => (p === 'start' ? null : 'start'));
      } else if (e.altKey && k === 'x') {
        e.preventDefault();
        setPanel(null);
        setMenu({ x: 8, y: 0, kind: 'start' });
      } else if (e.altKey && k === 'a') {
        e.preventDefault();
        setPanel((p) => (p === 'quick' ? null : 'quick'));
      } else if (e.altKey && k === 'd') {
        e.preventDefault();
        showDesktop();
      } else if (e.altKey && /^[1-3]$/.test(k)) {
        e.preventDefault();
        switchWorkspace(Number(k) - 1);
      } else if (e.key === 'Escape') {
        setPanel(null);
        setMenu(null);
        setSwitcher(null);
      } else if (e.altKey && activeId && !typing && ['w', 'm', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
        e.preventDefault();
        if (k === 'w') close(activeId);
        else if (k === 'm') setMode(activeId, 'min');
        else if (k === 'arrowleft') snapTo(activeId, ZONES.left);
        else if (k === 'arrowright') snapTo(activeId, ZONES.right);
        else if (k === 'arrowup') setMode(activeId, 'max');
        else {
          const w = wins.find((x) => x.id === activeId);
          setMode(activeId, w && (w.mode === 'max' || w.snap) ? 'normal' : 'min');
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (switcherRef.current && (e.key === 'Alt' || !e.altKey)) {
        const s = switcherRef.current;
        switcherRef.current = null;
        setSwitcher(null);
        const id = s.ids[s.index];
        if (id) focus(id);
      }
    };
    const onBlur = () => {
      switcherRef.current = null;
      setSwitcher(null);
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locked, booting, activeId, wins, visibleWins, close, setMode, snapTo, focus, lock]);

  const setTheme = (t: 'light' | 'dark') => setThemeState(t);
  const setDesktop = (patch: Partial<DesktopPrefs>) => setDesktopState((d) => ({ ...d, ...patch }));
  const api: OsApi = { session, can, openApp, toast, theme, setTheme, wallpaper, setWallpaper: setWallpaperState, lock, desktop, setDesktop };

  const time = now ? now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : '';
  const date = now ? now.toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : '';
  const taskApps = apps.filter((a) => a.pinned || wins.some((x) => x.app === a.id));
  const accent = ACCENTS[(desktop.accent as string) ?? 'blau'] ?? ACCENTS.blau;

  const menuItems = (): ReactNode => {
    if (!menu) return null;
    if (menu.kind === 'icon' && menu.app) {
      return (
        <>
          <button type="button" role="menuitem" onClick={() => openApp(menu.app as AppId)}>
            <AppIcon app={menu.app} size={18} /> <strong>Öffnen</strong>
          </button>
          <hr />
          <button type="button" role="menuitem" onClick={() => (setIconCells({}), setMenu(null))}>
            <IGrid width={16} height={16} /> Symbole automatisch anordnen
          </button>
        </>
      );
    }
    if (menu.kind === 'start') {
      return (
        <>
          {apps.map((a) => (
            <button key={a.id} type="button" role="menuitem" onClick={() => openApp(a.id)}>
              <AppIcon app={a.id} size={18} /> {a.title}
            </button>
          ))}
          <hr />
          <button type="button" role="menuitem" onClick={() => (setMenu(null), setPanel('search'))}>
            <ISearch width={16} height={16} /> Suchen
          </button>
          <button type="button" role="menuitem" onClick={showDesktop}>
            <IGrid width={16} height={16} /> Desktop anzeigen
          </button>
          <button type="button" role="menuitem" onClick={lock}>
            <ILock width={16} height={16} /> Sperren
          </button>
          <form action={logoutAction}>
            <button type="submit" role="menuitem">
              <IPower width={16} height={16} /> Abmelden
            </button>
          </form>
        </>
      );
    }
    return (
      <>
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            setMenu(null);
            window.dispatchEvent(new CustomEvent('os:refresh'));
          }}
        >
          <IRefresh width={16} height={16} /> Aktualisieren
        </button>
        <button type="button" role="menuitem" onClick={() => (setIconCells({}), setMenu(null))}>
          <IGrid width={16} height={16} /> Symbole automatisch anordnen
        </button>
        <hr />
        <button type="button" role="menuitem" onClick={() => (tile(), setMenu(null))} disabled={!visibleWins.some((w) => w.mode !== 'min')}>
          Fenster nebeneinander anordnen
        </button>
        <button type="button" role="menuitem" onClick={() => (cascade(), setMenu(null))} disabled={!visibleWins.length}>
          Fenster überlappend anordnen
        </button>
        <button type="button" role="menuitem" onClick={showDesktop} disabled={!visibleWins.length}>
          Desktop anzeigen
        </button>
        <hr />
        <button type="button" role="menuitem" onClick={() => (setTheme(theme === 'dark' ? 'light' : 'dark'), setMenu(null))}>
          {theme === 'dark' ? <ISun width={16} height={16} /> : <IMoon width={16} height={16} />} {theme === 'dark' ? 'Heller Modus' : 'Dunkler Modus'}
        </button>
        <button type="button" role="menuitem" onClick={() => (setWallpaperState((wallpaper + 1) % WALLPAPERS.length), setMenu(null))}>
          <IImage width={16} height={16} /> Nächster Hintergrund
        </button>
        <button type="button" role="menuitem" onClick={() => openApp('settings', { tab: 'design' })}>
          <ISliders width={16} height={16} /> Anpassen …
        </button>
      </>
    );
  };

  return (
    <OsContext.Provider value={api}>
      <div
        className={`os os--wp${wallpaper}${calm ? ' is-calm' : ''}`}
        data-os-theme={theme}
        style={{ ['--os-accent' as string]: accent.color, ['--os-accent-2' as string]: accent.strong, ['--os-accent-soft' as string]: `${accent.color}22` }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {/* Desktop */}
        <div
          className="os-desktop"
          style={{ height: area.h }}
          onPointerDown={(e) => {
            const t = e.target as HTMLElement;
            if (t === e.currentTarget || t.classList.contains('os-icons')) {
              setPanel(null);
              setMenu(null);
              setSelectedIcon(null);
            }
          }}
          onContextMenu={(e) => {
            if ((e.target as HTMLElement).closest('.os-win, .os-toasts')) return;
            e.preventDefault();
            const icon = (e.target as HTMLElement).closest<HTMLElement>('[data-app]')?.dataset.app as AppId | undefined;
            if (icon) setSelectedIcon(icon);
            setPanel(null);
            setMenu({ x: e.clientX, y: e.clientY, kind: icon ? 'icon' : 'desktop', app: icon });
          }}
        >
          <DesktopIcons
            apps={apps}
            cells={cells}
            rows={rows}
            cols={cols}
            compact={compact}
            size={iconSize}
            selected={selectedIcon}
            onSelect={setSelectedIcon}
            onOpen={openApp}
            onMove={(app, to) => {
              const next: IconCells = { ...cells };
              const other = (Object.keys(next) as AppId[]).find((k) => k !== app && next[k]?.c === to.c && next[k]?.r === to.r);
              if (other) next[other] = cells[app];
              next[app] = to;
              setIconCells(next);
            }}
          />

          {wins.map((w) => {
            const App = APP_COMPONENTS[w.app];
            const hidden = (w.ws ?? 0) !== ws;
            return (
              <div key={w.id} hidden={hidden} className="os-winhost">
                <OsWindow
                  win={hidden ? { ...w, mode: 'min' } : w}
                  title={appById(w.app).title}
                  active={activeId === w.id}
                  compact={compact}
                  area={area}
                  snapEnabled={desktop.snap !== false}
                  onFocus={() => activeId !== w.id && focus(w.id)}
                  onRect={(r) => setRect(w.id, r)}
                  onMode={(m) => setMode(w.id, m)}
                  onSnap={(z) => snapTo(w.id, z)}
                  onPreview={setPreview}
                  onClose={() => close(w.id)}
                >
                  <App params={w.params} nonce={w.nonce} />
                </OsWindow>
              </div>
            );
          })}

          {preview ? (
            <div
              className="os-snap-preview"
              aria-hidden="true"
              style={
                preview === 'max'
                  ? { left: 6, top: 6, width: area.w - 12, height: area.h - 12 }
                  : { left: preview.x * area.w + 6, top: preview.y * area.h + 6, width: preview.w * area.w - 12, height: preview.h * area.h - 12 }
              }
            />
          ) : null}

          {menu ? (
            <div
              className="os-menu os-acrylic"
              style={menu.kind === 'start' ? { left: 8, bottom: 8 } : { left: Math.min(menu.x, area.w - 250), top: Math.min(menu.y, area.h - 330) }}
              role="menu"
            >
              {menuItems()}
            </div>
          ) : null}

          {switcher ? (
            <div className="os-switcher os-acrylic" role="listbox" aria-label="Programmwechsler">
              {switcher.ids.map((id, i) => {
                const w = wins.find((x) => x.id === id);
                if (!w) return null;
                return (
                  <button key={id} type="button" role="option" aria-selected={i === switcher.index} className={i === switcher.index ? 'is-sel' : ''} onClick={() => (setSwitcher(null), focus(id))}>
                    <AppIcon app={w.app} size={40} />
                    <span>{appById(w.app).title}</span>
                  </button>
                );
              })}
            </div>
          ) : null}

          {/* Hinweise (In-App-Benachrichtigungen) */}
          <div className="os-toasts" aria-live="polite">
            {toasts.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`os-toast os-acrylic os-toast--${t.tone ?? 'info'}`}
                onClick={() => {
                  setToasts((ts) => ts.filter((x) => x.id !== t.id));
                  if (t.orderId) openApp('orders', { orderId: t.orderId });
                }}
              >
                <OsMark size={18} />
                <span>
                  <strong>{t.title}</strong>
                  {t.text ? <span>{t.text}</span> : null}
                </span>
              </button>
            ))}
          </div>
        </div>

        {panel === 'start' ? <StartMenu apps={apps} onOpen={openApp} onLock={lock} onSearch={() => setPanel('search')} /> : null}
        {panel === 'search' ? <SearchPanel apps={apps} onClose={() => setPanel(null)} /> : null}
        {panel === 'notifications' ? (
          <NotificationPanel
            list={notes}
            date={now}
            dnd={dnd}
            onReadAll={async () => {
              await osFetch('notifications/read-all', { method: 'POST', body: {} }).catch(() => undefined);
              void pollNotes();
            }}
            onOpen={(n) => {
              setPanel(null);
              void osFetch('notifications/read', { method: 'POST', body: { ids: [n.id] } }).then(() => pollNotes(), () => undefined);
              openTarget(n, openApp as never);
            }}
            onAll={() => openApp('notifications')}
          />
        ) : null}
        {panel === 'quick' ? (
          <QuickPanel
            theme={theme}
            dnd={dnd}
            calm={calm}
            online={online}
            idleLeft={idleLeft}
            wallpaper={wallpaper}
            onTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            onDnd={() => setDnd((v) => !v)}
            onCalm={() => setCalm((v) => !v)}
            onWallpaper={() => setWallpaperState((wallpaper + 1) % WALLPAPERS.length)}
            onLock={lock}
            onSettings={() => openApp('settings')}
          />
        ) : null}

        {/* Taskleiste */}
        <footer className="os-taskbar os-acrylic" style={{ height: TASKBAR_H }}>
          <div className="os-taskbar__left">
            <OsMark size={20} />
            <span className="os-taskbar__brand">EasyKFZ24 OS</span>
            <span className="os-ws" role="group" aria-label="Arbeitsflächen">
              {Array.from({ length: WORKSPACES }, (_, i) => {
                const count = wins.filter((w) => (w.ws ?? 0) === i).length;
                return (
                  <button
                    key={i}
                    type="button"
                    className={ws === i ? 'is-sel' : ''}
                    onClick={() => switchWorkspace(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const id = e.dataTransfer.getData('text/os-win');
                      if (id) moveToWorkspace(id, i);
                    }}
                    title={`Arbeitsfläche ${i + 1} (Alt+${i + 1})${count ? ` · ${count} Fenster` : ''}`}
                    aria-pressed={ws === i}
                  >
                    {i + 1}
                    {count ? <i aria-hidden="true" /> : null}
                  </button>
                );
              })}
            </span>
          </div>
          <nav className="os-taskbar__apps" aria-label="Taskleiste">
            <button
              type="button"
              className={`os-tb${panel === 'start' ? ' is-pressed' : ''}`}
              onClick={() => (setMenu(null), setPanel((p) => (p === 'start' ? null : 'start')))}
              onContextMenu={(e) => (e.preventDefault(), e.stopPropagation(), setPanel(null), setMenu({ x: 8, y: 0, kind: 'start' }))}
              aria-label="Start (Alt+S, Rechtsklick: Schnellzugriff)"
              title="Start (Alt+S) · Rechtsklick: Schnellzugriff (Alt+X)"
            >
              <span className="os-tb__start">
                <IGrid width={22} height={22} />
              </span>
            </button>
            <button type="button" className={`os-tb${panel === 'search' ? ' is-pressed' : ''}`} onClick={() => setPanel((p) => (p === 'search' ? null : 'search'))} aria-label="Suche (Strg+K)" title="Suche (Strg/⌘+K)">
              <ISearch width={20} height={20} />
            </button>
            {taskApps.map((a) => {
              const w = wins.find((x) => x.app === a.id);
              const here = w && (w.ws ?? 0) === ws;
              const state = w ? (activeId === w.id && w.mode !== 'min' && here ? 'is-active' : here ? 'is-open' : 'is-elsewhere') : '';
              return (
                <button
                  key={a.id}
                  type="button"
                  className={`os-tb ${state}`}
                  onClick={() => taskbarClick(a.id)}
                  title={`${a.title}${w && !here ? ` (Arbeitsfläche ${(w.ws ?? 0) + 1})` : ''}`}
                  aria-label={a.title}
                  aria-pressed={!!state}
                  draggable={!!w}
                  onDragStart={(e) => w && e.dataTransfer.setData('text/os-win', w.id)}
                >
                  <AppIcon app={a.id} size={26} />
                  {a.id === 'notifications' && unread ? <span className="os-tb__count">{unread > 99 ? '99+' : unread}</span> : null}
                </button>
              );
            })}
          </nav>
          <div className="os-taskbar__tray">
            <button
              type="button"
              className={`os-tray os-tray--quick${panel === 'quick' ? ' is-pressed' : ''}`}
              onClick={() => (setMenu(null), setPanel((p) => (p === 'quick' ? null : 'quick')))}
              aria-label="Schnellmenü (Alt+A)"
              title="Schnellmenü (Alt+A)"
            >
              {online ? <IWifi width={17} height={17} /> : <IWifiOff width={17} height={17} />}
              {theme === 'dark' ? <IMoon width={16} height={16} /> : <ISun width={16} height={16} />}
              {dnd ? <IBellOff width={16} height={16} /> : null}
            </button>
            <button
              type="button"
              className={`os-tray os-tray--clock${panel === 'notifications' ? ' is-pressed' : ''}`}
              onClick={() => (setMenu(null), setPanel((p) => (p === 'notifications' ? null : 'notifications')))}
              aria-label={`Benachrichtigungen und Kalender, ${unread} neu`}
            >
              <span className="os-clock">
                <strong>{time}</strong>
                <span>{date}</span>
              </span>
              {unread ? <span className="os-tray__dot" aria-hidden="true" /> : null}
            </button>
            <button type="button" className="os-showdesk" onClick={showDesktop} aria-label="Desktop anzeigen (Alt+D)" title="Desktop anzeigen (Alt+D)" />
          </div>
        </footer>

        {locked && lockedAt ? (
          <LockScreen
            session={session}
            lockedAt={lockedAt}
            unread={unread}
            onUnlock={(s) => {
              lastActivity.current = Date.now();
              knownNotes.current = null;
              setSession((cur) => ({ ...s, prefs: s.prefs ?? cur.prefs }));
              setLockedAt(null);
              window.dispatchEvent(new CustomEvent('os:refresh'));
            }}
          />
        ) : null}

        {booting && !locked ? (
          <BootScreen
            session={session}
            onDone={() => {
              write(bootKey(session.user.id), true, 'session');
              setBooting(false);
            }}
          />
        ) : null}
      </div>
    </OsContext.Provider>
  );
}

/* ---------- Startmenü ---------- */

function StartMenu({ apps, onOpen, onLock, onSearch }: { apps: AppDef[]; onOpen: (a: AppId, p?: Record<string, unknown>) => void; onLock: () => void; onSearch: () => void }) {
  const { session, can } = useOs();
  return (
    <div className="os-start os-acrylic" role="dialog" aria-label="Startmenü">
      <button type="button" className="os-start__search" onClick={onSearch}>
        <ISearch width={18} height={18} /> Programme, Aufträge, Kunden und Dateien suchen <kbd>Strg K</kbd>
      </button>
      <p className="os-start__label">Programme</p>
      <ul className="os-start__grid" role="list">
        {apps.map((a) => (
          <li key={a.id}>
            <button type="button" onClick={() => onOpen(a.id)} title={a.description}>
              <AppIcon app={a.id} size={40} />
              <span lang="de">{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
      {can('orders.write') || can('customers.write') ? (
        <>
          <p className="os-start__label">Schnellaktionen</p>
          <div className="os-row">
            {can('orders.write') ? (
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => onOpen('orders', { create: true })}>
                + Neuer Auftrag
              </button>
            ) : null}
            <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => onOpen('tasks')}>
              Meine Aufgaben
            </button>
            {can('orders.read') ? (
              <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => onOpen('orders', { status: 'laufend', overdue: true })}>
                Überfällige Aufträge
              </button>
            ) : null}
          </div>
        </>
      ) : null}
      <p className="os-start__label">Tastenkombinationen</p>
      <ul className="os-start__keys" role="list">
        <li>
          <kbd>Strg/⌘ K</kbd> Suche
        </li>
        <li>
          <kbd>Alt Q</kbd> Programmwechsler
        </li>
        <li>
          <kbd>Alt 1–3</kbd> Arbeitsfläche
        </li>
        <li>
          <kbd>Alt X</kbd> Schnellzugriff
        </li>
        <li>
          <kbd>Alt A</kbd> Schnellmenü
        </li>
        <li>
          <kbd>Alt ← →</kbd> Einrasten
        </li>
        <li>
          <kbd>Alt ↑</kbd> Maximieren
        </li>
        <li>
          <kbd>Alt W</kbd> Schließen
        </li>
        <li>
          <kbd>Alt D</kbd> Desktop
        </li>
        <li>
          <kbd>Strg/⌘ ⇧ L</kbd> Sperren
        </li>
      </ul>
      <footer className="os-start__foot">
        <span className="os-start__user">
          <span className="os-avatar" aria-hidden="true">
            {session.user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{session.user.displayName}</strong>
            <span>{session.user.roleLabel}</span>
          </span>
        </span>
        <span className="os-start__power">
          <button type="button" onClick={onLock} title="Sperren">
            <ILock width={18} height={18} />
          </button>
          <form action={logoutAction}>
            <button type="submit" title="Abmelden">
              <IPower width={18} height={18} />
            </button>
          </form>
        </span>
      </footer>
    </div>
  );
}

/* ---------- Schnellmenü ---------- */

function QuickPanel(p: {
  theme: 'light' | 'dark';
  dnd: boolean;
  calm: boolean;
  online: boolean;
  idleLeft: number | null;
  wallpaper: number;
  onTheme: () => void;
  onDnd: () => void;
  onCalm: () => void;
  onWallpaper: () => void;
  onLock: () => void;
  onSettings: () => void;
}) {
  const { session } = useOs();
  const tiles = [
    { on: p.theme === 'dark', label: 'Dunkler Modus', icon: <IMoon width={18} height={18} />, run: p.onTheme },
    { on: p.dnd, label: 'Nicht stören', icon: p.dnd ? <IBellOff width={18} height={18} /> : <IBell width={18} height={18} />, run: p.onDnd },
    { on: p.calm, label: 'Weniger Bewegung', icon: <IMotion width={18} height={18} />, run: p.onCalm },
    { on: false, label: `Hintergrund: ${WALLPAPERS[p.wallpaper]}`, icon: <IImage width={18} height={18} />, run: p.onWallpaper },
  ];
  return (
    <div className="os-quick os-acrylic" role="dialog" aria-label="Schnellmenü">
      <div className="os-quick__tiles">
        {tiles.map((t) => (
          <button key={t.label} type="button" className={`os-quick__tile${t.on ? ' is-on' : ''}`} onClick={t.run} aria-pressed={t.on}>
            <span className="os-quick__icon">{t.icon}</span>
            <span>{t.label}</span>
          </button>
        ))}
      </div>
      <ul className="os-quick__info" role="list">
        <li>
          {p.online ? <IWifi width={16} height={16} /> : <IWifiOff width={16} height={16} />}
          <span>{p.online ? 'Verbunden mit EasyKFZ24' : 'Keine Verbindung – Änderungen werden nicht gespeichert'}</span>
        </li>
        <li>
          <IShield width={16} height={16} />
          <span>Automatische Sperre {p.idleLeft === null ? `nach ${session.lockMinutes} Min.` : `in ${p.idleLeft} Min.`} ohne Aktivität</span>
        </li>
        <li>
          <IBell width={16} height={16} />
          <span>{p.dnd ? 'Hinweise stummgeschaltet – das Benachrichtigungscenter sammelt weiter' : 'Hinweise werden eingeblendet'}</span>
        </li>
      </ul>
      <footer className="os-quick__foot">
        <span className="os-start__user">
          <span className="os-avatar" aria-hidden="true">
            {session.user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <span>
            <strong>{session.user.displayName}</strong>
            <span>{session.user.roleLabel}</span>
          </span>
        </span>
        <span className="os-start__power">
          <button type="button" onClick={p.onSettings} title="Systemeinstellungen">
            <ISliders width={18} height={18} />
          </button>
          <button type="button" onClick={p.onLock} title="Sperren">
            <ILock width={18} height={18} />
          </button>
          <form action={logoutAction}>
            <button type="submit" title="Abmelden">
              <IPower width={18} height={18} />
            </button>
          </form>
        </span>
      </footer>
    </div>
  );
}

/* ---------- Suche ---------- */

interface SearchResult {
  orders: { id: number; number: string; holder_name: string; status: string; assigned_plate: string }[];
  customers: { id: number; number: string; name: string; email: string; orders: number }[];
  documents: { id: string; label: string; order_id: number; number: string }[];
}

function SearchPanel({ apps, onClose }: { apps: AppDef[]; onClose: () => void }) {
  const { openApp, can } = useOs();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<SearchResult | null>(null);
  const [sel, setSel] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    if (q.trim().length < 2 || !can('orders.read')) {
      setRes(null);
      return;
    }
    const t = window.setTimeout(() => {
      osFetch<SearchResult>(`search?q=${encodeURIComponent(q)}`).then(setRes, () => setRes(null));
    }, 180);
    return () => window.clearTimeout(t);
  }, [q, can]);

  const needle = q.trim().toLowerCase();
  const progs = apps.filter((a) => !needle || a.title.toLowerCase().includes(needle) || a.keywords.includes(needle));
  const items: { key: string; label: ReactNode; hint: string; run: () => void }[] = [
    ...progs.map((a) => ({ key: `a-${a.id}`, label: (<><AppIcon app={a.id} size={20} /> {a.title}</>) as ReactNode, hint: 'Programm', run: () => openApp(a.id) })),
    ...(res?.orders ?? []).map((o) => ({
      key: `o-${o.id}`,
      label: (<><AppIcon app="orders" size={20} /> {o.number} · {o.holder_name}{o.assigned_plate ? ` · ${o.assigned_plate}` : ''}</>) as ReactNode,
      hint: 'Auftrag',
      run: () => openApp('orders', { orderId: o.id }),
    })),
    ...(res?.customers ?? []).map((c) => ({
      key: `c-${c.id}`,
      label: (<><AppIcon app="customers" size={20} /> {c.name} · {c.number}{c.email ? ` · ${c.email}` : ''}</>) as ReactNode,
      hint: `Kunde · ${c.orders} Auftrag/Aufträge`,
      run: () => openApp('customers', { customerId: c.id }),
    })),
    ...(res?.documents ?? []).map((d) => ({
      key: `d-${d.id}`,
      label: (<><AppIcon app="documents" size={20} /> {d.label} · {d.number}</>) as ReactNode,
      hint: 'Datei',
      run: () => openApp('documents', { orderId: d.order_id }),
    })),
  ];

  return (
    <div className="os-search os-acrylic" role="dialog" aria-label="Suche">
      <div className="os-search__field">
        <ISearch width={20} height={20} />
        <input
          ref={input}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setSel((s) => Math.min(items.length - 1, s + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
            else if (e.key === 'Enter' && items[sel]) items[sel].run();
            else if (e.key === 'Escape') onClose();
          }}
          placeholder="Auftragsnummer, Name, Kundennr., E-Mail, FIN, Kennzeichen, Datei oder Programm"
          aria-label="Suche"
          spellCheck={false}
        />
      </div>
      <ul className="os-search__list" role="listbox">
        {items.length ? (
          items.map((it, i) => (
            <li key={it.key} role="option" aria-selected={i === sel}>
              <button type="button" className={i === sel ? 'is-sel' : ''} onMouseEnter={() => setSel(i)} onClick={it.run}>
                <span className="os-search__label">{it.label}</span>
                <span className="os-search__hint">{it.hint}</span>
                <IChevron width={16} height={16} />
              </button>
            </li>
          ))
        ) : (
          <li className="os-search__empty">{needle.length >= 2 ? 'Keine Treffer' : 'Mindestens zwei Zeichen eingeben'}</li>
        )}
      </ul>
    </div>
  );
}

/* ---------- Benachrichtigungen & Kalender (Taskleiste) ---------- */

function NotificationPanel({
  list,
  date,
  dnd,
  onReadAll,
  onOpen,
  onAll,
}: {
  list: NotificationList | null;
  date: Date | null;
  dnd: boolean;
  onReadAll: () => void;
  onOpen: (n: OsNotification) => void;
  onAll: () => void;
}) {
  const items = list?.items ?? [];
  return (
    <div className="os-notes os-acrylic" role="dialog" aria-label="Benachrichtigungen und Kalender">
      <header>
        <strong>Benachrichtigungen{dnd ? ' · Nicht stören' : ''}</strong>
        <button type="button" className="os-linkbtn" onClick={onReadAll} disabled={!list?.unread}>
          Alle gelesen
        </button>
      </header>
      <ul role="list">
        {items.slice(0, 10).map((n) => (
          <li key={n.id}>
            <button type="button" className={n.read ? '' : 'is-new'} onClick={() => onOpen(n)}>
              <span className={`os-notes__dot os-notes__dot--${n.priority}`} aria-hidden="true" />
              <span>
                <strong>{n.title}</strong>
                <span>{n.text}</span>
              </span>
              <time>{relTime(n.at)}</time>
            </button>
          </li>
        ))}
        {!items.length ? <li className="os-notes__empty">Keine Benachrichtigungen</li> : null}
      </ul>
      <button type="button" className="os-notes__all" onClick={onAll}>
        Benachrichtigungscenter öffnen
      </button>
      {date ? <MiniCalendar today={date} /> : null}
    </div>
  );
}

/** Kalender mit eigenen Fristen (Aufgaben) – echte Daten aus dem Aufgabencenter. */
function MiniCalendar({ today }: { today: Date }) {
  const { openApp } = useOs();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [due, setDue] = useState<{ id: number; title: string; due_at: string }[]>([]);
  const [day, setDay] = useState<string | null>(null);
  useEffect(() => {
    osFetch<{ items: { id: number; title: string; due_at: string }[] }>('tasks?scope=mine&status=aktiv', { background: true }).then(
      (r) => setDue(r.items.filter((t) => t.due_at)),
      () => setDue([]),
    );
  }, []);
  const first = (month.getDay() + 6) % 7;
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const key = (d: number) => `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const localDay = (iso: string) => {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const byDay = new Map<string, typeof due>();
  for (const t of due) byDay.set(localDay(t.due_at), [...(byDay.get(localDay(t.due_at)) ?? []), t]);
  const todayKey = localDay(today.toISOString());
  return (
    <div className="os-cal">
      <div className="os-cal__head">
        <button type="button" className="os-iconbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} aria-label="Voriger Monat">
          ‹
        </button>
        <strong>{month.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" className="os-iconbtn" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} aria-label="Nächster Monat">
          ›
        </button>
      </div>
      <div className="os-cal__grid" role="grid">
        {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
          <span key={d} className="os-cal__dow">
            {d}
          </span>
        ))}
        {Array.from({ length: first }, (_, i) => (
          <span key={`e${i}`} />
        ))}
        {Array.from({ length: days }, (_, i) => {
          const k = key(i + 1);
          const has = byDay.get(k);
          return (
            <button key={k} type="button" className={`${k === todayKey ? 'is-today' : ''}${day === k ? ' is-sel' : ''}${has ? ' has-due' : ''}`} onClick={() => setDay(day === k ? null : k)} aria-label={`${i + 1}.${has ? `, ${has.length} Frist(en)` : ''}`}>
              {i + 1}
            </button>
          );
        })}
      </div>
      {day && byDay.get(day)?.length ? (
        <ul className="os-plain os-small os-cal__list">
          {byDay.get(day)!.map((t) => (
            <li key={t.id}>
              <button type="button" className="os-linkbtn" onClick={() => openApp('tasks', { taskId: t.id })}>
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="os-muted os-small os-cal__list">{byDay.size ? 'Punkte = Fristen Ihrer Aufgaben' : 'Keine Fristen in Ihren Aufgaben.'}</p>
      )}
    </div>
  );
}
