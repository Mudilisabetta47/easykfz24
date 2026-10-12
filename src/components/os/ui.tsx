'use client';

import { useState, type ReactNode } from 'react';
import { DISPLAY, type DisplayStatus } from '../../lib/kfz-status.ts';
import { STATUSES, statusLabel, type StatusId } from '../../lib/status.ts';
import type { ServiceId } from '../../lib/services.ts';
import { IInfo, IRefresh, IWarn } from './icons.tsx';

export function Badge({ tone = 'slate', children }: { tone?: string; children: ReactNode }) {
  return <span className={`os-badge os-badge--${tone}`}>{children}</span>;
}

export function StatusBadge({ status, service }: { status: StatusId; service?: ServiceId }) {
  return <Badge tone={STATUSES[status]?.tone ?? 'slate'}>{statusLabel(status, service)}</Badge>;
}

export function KfzState({ display }: { display: string }) {
  if (!display || !(display in DISPLAY)) return <span className="os-muted">–</span>;
  const d = DISPLAY[display as DisplayStatus];
  return <Badge tone={d.tone}>{d.label}</Badge>;
}

export function Loading({ label = 'Wird geladen …' }: { label?: string }) {
  return (
    <div className="os-state" role="status">
      <span className="os-spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="os-state os-state--error" role="alert">
      <IWarn width={22} height={22} />
      <span>{message}</span>
      {onRetry ? (
        <button type="button" className="os-btn os-btn--ghost" onClick={onRetry}>
          <IRefresh width={16} height={16} /> Erneut versuchen
        </button>
      ) : null}
    </div>
  );
}

export function Empty({ title, text }: { title: string; text?: string }) {
  return (
    <div className="os-state os-state--empty">
      <IInfo width={22} height={22} />
      <strong>{title}</strong>
      {text ? <span>{text}</span> : null}
    </div>
  );
}

export function Kpi({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className={`os-kpi${tone ? ` os-kpi--${tone}` : ''}`}>
      <span className="os-kpi__label">{label}</span>
      <span className="os-kpi__value">{value}</span>
      {hint ? <span className="os-kpi__hint">{hint}</span> : null}
    </div>
  );
}

export function Panel({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`os-panel ${className}`}>
      {title || actions ? (
        <header className="os-panel__head">
          {title ? <h3>{title}</h3> : <span />}
          {actions}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="os-tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} className={value === t.id ? 'is-active' : ''} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Kleiner Hinweis nach einer Aktion (Erfolg/Fehler) innerhalb eines Programms. */
export function useFlash() {
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const show = (ok: boolean, text: string) => {
    setFlash({ ok, text });
    window.setTimeout(() => setFlash((f) => (f?.text === text ? null : f)), 4500);
  };
  const node = flash ? (
    <p className={`os-flash ${flash.ok ? 'is-ok' : 'is-error'}`} role={flash.ok ? 'status' : 'alert'}>
      {flash.text}
    </p>
  ) : null;
  return { show, node };
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="os-field">
      <span className="os-field__label">{label}</span>
      {children}
      {hint ? <span className="os-field__hint">{hint}</span> : null}
    </label>
  );
}
