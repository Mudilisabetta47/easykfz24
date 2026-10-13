'use client';

import { useState } from 'react';
import { CONFIRM_LABEL, validateWithdrawal, withdrawalStatement, formatReceipt, type WithdrawalErrors, type WithdrawalInput } from '../../../lib/withdrawal.ts';

interface Receipt {
  reference: string;
  receivedAt: string;
  statement: string;
  confirmation: string;
}

/**
 * Zwei Schritte nach § 356a BGB: (1) Name, Vertrag und E-Mail für die Eingangsbestätigung angeben,
 * (2) Angaben prüfen und mit „Widerruf bestätigen“ absenden. Danach Eingangsbestätigung mit Datum und Uhrzeit.
 */
export function WithdrawalForm({ initialContract = '' }: { initialContract?: string }) {
  const [step, setStep] = useState<'angaben' | 'pruefen' | 'fertig'>('angaben');
  const [values, setValues] = useState<WithdrawalInput>({ name: '', contract: initialContract, email: '' });
  const [errors, setErrors] = useState<WithdrawalErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const set = (k: keyof WithdrawalInput, v: string) => {
    setValues((x) => ({ ...x, [k]: v }));
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  const next = () => {
    const v = validateWithdrawal(values);
    if (!v.ok) return setErrors(v.errors);
    setValues(v.value);
    setStep('pruefen');
  };

  const submit = async () => {
    setBusy(true);
    setFailure('');
    try {
      const res = await fetch('/api/widerruf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(values) });
      const j = (await res.json()) as { ok: boolean; receipt?: Receipt; errors?: WithdrawalErrors; error?: string };
      if (j.ok && j.receipt) {
        setReceipt(j.receipt);
        setStep('fertig');
      } else if (j.errors) {
        setErrors(j.errors);
        setStep('angaben');
      } else setFailure(j.error ?? 'Der Widerruf konnte nicht übermittelt werden. Bitte per E-Mail oder Post widerrufen.');
    } catch {
      setFailure('Keine Verbindung. Bitte erneut versuchen oder per E-Mail bzw. Post widerrufen.');
    } finally {
      setBusy(false);
    }
  };

  if (step === 'fertig' && receipt) {
    return (
      <section className="card wd" aria-labelledby="wd-done" role="status">
        <h2 id="wd-done">Ihr Widerruf ist eingegangen</h2>
        <dl className="legal__facts">
          <div>
            <dt>Eingegangen am</dt>
            <dd>{formatReceipt(receipt.receivedAt)}</dd>
          </div>
          <div>
            <dt>Vorgangsnummer</dt>
            <dd>{receipt.reference}</dd>
          </div>
          <div>
            <dt>Inhalt der Erklärung</dt>
            <dd>{receipt.statement}</dd>
          </div>
        </dl>
        <p>
          {receipt.confirmation === 'versendet'
            ? `Die Eingangsbestätigung haben wir an ${values.email} gesendet.`
            : 'Die Eingangsbestätigung per E-Mail konnte gerade nicht versendet werden – wir senden sie nach. Bitte bewahren Sie diese Seite (z. B. als Ausdruck) auf.'}
        </p>
      </section>
    );
  }

  if (step === 'pruefen') {
    return (
      <section className="card wd" aria-labelledby="wd-check">
        <h2 id="wd-check">Angaben prüfen</h2>
        <p>Mit „{CONFIRM_LABEL}“ senden Sie folgende Erklärung ab:</p>
        <blockquote className="wd__statement">{withdrawalStatement(values)}</blockquote>
        {failure ? (
          <div className="alert alert--error" role="alert">
            {failure}
          </div>
        ) : null}
        <div className="wd__actions">
          <button type="button" className="btn btn--ghost" onClick={() => setStep('angaben')} disabled={busy}>
            Angaben ändern
          </button>
          <button type="button" className="btn" onClick={submit} disabled={busy} aria-busy={busy}>
            {busy ? 'Wird übermittelt …' : CONFIRM_LABEL}
          </button>
        </div>
      </section>
    );
  }

  const field = (k: keyof WithdrawalInput, label: string, props: Record<string, string> = {}) => (
    <div className={`field${errors[k] ? ' field--error' : ''}`}>
      <label htmlFor={`wd-${k}`} className="field__label">
        {label}
      </label>
      <input
        id={`wd-${k}`}
        value={values[k]}
        onChange={(e) => set(k, e.target.value)}
        aria-invalid={!!errors[k]}
        aria-describedby={errors[k] ? `wd-${k}-err` : undefined}
        {...props}
      />
      {errors[k] ? (
        <p className="field__error" id={`wd-${k}-err`}>
          {errors[k]}
        </p>
      ) : null}
    </div>
  );

  return (
    <form
      className="card wd"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        next();
      }}
      aria-labelledby="wd-form"
    >
      <h2 id="wd-form">Ihre Angaben</h2>
      {field('name', 'Ihr Name', { autoComplete: 'name' })}
      {field('contract', 'Vertrag (Auftragsnummer, z. B. EK-2026-00012, oder andere Angaben zum Vertrag)')}
      {field('email', 'E-Mail-Adresse für die Eingangsbestätigung', { type: 'email', autoComplete: 'email', inputMode: 'email' })}
      <div className="wd__actions">
        <button type="submit" className="btn">
          Weiter zur Bestätigung
        </button>
      </div>
    </form>
  );
}
