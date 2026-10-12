'use client';

// Gemeinsame Bausteine der Programme: Dialog, Mitarbeiterauswahl, Badges, Problemliste, Upload-Zone, Datum.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { STAGE_META, type Issue, type Stage } from '../../lib/workflow.ts';
import { osFetch } from './api.ts';
import { IClose, IWarn } from './icons.tsx';
import { Badge } from './ui.tsx';

/* ---------- Datum ---------- */

/** ISO → Wert für <input type="date"> (lokales Datum) */
export const toDateInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
/** <input type="date"> → ISO (Ende des Tages lokal) */
export const fromDateInput = (v: string, endOfDay = true) => (v ? new Date(`${v}T${endOfDay ? '18:00' : '08:00'}:00`).toISOString() : '');
export const toDateTimeInput = (iso: string | null | undefined) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
export const fromDateTimeInput = (v: string) => (v ? new Date(v).toISOString() : '');
export const dateOnly = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '–');
export const isOverdue = (iso: string | null | undefined) => !!iso && iso < new Date().toISOString();

/* ---------- Mitarbeiter ---------- */

export interface Staff {
  id: number;
  name: string;
  role: string;
  active: boolean;
}

let staffCache: { at: number; list: Staff[] } | null = null;

export function useStaff(): Staff[] {
  const [list, setList] = useState<Staff[]>(staffCache?.list ?? []);
  useEffect(() => {
    if (staffCache && Date.now() - staffCache.at < 60_000) return;
    osFetch<Staff[]>('staff', { background: true })
      .then((l) => {
        staffCache = { at: Date.now(), list: l };
        setList(l);
      })
      .catch(() => undefined);
  }, []);
  return list;
}

export function staffName(list: Staff[], id: number | null | undefined): string {
  if (id === null || id === undefined) return 'nicht zugewiesen';
  return list.find((s) => s.id === id)?.name ?? `#${id}`;
}

export function StaffSelect({ value, onChange, disabled, allowNone = true, label = 'Zuständig' }: { value: number | null; onChange: (v: number | null) => void; disabled?: boolean; allowNone?: boolean; label?: string }) {
  const staff = useStaff();
  return (
    <select className="os-select" value={value === null ? '' : String(value)} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={disabled} aria-label={label}>
      {allowNone ? <option value="">– niemand –</option> : null}
      {staff
        .filter((s) => s.active || s.id === value)
        .map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
    </select>
  );
}

/* ---------- Badges ---------- */

export const PRIORITY_TONE: Record<string, string> = { niedrig: 'slate', normal: 'blue', hoch: 'amber', dringend: 'red' };
export const PRIORITY_LABEL: Record<string, string> = { niedrig: 'Niedrig', normal: 'Normal', hoch: 'Hoch', dringend: 'Dringend' };

export function PriorityBadge({ value }: { value: string }) {
  if (!value || value === 'normal') return null;
  return <Badge tone={PRIORITY_TONE[value] ?? 'slate'}>{PRIORITY_LABEL[value] ?? value}</Badge>;
}

export function StageBadge({ stage }: { stage: Stage }) {
  const m = STAGE_META[stage];
  return <Badge tone={m.tone}>{m.label}</Badge>;
}

export function IssueList({ issues, onFix, compact }: { issues: Issue[]; onFix?: (i: Issue) => void; compact?: boolean }) {
  if (!issues.length) return compact ? null : <p className="os-ok-line">Keine Auffälligkeiten erkannt.</p>;
  return (
    <ul className={`os-issues${compact ? ' is-compact' : ''}`} role="list">
      {issues.map((i, k) => (
        <li key={`${i.code}-${k}`} className={`is-${i.level}`}>
          <IWarn width={14} height={14} />
          <span>{i.text}</span>
          {onFix && i.fix ? (
            <button type="button" className="os-linkbtn os-small" onClick={() => onFix(i)}>
              Beheben
            </button>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function IssueDot({ issues }: { issues: Issue[] }) {
  const worst = issues.find((i) => i.level === 'fehler') ?? issues.find((i) => i.level === 'warnung');
  if (!worst) return null;
  return (
    <span className={`os-issue-dot is-${worst.level}`} title={issues.map((i) => i.text).join('\n')} aria-label={`${issues.length} Hinweis(e)`}>
      {issues.length}
    </span>
  );
}

/* ---------- Dialog ---------- */

export function Dialog({ title, onClose, children, wide, footer }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean; footer?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="os-dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={`os-dialog${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <header className="os-dialog__head">
          <h3>{title}</h3>
          <button type="button" className="os-iconbtn" onClick={onClose} aria-label="Schließen">
            <IClose width={16} height={16} />
          </button>
        </header>
        <div className="os-dialog__body os-scroll">{children}</div>
        {footer ? <footer className="os-dialog__foot">{footer}</footer> : null}
      </div>
    </div>
  );
}

/* ---------- Upload ---------- */

export function DropZone({ onFiles, disabled, label = 'Dateien hierher ziehen oder klicken' }: { onFiles: (f: File[]) => void; disabled?: boolean; label?: string }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`os-drop${over ? ' is-over' : ''}${disabled ? ' is-disabled' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files]);
      }}
      onClick={() => !disabled && input.current?.click()}
      role="button"
      tabIndex={disabled ? -1 : 0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && !disabled && input.current?.click()}
      aria-disabled={disabled}
    >
      <span>{label}</span>
      <span className="os-muted os-small">PDF, JPG, PNG, WebP oder HEIC · je Datei max. 10 MB · privat gespeichert</span>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,application/pdf,image/*"
        onChange={(e) => {
          if (e.target.files?.length) onFiles([...e.target.files]);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/** Upload über die geschützte OS-Schnittstelle (multipart, Same-Origin). */
export async function uploadFiles(orderId: number, files: File[], meta: { kind?: string; category?: string; folder?: string; replaces?: string; expiresAt?: string } = {}) {
  const form = new FormData();
  form.set('orderId', String(orderId));
  for (const [k, v] of Object.entries(meta)) if (v) form.set(k, v);
  for (const f of files) form.append('file', f);
  const res = await fetch('/api/admin/os/documents/upload', { method: 'POST', body: form, credentials: 'same-origin' });
  const data = (await res.json().catch(() => ({}))) as { results?: { name: string; ok: boolean; error?: string }[]; error?: string; locked?: boolean };
  if (res.status === 401 && data.locked) window.dispatchEvent(new CustomEvent('os:locked'));
  if (!res.ok) throw new Error(data.error ?? `Fehler ${res.status}`);
  return data.results ?? [];
}

/* ---------- Export ---------- */

export function ExportMenu({ base, query = '' }: { base: string; query?: string }) {
  const href = (format: string) => `/api/admin/os/${base}${base.includes('?') ? '&' : '?'}format=${format}${query ? `&${query}` : ''}`;
  return (
    <span className="os-row os-row--tight">
      <a className="os-btn os-btn--ghost os-btn--sm" href={href('csv')} download>
        CSV
      </a>
      <a className="os-btn os-btn--ghost os-btn--sm" href={href('xlsx')} download>
        Excel
      </a>
    </span>
  );
}

/* ---------- Kleine Helfer ---------- */

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { id: T; label: ReactNode }[] }) {
  return (
    <div className="os-chipset" role="radiogroup">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'is-on' : ''} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await fn();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

/** Datei-Download einer GET-Schnittstelle (z. B. DSGVO-Auskunft) */
export function downloadHref(path: string): string {
  return `/api/admin/os/${path}`;
}
