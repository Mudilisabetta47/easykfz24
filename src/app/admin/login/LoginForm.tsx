'use client';

import { useActionState, useEffect, useState } from 'react';
import { loginAction, type LoginState } from '../actions.ts';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  // Kontrollierte Felder: Nach der Zwei-Faktor-Rückfrage bleiben Benutzername und Passwort erhalten.
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  // Nach jeder neuen Anmeldung erscheint der Startbildschirm von EasyKFZ24 OS wieder
  useEffect(() => {
    try {
      for (const k of Object.keys(sessionStorage)) if (k.startsWith('ekos:')) sessionStorage.removeItem(k);
    } catch {
      /* ohne Speicher kein Startbildschirm-Merker */
    }
  }, []);
  return (
    <form action={action} className="admin-login__form">
      <div className="field">
        <label htmlFor="user" className="field__label">
          Benutzername <span className="field__opt">leer lassen für Inhaber</span>
        </label>
        <input id="user" name="username" autoComplete="username" spellCheck={false} autoCapitalize="none" value={username} onChange={(e) => setUsername(e.target.value)} maxLength={40} />
      </div>
      <div className="field">
        <label htmlFor="pw" className="field__label">
          Passwort
        </label>
        <input id="pw" name="password" type="password" autoComplete="current-password" required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {state.needCode ? (
        <div className="field">
          <label htmlFor="code" className="field__label">
            Code aus der Authenticator-App
          </label>
          <input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
      ) : null}
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending} aria-busy={pending}>
        {pending ? 'Wird geprüft …' : state.needCode ? 'Bestätigen' : 'Anmelden'}
      </button>
    </form>
  );
}
