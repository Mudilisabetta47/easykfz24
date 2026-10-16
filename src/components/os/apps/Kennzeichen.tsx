'use client';
import { useRef, useState } from 'react';
import { CUSTOMER_FIELD_LABELS, OPERATION_LABELS, RESERVATION_STATUS_LABELS } from '../../../lib/kennzeichen-api.ts';
import type { Catalog, PlateSearch, Requirements } from '../../../lib/kennzeichen-api.ts';
import { osFetch, useOsData, dateTime } from '../api.ts';
import { ErrorBox, Loading, Panel, useFlash } from '../ui.tsx';

type Operation = { id: string; kind: string; reference: string; state: string; job_id: string; created_at: string };
interface Data { policy: { searchEnabled: boolean; dailyBudgetCent: number; reason: string }; budgetReservedCent: number; canWrite: boolean; operations: Operation[]; catalog: Catalog | null }
const vehicles = ['PKW', 'MOTORRAD', 'LEICHTKRAFTRAD', 'ANHAENGER', 'ZUGMASCHINE', 'LKW'] as const;

export function KennzeichenApp() {
  const { data, error, reload } = useOsData<Data>('kennzeichen');
  const flash = useFlash();
  const [busy, setBusy] = useState(false);
  const [ks, setKs] = useState('');
  const [uz, setUz] = useState('');
  const [letters, setLetters] = useState('');
  const [numbers, setNumbers] = useState('');
  const [vehicle, setVehicle] = useState<PlateSearch['vehicleType']>('PKW');
  const [electric, setElectric] = useState(false);
  const [historic, setHistoric] = useState(false);
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [kind, setKind] = useState<'private' | 'company'>('private');
  const [customer, setCustomer] = useState<Record<string, string | boolean>>({});
  const [consent, setConsent] = useState(false);
  const [terms, setTerms] = useState(false);
  const [jobId, setJobId] = useState('');
  const [result, setResult] = useState('');
  // Dieselben Angaben behalten bei Fehlern dieselbe Referenz. Neue bewusste Abfrage über eigenen Knopf.
  const references = useRef(new Map<string, string>());
  const reference = (value: unknown) => {
    const key = JSON.stringify(value);
    if (!references.current.has(key)) references.current.set(key, `ek:${crypto.randomUUID()}`);
    return references.current.get(key)!;
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try { await action(); await reload(); } catch (e) { flash.show(false, (e as Error).message); }
    finally { setBusy(false); }
  };
  if (!data) return error ? <ErrorBox message={error} onRetry={() => void reload()} /> : <Loading />;
  const district = data.catalog?.bezirke.find((d) => d.ks === ks);
  const plate: PlateSearch = { ks, uz, buchstaben: letters, ziffern: numbers, vehicleType: vehicle, electric, historic };
  const reservation = { plate, kind, customer, einwilligung: consent, authorityTermsAccepted: terms };
  return <>
    {flash.node}
    <Panel title="Kennzeichen prüfen und vorbereiten">
      <p>{data.policy.reason}</p>
      <p className="os-small">Tageslimit: {(data.policy.dailyBudgetCent / 100).toFixed(2)} € netto · vorsorglich gebunden: {(data.budgetReservedCent / 100).toFixed(2)} € · Einzelabfrage höchstens 0,10 € netto.</p>
      <p className="os-small">Eine Verfügbarkeitsauskunft ist keine Reservierung. Entwürfe lösen keine Behördenbuchung aus.</p>
      {data.canWrite ? <>
        <button className="os-btn" disabled={busy} onClick={() => void run(async () => { await osFetch('kennzeichen/bezirke', { method: 'POST', body: {} }); })}>Bezirkskatalog laden</button>
        {!data.catalog ? <p>Aktuell kein Bezirkskatalog geladen.</p> : <form className="os-form" onSubmit={(e) => e.preventDefault()}>
          <fieldset className="os-fields os-fields--2" disabled={busy}>
            <legend>Vollständige Kombination</legend>
            <label className="os-field">Behörde <select value={ks} onChange={(e) => { setKs(e.target.value); setUz(''); setRequirements(null); setCustomer({}); setConsent(false); setTerms(false); setResult(''); }}>
              <option value="">Bitte ausdrücklich wählen</option>{data.catalog.bezirke.map((d) => <option key={d.ks} value={d.ks}>{d.name} ({d.ks})</option>)}
            </select></label>
            <label className="os-field">Kürzel <select value={uz} onChange={(e) => setUz(e.target.value)}><option value="">Bitte wählen</option>{district?.codes.map((c) => <option key={c}>{c}</option>)}</select></label>
            <label className="os-field">Buchstaben <input maxLength={2} value={letters} onChange={(e) => setLetters(e.target.value.toUpperCase())} /></label>
            <label className="os-field">Ziffern <input inputMode="numeric" maxLength={4} value={numbers} onChange={(e) => setNumbers(e.target.value)} /></label>
            <label className="os-field">Fahrzeugart <select value={vehicle} onChange={(e) => setVehicle(e.target.value as PlateSearch['vehicleType'])}>{vehicles.map((v) => <option key={v}>{v}</option>)}</select></label>
            <label className="os-field"><input type="checkbox" checked={electric} onChange={(e) => setElectric(e.target.checked)} /> Elektrokennzeichen</label>
            <label className="os-field"><input type="checkbox" checked={historic} onChange={(e) => setHistoric(e.target.checked)} /> Oldtimerkennzeichen</label>
            <div className="os-row">
              <button className="os-btn" type="button" disabled={!data.policy.searchEnabled} onClick={() => void run(async () => {
                const r = await osFetch<{ outcome: string; kostenCent: number }>('kennzeichen/search', { method: 'POST', body: { plate, reference: reference({ search: plate }) } });
                setResult(`${r.outcome === 'AVAILABLE' ? 'Verfügbar' : r.outcome === 'NOT_AVAILABLE' ? 'Nicht verfügbar' : 'Verfügbarkeit unbekannt'} · ${(r.kostenCent / 100).toFixed(2)} € netto`);
              })}>Verfügbarkeit prüfen (bis 0,10 € netto)</button>
              <button className="os-btn os-btn--ghost" type="button" disabled={!data.policy.searchEnabled} onClick={() => { references.current.delete(JSON.stringify({ search: plate })); setResult('Neue Abfrage vorbereitet. Erneutes Prüfen kann erneut berechnet werden.'); }}>Neue Abfrage vorbereiten</button>
              <button className="os-btn" type="button" disabled={!ks} onClick={() => void run(async () => {
                const r = await osFetch<{ requirements: Requirements }>(`kennzeichen/bezirke/${ks}/anforderungen`, { method: 'POST', body: {} });
                setRequirements(r.requirements);
              })}>Pflichtfelder der Behörde laden</button>
            </div>
          </fieldset>
          {requirements ? <fieldset className="os-fields os-fields--2" disabled={busy}>
            <legend>Reservierungsentwurf · keine Übermittlung</legend>
            <p>Bei späterer echter Reservierung: {(data.catalog.preise.reservierungCent / 100).toFixed(2)} € netto zuzüglich möglicher Behördengebühren. Dieser Entwurf kostet nichts.</p>
            <label className="os-field">Halterart <select value={kind} onChange={(e) => { setKind(e.target.value as typeof kind); setCustomer({}); setConsent(false); setTerms(false); }}><option value="private">Privatperson</option><option value="company">Firma</option></select></label>
            {requirements.customerFields[kind].map((f) => <label className="os-field" key={f.name}>{CUSTOMER_FIELD_LABELS[f.name] ?? f.name}{f.required ? ' *' : ''} <input
              type={['email', 'date', 'boolean'].includes(f.type) ? f.type === 'boolean' ? 'checkbox' : f.type : 'text'} required={f.required}
              {...(f.type === 'boolean' ? { checked: customer[f.name] === true } : { value: String(customer[f.name] ?? '') })}
              onChange={(e) => setCustomer((c) => ({ ...c, [f.name]: f.type === 'boolean' ? e.target.checked : e.target.value }))} /></label>)}
            <label className="os-field"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> Tatsächliche Einwilligung des Kunden liegt vor</label>
            <label className="os-field"><input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} /> Kunde hat die Bedingungen der gewählten Behörde tatsächlich akzeptiert</label>
            <button className="os-btn" type="button" disabled={!consent || !terms} onClick={() => void run(async () => {
              const r = await osFetch<{ message: string }>('kennzeichen/reservations/prepare', { method: 'POST', body: { reservation, reference: reference({ reservation }) } });
              flash.show(true, r.message);
            })}>Nur Entwurf speichern</button>
          </fieldset> : null}
        </form>}
        <p role="status">{result}</p>
      </> : <p>Für Abfragen und Entwürfe ist eine Bearbeitungsberechtigung erforderlich.</p>}
    </Panel>
    <Panel title="Bestehende Reservierungen und Abfragen">
      {data.canWrite ? <div className="os-row"><label className="os-field">Vorhandene Anbieter-Vorgangsnummer <input value={jobId} maxLength={120} onChange={(e) => setJobId(e.target.value)} /></label>
        <button className="os-btn" disabled={busy || !jobId} onClick={() => void run(async () => {
          const r = await osFetch<{ status: string; pin?: string }>('kennzeichen/reservations/import', { method: 'POST', body: { jobId, reference: reference({ jobId }) } });
          setResult(`Status: ${RESERVATION_STATUS_LABELS[r.status] ?? r.status}${r.pin ? ` · PIN: ${r.pin}` : ' · noch keine PIN'}`);
        })}>Bestehenden Vorgang abrufen</button></div> : null}
      <div role="status">{result}</div>
      <table className="os-table"><thead><tr><th>Datum</th><th>Art</th><th>Referenz</th><th>Stand</th><th>Aktion</th></tr></thead><tbody>
        {data.operations.map((o) => <tr key={o.id}><td>{dateTime(o.created_at)}</td><td>{OPERATION_LABELS[o.kind] ?? o.kind}</td><td>{o.reference}</td><td>{RESERVATION_STATUS_LABELS[o.state] ?? o.state}</td><td>{o.job_id && data.canWrite ? <button className="os-btn" disabled={busy} onClick={() => void run(async () => {
          const r = await osFetch<{ status: string; pin?: string }>(`kennzeichen/reservations/${o.id}/refresh`, { method: 'POST', body: {} });
          setResult(`Status: ${RESERVATION_STATUS_LABELS[r.status] ?? r.status}${r.pin ? ` · PIN: ${r.pin}` : ' · noch keine PIN'}`);
        })}>Status und PIN abrufen</button> : data.canWrite ? <button className="os-btn" disabled={busy} onClick={() => void run(async () => {
          const d = await osFetch<{ request: unknown; result: unknown }>(`kennzeichen/operations/${o.id}`);
          setResult(Object.entries((d.request ?? {}) as Record<string, unknown>).map(([k, v]) => `${k}: ${typeof v === 'object' ? Object.entries(v as Record<string, unknown>).map(([f, x]) => `${CUSTOMER_FIELD_LABELS[f] ?? f}: ${String(x)}`).join(', ') : String(v)}`).join(' · '));
        })}>Details ansehen</button> : '–'}
        {o.kind === 'search' && ['uncertain', 'running'].includes(o.state) && data.canWrite ? <button className="os-btn" disabled={busy} onClick={() => void run(async () => {
          const r = await osFetch(`kennzeichen/operations/${o.id}/retry`, { method: 'POST', body: {} });
          setResult(`Abfrage fortgesetzt: ${String((r as { outcome?: string }).outcome ?? 'Stand aktualisiert')}`);
        })}>Mit gleicher Referenz wiederholen</button> : null}</td></tr>)}
      </tbody></table>
    </Panel>
  </>;
}
