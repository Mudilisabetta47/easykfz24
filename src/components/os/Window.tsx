'use client';

// Fenster von EasyKFZ24 OS: verschieben (Titelleiste), Größe ändern (8 Griffe), minimieren, maximieren, schließen.
// Einrasten: an den Rand ziehen (oben = maximiert, links/rechts = Hälfte, Ecken = Viertel) mit Vorschau;
// Snap-Layouts: Mauszeiger auf „Maximieren“ halten → Layout und Zone wählen (Hälften, Drittel, Viertel).

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppIcon, IClose, IMax, IMin, IRestore, type AppId } from './icons.tsx';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Einrastzone als Anteil der Arbeitsfläche (0–1). */
export type Zone = Rect;

export interface WinState extends Rect {
  id: string;
  app: AppId;
  z: number;
  mode: 'normal' | 'min' | 'max';
  snap?: Zone | null;
  params?: Record<string, unknown>;
  nonce: number;
  /** Virtuelle Arbeitsfläche (0–2) */
  ws?: number;
}

export const ZONES = {
  left: { x: 0, y: 0, w: 0.5, h: 1 },
  right: { x: 0.5, y: 0, w: 0.5, h: 1 },
  topLeft: { x: 0, y: 0, w: 0.5, h: 0.5 },
  topRight: { x: 0.5, y: 0, w: 0.5, h: 0.5 },
  bottomLeft: { x: 0, y: 0.5, w: 0.5, h: 0.5 },
  bottomRight: { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
} satisfies Record<string, Zone>;

/** Snap-Layouts wie im Flyout gezeigt – jede Zeile ein Layout, jede Kachel eine Zone. */
const LAYOUTS: { label: string; zones: Zone[] }[] = [
  { label: 'Zwei Hälften', zones: [ZONES.left, ZONES.right] },
  { label: 'Zwei Drittel und ein Drittel', zones: [{ x: 0, y: 0, w: 2 / 3, h: 1 }, { x: 2 / 3, y: 0, w: 1 / 3, h: 1 }] },
  {
    label: 'Drei Drittel',
    zones: [
      { x: 0, y: 0, w: 1 / 3, h: 1 },
      { x: 1 / 3, y: 0, w: 1 / 3, h: 1 },
      { x: 2 / 3, y: 0, w: 1 / 3, h: 1 },
    ],
  },
  { label: 'Hälfte und zwei Viertel', zones: [ZONES.left, ZONES.topRight, ZONES.bottomRight] },
  { label: 'Vier Viertel', zones: [ZONES.topLeft, ZONES.topRight, ZONES.bottomLeft, ZONES.bottomRight] },
];

const MIN_W = 380;
const MIN_H = 280;
const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type SnapHint = Zone | 'max' | null;

export function zoneRect(z: Zone, area: { w: number; h: number }): Rect {
  return { x: Math.round(z.x * area.w), y: Math.round(z.y * area.h), w: Math.round(z.w * area.w), h: Math.round(z.h * area.h) };
}

export function OsWindow({
  win,
  title,
  active,
  compact,
  area,
  onFocus,
  onRect,
  onMode,
  onSnap,
  onPreview,
  onClose,
  children,
  snapEnabled = true,
}: {
  snapEnabled?: boolean;
  win: WinState;
  title: string;
  active: boolean;
  compact: boolean;
  area: { w: number; h: number };
  onFocus: () => void;
  onRect: (r: Rect) => void;
  onMode: (mode: WinState['mode']) => void;
  onSnap: (zone: Zone) => void;
  onPreview: (hint: SnapHint) => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [layouts, setLayouts] = useState(false);
  const hoverTimer = useRef(0);
  const maximized = compact || win.mode === 'max';
  const snapped = !maximized && win.snap ? win.snap : null;

  const geometry = maximized
    ? { left: 0, top: 0, width: area.w, height: area.h }
    : snapped
      ? (({ x, y, w, h }) => ({ left: x, top: y, width: w, height: h }))(zoneRect(snapped, area))
      : { left: win.x, top: win.y, width: win.w, height: win.h };

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  /** Zieht/ändert Größe über Pointer-Events; schreibt während des Ziehens direkt ins DOM (60 fps), am Ende einmal in den Zustand. */
  const startDrag = (e: React.PointerEvent, edge: (typeof EDGES)[number] | 'move') => {
    if (compact || e.button !== 0) return;
    const el = ref.current;
    if (!el) return;
    if ((maximized || snapped) && edge !== 'move') return;
    e.preventDefault();
    onFocus();
    setLayouts(false);
    const start = { px: e.clientX, py: e.clientY };
    let base: Rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    let detached = !(maximized || snapped);
    let next = base;
    let hint: SnapHint = null;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.px;
      const dy = ev.clientY - start.py;
      if (!detached) {
        // Aus maximiert/eingerastet erst nach kurzer Bewegung lösen – dann in normaler Größe unter dem Zeiger
        if (Math.abs(dx) + Math.abs(dy) < 6) return;
        detached = true;
        const ratio = (ev.clientX - geometry.left) / geometry.width;
        base = { x: ev.clientX - win.w * ratio, y: Math.max(0, ev.clientY - 18), w: win.w, h: win.h };
        start.px = ev.clientX;
        start.py = ev.clientY;
        el.classList.add('is-detaching');
      }
      el.classList.add('is-dragging');
      if (edge === 'move') {
        next = { ...base, x: base.x + (ev.clientX - start.px), y: Math.max(0, Math.min(area.h - 40, base.y + (ev.clientY - start.py))) };
        const atLeft = ev.clientX <= 4;
        const atRight = ev.clientX >= window.innerWidth - 5;
        const nearTop = ev.clientY <= 60;
        const nearBottom = ev.clientY >= area.h - 60;
        const h: SnapHint = !snapEnabled
          ? null
          : atLeft && nearTop ? ZONES.topLeft
          : atLeft && nearBottom ? ZONES.bottomLeft
          : atRight && nearTop ? ZONES.topRight
          : atRight && nearBottom ? ZONES.bottomRight
          : atLeft ? ZONES.left
          : atRight ? ZONES.right
          : ev.clientY <= 2 ? 'max'
          : null;
        if (h !== hint) {
          hint = h;
          onPreview(hint);
        }
      } else {
        let { x, y, w, h } = base;
        if (edge.includes('e')) w = Math.max(MIN_W, base.w + dx);
        if (edge.includes('s')) h = Math.max(MIN_H, base.h + dy);
        if (edge.includes('w')) {
          w = Math.max(MIN_W, base.w - dx);
          x = base.x + base.w - w;
        }
        if (edge.includes('n')) {
          h = Math.max(MIN_H, base.h - dy);
          y = Math.max(0, base.y + base.h - h);
          h = base.y + base.h - y;
        }
        next = { x, y, w, h };
      }
      Object.assign(el.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.w}px`, height: `${next.h}px` });
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      el.classList.remove('is-dragging', 'is-detaching');
      onPreview(null);
      if (!detached) return;
      // Titelleiste bleibt immer greifbar
      next = { ...next, x: Math.max(-next.w + 120, Math.min(area.w - 120, next.x)) };
      onRect(next);
      if (hint === 'max') onMode('max');
      else if (hint) onSnap(hint);
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };

  const showLayouts = () => {
    if (compact) return;
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setLayouts(true), 450);
  };
  const hideLayouts = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setLayouts(false), 250);
  };

  return (
    <div
      ref={ref}
      className={`os-win${active ? ' is-active' : ''}${maximized ? ' is-max' : ''}${snapped ? ' is-snapped' : ''}${win.mode === 'min' ? ' is-min' : ''}`}
      style={{ ...geometry, zIndex: win.z }}
      role="dialog"
      aria-label={title}
      aria-hidden={win.mode === 'min'}
      onPointerDownCapture={onFocus}
    >
      <header
        className="os-win__bar"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('button, .os-layouts')) return;
          startDrag(e, 'move');
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('button, .os-layouts') || compact) return;
          onMode(win.mode === 'max' ? 'normal' : 'max');
        }}
      >
        <span className="os-win__title">
          <AppIcon app={win.app} size={18} />
          {title}
        </span>
        <span className="os-win__ctrls">
          <button type="button" onClick={() => onMode('min')} aria-label="Minimieren" title="Minimieren (Alt+M)">
            <IMin width={16} height={16} />
          </button>
          {!compact ? (
            <span className="os-win__maxwrap" onPointerEnter={showLayouts} onPointerLeave={hideLayouts}>
              <button
                type="button"
                onClick={() => (setLayouts(false), onMode(win.mode === 'max' || snapped ? 'normal' : 'max'))}
                onContextMenu={(e) => (e.preventDefault(), setLayouts((v) => !v))}
                aria-label={win.mode === 'max' || snapped ? 'Wiederherstellen' : 'Maximieren'}
                aria-haspopup="menu"
                aria-expanded={layouts}
                title="Maximieren (Alt+↑) – Zeiger halten für Snap-Layouts"
              >
                {win.mode === 'max' || snapped ? <IRestore width={16} height={16} /> : <IMax width={15} height={15} />}
              </button>
              {layouts ? (
                <div className="os-layouts os-acrylic" role="menu" aria-label="Snap-Layouts" onPointerEnter={showLayouts} onPointerLeave={hideLayouts}>
                  {LAYOUTS.map((l) => (
                    <div key={l.label} className="os-layouts__item" role="group" aria-label={l.label}>
                      {l.zones.map((z, i) => (
                        <button
                          key={i}
                          type="button"
                          role="menuitem"
                          aria-label={`${l.label}: Bereich ${i + 1}`}
                          style={{ left: `${z.x * 100}%`, top: `${z.y * 100}%`, width: `${z.w * 100}%`, height: `${z.h * 100}%` }}
                          onClick={() => {
                            setLayouts(false);
                            onSnap(z);
                          }}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </span>
          ) : null}
          <button type="button" className="os-win__close" onClick={onClose} aria-label="Schließen" title="Schließen (Alt+W)">
            <IClose width={16} height={16} />
          </button>
        </span>
      </header>
      <div className="os-win__body">{children}</div>
      {!maximized && !snapped
        ? EDGES.map((edge) => <span key={edge} className={`os-win__grip os-win__grip--${edge}`} onPointerDown={(e) => startDrag(e, edge)} aria-hidden="true" />)
        : null}
    </div>
  );
}
