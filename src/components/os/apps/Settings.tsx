'use client';

// Systemsteuerung: Konto, Benutzer & Mitarbeiter, Unternehmen, Design & Personalisierung, Benachrichtigungen,
// Sicherheit, Automatisierungen, Integrationen, System. Rechte werden serverseitig geprüft; Geheimnisse (API-Schlüssel)
// werden nie angezeigt oder im Browser gespeichert – nur ob sie eingerichtet sind.

import { useEffect, useState } from 'react';
import { logoutAction } from '../../../app/admin/actions.ts';
import { NOTIFY_KINDS, NOTIFY_META } from '../../../lib/os-notify.ts';
import { PERMISSION_LABEL, type Permission } from '../../../lib/permissions.ts';
import { dateTime, osFetch, useOsData } from '../api.ts';
import { ACCENTS, useOs } from '../context.ts';
import { ILock, IMoon, ISun } from '../icons.tsx';
import { Chips, staffName, useStaff } from '../shared.tsx';
import { Badge, Empty, ErrorBox, Field, Loading, Panel, useFlash } from '../ui.tsx';

type Section = 'konto' | 'benutzer' | 'unternehmen' | 'design' | 'benachrichtigungen' | 'sicherheit' | 'automatisierung' | 'integrationen' | 'system';
const WALLPAPER_NAMES = ['Aurora', 'Nacht', 'Morgen', 'Graphit'];

export function SettingsApp({ params, nonce }: { params?: Record<string, unknown>; nonce: number }) {
  const { can } = useOs();
  const [section, setSection] = useState<Section>('konto');
  useEffect(() => {
    if (typeof params?.tab === 'string') setSection(params.tab as Section);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce]);
  const sections: { id: Section; label: string; hint: string; show: boolean }[] = [
    { id: 'konto', label: 'Konto', hint: 'Passwort, Zwei-Faktor, Sitzungen', show: true },
    { id: 'benutzer', label: 'Benutzer & Mitarbeiter', hint: 'Anlegen, Rollen, Rechte', show: can('users.manage') },
    { id: 'unternehmen', label: 'Unternehmen', hint: 'Firmendaten, Rechnung, Absender', show: can('settings.manage') || can('finance.read') },
    { id: 'design', label: 'Design & Personalisierung', hint: 'Farben, Hintergrund, Symbole', show: true },
    { id: 'benachrichtigungen', label: 'Benachrichtigungen', hint: 'Hinweise, E-Mail, Browser', show: true },
    { id: 'sicherheit', label: 'Sicherheit', hint: 'Sperre, Protokoll, Rechte', show: true },
    { id: 'automatisierung', label: 'Automatisierungen', hint: 'Regeln und Protokoll', show: can('automation.manage') || can('orders.read') },
    { id: 'integrationen', label: 'Integrationen', hint: 'KFZ-API, Zahlung, E-Mail', show: true },
    { id: 'system', label: 'System & Diagnose', hint: 'D1, R2, Cloudflare', show: true },
  ];
  return (
    <div className="os-settings os-settings--panel">
      <nav className="os-settings__side" aria-label="Bereiche">
        {sections
          .filter((s) => s.show)
          .map((s) => (
            <button key={s.id} type="button" className={section === s.id ? 'is-sel' : ''} onClick={() => setSection(s.id)}>
              <strong>{s.label}</strong>
              <span>{s.hint}</span>
            </button>
          ))}
      </nav>
      <div className="os-settings__body os-scroll">
        {section === 'konto' ? <Account /> : null}
        {section === 'benutzer' ? <Users /> : null}
        {section === 'unternehmen' ? <Company /> : null}
        {section === 'design' ? <Design /> : null}
        {section === 'benachrichtigungen' ? <NotifyPrefs /> : null}
        {section === 'sicherheit' ? <Security /> : null}
        {section === 'automatisierung' ? <Automation /> : null}
        {section === 'integrationen' ? <Integrations /> : null}
        {section === 'system' ? <SystemStatus /> : null}
      </div>
    </div>
  );
}

/* ---------- Konto ---------- */

interface SecurityData {
  twoFactor: { enabled: boolean; pending: boolean; enabledAt: string };
  sessions: { id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string; current: boolean }[];
  canChangePassword: boolean;
}

