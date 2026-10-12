'use client';

// Auftrag in der Verwaltung anlegen (auch als Duplikat eines bestehenden Auftrags). Gleiche Prüfung wie auf der
// Website (validateOrder auf dem Server); Dokumente danach im Auftrag bzw. Dokumentenmanager hochladen.

import { useState } from 'react';
import { DRIVE_TYPES, VEHICLE_TYPES } from '../../../lib/catalog.ts';
import { emptyDraft, applyServiceDefaults, type OrderInput } from '../../../lib/order.ts';
import { PLATE_CHOICES, SERVICE_IDS, SERVICES, type ServiceId } from '../../../lib/services.ts';
import { CARRIER_IDS, CARRIERS } from '../../../lib/shipping.ts';
import { OsError, osFetch } from '../api.ts';
import { Dialog } from '../shared.tsx';

export function OrderForm({ initial, onClose, onCreated }: { initial?: Record<string, unknown> | null; onClose: () => void; onCreated: (id: number, number: string, warnings: string[]) => void }) {
  const [d, setD] = useState<OrderInput>(() => {
    const base = emptyDraft('halterwechsel');
    if (!initial) return base;
    const i = initial as Partial<OrderInput>;
    return { ...base, ...i, vehicle: { ...base.vehicle, ...(i.vehicle ?? {}) }, holder: { ...base.holder, ...(i.holder ?? {}) }, plate: { ...base.plate, ...(i.plate ?? {}) }, finish: { ...base.finish, ...(i.finish ?? {}) } } as OrderInput;
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svc = SERVICES[d.service as ServiceId];

  const set = <S extends 'vehicle' | 'holder' | 'plate' | 'finish'>(section: S, key: keyof OrderInput[S], value: unknown) =>
    setD((x) => ({ ...x, [section]: { ...x[section], [key]: value } }));
  const err = (k: string) => (errors[k] ? <span className="os-field__error">{errors[k]}</span> : null);
  const text = (section: 'vehicle' | 'holder' | 'plate' | 'finish', key: string, label: string, opts: { mono?: boolean; type?: string; placeholder?: string; upper?: boolean } = {}) => (
    <label className={`os-field${errors[`${section}.${key}`] ? ' has-error' : ''}`}>
      <span className="os-field__label">{label}</span>
      <input
        className={opts.mono ? 'os-mono' : ''}
        type={opts.type ?? 'text'}
        placeholder={opts.placeholder}
        value={String((d[section] as Record<string, unknown>)[key] ?? '')}
        onChange={(e) => set(section, key as never, opts.upper ? e.target.value.toUpperCase() : e.target.value)}
      />
      {err(`${section}.${key}`)}
    </label>
  );

  const submit = async () => {
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await osFetch<{ ok: true; id: number; number: string; warnings: string[] }>('orders', { method: 'POST', body: { data: d } });
      onCreated(r.id, r.number, r.warnings);
    } catch (e) {
      if (e instanceof OsError && e.data.fields) setErrors(e.data.fields as Record<string, string>);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      title={initial ? 'Auftrag duplizieren' : 'Neuer Auftrag'}
      onClose={onClose}
      wide
      footer={
        <>
          {error ? (
            <p className="os-flash is-error" role="alert">
              {error}
              {Object.keys(errors).length ? ` (${Object.keys(errors).length} Feld(er))` : ''}
            </p>
          ) : (
            <span className="os-muted os-small">Dokumente nach dem Anlegen im Auftrag hochladen. Preis und Neukundenrabatt werden wie auf der Website berechnet.</span>
          )}
          <span className="os-row">
            <button type="button" className="os-btn os-btn--ghost" onClick={onClose}>
              Abbrechen
            </button>
            <button type="button" className="os-btn" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Wird geprüft …' : 'Auftrag anlegen'}
            </button>
          </span>
        </>
      }
    >
      <div className="os-formgrid">
        <fieldset>
          <legend>Leistung</legend>
          <div className="os-chipset" role="radiogroup">
            {SERVICE_IDS.map((s) => (
              <button key={s} type="button" role="radio" aria-checked={d.service === s} className={d.service === s ? 'is-on' : ''} onClick={() => setD((x) => applyServiceDefaults({ ...x }, s))}>
                {SERVICES[s].title}
              </button>
            ))}
          </div>
          {err('service')}
        </fieldset>

        <fieldset>
          <legend>Fahrzeug</legend>
          <div className="os-fields">
            <label className="os-field">
              <span className="os-field__label">Fahrzeugart</span>
              <select className="os-select" value={d.vehicle.art} onChange={(e) => set('vehicle', 'art', e.target.value)}>
                <option value="">– wählen –</option>
                {Object.entries(VEHICLE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              {err('vehicle.art')}
            </label>
            {text('vehicle', 'hersteller', 'Hersteller')}
            {text('vehicle', 'modell', 'Modell')}
            {text('vehicle', 'fin', 'FIN (17 Zeichen)', { mono: true, upper: true })}
            {text('vehicle', 'bisherigesKennzeichen', 'Bisheriges Kennzeichen', { mono: true, upper: true, placeholder: 'z. B. HB-AB 123' })}
            <label className="os-field">
              <span className="os-field__label">Antrieb</span>
              <select className="os-select" value={d.vehicle.antrieb} onChange={(e) => set('vehicle', 'antrieb', e.target.value)}>
                <option value="">– wählen –</option>
                {Object.entries(DRIVE_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
              {err('vehicle.antrieb')}
            </label>
            <label className="os-check-field">
              <input type="checkbox" checked={!!d.vehicle.eKennzeichen} onChange={(e) => set('vehicle', 'eKennzeichen', e.target.checked)} /> E-Kennzeichen
            </label>
            <label className="os-check-field">
              <input type="checkbox" checked={!!d.vehicle.hKennzeichen} onChange={(e) => set('vehicle', 'hKennzeichen', e.target.checked)} /> H-Kennzeichen
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>Halter</legend>
          <div className="os-chipset" role="radiogroup">
            {(['privat', 'firma'] as const).map((t) => (
              <button key={t} type="button" role="radio" aria-checked={d.holder.typ === t} className={d.holder.typ === t ? 'is-on' : ''} onClick={() => set('holder', 'typ', t)}>
                {t === 'privat' ? 'Privatperson' : 'Firma'}
              </button>
            ))}
          </div>
          <div className="os-fields">
            {d.holder.typ === 'firma' ? (
              <>
                {text('holder', 'firmenname', 'Firmenname')}
                {text('holder', 'registernummer', 'Registernummer')}
                {text('holder', 'ansprechpartner', 'Ansprechperson')}
              </>
            ) : (
              <>
                {text('holder', 'vorname', 'Vorname')}
                {text('holder', 'nachname', 'Nachname')}
                {text('holder', 'geburtsdatum', 'Geburtsdatum', { type: 'date' })}
              </>
            )}
            {text('holder', 'strasse', 'Straße')}
            {text('holder', 'hausnummer', 'Hausnummer')}
            {text('holder', 'plz', 'PLZ')}
            {text('holder', 'ort', 'Ort')}
            {text('holder', 'email', 'E-Mail', { type: 'email' })}
            {text('holder', 'telefon', 'Telefon', { type: 'tel' })}
          </div>
        </fieldset>

        <fieldset>
          <legend>Kennzeichen & Zustellung</legend>
          <div className="os-fields">
            {svc?.plateChoices.length ? (
              <label className="os-field">
                <span className="os-field__label">Kennzeichen</span>
                <select className="os-select" value={d.plate.wahl} onChange={(e) => set('plate', 'wahl', e.target.value)}>
                  {svc.plateChoices.map((c) => (
                    <option key={c} value={c}>
                      {PLATE_CHOICES[c].label}
                    </option>
                  ))}
                </select>
                {err('plate.wahl')}
              </label>
            ) : null}
            {d.plate.wahl === 'wunsch' ? text('plate', 'wunschkennzeichen', 'Wunschkennzeichen', { mono: true, upper: true }) : null}
            {svc?.plateChoices.length ? (
              <label className="os-check-field">
                <input type="checkbox" checked={!!d.plate.schilder} onChange={(e) => set('plate', 'schilder', e.target.checked)} /> Schilder mitbestellen
              </label>
            ) : null}
            <label className="os-field">
              <span className="os-field__label">Zustellung</span>
              <select className="os-select" value={d.plate.zustellung} onChange={(e) => set('plate', 'zustellung', e.target.value)}>
                <option value="">– wählen –</option>
                <option value="versand">Versand</option>
                <option value="abholung">Abholung</option>
              </select>
              {err('plate.zustellung')}
            </label>
            {d.plate.zustellung === 'versand' ? (
              <label className="os-field">
                <span className="os-field__label">Versanddienst</span>
                <select className="os-select" value={d.plate.versanddienst} onChange={(e) => set('plate', 'versanddienst', e.target.value)}>
                  <option value="">– wählen –</option>
                  {CARRIER_IDS.map((c) => (
                    <option key={c} value={c}>
                      {CARRIERS[c].name}
                    </option>
                  ))}
                </select>
                {err('plate.versanddienst')}
              </label>
            ) : null}
          </div>
        </fieldset>

        <fieldset>
          <legend>Versicherung, Steuer, Vollmacht</legend>
          <div className="os-fields">
            {text('finish', 'evb', 'eVB-Nummer', { mono: true, upper: true })}
            {svc?.sepa ? (
              <>
                {text('finish', 'kontoinhaber', 'Kontoinhaber (Kfz-Steuer)')}
                {text('finish', 'iban', 'IBAN', { mono: true, upper: true })}
                <label className="os-check-field">
                  <input type="checkbox" checked={!!d.finish.sepaMandat} onChange={(e) => set('finish', 'sepaMandat', e.target.checked)} /> SEPA-Mandat liegt vor
                </label>
              </>
            ) : null}
            <label className={`os-check-field${errors['finish.vollmacht'] ? ' has-error' : ''}`}>
              <input type="checkbox" checked={!!d.finish.vollmacht} onChange={(e) => set('finish', 'vollmacht', e.target.checked)} /> Vollmacht liegt vor
            </label>
            <label className={`os-check-field${errors['finish.datenschutz'] ? ' has-error' : ''}`}>
              <input type="checkbox" checked={!!d.finish.datenschutz} onChange={(e) => set('finish', 'datenschutz', e.target.checked)} /> Kunde wurde über den Datenschutz informiert
            </label>
            <label className="os-field os-field--wide">
              <span className="os-field__label">Hinweise</span>
              <textarea rows={2} value={d.finish.hinweise} onChange={(e) => set('finish', 'hinweise', e.target.value)} maxLength={1000} />
            </label>
          </div>
          {Object.entries(errors)
            .filter(([k]) => k.startsWith('finish.') && !['finish.evb', 'finish.kontoinhaber', 'finish.iban'].includes(k))
            .map(([k, v]) => (
              <p key={k} className="os-field__error">
                {v}
              </p>
            ))}
        </fieldset>
      </div>
    </Dialog>
  );
}
