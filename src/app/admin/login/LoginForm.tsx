'use client';

import { useActionState } from 'react';
import { loginAction, type LoginState } from '../actions.ts';

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  return (
    <form action={action} className="admin-login__form">
      <div className="field">
        <label htmlFor="pw" className="field__label">
          Passwort
        </label>
        <input id="pw" name="password" type="password" autoComplete="current-password" required autoFocus />
      </div>
      {state.error ? (
        <p className="alert alert--error" role="alert">
          {state.error}
        </p>
      ) : null}
      <button type="submit" className="btn" disabled={pending} aria-busy={pending}>
        {pending ? 'Wird geprüft …' : 'Anmelden'}
      </button>
    </form>
  );
}