function Account() {
  const { session, lock } = useOs();
  const sec = useOsData<SecurityData>('security');
  const flash = useFlash();
  const [pw, setPw] = useState({ current: '', next: '', repeat: '' });
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [code, setCode] = useState('');
  const call = async (path: string, body: unknown, ok: string) => {
    try {
      const r = await osFetch<Record<string, unknown>>(path, { method: 'POST', body });
      flash.show(true, ok);
      await sec.reload(true);
      return r;
    } catch (e) {
      flash.show(false, (e as Error).message);
      return null;
    }
  };
  return (
    <>
      {flash.node}
      <Panel title="Angemeldet als">
        <div className="os-account">
          <span className="os-avatar os-avatar--lg" aria-hidden="true">
            {session.user.displayName.slice(0, 1).toUpperCase()}
          </span>
          <div>
            <strong>{session.user.displayName}</strong>
            <p className="os-muted">
              {session.user.username} · {session.user.roleLabel}
            </p>
          </div>
        </div>
        <div className="os-row">
          <button type="button" className="os-btn os-btn--ghost" onClick={lock}>
            <ILock width={16} height={16} /> Sperren
          </button>
          <form action={logoutAction}>
            <button type="submit" className="os-btn os-btn--ghost">
              Abmelden
            </button>
          </form>
        </div>
        <ul className="os-chips" role="list">
          {session.permissions.map((p) => (
            <li key={p}>
              <Badge tone="blue">{PERMISSION_LABEL[p as Permission]}</Badge>
            </li>
          ))}
        </ul>
      </Panel>
      <div className="os-grid os-grid--2">
        <Panel title="Passwort ändern">
          {sec.data && !sec.data.canChangePassword ? (
            <p className="os-muted os-small">Das Inhaber-Passwort liegt als Geheimnis auf dem Server (ADMIN_PASSWORD) und wird dort geändert: <code>npx wrangler secret put ADMIN_PASSWORD</code>.</p>
          ) : (
            <form
              className="os-form"
              onSubmit={async (e) => {
                e.preventDefault();
                if (pw.next !== pw.repeat) return flash.show(false, 'Die neuen Passwörter stimmen nicht überein');
                if (await call('security/password', { current: pw.current, next: pw.next }, 'Passwort geändert – andere Sitzungen wurden beendet')) setPw({ current: '', next: '', repeat: '' });
              }}
            >
              <input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} placeholder="Aktuelles Passwort" autoComplete="current-password" aria-label="Aktuelles Passwort" />
              <input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} placeholder="Neues Passwort (mind. 12 Zeichen)" autoComplete="new-password" aria-label="Neues Passwort" />
              <input type="password" value={pw.repeat} onChange={(e) => setPw({ ...pw, repeat: e.target.value })} placeholder="Neues Passwort wiederholen" autoComplete="new-password" aria-label="Wiederholen" />
              <button type="submit" className="os-btn os-btn--sm" disabled={!pw.current || pw.next.length < 12}>
                Ändern
              </button>
            </form>
          )}
        </Panel>
        <Panel title="Zwei-Faktor-Anmeldung (TOTP)" actions={sec.data ? <Badge tone={sec.data.twoFactor.enabled ? 'green' : 'slate'}>{sec.data.twoFactor.enabled ? 'aktiv' : 'aus'}</Badge> : null}>
          {!sec.data ? (
            <Loading />
          ) : sec.data.twoFactor.enabled ? (
            <>
              <p className="os-small">Aktiv seit {dateTime(sec.data.twoFactor.enabledAt)}. Bei Anmeldung und Entsperren wird zusätzlich der 6-stellige Code aus der Authenticator-App verlangt.</p>
              <div className="os-inline">
                <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="Code" aria-label="Code" />
                <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={code.length !== 6} onClick={async () => (await call('security/2fa/disable', { code }, 'Zwei-Faktor-Anmeldung abgeschaltet')) && setCode('')}>
                  Abschalten
                </button>
              </div>
            </>
          ) : setup ? (
            <>
              <p className="os-small">1. In der Authenticator-App (z. B. Google Authenticator, Microsoft Authenticator, 1Password) ein Konto hinzufügen – Schlüssel manuell eingeben:</p>
              <p className="os-mono os-break os-keybox">{setup.secret.replace(/(.{4})/g, '$1 ').trim()}</p>
              <p className="os-small">
                Auf dem Smartphone geht es auch per Link:{' '}
                <a className="os-link" href={setup.uri}>
                  in Authenticator öffnen
                </a>
              </p>
              <p className="os-small">2. Den angezeigten 6-stelligen Code eingeben:</p>
              <div className="os-inline">
                <input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" aria-label="Code" />
                <button
                  type="button"
                  className="os-btn os-btn--sm"
                  disabled={code.length !== 6}
                  onClick={async () => {
                    if (await call('security/2fa/enable', { code }, 'Zwei-Faktor-Anmeldung aktiviert')) {
                      setSetup(null);
                      setCode('');
                    }
                  }}
                >
                  Aktivieren
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="os-small">Zusätzliche Sicherheitsstufe: Neben dem Passwort wird ein zeitbasierter Code aus einer Authenticator-App verlangt.</p>
              <button type="button" className="os-btn os-btn--sm" onClick={async () => setSetup((await call('security/2fa/setup', {}, 'Schlüssel erzeugt')) as { secret: string; uri: string } | null)}>
                Einrichten
              </button>
            </>
          )}
        </Panel>
      </div>
      <Panel title="Aktive Sitzungen" actions={<button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void call('security/sessions/revoke-others', {}, 'Andere Sitzungen beendet')}>Alle anderen abmelden</button>}>
        {sec.data?.sessions.length ? (
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Gerät</th>
                <th scope="col">IP</th>
                <th scope="col">Angemeldet</th>
                <th scope="col">Zuletzt aktiv</th>
                <th scope="col" />
              </tr>
            </thead>
            <tbody>
              {sec.data.sessions.map((s) => (
                <tr key={s.id}>
                  <td className="os-small">
                    {browserName(s.user_agent)}
                    {s.current ? <Badge tone="green">diese Sitzung</Badge> : null}
                  </td>
                  <td className="os-mono os-small">{s.ip || '–'}</td>
                  <td>{dateTime(s.created_at)}</td>
                  <td>{dateTime(s.last_seen_at)}</td>
                  <td>
                    {!s.current ? (
                      <button type="button" className="os-linkbtn os-small" onClick={() => void call(`security/sessions/${s.id}/revoke`, {}, 'Sitzung beendet')}>
                        Abmelden
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="os-muted">Keine weiteren Sitzungen.</p>
        )}
      </Panel>
    </>
  );
}

function browserName(ua: string): string {
  if (!ua) return 'Unbekannt';
  const b = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const o = /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  return `${b}${o ? ` · ${o}` : ''}`;
}

/* ---------- Benutzer ---------- */

interface UsersData {
  users: { id: number; username: string; display_name: string; role: string; active: number; created_at: string; last_login_at: string; email: string; twoFactor: boolean; sessions: { n: number; last: string } | null }[];
  roles: { id: string; label: string; permissions: string[] }[];
  permissions: { id: string; label: string }[];
}

function Users() {
  const { data, error, loading, reload } = useOsData<UsersData>('users');
  const flash = useFlash();
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ username: '', displayName: '', role: 'sachbearbeitung', password: '', email: '' });
  const [pwFor, setPwFor] = useState<number | null>(null);
  const [newPw, setNewPw] = useState('');

  const call = async (path: string, body: unknown, ok: string) => {
    setBusy(true);
    try {
      await osFetch(path, { method: 'POST', body });
      flash.show(true, ok);
      await reload(true);
      return true;
    } catch (e) {
      flash.show(false, (e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const roleLabel = (r: string) => data.roles.find((x) => x.id === r)?.label ?? r;
  const assignable = data.roles.filter((r) => r.id !== 'inhaber');

  return (
    <>
      {flash.node}
      <Panel title={`Benutzer und Mitarbeiter (${data.users.length + 1})`}>
        <div className="os-tablewrap">
          <table className="os-table">
            <thead>
              <tr>
                <th scope="col">Benutzer</th>
                <th scope="col">Rolle</th>
                <th scope="col">E-Mail (Benachrichtigungen)</th>
                <th scope="col">Status</th>
                <th scope="col">Zuletzt</th>
                <th scope="col">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>
                  <strong>Inhaber</strong> <span className="os-muted os-mono">inhaber</span>
                </td>
                <td>{roleLabel('inhaber')}</td>
                <td className="os-muted os-small">Unternehmen → Benachrichtigungs-E-Mail</td>
                <td>
                  <Badge tone="green">aktiv</Badge>
                </td>
                <td className="os-muted">–</td>
                <td className="os-muted os-small">Passwort: Server-Geheimnis</td>
              </tr>
              {data.users.map((u) => (
                <tr key={u.id}>
                  <td>
                    <strong>{u.display_name}</strong> <span className="os-muted os-mono">{u.username}</span>
                    {u.twoFactor ? <Badge tone="green">2FA</Badge> : null}
                  </td>
                  <td>
                    <select className="os-select" value={u.role} disabled={busy} onChange={(e) => void call(`users/${u.id}`, { role: e.target.value }, `Rolle von ${u.username} geändert`)} aria-label={`Rolle von ${u.username}`}>
                      {assignable.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      type="email"
                      defaultValue={u.email}
                      placeholder="für E-Mail-Benachrichtigungen"
                      onBlur={(e) => e.target.value !== u.email && void call(`users/${u.id}`, { email: e.target.value }, 'E-Mail gespeichert')}
                      aria-label={`E-Mail von ${u.username}`}
                    />
                  </td>
                  <td>
                    <Badge tone={u.active ? 'green' : 'slate'}>{u.active ? 'aktiv' : 'deaktiviert'}</Badge>
                    {u.sessions ? <span className="os-muted os-small"> · {u.sessions.n} Sitzung(en)</span> : null}
                  </td>
                  <td>{u.last_login_at ? dateTime(u.last_login_at) : <span className="os-muted">nie</span>}</td>
                  <td>
                    <div className="os-row os-row--tight">
                      <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void call(`users/${u.id}`, { active: !u.active }, u.active ? `${u.username} deaktiviert` : `${u.username} aktiviert`)}>
                        {u.active ? 'Deaktivieren' : 'Aktivieren'}
                      </button>
                      <button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => (setPwFor(pwFor === u.id ? null : u.id), setNewPw(''))}>
                        Passwort
                      </button>
                      {u.sessions ? (
                        <button type="button" className="os-btn os-btn--ghost os-btn--sm" disabled={busy} onClick={() => void call(`users/${u.id}`, { revokeSessions: true }, 'Sitzungen beendet')}>
                          Abmelden
                        </button>
                      ) : null}
                      {u.twoFactor ? (
                        <button
                          type="button"
                          className="os-btn os-btn--ghost os-btn--sm"
                          disabled={busy}
                          onClick={() => window.confirm(`Zwei-Faktor für ${u.username} zurücksetzen (z. B. Gerät verloren)? Alle Sitzungen werden beendet.`) && void call(`users/${u.id}`, { resetTwoFactor: true }, 'Zwei-Faktor zurückgesetzt')}
                        >
                          2FA zurücksetzen
                        </button>
                      ) : null}
                    </div>
                    {pwFor === u.id ? (
                      <form
                        className="os-inline os-inline--tight"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          if (await call(`users/${u.id}`, { password: newPw }, `Passwort von ${u.username} geändert – Sitzungen beendet`)) {
                            setPwFor(null);
                            setNewPw('');
                          }
                        }}
                      >
                        <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="Neues Passwort" autoComplete="new-password" aria-label="Neues Passwort" />
                        <button type="submit" className="os-btn os-btn--sm" disabled={busy || newPw.length < 12}>
                          Setzen
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="os-muted os-small">Rollen-, Status- und Passwortänderungen beenden laufende Sitzungen sofort. Aktivitäten stehen im Protokoll (Sicherheit).</p>
      </Panel>
      <Panel title="Neuer Benutzer">
        <form
          className="os-form os-form--grid"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await call('users', form, `Benutzer ${form.username} angelegt`)) setForm({ username: '', displayName: '', role: 'sachbearbeitung', password: '', email: '' });
          }}
        >
          <Field label="Benutzername" hint="3–32 Zeichen: a–z, 0–9, . _ -">
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} required autoComplete="off" spellCheck={false} />
          </Field>
          <Field label="Anzeigename">
            <input value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
          </Field>
          <Field label="E-Mail (optional)">
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Rolle">
            <select className="os-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              {assignable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Startpasswort" hint="mind. 12 Zeichen, 3 von: Groß, klein, Ziffer, Sonderzeichen">
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="new-password" />
          </Field>
          <button type="submit" className="os-btn" disabled={busy}>
            Anlegen
          </button>
        </form>
      </Panel>
      <Panel title="Rollen und Rechte">
        <div className="os-tablewrap">
          <table className="os-table os-table--matrix">
            <thead>
              <tr>
                <th scope="col">Recht</th>
                {data.roles.map((r) => (
                  <th key={r.id} scope="col">
                    {r.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.permissions.map((p) => (
                <tr key={p.id}>
                  <th scope="row">{p.label}</th>
                  {data.roles.map((r) => (
                    <td key={r.id} className="center">
                      {r.permissions.includes(p.id) ? <span className="os-yes" aria-label="ja">●</span> : <span className="os-no" aria-label="nein">–</span>}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="os-muted os-small">Jeder Mitarbeiter sieht nur die Programme und Daten, für die seine Rolle berechtigt ist – geprüft auf dem Server bei jeder Anfrage.</p>
      </Panel>
    </>
  );
}

/* ---------- Unternehmen ---------- */

interface CompanyData {
  company: Record<string, string | number>;
  missing: string[];
  canManage: boolean;
}

function Company() {
  const { data, loading, reload } = useOsData<CompanyData>('company');
  const [c, setC] = useState<Record<string, string | number>>({});
  const flash = useFlash();
  useEffect(() => {
    if (data) setC(data.company);
  }, [data]);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const ro = !data.canManage;
  const f = (k: string, label: string, opts: { type?: string; wide?: boolean } = {}) => (
    <label className={`os-field${opts.wide ? ' os-field--wide' : ''}`}>
      <span className="os-field__label">{label}</span>
      <input type={opts.type ?? 'text'} value={String(c[k] ?? '')} onChange={(e) => setC({ ...c, [k]: opts.type === 'number' ? Number(e.target.value) : e.target.value })} disabled={ro} />
    </label>
  );
  return (
    <>
      {flash.node}
      {data.missing.length ? <p className="os-flash is-error">Für Rechnungen fehlen: {data.missing.join(', ')}.</p> : <p className="os-ok-line">Angaben für ordnungsgemäße Rechnungen vollständig.</p>}
      <Panel title="Unternehmensdaten">
        <div className="os-fields os-fields--3">
          {f('name', 'Firmenname inkl. Rechtsform', { wide: true })}
          {f('owner', 'Vertretungsberechtigt')}
          {f('street', 'Straße und Nr.')}
          {f('zip', 'PLZ')}
          {f('city', 'Ort')}
          {f('phone', 'Telefon')}
          {f('email', 'E-Mail')}
          {f('web', 'Website')}
          {f('register', 'Registergericht und -nummer')}
          {f('taxNumber', 'Steuernummer')}
          {f('vatId', 'USt-IdNr.')}
        </div>
      </Panel>
      <Panel title="Steuer und Rechnung">
        <div className="os-fields os-fields--3">
          <label className="os-field">
            <span className="os-field__label">Besteuerung</span>
            <select className="os-select" value={String(c.taxMode ?? 'regel')} onChange={(e) => setC({ ...c, taxMode: e.target.value })} disabled={ro}>
              <option value="regel">Regelbesteuerung (USt ausweisen)</option>
              <option value="kleinunternehmer">Kleinunternehmer § 19 UStG</option>
            </select>
          </label>
          {f('vatRate', 'USt-Satz (%)', { type: 'number' })}
          {f('paymentTermDays', 'Zahlungsziel (Tage)', { type: 'number' })}
          {f('invoicePrefix', 'Präfix Rechnungen')}
          {f('creditPrefix', 'Präfix Gutschriften')}
          {f('bankName', 'Bank')}
          {f('iban', 'IBAN')}
          {f('bic', 'BIC')}
          <label className="os-field os-field--wide">
            <span className="os-field__label">Fußzeile der Rechnung</span>
            <textarea rows={2} value={String(c.invoiceFooter ?? '')} onChange={(e) => setC({ ...c, invoiceFooter: e.target.value })} disabled={ro} />
          </label>
        </div>
        <p className="os-muted os-small">Amtliche Gebühren werden als durchlaufende Posten behandelt und sind nicht Teil der Servicepreise. Steuerliche Behandlung bitte mit der Steuerberatung abstimmen.</p>
      </Panel>
      <Panel title="E-Mail, Geschäftszeiten, Zahlungen, Dokumente">
        <div className="os-fields os-fields--3">
          {f('mailFromName', 'Absendername')}
          {f('replyTo', 'Antwort-Adresse (Reply-To)', { type: 'email' })}
          {f('notifyEmail', 'Benachrichtigungs-E-Mail des Inhabers', { type: 'email' })}
          <label className="os-field os-field--wide">
            <span className="os-field__label">Geschäftszeiten</span>
            <textarea rows={2} value={String(c.businessHours ?? '')} onChange={(e) => setC({ ...c, businessHours: e.target.value })} disabled={ro} />
          </label>
          {f('docReviewDays', 'Dokumente erneut prüfen nach (Tage, 0 = nie)', { type: 'number' })}
        </div>
        <p className="os-muted os-small">Der technische Absender (MAIL_FROM) und alle Schlüssel liegen ausschließlich als Server-Geheimnisse vor.</p>
      </Panel>
      {!ro ? (
        <button
          type="button"
          className="os-btn"
          onClick={async () => {
            try {
              await osFetch('company', { method: 'POST', body: c });
              flash.show(true, 'Unternehmensdaten gespeichert');
              void reload(true);
            } catch (e) {
              flash.show(false, (e as Error).message);
            }
          }}
        >
          Speichern
        </button>
      ) : null}
    </>
  );
}

/* ---------- Design ---------- */

function Design() {
  const { theme, setTheme, wallpaper, setWallpaper, desktop, setDesktop } = useOs();
  return (
    <>
      <Panel title="Farbmodus">
        <div className="os-row">
          <button type="button" className={`os-choice${theme === 'light' ? ' is-sel' : ''}`} onClick={() => setTheme('light')} aria-pressed={theme === 'light'}>
            <ISun width={18} height={18} /> Hell
          </button>
          <button type="button" className={`os-choice${theme === 'dark' ? ' is-sel' : ''}`} onClick={() => setTheme('dark')} aria-pressed={theme === 'dark'}>
            <IMoon width={18} height={18} /> Dunkel
          </button>
        </div>
      </Panel>
      <Panel title="Akzentfarbe">
        <div className="os-accents">
          {Object.entries(ACCENTS).map(([id, a]) => (
            <button key={id} type="button" className={desktop.accent === id ? 'is-sel' : ''} style={{ background: a.color }} onClick={() => setDesktop({ accent: id })} aria-label={a.label} aria-pressed={desktop.accent === id} title={a.label} />
          ))}
        </div>
      </Panel>
      <Panel title="Hintergrund">
        <ul className="os-wallpicks" role="list">
          {WALLPAPER_NAMES.map((name, i) => (
            <li key={name}>
              <button type="button" className={`os-wallpick${wallpaper === i ? ' is-sel' : ''}`} onClick={() => setWallpaper(i)} aria-pressed={wallpaper === i}>
                <span className={`os-wallpick__img os--wp${i}`} aria-hidden="true" />
                <span>{name}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Symbole und Fenster">
        <div className="os-fields os-fields--2">
          <label className="os-field">
            <span className="os-field__label">Größe der Desktop-Symbole</span>
            <Chips
              value={(desktop.iconSize as string) ?? 'mittel'}
              onChange={(v) => setDesktop({ iconSize: v })}
              options={[
                { id: 'klein', label: 'Klein' },
                { id: 'mittel', label: 'Mittel' },
                { id: 'gross', label: 'Groß' },
              ]}
            />
          </label>
          <label className="os-field">
            <span className="os-field__label">Fenster beim Ziehen an den Rand einrasten</span>
            <Chips
              value={desktop.snap === false ? 'aus' : 'an'}
              onChange={(v) => setDesktop({ snap: v === 'an' })}
              options={[
                { id: 'an', label: 'An' },
                { id: 'aus', label: 'Aus' },
              ]}
            />
          </label>
          <label className="os-field">
            <span className="os-field__label">Programme öffnen</span>
            <Chips
              value={desktop.openMaximized ? 'max' : 'normal'}
              onChange={(v) => setDesktop({ openMaximized: v === 'max' })}
              options={[
                { id: 'normal', label: 'Als Fenster' },
                { id: 'max', label: 'Maximiert' },
              ]}
            />
          </label>
        </div>
        <p className="os-muted os-small">Einstellungen werden pro Benutzer auf dem Server gespeichert und gelten auf jedem Gerät.</p>
      </Panel>
    </>
  );
}

/* ---------- Benachrichtigungen ---------- */

function NotifyPrefs() {
  const { session, can } = useOs();
  const prefs = useOsData<{ notify: { toast: Record<string, boolean>; email: Record<string, boolean>; browser: boolean } }>('prefs');
  const [p, setP] = useState<{ toast: Record<string, boolean>; email: Record<string, boolean>; browser: boolean }>({ toast: {}, email: {}, browser: false });
  const [perm, setPerm] = useState<string>('default');
  const flash = useFlash();
  useEffect(() => {
    if (prefs.data) setP(prefs.data.notify);
    if (typeof Notification !== 'undefined') setPerm(Notification.permission);
  }, [prefs.data]);
  const save = async (next: typeof p) => {
    setP(next);
    try {
      await osFetch('prefs', { method: 'POST', body: { notify: next } });
      window.dispatchEvent(new CustomEvent('os:prefs', { detail: { notify: next } }));
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };
  const visible = NOTIFY_KINDS.filter((k) => can(NOTIFY_META[k].permission));
  return (
    <>
      {flash.node}
      <Panel title="Benachrichtigungen je Ereignis">
        <table className="os-table">
          <thead>
            <tr>
              <th scope="col">Ereignis</th>
              <th scope="col">Priorität</th>
              <th scope="col" className="center">
                Hinweis am Desktop
              </th>
              <th scope="col" className="center">
                E-Mail
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((k) => (
              <tr key={k}>
                <th scope="row">{NOTIFY_META[k].label}</th>
                <td>{NOTIFY_META[k].priority}</td>
                <td className="center">
                  <input type="checkbox" checked={p.toast[k] ?? true} onChange={(e) => void save({ ...p, toast: { ...p.toast, [k]: e.target.checked } })} aria-label={`${NOTIFY_META[k].label} am Desktop`} />
                </td>
                <td className="center">
                  <input type="checkbox" checked={p.email[k] ?? false} onChange={(e) => void save({ ...p, email: { ...p.email, [k]: e.target.checked } })} aria-label={`${NOTIFY_META[k].label} per E-Mail`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="os-muted os-small">
          E-Mails gehen an {session.user.id === 0 ? 'die Benachrichtigungs-E-Mail aus Unternehmen' : 'die in Benutzer hinterlegte E-Mail'} – nur wenn der E-Mail-Versand eingerichtet ist. Das
          Benachrichtigungscenter speichert immer alles; Wiederholungen derselben Meldung werden nie doppelt angezeigt.
        </p>
      </Panel>
      <Panel title="Browser-Benachrichtigungen">
        <p className="os-small">Kritische Meldungen (z. B. abgelehnte Zulassung, Webhook-Fehler) zusätzlich als Systemmeldung des Browsers, auch wenn das Fenster im Hintergrund ist – nur mit Ihrer Zustimmung im Browser.</p>
        <div className="os-row">
          <label className="os-check-field">
            <input
              type="checkbox"
              checked={p.browser}
              onChange={async (e) => {
                if (e.target.checked && typeof Notification !== 'undefined' && Notification.permission !== 'granted') {
                  const r = await Notification.requestPermission();
                  setPerm(r);
                  if (r !== 'granted') return flash.show(false, 'Der Browser hat die Erlaubnis nicht erteilt');
                }
                void save({ ...p, browser: e.target.checked });
              }}
            />{' '}
            Aktiv
          </label>
          <span className="os-muted os-small">Browser-Erlaubnis: {perm === 'granted' ? 'erteilt' : perm === 'denied' ? 'abgelehnt (in den Browser-Einstellungen ändern)' : 'noch nicht gefragt'}</span>
        </div>
      </Panel>
    </>
  );
}

/* ---------- Sicherheit ---------- */

interface SettingsData {
  lockMinutes: number;
  lockRange: { min: number; max: number };
  canManage: boolean;
  system: { platform: string; database: string; uploads: string; publicUrl: string; kfzWebhook: boolean; kfzApi: boolean; mail: boolean; payments: boolean; stripeWebhook: boolean; plateAvailability: boolean };
}

interface AuditRow {
  id: number;
  at: string;
  username: string;
  action: string;
  target: string;
  detail: string;
  ip: string;
}

function Security() {
  const { can } = useOs();
  const settings = useOsData<SettingsData>('settings');
  const [user, setUser] = useState('');
  const auditLog = useOsData<AuditRow[]>(can('audit.read') ? `audit${user ? `?user=${encodeURIComponent(user)}` : ''}` : null);
  const [minutes, setMinutes] = useState<number | null>(null);
  const [q, setQ] = useState('');
  const flash = useFlash();
  const s = settings.data;
  const value = minutes ?? s?.lockMinutes ?? 15;
  return (
    <>
      {flash.node}
      <Panel title="Inaktivitätssperre und Sitzungsschutz">
        {s ? (
          <form
            className="os-inline"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await osFetch('settings', { method: 'POST', body: { lockMinutes: value } });
                flash.show(true, `Sperre nach ${value} Minuten`);
                await settings.reload(true);
              } catch (err) {
                flash.show(false, (err as Error).message);
              }
            }}
          >
            <label className="os-field os-field--inline">
              <span className="os-field__label">Sperren nach Inaktivität (Minuten)</span>
              <input type="number" min={s.lockRange.min} max={s.lockRange.max} value={value} onChange={(e) => setMinutes(Number(e.target.value))} disabled={!s.canManage} />
            </label>
            {s.canManage ? (
              <button type="submit" className="os-btn os-btn--sm" disabled={value === s.lockMinutes}>
                Speichern
              </button>
            ) : null}
          </form>
        ) : (
          <Loading />
        )}
        <ul className="os-plain os-small">
          <li>• Sitzung nur per HttpOnly-Cookie (SameSite=Strict), signiert, serverseitig registriert und einzeln widerrufbar, höchstens 12 Stunden.</li>
          <li>• Inaktive Sitzungen laufen auf dem Server ab; der Bildschirm sperrt sich zusätzlich im Browser.</li>
          <li>• Änderungen nur von dieser Seite (Herkunftsprüfung, CSRF-Schutz), Anmeldeversuche begrenzt, optional Zwei-Faktor (Konto).</li>
          <li>• Berechtigungen werden bei jeder Anfrage auf dem Server geprüft; Dokumente nur über geschützte Adressen, jeder Abruf protokolliert.</li>
        </ul>
      </Panel>
      {can('audit.read') ? (
        <Panel
          title="Protokoll (Audit)"
          actions={
            <span className="os-row">
              <UserFilter value={user} onChange={setUser} />
              <input className="os-input-sm" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtern" aria-label="Protokoll filtern" />
            </span>
          }
        >
          {auditLog.loading && !auditLog.data ? (
            <Loading />
          ) : auditLog.data?.length ? (
            <div className="os-tablewrap">
              <table className="os-table os-table--compact">
                <thead>
                  <tr>
                    <th scope="col">Zeit</th>
                    <th scope="col">Benutzer</th>
                    <th scope="col">Aktion</th>
                    <th scope="col">Ziel</th>
                    <th scope="col">Details</th>
                    <th scope="col">IP</th>
                  </tr>
                </thead>
                <tbody>
                  {auditLog.data
                    .filter((r) => !q || `${r.username} ${r.action} ${r.target} ${r.detail}`.toLowerCase().includes(q.toLowerCase()))
                    .map((r) => (
                      <tr key={r.id}>
                        <td>{dateTime(r.at)}</td>
                        <td>{r.username}</td>
                        <td>
                          <Badge tone={r.action.includes('fehlgeschlagen') ? 'red' : r.action.startsWith('dokument') || r.action.startsWith('dsgvo') ? 'violet' : 'slate'}>{r.action}</Badge>
                        </td>
                        <td className="os-mono os-small">{r.target}</td>
                        <td className="os-small">{r.detail}</td>
                        <td className="os-mono os-small">{r.ip}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty title="Noch keine Einträge" />
          )}
        </Panel>
      ) : null}
    </>
  );
}

function UserFilter({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const staff = useOsData<{ id: number; name: string }[]>('staff');
  const users = useOsData<UsersData>(useOs().can('users.manage') ? 'users' : null);
  return (
    <select className="os-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Benutzer">
      <option value="">Alle Benutzer</option>
      <option value="inhaber">Inhaber</option>
      {(users.data?.users ?? []).map((u) => (
        <option key={u.id} value={u.username}>
          {u.display_name}
        </option>
      ))}
      {!users.data && staff.data ? null : null}
    </select>
  );
}

/* ---------- Automatisierungen ---------- */

interface Rule {
  id: string;
  title: string;
  description: string;
  trigger: string[] | 'zeitgesteuert';
  safety: string;
  params: { key: string; label: string; type: 'number' | 'user'; default: number | null; min?: number; max?: number }[];
  enabled: boolean;
  values: Record<string, number | null>;
  runs: number;
  errors: number;
  lastRun: string | null;
}

function Automation() {
  const { openApp } = useOs();
  const staff = useStaff();
  const { data, loading, reload } = useOsData<{ rules: Rule[]; canManage: boolean }>('automation');
  const runs = useOsData<{ id: number; rule_id: string; at: string; order_id: number | null; number: string | null; result: string; detail: string }[]>('automation/runs');
  const [vals, setVals] = useState<Record<string, Record<string, number | null>>>({});
  const flash = useFlash();
  useEffect(() => {
    if (data) setVals(Object.fromEntries(data.rules.map((r) => [r.id, r.values])));
  }, [data]);
  if (loading && !data) return <Loading />;
  if (!data) return null;
  const save = async (r: Rule, enabled: boolean) => {
    try {
      await osFetch(`automation/${r.id}`, { method: 'POST', body: { enabled, values: vals[r.id] ?? r.values } });
      flash.show(true, `„${r.title}“ ${enabled ? 'aktiv' : 'aus'}`);
      void reload(true);
    } catch (e) {
      flash.show(false, (e as Error).message);
    }
  };
  return (
    <>
      {flash.node}
      <Panel
        title="Regeln"
        actions={
          data.canManage ? (
            <button
              type="button"
              className="os-btn os-btn--ghost os-btn--sm"
              onClick={async () => {
                const r = await osFetch<{ cases: number }>('automation/scan', { method: 'POST', body: {} }).catch((e: Error) => (flash.show(false, e.message), null));
                if (r) flash.show(true, `Zeitgesteuerte Regeln geprüft: ${r.cases} Fall/Fälle`);
                void runs.reload(true);
              }}
            >
              Zeitregeln jetzt prüfen
            </button>
          ) : null
        }
      >
        <p className="os-muted os-small">
          Jede Regel läuft je Auslöser höchstens einmal (Protokoll unten). Keine Regel übermittelt Anträge, versendet Kunden-E-Mails oder löst Kosten aus. Zeitgesteuerte Regeln laufen
          höchstens alle 5 Minuten, sobald jemand angemeldet ist.
        </p>
        <ul className="os-rules" role="list">
          {data.rules.map((r) => (
            <li key={r.id} className={r.enabled ? 'is-on' : ''}>
              <div className="os-rules__head">
                <label className="os-switch">
                  <input type="checkbox" checked={r.enabled} disabled={!data.canManage} onChange={(e) => void save(r, e.target.checked)} />
                  <span aria-hidden="true" />
                  <strong>{r.title}</strong>
                </label>
                <span className="os-muted os-small">
                  {r.trigger === 'zeitgesteuert' ? 'zeitgesteuert' : `bei ${r.trigger.join(', ')}`} · {r.runs} Mal ausgeführt
                  {r.errors ? <span className="os-overdue"> · {r.errors} Fehler</span> : null}
                  {r.lastRun ? ` · zuletzt ${dateTime(r.lastRun)}` : ''}
                </span>
              </div>
              <p className="os-small">{r.description}</p>
              <p className="os-muted os-small">Sicherheit: {r.safety}</p>
              {r.params.length ? (
                <div className="os-inline">
                  {r.params.map((p) => (
                    <label key={p.key} className="os-field os-field--inline">
                      <span className="os-field__label">{p.label}</span>
                      {p.type === 'user' ? (
                        <select
                          className="os-select"
                          value={vals[r.id]?.[p.key] ?? ''}
                          disabled={!data.canManage}
                          onChange={(e) => setVals({ ...vals, [r.id]: { ...vals[r.id], [p.key]: e.target.value === '' ? null : Number(e.target.value) } })}
                        >
                          <option value="">– niemand –</option>
                          {staff.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input type="number" min={p.min} max={p.max} value={vals[r.id]?.[p.key] ?? ''} disabled={!data.canManage} onChange={(e) => setVals({ ...vals, [r.id]: { ...vals[r.id], [p.key]: e.target.value === '' ? null : Number(e.target.value) } })} />
                      )}
                    </label>
                  ))}
                  {data.canManage ? (
                    <button type="button" className="os-btn os-btn--sm" onClick={() => void save(r, r.enabled)}>
                      Übernehmen
                    </button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="Ereignisprotokoll der Automatisierungen">
        {runs.data?.length ? (
          <table className="os-table os-table--compact">
            <thead>
              <tr>
                <th scope="col">Zeit</th>
                <th scope="col">Regel</th>
                <th scope="col">Auftrag</th>
                <th scope="col">Ergebnis</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {runs.data.map((r) => (
                <tr key={r.id}>
                  <td>{dateTime(r.at)}</td>
                  <td>{data.rules.find((x) => x.id === r.rule_id)?.title ?? r.rule_id}</td>
                  <td>
                    {r.order_id ? (
                      <button type="button" className="os-linkbtn os-mono" onClick={() => openApp('orders', { orderId: r.order_id })}>
                        {r.number}
                      </button>
                    ) : (
                      '–'
                    )}
                  </td>
                  <td>
                    <Badge tone={r.result === 'ausgeführt' ? 'green' : r.result === 'fehler' ? 'red' : 'slate'}>{r.result}</Badge>
                  </td>
                  <td className="os-small">{r.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="os-muted">Noch keine Läufe.</p>
        )}
        <p className="os-muted os-small">Zuständige: {staff.length ? staff.map((s) => staffName(staff, s.id)).join(', ') : '–'}</p>
      </Panel>
    </>
  );
}

/* ---------- Integrationen ---------- */

function Integrations() {
  const { data } = useOsData<SettingsData>('settings');
  if (!data) return <Loading />;
  const s = data.system;
  const row = (label: string, ok: boolean, text: string, how: string) => (
    <tr>
      <th scope="row">{label}</th>
      <td>
        <Badge tone={ok ? 'green' : 'amber'}>{ok ? 'eingerichtet' : 'nicht eingerichtet'}</Badge>
      </td>
      <td className="os-small">{text}</td>
      <td className="os-small os-mono">{how}</td>
    </tr>
  );
  return (
    <Panel title="Integrationen">
      <table className="os-table">
        <thead>
          <tr>
            <th scope="col">Schnittstelle</th>
            <th scope="col">Status</th>
            <th scope="col">Zweck</th>
            <th scope="col">Einrichtung (Server-Geheimnis)</th>
          </tr>
        </thead>
        <tbody>
          {row('KFZ-API Webhook', s.kfzWebhook, 'Statusmeldungen von kfz-api.de empfangen (signiert)', 'KFZ_API_WEBHOOK_SECRET')}
          {row('KFZ-API Zugang', s.kfzApi, 'Belege abrufen, Verbindungstest (nur lesend)', 'KFZ_API_BASE_URL, KFZ_API_LOGIN, KFZ_API_PASSWORD')}
          {row('Zahlungsanbieter (Stripe)', s.payments, 'Bezahlseite, Gebühren als Ist-Wert', 'STRIPE_SECRET_KEY')}
          {row('Stripe-Webhook', s.stripeWebhook, 'Zahlungseingang automatisch buchen', 'STRIPE_WEBHOOK_SECRET')}
          {row('E-Mail-Versand', s.mail, 'Kunden- und Mitarbeiter-E-Mails', 'RESEND_API_KEY, MAIL_FROM')}
          {row('Wunschkennzeichen-Prüfung', s.plateAvailability, 'Verfügbarkeit prüfen', 'PLATE_AVAILABILITY_URL')}
        </tbody>
      </table>
      <p className="os-muted os-small">
        Geheimnisse werden nur auf dem Server gespeichert (Cloudflare: <code>npx wrangler secret put NAME</code>) und hier nie angezeigt. Weitere Schnittstellen werden auf demselben Weg ergänzt.
      </p>
    </Panel>
  );
}

/* ---------- System ---------- */

function SystemStatus() {
  const { can } = useOs();
  const { data, error, loading, reload } = useOsData<SettingsData>('settings');
  const diag = useOsData<{
    database: { ok: boolean; ms: number; schema: number; expected: number; counts: Record<string, number> };
    storage: { ok: boolean; ms: number; error?: string };
    cloudflare: { worker: boolean; d1Binding: boolean; r2Binding: boolean };
    runtime: { node: string; at: string };
  }>(can('settings.manage') ? 'system/diagnose' : null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox message={error} onRetry={() => void reload()} />;
  if (!data) return null;
  const s = data.system;
  const row = (label: string, ok: boolean, text: string) => (
    <li className={`os-status__row is-${ok ? 'ok' : 'warn'}`}>
      <span className="os-status__dot" aria-hidden="true" />
      <span className="os-status__label">{label}</span>
      <span className="os-status__text">{text}</span>
    </li>
  );
  return (
    <>
      <Panel title="System">
        <ul className="os-status" role="list">
          {row('Plattform', true, s.platform)}
          {row('Datenbank', !s.database.startsWith('nicht'), s.database)}
          {row('Dateispeicher', !s.uploads.startsWith('nicht'), s.uploads)}
          {row('Öffentliche Adresse', true, s.publicUrl || 'Standard (easykfz24.de)')}
        </ul>
      </Panel>
      {can('settings.manage') ? (
        <Panel title="Diagnose" actions={<button type="button" className="os-btn os-btn--ghost os-btn--sm" onClick={() => void diag.reload()}>Erneut prüfen</button>}>
          {diag.data ? (
            <ul className="os-status" role="list">
              {row('Datenbank', diag.data.database.ok, `${diag.data.database.ms} ms · Schema v${diag.data.database.schema} von v${diag.data.database.expected}`)}
              {row('Datenbestand', true, Object.entries(diag.data.database.counts).map(([k, v]) => `${k} ${v}`).join(' · '))}
              {row('Speicher-Test (schreiben/lesen/löschen)', diag.data.storage.ok, `${diag.data.storage.ms} ms${diag.data.storage.error ? ` · ${diag.data.storage.error}` : ''}`)}
              {row('Cloudflare', diag.data.cloudflare.worker || !diag.data.cloudflare.worker, diag.data.cloudflare.worker ? `Worker · D1 ${diag.data.cloudflare.d1Binding ? 'gebunden' : 'fehlt'} · R2 ${diag.data.cloudflare.r2Binding ? 'gebunden' : 'fehlt'}` : 'lokal (kein Worker)')}
            </ul>
          ) : (
            <Loading />
          )}
        </Panel>
      ) : null}
    </>
  );
}
