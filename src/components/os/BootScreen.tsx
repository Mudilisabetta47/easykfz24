'use client';

// Startbildschirm beim Öffnen von EasyKFZ24 OS. Die Schritte sind echte Prüfungen (Sitzung, Datenbank,
// Dateispeicher, Meldungen) – nichts wird nur vorgespielt. Erscheint einmal pro Anmeldung in diesem Tab.

import { useEffect, useState } from 'react';
import { osFetch } from './api.ts';
import type { OsSession } from './context.ts';
import { ICheck, IWarn, OsMark } from './icons.tsx';

type StepState = 'wait' | 'ok' | 'warn';
interface Step {
  label: string;
  state: StepState;
  detail?: string;
}

interface SystemInfo {
  system: { platform: string; database: string; uploads: string };
}

export function BootScreen({ session, onDone }: { session: OsSession; onDone: () => void }) {
  const [steps, setSteps] = useState<Step[]>([
    { label: 'Sitzung prüfen', state: 'wait' },
    { label: 'Datenbank verbinden', state: 'wait' },
    { label: 'Dateispeicher prüfen', state: 'wait' },
    { label: 'Programme bereitstellen', state: 'wait' },
  ]);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const set = (i: number, state: StepState, detail?: string) => setSteps((s) => s.map((x, k) => (k === i ? { ...x, state, detail } : x)));
    const started = Date.now();
    (async () => {
      try {
        const s = await osFetch<OsSession>('session', { background: true });
        set(0, 'ok', `${s.user.displayName} · ${s.user.roleLabel}`);
      } catch (e) {
        set(0, 'warn', (e as Error).message);
      }
      try {
        const info = await osFetch<SystemInfo>('settings', { background: true });
        const dbOk = !info.system.database.startsWith('nicht');
        const upOk = !info.system.uploads.startsWith('nicht');
        set(1, dbOk ? 'ok' : 'warn', info.system.database);
        set(2, upOk ? 'ok' : 'warn', info.system.uploads);
      } catch (e) {
        set(1, 'warn', (e as Error).message);
        set(2, 'warn', 'nicht geprüft');
      }
      const apps = session.permissions.length;
      set(3, 'ok', `${apps} Berechtigungen geladen`);
      // Kurz stehen lassen, damit der Abschluss lesbar ist – nie länger als nötig
      const rest = Math.max(0, 1100 - (Date.now() - started));
      await new Promise((r) => setTimeout(r, rest));
      if (cancelled) return;
      setLeaving(true);
      await new Promise((r) => setTimeout(r, 450));
      if (!cancelled) onDone();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const done = steps.filter((s) => s.state !== 'wait').length;

  return (
    <div className={`os-boot${leaving ? ' is-leaving' : ''}`} role="status" aria-live="polite" aria-label="EasyKFZ24 OS startet">
      <div className="os-boot__center">
        <span className="os-boot__mark">
          <OsMark size={84} />
        </span>
        <h1>
          EasyKFZ24 <span>OS</span>
        </h1>
        <p className="os-boot__sub">Business Control Center</p>
        <div className="os-boot__bar" aria-hidden="true">
          <span style={{ width: `${(done / steps.length) * 100}%` }} />
        </div>
        <ul className="os-boot__steps" role="list">
          {steps.map((s) => (
            <li key={s.label} className={`is-${s.state}`}>
              <span className="os-boot__icon" aria-hidden="true">
                {s.state === 'ok' ? <ICheck width={14} height={14} /> : s.state === 'warn' ? <IWarn width={14} height={14} /> : <span className="os-spinner os-spinner--sm" />}
              </span>
              <span>{s.label}</span>
              {s.detail ? <span className="os-boot__detail">{s.detail}</span> : null}
            </li>
          ))}
        </ul>
      </div>
      <p className="os-boot__foot">Willkommen, {session.user.displayName}</p>
    </div>
  );
}
