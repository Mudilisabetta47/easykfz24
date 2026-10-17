'use client';

// Automatische Übermittlung an kfz-api.de (Phase 1: Außerbetriebsetzung) in der Auftragsakte: Sicherheitscodes nur schreibend
// erfassen, Vorschau mit Kosten und Hinweisen, ausdrückliche Bestätigung, Senden, Klären einer ungewissen Übermittlung.
// Der manuelle Weg (Partner-Dashboard + Verknüpfen) bleibt daneben bestehen.

import { Fragment, useEffect, useState } from 'react';
import { dateTime, OsError, osFetch } from '../api.ts';
import { Badge, Panel } from '../ui.tsx';
import { euroCents } from '../../../lib/kfz-deregistration.ts';
import type { SubmissionPanel, SubmissionView, SubmitPreview } from '../../../server/kfz-submission.ts';

type Done = (ok: boolean, text: string) => Promise<void>;

const TONE: Record<SubmissionView['state'], string> = {
  sendet: 'violet',
  angenommen: 'green',
  ungewiss: 'red',
  konflikt: 'red',
  abgewiesen: 'amber',
  nicht_angelegt: 'slate',
};

export function KfzSubmissionPanel({
  orderId,
  orderNumber,
  panel,
  released,
  linkedManually,
  canKfz,
  done,
}: {
  orderId: number;
  orderNumber: string;
  panel: SubmissionPanel;
  released: boolean;
  linkedManually: boolean;
  canKfz: boolean;
  done: Done;
}) {
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const last = panel.submissions[0] ?? null;
  const open = last && ['sendet', 'ungewiss', 'konflikt'].includes(last.state);
  const accepted = last?.state === 'angenommen';
  const t = panel.test;
  const modeOk = panel.mode === 'aktiv' || (panel.mode === 'test' && !!t.release?.active);
  const canSend = canKfz && panel.eligible && modeOk && released && !linkedManually && panel.codes.present && panel.codes.readable && !open && !accepted;

  const run = async (path: string, success: string, body: Record<string, unknown> = {}, confirmText?: string) => {
    if (confirmText && !window.confirm(confirmText)) return;
    setBusy(true);
    try {
      await osFetch(`orders/${orderId}/uebermittlung${path}`, { method: 'POST', body });
      await done(true, success);
    } catch (e) {
      await done(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="Automatische Übermittlung (Abmeldung)"
      actions={
        last ? (
          <Badge tone={TONE[last.state]}>{last.label}</Badge>
        ) : (
          <Badge tone="slate">{panel.mode === 'aus' ? 'ausgeschaltet' : panel.mode === 'test' ? 'Testmodus' : 'bereit'}</Badge>
        )
      }
    >
      {panel.mode === 'aus' ? (
        <p className="os-muted os-small">{panel.offReason}</p>
      ) : !panel.eligible ? (
        <p className="os-muted os-small">Testauftrag – wird nie an Partner oder Behörde übermittelt.</p>
      ) : (
        <>
          {panel.mode === 'test' ? <SubmitTestRelease orderNumber={orderNumber} panel={panel} busy={busy} run={run} /> : null}
          {last ? (
            <dl className="os-dl os-small">
              <dt>Referenz</dt>
              <dd className="os-mono">{last.externalOrderId}</dd>
              <dt>Vorgang beim Partner</dt>
              <dd className="os-mono">{last.kfzOrderId || '–'}</dd>
              <dt>Gesendet</dt>
              <dd>
                {last.sentAt ? dateTime(last.sentAt) : '–'} von {last.confirmedBy || '–'}
                {last.mode === 'test' ? ' (Testmodus)' : ''}
              </dd>
              {last.httpStatus !== null || last.traceId ? (
                <>
                  <dt>Antwort</dt>
                  <dd>
                    {last.httpStatus ?? 'keine'}
                    {last.traceId ? <span className="os-mono"> · Trace {last.traceId}</span> : null}
                  </dd>
                </>
              ) : null}
              {last.error ? (
                <>
                  <dt>Meldung</dt>
                  <dd>{last.error}</dd>
                </>
              ) : null}
            </dl>
          ) : null}
          {open && canKfz ? (
            <div className="poa-test">
              <p className="os-small">
                <strong>Nicht erneut senden.</strong> Ob der Antrag angelegt wurde, ist offen. „Stand klären“ fragt beim Partner die eigenen Aufträge exakt nach
                der Referenz ab (lesend, kostenlos).
              </p>
              <div className="os-row">
                <button type="button" className="os-btn" disabled={busy || last?.state === 'sendet'} onClick={() => void run('/klaeren', 'Stand geklärt')}>
                  Stand klären
                </button>
              </div>
            </div>
          ) : null}
          {accepted ? (
            <p className="os-muted os-small">
              Übermittelt. Weitere Statusmeldungen kommen über den Webhook; fehlt eine Meldung, kann der Stand in der Registerkarte KFZ-API abgefragt werden.
            </p>
          ) : null}
          {!accepted && !open ? (
            <>
              <CodesForm orderId={orderId} panel={panel} canKfz={canKfz} done={done} />
              {!released ? <p className="os-muted os-small">Senden erst nach „Zur Übermittlung freigeben“.</p> : null}
              {linkedManually ? <p className="os-muted os-small">Bereits manuell mit einem Vorgang verknüpft – keine automatische Übermittlung.</p> : null}
              {confirming ? (
                <SubmitConfirm
                  orderId={orderId}
                  onCancel={() => setConfirming(false)}
                  onDone={async (ok, text) => {
                    setConfirming(false);
                    await done(ok, text);
                  }}
                />
              ) : canSend ? (
                <div className="os-row">
                  <button type="button" className="os-btn" disabled={busy} onClick={() => setConfirming(true)}>
                    Vorschau für die Übermittlung
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </>
      )}
    </Panel>
  );
}

/** Codes nur schreibend erfassen: Die Felder werden nach dem Speichern geleert, angezeigt wird nur der Status */
function CodesForm({ orderId, panel, canKfz, done }: { orderId: number; panel: SubmissionPanel; canKfz: boolean; done: Done }) {
  const [plates, setPlates] = useState<1 | 2>(panel.codes.plates ?? panel.defaultPlates);
  const [zb1, setZb1] = useState('');
  const [rear, setRear] = useState('');
  const [front, setFront] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(!panel.codes.present);
  const c = panel.codes;
  const save = async () => {
    setBusy(true);
    try {
      await osFetch(`orders/${orderId}/uebermittlung/codes`, { method: 'POST', body: { zb1, rear, front: plates === 2 ? front : '', plates } });
      setZb1('');
      setRear('');
      setFront('');
      setFields({});
      setEditing(false);
      await done(true, 'Sicherheitscodes verschlüsselt gespeichert');
    } catch (e) {
      const d = e instanceof OsError ? e.data : {};
      setFields(d.fields && typeof d.fields === 'object' ? (d.fields as Record<string, string>) : {});
      await done(false, (e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const input = (label: string, key: string, value: string, set: (v: string) => void, len: number) => (
    <label className="os-field">
      <span>{label}</span>
      <input
        className="os-mono"
        value={value}
        onChange={(e) => set(e.target.value.replace(/\s/g, ''))}
        maxLength={len}
        autoComplete="off"
        spellCheck={false}
        data-1p-ignore="true"
        data-lpignore="true"
        aria-invalid={!!fields[key]}
      />
      {fields[key] ? <small className="os-field__error">{fields[key]}</small> : null}
    </label>
  );
  return (
    <div className="os-stack">
      <p className="os-small">
        <strong>Sicherheitscodes:</strong>{' '}
        {c.present
          ? c.readable
            ? `verschlüsselt erfasst am ${dateTime(c.createdAt)} von ${c.createdBy} (${c.plates === 1 ? 'ein Kennzeichenschild' : 'zwei Kennzeichenschilder'}), gelöscht spätestens ${dateTime(c.expiresAt)}`
            : 'mit einem anderen Schlüssel erfasst – bitte neu erfassen'
          : 'noch nicht erfasst'}
      </p>
      {canKfz && editing ? (
        <div className="poa-confirm">
          <p className="os-muted os-small">
            Codes aus den Originalen (ZB I und Stempelplaketten) genau übernehmen – Groß- und Kleinschreibung zählt. Sie werden verschlüsselt gespeichert, nie
            wieder angezeigt und nach der Übermittlung gelöscht.
          </p>
          <fieldset className="os-row">
            <legend className="os-small">Kennzeichenschilder am Fahrzeug</legend>
            <label className="os-check-field">
              <input type="radio" name={`plates-${orderId}`} checked={plates === 2} onChange={() => setPlates(2)} /> zwei (vorne und hinten)
            </label>
            <label className="os-check-field">
              <input type="radio" name={`plates-${orderId}`} checked={plates === 1} onChange={() => setPlates(1)} /> eines (nur hinten)
            </label>
          </fieldset>
          <div className="os-row">
            {input('ZB I (7 Zeichen)', 'zb1', zb1, setZb1, 7)}
            {input('Plakette hinten (3)', 'rear', rear, setRear, 3)}
            {plates === 2 ? input('Plakette vorne (3)', 'front', front, setFront, 3) : null}
          </div>
          <div className="os-row">
            {c.present ? (
              <button type="button" className="os-btn os-btn--ghost" disabled={busy} onClick={() => setEditing(false)}>
                Abbrechen
              </button>
            ) : null}
            <button
              type="button"
              className="os-btn"
              disabled={busy || zb1.length !== 7 || rear.length !== 3 || (plates === 2 && front.length !== 3)}
              onClick={() => void save()}
            >
              Verschlüsselt speichern
            </button>
          </div>
        </div>
      ) : canKfz ? (
        <div className="os-row">
          <button type="button" className="os-linkbtn os-small" onClick={() => setEditing(true)}>
            Codes neu erfassen
          </button>
          {c.present ? (
            <button
              type="button"
              className="os-linkbtn os-small"
              onClick={async () => {
                if (!window.confirm('Erfasste Sicherheitscodes löschen?')) return;
                try {
                  await osFetch(`orders/${orderId}/uebermittlung/codes/loeschen`, { method: 'POST', body: {} });
                  await done(true, 'Sicherheitscodes gelöscht');
                } catch (e) {
                  await done(false, (e as Error).message);
                }
              }}
            >
              Codes löschen
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SubmitTestRelease({
  orderNumber,
  panel,
  busy,
  run,
}: {
  orderNumber: string;
  panel: SubmissionPanel;
  busy: boolean;
  run: (path: string, success: string, body?: Record<string, unknown>, confirmText?: string) => Promise<void>;
}) {
  const t = panel.test;
  const r = t.release;
  if (!t.canGrant)
    return (
      <p className="os-muted os-small">
        Testmodus: Übermitteln kann nur der Inhaber für einen einzeln freigegebenen Auftrag{r?.active ? ` – freigegeben bis ${dateTime(r.expiresAt)}` : ''}.
      </p>
    );
  return (
    <div className="poa-test">
      <p className="os-small">
        <strong>Testmodus.</strong>{' '}
        {r?.active
          ? `Dieser Auftrag ist für genau eine echte Übermittlung freigegeben – bis ${dateTime(r.expiresAt)}${r.submissionId !== null ? ', bereits genutzt' : ', noch nicht genutzt'}.`
          : r
            ? `Die Testfreigabe ist abgelaufen (${dateTime(r.expiresAt)}).`
            : 'Für den ersten echten Test kann der Inhaber genau diese (bezahlte, freigegebene) Abmeldung freigeben: einmal, 24 Stunden lang.'}
        {t.otherOrder ? ` Aktuell freigegeben ist ${t.otherOrder} – eine neue Freigabe ersetzt sie.` : ''}
      </p>
      <div className="os-row">
        {r?.active ? (
          <button
            type="button"
            className="os-btn os-btn--ghost"
            disabled={busy}
            onClick={() => void run('/testfreigabe', 'Testfreigabe zurückgezogen', { aktiv: false })}
          >
            Testfreigabe zurückziehen
          </button>
        ) : (
          <button
            type="button"
            className="os-btn os-btn--ghost"
            disabled={busy}
            onClick={() =>
              void run(
                '/testfreigabe',
                'Testfreigabe erteilt – jetzt Codes erfassen und die Vorschau prüfen',
                { aktiv: true },
                `${orderNumber} für genau eine echte, kostenpflichtige Abmeldung beim KBA freigeben (24 Stunden)? Gesendet wird erst nach Vorschau und ausdrücklicher Bestätigung.`,
              )
            }
          >
            Testfreigabe für diesen Auftrag erteilen
          </button>
        )}
      </div>
    </div>
  );
}

/** Bestätigung vor dem Senden – gesendet wird nur genau dieser Stand (Prüfsumme über den Rumpf) */
function SubmitConfirm({ orderId, onCancel, onDone }: { orderId: number; onCancel: () => void; onDone: Done }) {
  const [reserve, setReserve] = useState(false);
  const [preview, setPreview] = useState<SubmitPreview | null>(null);
  const [error, setError] = useState<{ text: string; reasons: string[] } | null>(null);
  const [checked, setChecked] = useState(false);
  const [sending, setSending] = useState(false);
  const load = async (withReserve: boolean) => {
    setPreview(null);
    setChecked(false);
    try {
      const r = await osFetch<{ ok: true; preview: SubmitPreview }>(`orders/${orderId}/uebermittlung/vorschau`, {
        method: 'POST',
        body: { reservieren: withReserve },
      });
      setPreview(r.preview);
      setError(null);
    } catch (e) {
      const d = e instanceof OsError ? e.data : {};
      setError({ text: (e as Error).message, reasons: Array.isArray(d.reasons) ? d.reasons.map(String) : [] });
    }
  };
  useEffect(() => {
    void load(reserve);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId, reserve]);
  const send = async () => {
    if (!preview || sending) return;
    setSending(true);
    try {
      const r = await osFetch<{ ok: true; already: boolean; submission: SubmissionView }>(`orders/${orderId}/uebermittlung`, {
        method: 'POST',
        body: { reservieren: reserve, fingerprint: preview.fingerprint, bestaetigt: true },
      });
      await onDone(true, r.already ? 'Bereits übermittelt – nichts erneut gesendet' : `Abmeldung übermittelt (Vorgang ${r.submission.kfzOrderId})`);
    } catch (e) {
      if (e instanceof OsError && e.status === 409 && e.data.code === 'changed') await load(reserve);
      await onDone(false, (e as Error).message);
    } finally {
      setSending(false);
    }
  };
  return (
    <section className="poa-confirm" aria-label="Automatische Abmeldung – Bestätigung">
      <h4>Vor dem Senden prüfen</h4>
      {error ? (
        <div className="os-flash is-error">
          {error.text}
          {error.reasons.length ? (
            <ul>
              {error.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : !preview ? (
        <p className="os-muted os-small">Vorschau wird erstellt …</p>
      ) : (
        <>
          {preview.mode === 'test' ? (
            <p className="os-flash is-warn">Testmodus: echter, kostenpflichtiger Antrag beim KBA – nur für diesen freigegebenen Auftrag.</p>
          ) : null}
          <dl className="os-dl os-small">
            {preview.details.map((d) => (
              <Fragment key={d.label}>
                <dt>{d.label}</dt>
                <dd>{d.value}</dd>
              </Fragment>
            ))}
            <dt>Kosten</dt>
            <dd>
              <strong>
                ab {euroCents(preview.costs.fromNetCents)} netto · ab {euroCents(preview.costs.fromGrossCents)} brutto
              </strong>{' '}
              <span className="os-muted">
                (Leistung {euroCents(preview.costs.serviceNetCents)} + 19 % USt, amtliche Gebühren ab {euroCents(preview.costs.officialFromCents)} ohne USt;
                abgewiesen {euroCents(preview.costs.rejectedNetCents)} netto) – {preview.costs.source}
              </span>
            </dd>
          </dl>
          <label className="os-check-field">
            <input type="checkbox" checked={reserve} onChange={(e) => setReserve(e.target.checked)} /> Kennzeichen fahrzeugbezogen reservieren (längstens zwölf
            Monate)
          </label>
          <ul className="poa-confirm__notices">
            {preview.notices.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
          <label className="os-check-field">
            <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> Ich habe Angaben, Kosten und Hinweise geprüft und stelle
            genau diesen kostenpflichtigen Antrag auf Außerbetriebsetzung.
          </label>
        </>
      )}
      <div className="os-row">
        <button type="button" className="os-btn os-btn--ghost" disabled={sending} onClick={onCancel}>
          Abbrechen
        </button>
        <button type="button" className="os-btn" disabled={!preview || !checked || sending || !!error} onClick={() => void send()}>
          {sending ? 'Wird gesendet …' : 'Jetzt kostenpflichtig an das KBA senden'}
        </button>
      </div>
    </section>
  );
}
