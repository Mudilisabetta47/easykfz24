'use client';

// Sperrbildschirm: zuerst Uhr und Datum auf dem Hintergrund (keine Inhalte sichtbar), nach Klick/Taste/Wischen
// die Anmeldung. Entsperren = vollständige erneute Anmeldung am Server (POST /api/admin/os/unlock).

import { useEffect, useRef, useState } from 'react';
import { logoutAction } from '../../app/admin/actions.ts';
import { OsError, osFetch } from './api.ts';
import type { OsSession } from './context.ts';
import { IArrowRight, IBell, ILock, IWifi, IWifiOff, IWarn } from './icons.tsx';

export function LockScreen({ session, lockedAt, unread, onUnlock }: { session: OsSession; lockedAt: Date; unread: number; onUnlock: (s: OsSession) => void }) {
  const [stage, setStage] = useState<'curtain' | 'login'>('curtain');
  const [otherUser, setOtherUser] = useState(false);
  const [username, setUsername] = useState(session.user.username);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needCode, setNeedCode] = useState(false);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [caps, setCaps] = useState(false);
  const [now, setNow] = useState(new Date());
  const [online, setOnline] = useState(true);
  const pw = useRef<HTMLInputElement>(null);
  const touchY = useRef<number | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const t = window.setInterval(() => setNow(new Date()), 10_000);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.clearInterval(t);
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);

  useEffect(() => {
    if (stage === 'login') window.setTimeout(() => pw.current?.focus(), 260);
    const onKey = (e: KeyboardEvent) => {
      if (stage === 'curtain' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setStage('login');
      } else if (stage === 'login' && e.key === 'Escape' && !busy) {
        setStage('curtain');
        setError(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stage, busy]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onUnlock(await osFetch<OsSession>('unlock', { method: 'POST', body: { username: otherUser ? username : session.user.username, password, code } }));
    } catch (e) {
      if (e instanceof OsError && e.data.needCode) {
        setNeedCode(true);
        setError(code ? (e as Error).message : null);
      } else {
        setError((e as Error).message);
        setPassword('');
        pw.current?.focus();
      }
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const time = now.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const date = now.toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className={`os-lock is-${stage}`} role="dialog" aria-modal="true" aria-label="EasyKFZ24 OS ist gesperrt">
      <div className="os-lock__blur" aria-hidden="true" />
      <div
        className="os-lock__curtain"
        onClick={() => setStage('login')}
        onTouchStart={(e) => (touchY.current = e.touches[0].clientY)}
        onTouchEnd={(e) => {
          if (touchY.current !== null && touchY.current - e.changedTouches[0].clientY > 40) setStage('login');
          touchY.current = null;
        }}
        aria-hidden={stage !== 'curtain'}
      >
        <div className="os-lock__clock">
          <strong>{time}</strong>
          <span>{date}</span>
        </div>
        <div className="os-lock__status">
          <span title={online ? 'Verbunden' : 'Keine Verbindung'}>{online ? <IWifi width={18} height={18} /> : <IWifiOff width={18} height={18} />}</span>
          {unread ? (
            <span title="Neue Benachrichtigungen">
              <IBell width={18} height={18} /> {unread}
            </span>
          ) : null}
          <span>
            <ILock width={16} height={16} /> gesperrt seit {lockedAt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
        <p className="os-lock__tap">Klicken oder beliebige Taste drücken</p>
      </div>

      <form
        className="os-lock__login"
        aria-hidden={stage !== 'login'}
        onSubmit={(e) => {
          e.preventDefault();
          if (password && (!needCode || code.length === 6)) void submit();
        }}
      >
        <span className="os-avatar os-avatar--xl" aria-hidden="true">
          {(otherUser ? username || '?' : session.user.displayName).slice(0, 1).toUpperCase()}
        </span>
        <strong className="os-lock__name">{otherUser ? 'Anderer Benutzer' : session.user.displayName}</strong>
        {!otherUser ? <span className="os-lock__role">{session.user.roleLabel}</span> : null}
        {otherUser ? (
          <input
            className="os-lock__input"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Benutzername (leer = Inhaber)"
            aria-label="Benutzername"
            autoComplete="username"
            spellCheck={false}
            tabIndex={stage === 'login' ? 0 : -1}
          />
        ) : null}
        <span className="os-lock__pw">
          <input
            ref={pw}
            className="os-lock__input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyUp={(e) => setCaps(e.getModifierState('CapsLock'))}
            placeholder="Passwort"
            aria-label="Passwort"
            autoComplete="current-password"
            tabIndex={stage === 'login' ? 0 : -1}
          />
          <button type="submit" disabled={busy || !password} aria-label="Entsperren" tabIndex={stage === 'login' ? 0 : -1}>
            {busy ? <span className="os-spinner os-spinner--sm" aria-hidden="true" /> : <IArrowRight width={18} height={18} />}
          </button>
        </span>
        {needCode ? (
          <input
            className="os-lock__input"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="Code aus der Authenticator-App"
            aria-label="Zwei-Faktor-Code"
            autoFocus
          />
        ) : null}
        {caps ? (
          <p className="os-lock__caps">
            <IWarn width={14} height={14} /> Feststelltaste ist aktiv
          </p>
        ) : null}
        {error ? (
          <p className="os-lock__error" role="alert">
            {error}
          </p>
        ) : null}
        <div className="os-lock__links">
          <button
            type="button"
            className="os-linkbtn"
            tabIndex={stage === 'login' ? 0 : -1}
            onClick={() => {
              setOtherUser((v) => !v);
              setUsername(otherUser ? session.user.username : '');
              setError(null);
            }}
          >
            {otherUser ? `Als ${session.user.displayName} anmelden` : 'Anderer Benutzer'}
          </button>
        </div>
      </form>

      <form action={logoutAction} className="os-lock__logout">
        <button type="submit" className="os-linkbtn" tabIndex={stage === 'login' ? 0 : -1}>
          Abmelden
        </button>
      </form>
    </div>
  );
}
