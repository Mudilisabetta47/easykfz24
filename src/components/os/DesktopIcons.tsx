'use client';

// Desktop-Symbole in einem festen Raster (spaltenweise wie gewohnt). Symbole lassen sich per Ziehen auf eine
// andere Rasterzelle legen (belegte Zelle = Platz tauschen); Anordnung wird pro Benutzer gespeichert.

import { useRef, useState } from 'react';
import type { AppDef } from './context.ts';
import { AppIcon, type AppId } from './icons.tsx';

/** Rastergröße je Symbolgröße (Einstellungen → Design) */
export const ICON_GRID = {
  klein: { w: 92, h: 92, icon: 36 },
  mittel: { w: 108, h: 112, icon: 46 },
  gross: { w: 128, h: 134, icon: 60 },
} as const;
export type IconSize = keyof typeof ICON_GRID;
export const CELL_W = ICON_GRID.mittel.w;
export const CELL_H = ICON_GRID.mittel.h;
const PAD = 12;

export type IconCells = Partial<Record<AppId, { c: number; r: number }>>;

/** Fehlende Symbole spaltenweise in freie Zellen legen. */
export function layoutIcons(apps: AppDef[], saved: IconCells, rows: number): Record<string, { c: number; r: number }> {
  const out: Record<string, { c: number; r: number }> = {};
  const taken = new Set<string>();
  for (const a of apps) {
    const p = saved[a.id];
    if (p && p.r < rows && !taken.has(`${p.c}:${p.r}`)) {
      out[a.id] = p;
      taken.add(`${p.c}:${p.r}`);
    }
  }
  let i = 0;
  for (const a of apps) {
    if (out[a.id]) continue;
    while (taken.has(`${Math.floor(i / rows)}:${i % rows}`)) i++;
    out[a.id] = { c: Math.floor(i / rows), r: i % rows };
    taken.add(`${out[a.id].c}:${out[a.id].r}`);
  }
  return out;
}

export function DesktopIcons({
  apps,
  cells,
  rows,
  cols,
  compact,
  selected,
  onSelect,
  onOpen,
  onMove,
  size = 'mittel',
}: {
  size?: IconSize;
  apps: AppDef[];
  cells: Record<string, { c: number; r: number }>;
  rows: number;
  cols: number;
  compact: boolean;
  selected: AppId | null;
  onSelect: (a: AppId | null) => void;
  onOpen: (a: AppId) => void;
  onMove: (a: AppId, to: { c: number; r: number }) => void;
}) {
  const [drag, setDrag] = useState<{ app: AppId; dx: number; dy: number; target: { c: number; r: number } | null } | null>(null);
  const g = ICON_GRID[size] ?? ICON_GRID.mittel;
  const CW = g.w;
  const CH = g.h;
  const moved = useRef(false);

  const startDrag = (e: React.PointerEvent<HTMLButtonElement>, app: AppId) => {
    if (compact || e.button !== 0) return;
    const el = e.currentTarget;
    const sx = e.clientX;
    const sy = e.clientY;
    const origin = cells[app];
    moved.current = false;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved.current && Math.abs(dx) + Math.abs(dy) < 6) return;
      moved.current = true;
      const c = Math.max(0, Math.min(cols - 1, Math.round((PAD + origin.c * CW + dx) / CW)));
      const r = Math.max(0, Math.min(rows - 1, Math.round((PAD + origin.r * CH + dy) / CH)));
      setDrag({ app, dx, dy, target: { c, r } });
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      setDrag((d) => {
        if (d?.target && moved.current) onMove(app, d.target);
        return null;
      });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  return (
    <ul className={`os-icons os-icons--${size}${compact ? ' is-compact' : ''}`} role="list" aria-label="Desktop">
      {drag?.target ? (
        <li className="os-icons__target" aria-hidden="true" style={{ left: PAD + drag.target.c * CW, top: PAD + drag.target.r * CH, width: CW - 4, height: CH - 8 }} />
      ) : null}
      {apps.map((a) => {
        const p = cells[a.id];
        const dragging = drag?.app === a.id;
        return (
          <li
            key={a.id}
            className={dragging ? 'is-dragging' : ''}
            style={
              compact || !p
                ? undefined
                : { left: PAD + p.c * CW, top: PAD + p.r * CH, width: CW - 4, transform: dragging ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }
            }
          >
            <button
              type="button"
              data-app={a.id}
              className={`os-icon${selected === a.id ? ' is-selected' : ''}`}
              title={a.description}
              onPointerDown={(e) => startDrag(e, a.id)}
              onClick={() => {
                if (moved.current) return;
                if (compact) onOpen(a.id);
                else onSelect(a.id);
              }}
              onDoubleClick={() => onOpen(a.id)}
              onKeyDown={(e) => e.key === 'Enter' && onOpen(a.id)}
            >
              <AppIcon app={a.id} size={g.icon} />
              <span lang="de">{a.label}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
