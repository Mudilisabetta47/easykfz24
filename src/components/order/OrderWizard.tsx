'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DRIVE_TYPE_IDS, DRIVE_TYPES, isEKennzeichenEligible, MANUFACTURER_SUGGESTIONS, VEHICLE_TYPE_IDS, VEHICLE_TYPES } from '../../lib/catalog.ts';
import { formatBytes, formatEuro, formatIsoDay } from '../../lib/format.ts';
import { ACCEPT_ATTRIBUTE, ALLOWED_TYPES_TEXT, checkUpload, MAX_FILES_PER_DOCUMENT } from '../../lib/files.ts';
import {
  applyServiceDefaults,
  emptyDraft,
  errorsForPrefix,
  validateDocuments,
  validateOrder,
  type FieldErrors,
  type OrderInput,
} from '../../lib/order.ts';
import { calculatePrice, isPromoActive, plateSignCount, servicePrice } from '../../lib/pricing.ts';
import { BUNDLE_NAMES, NEW_CUSTOMER_PROMO, OFFICIAL_FEES_NOTE, PRICE_CONFIG, PRICES_ARE_EXAMPLE_VALUES, PRICES_FINAL } from '../../lib/pricing.config.ts';

const PROMO_ON = PRICES_FINAL && isPromoActive();
import {
  DOCUMENTS,
  documentsFor,
  isEvbRequired,
  isPlateChange,
  isServiceId,
  PLATE_CHOICES,
  SERVICE_IDS,
  SERVICES,
  type DocumentKind,
  type PlateChoice,
  type ServiceId,
} from '../../lib/services.ts';
import { checkFin, checkIban, checkPlate, formatIban } from '../../lib/validation.ts';
import { splitPlate } from '../../lib/plate.ts';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';
import { PlateConfigurator } from '../plate/PlateConfigurator.tsx';
import { ArrowRight, Check, Close, Doc } from '../icons.tsx';
import { CarrierMark, PaymentMarks } from '../Brands.tsx';
import { CARRIER_IDS, CARRIERS, isCarrierId } from '../../lib/shipping.ts';

/** Schritte und die Fehlerschlüssel (Präfixe), die zu ihnen gehören. */
const STEPS = [
  { key: 'start', keys: ['service', 'plate.wahl', 'plate.wunschkennzeichen', 'plate.schilder'], title: 'Leistung & Kennzeichen' },
  { key: 'vehicle', keys: ['vehicle.'], title: 'Fahrzeug' },
  { key: 'holder', keys: ['holder.'], title: 'Halter' },
  { key: 'documents', keys: ['documents.'], title: 'Unterlagen' },
  { key: 'delivery', keys: ['plate.zustellung', 'plate.versanddienst'], title: 'Zustellung' },
  { key: 'finish', keys: ['finish.'], title: 'Abschluss' },
  { key: 'review', keys: [], title: 'Prüfen' },
] as const;

type Files = Partial<Record<DocumentKind, File[]>>;

const fieldId = (path: string) => `f-${path.replace(/\./g, '-')}`;

function Field({ path, label, error, hint, children, optional }: { path: string; label: string; error?: string; hint?: ReactNode; children: ReactNode; optional?: boolean }) {
  return (
    <div className={`field${error ? ' field--error' : ''}`}>
      <label htmlFor={fieldId(path)} className="field__label">
        {label}
        {optional ? <span className="field__opt">optional</span> : null}
      </label>
      {children}
      {error ? (
        <p className="field__error" id={`${fieldId(path)}-err`}>
          {error}
        </p>
      ) : hint ? (
        <p className="field__hint" id={`${fieldId(path)}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const describedBy = (path: string, error?: string, hint?: boolean) =>
  error ? `${fieldId(path)}-err` : hint ? `${fieldId(path)}-hint` : undefined;

export function OrderWizard({
  initial,
  wish = '',
  payOnline = false,
  bundle = false,
}: {
  initial: string;
  wish?: string;
  payOnline?: boolean;
  bundle?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<OrderInput>(() => withBundle(withWish(emptyDraft(isServiceId(initial) ? initial : ''), wish), bundle));
  const [files, setFiles] = useState<Files>({});
  const [step, setStep] = useState(isServiceId(initial) ? 1 : 0);
  const [maxStep, setMaxStep] = useState(isServiceId(initial) ? 1 : 0);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [dirty, setDirty] = useState(false);
  /** Schilder: bewusst ohne Vorauswahl – kostenpflichtige Extras müssen aktiv gewählt werden. */
  const [signs, setSigns] = useState<'ja' | 'nein' | null>(bundle ? 'ja' : null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);

  const service = isServiceId(draft.service) ? draft.service : null;
  const def = service ? SERVICES[service] : null;
  const wahl = (def?.plateChoices.includes(draft.plate.wahl as PlateChoice) ? draft.plate.wahl : null) as PlateChoice | null;

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const update = <S extends 'vehicle' | 'holder' | 'plate' | 'finish'>(section: S, key: keyof OrderInput[S], value: unknown) => {
    setDirty(true);
    setDraft((d) => ({ ...d, [section]: { ...d[section], [key]: value } }));
    const path = `${section}.${String(key)}`;
    if (errors[path]) setErrors(({ [path]: _, ...rest }) => rest);
  };

  const chooseService = (id: ServiceId) => {
    setDirty(true);
    setDraft((d) => withBundle(withWish(applyServiceDefaults({ ...d, plate: { ...d.plate } }, id), wish), bundle));
    setErrors({});
  };

  const counts = useMemo(
    () => Object.fromEntries(Object.entries(files).map(([k, v]) => [k, v?.length ?? 0])) as Partial<Record<string, number>>,
    [files],
  );

  const stepErrors = (i: number): FieldErrors => {
    const st = STEPS[i];
    if (st.key === 'review') return {};
    if (st.key === 'documents') return service ? validateDocuments(service, counts) : { service: 'Bitte eine Leistung wählen' };
    const res = validateOrder(draft);
    const errs: FieldErrors = {};
    if (!res.ok) {
      if (i > 0 && res.errors.service) return {};
      for (const k of st.keys) Object.assign(errs, errorsForPrefix(res.errors, k));
      // „Behalten“: das bisherige Kennzeichen wird direkt im ersten Schritt abgefragt
      if (i === 0 && wahl === 'behalten' && res.errors['vehicle.bisherigesKennzeichen']) {
        errs['vehicle.bisherigesKennzeichen'] = res.errors['vehicle.bisherigesKennzeichen'];
      }
    }
    if (i === 0 && service && isPlateChange(service, wahl) && signs === null) {
      errs['plate.schilder'] = 'Bitte wählen Sie, ob wir die Kennzeichenschilder mitliefern sollen';
    }
    return errs;
  };

  const focusFirstError = (errs: FieldErrors) => {
    requestAnimationFrame(() => {
      const first = Object.keys(errs)[0];
      const el = first ? (document.getElementById(fieldId(first)) ?? document.querySelector<HTMLElement>(`[data-error-anchor="${first}"]`)) : null;
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const goTo = (i: number) => {
    setStep(i);
    setMaxStep((m) => Math.max(m, i));
    setErrors({});
    requestAnimationFrame(() => {
      topRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      topRef.current?.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    });
  };

  const next = () => {
    const errs = stepErrors(step);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      focusFirstError(errs);
      return;
    }
    goTo(step + 1);
  };

  const submit = async () => {
    setSubmitError('');
    for (let i = 0; i < STEPS.length - 1; i++) {
      const errs = stepErrors(i);
      if (Object.keys(errs).length > 0) {
        setStep(i);
        setErrors(errs);
        focusFirstError(errs);
        return;
      }
    }
    const body = new FormData();
    body.set('data', JSON.stringify(draft));
    for (const [kind, list] of Object.entries(files)) for (const f of list ?? []) body.append(`doc_${kind}`, f, f.name);
    setBusy(true);
    try {
      const res = await fetch('/api/auftrag', { method: 'POST', body });
      const json = (await res.json().catch(() => ({}))) as { ok?: boolean; number?: string; service?: string; discount?: boolean; paymentUrl?: string | null; message?: string; errors?: FieldErrors };
      if (res.ok && json.ok && json.number) {
        setDirty(false);
        if (json.paymentUrl) {
          // Weiter zur sicheren Bezahlseite des Zahlungsdienstleisters
          window.location.assign(json.paymentUrl);
          return;
        }
        const r = PROMO_ON ? `&r=${json.discount ? 1 : 0}` : '';
        router.push(`/kfz-anmelden/auftrag/bestaetigung?nr=${encodeURIComponent(json.number)}&l=${encodeURIComponent(json.service ?? '')}${r}`);
        return;
      }
      setSubmitError(json.message ?? 'Der Auftrag konnte nicht übermittelt werden.');
      if (json.errors && Object.keys(json.errors).length) {
        const firstKey = Object.keys(json.errors)[0];
        const idx = STEPS.findIndex((s) => s.keys.some((k: string) => firstKey === k || firstKey.startsWith(k)));
        if (idx >= 0) {
          setStep(idx);
          setErrors(json.errors);
          focusFirstError(json.errors);
        }
      }
    } catch {
      setSubmitError('Keine Verbindung zum Server. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.');
    } finally {
      setBusy(false);
    }
  };

  /* ---------- Dateien ---------- */
  const [fileMsg, setFileMsg] = useState<Partial<Record<DocumentKind, string>>>({});
  const addFiles = async (kind: DocumentKind, list: FileList | File[]) => {
    const current = files[kind] ?? [];
    const accepted: File[] = [];
    let msg = '';
    for (const f of Array.from(list)) {
      if (current.length + accepted.length >= MAX_FILES_PER_DOCUMENT) {
        msg = `Höchstens ${MAX_FILES_PER_DOCUMENT} Dateien je Unterlage.`;
        break;
      }
      const head = new Uint8Array(await f.slice(0, 32).arrayBuffer());
      const check = checkUpload(f.name, f.size, head);
      if (!check.ok) {
        msg = check.error;
        continue;
      }
      accepted.push(f);
    }
    setDirty(true);
    setFiles((prev) => ({ ...prev, [kind]: [...(prev[kind] ?? []), ...accepted] }));
    setFileMsg((m) => ({ ...m, [kind]: msg }));
    if (accepted.length) setErrors(({ [`documents.${kind}`]: _, ...rest }) => rest);
  };
  const removeFile = (kind: DocumentKind, index: number) => {
    setFiles((prev) => ({ ...prev, [kind]: (prev[kind] ?? []).filter((_, i) => i !== index) }));
  };

  /* ---------- Preis ---------- */
  const price = service
    ? calculatePrice({
        service,
        vehicleType: draft.vehicle.art,
        plateChoice: wahl,
        plateSigns: draft.plate.schilder,
        delivery: (draft.plate.zustellung as 'versand' | 'abholung' | '') || '',
        carrier: draft.plate.versanddienst,
      })
    : null;

  const e = errors;
  const wishCheck = draft.plate.wunschkennzeichen ? checkPlate(draft.plate.wunschkennzeichen) : null;
  const wishParts = wishCheck?.ok ? splitPlate(wishCheck.value) : null;
  const finCheck = draft.vehicle.fin ? checkFin(draft.vehicle.fin) : null;
  const ibanCheck = draft.finish.iban ? checkIban(draft.finish.iban) : null;

  return (
    <div className="wizard" ref={topRef}>
      <ol className="wizard__steps" role="list" aria-label="Fortschritt">
        {STEPS.map((s, i) => (
          <li key={s.key} className={i === step ? 'is-current' : i < step ? 'is-done' : ''}>
            <button type="button" onClick={() => goTo(i)} disabled={i > maxStep || busy} aria-current={i === step ? 'step' : undefined} aria-label={`Schritt ${i + 1}: ${s.title}`}>
              <span className="wizard__step-n">{i < step ? <Check width={12} height={12} /> : i + 1}</span>
              <span className="wizard__step-t">{s.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="wizard__grid">
        <form
          className="wizard__main card"
          noValidate
          onSubmit={(ev) => {
            ev.preventDefault();
            if (step === STEPS.length - 1) void submit();
            else next();
          }}
        >
          {/* ---------------- 1 Leistung ---------------- */}
          {step === 0 && (
            <section aria-labelledby="st-0">
              <h2 id="st-0" tabIndex={-1}>Was möchten Sie erledigen?</h2>
              <p className="wizard__lead">Leistung wählen, Kennzeichen festlegen – den Preis sehen Sie rechts sofort.</p>
              {initial === 'ummeldung' && !service ? <p className="wizard__note">Ummeldung: Bitte wählen Sie, ob der Halter wechselt oder Sie umgezogen sind.</p> : null}
              {wish ? (
                <p className="wizard__note">
                  Ihr Wunschkennzeichen <strong>{wish}</strong> ist vorgemerkt. Wählen Sie jetzt die Leistung – die Reservierung übernehmen wir.
                </p>
              ) : null}
              <div className="choice-grid" role="radiogroup" aria-label="Leistung" data-error-anchor="service" tabIndex={-1}>
                {SERVICE_IDS.map((id) => (
                  <label key={id} className={`choice${draft.service === id ? ' is-selected' : ''}${initial === 'ummeldung' && (id === 'halterwechsel' || id === 'umzug') ? ' is-hinted' : ''}`}>
                    <input type="radio" name="service" value={id} checked={draft.service === id} onChange={() => chooseService(id)} />
                    <span className="choice__title">{SERVICES[id].title}</span>
                    <span className="choice__text">{SERVICES[id].summary}</span>
                    {PRICES_FINAL ? <ChoicePrice id={id} /> : null}
                  </label>
                ))}
              </div>
              {e.service ? <p className="field__error">{e.service}</p> : null}

              {def && service && def.plateChoices.length ? (
                <div className="wizard__block">
                  <h3 className="wizard__sub">Ihr Kennzeichen</h3>
                  <div className="choice-grid choice-grid--plates" role="radiogroup" aria-label="Kennzeichen" data-error-anchor="plate.wahl" tabIndex={-1}>
                    {def.plateChoices.map((c) => (
                      <label key={c} className={`choice${wahl === c ? ' is-selected' : ''}`}>
                        <input
                          type="radio"
                          name="plate-wahl"
                          value={c}
                          checked={wahl === c}
                          onChange={() => {
                            update('plate', 'wahl', c);
                            if (c === 'wunsch' && !draft.plate.wunschkennzeichen) setPickerOpen(true);
                          }}
                        />
                        <span className="choice__title">{PLATE_CHOICES[c].label}</span>
                        <span className="choice__text">{PLATE_CHOICES[c].hint}</span>
                        {PRICES_FINAL ? (
                          <span className="choice__price">
                            <strong>{c === 'wunsch' ? `+ ${formatEuro(PRICE_CONFIG.wishPlateHandlingCents)}` : 'inklusive'}</strong>
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                  {e['plate.wahl'] ? <p className="field__error">{e['plate.wahl']}</p> : null}

                  {wahl === 'behalten' ? (
                    <div className="form-grid">
                      <Field
                        path="vehicle.bisherigesKennzeichen"
                        label="Ihr bisheriges Kennzeichen"
                        error={e['vehicle.bisherigesKennzeichen']}
                        hint="Format z. B. M-AB 1234"
                      >
                        <input
                          id={fieldId('vehicle.bisherigesKennzeichen')}
                          className="input--mono"
                          autoComplete="off"
                          value={draft.vehicle.bisherigesKennzeichen}
                          onChange={(ev) => update('vehicle', 'bisherigesKennzeichen', ev.target.value.toUpperCase())}
                          aria-invalid={!!e['vehicle.bisherigesKennzeichen']}
                        />
                      </Field>
                    </div>
                  ) : null}

                  {wahl === 'wunsch' ? (
                    <div className="wish-box" data-error-anchor="plate.wunschkennzeichen" tabIndex={-1}>
                      <div className="wish-box__preview">
                        {wishParts ? (
                          <GermanLicensePlate id="wiz-wish" {...wishParts} size="min(100%, 360px)" detail="lite" />
                        ) : (
                          <span className="wish-box__empty">Noch kein Wunschkennzeichen gewählt</span>
                        )}
                      </div>
                      <div className="wish-box__actions">
                        <button type="button" className="btn" onClick={() => setPickerOpen(true)}>
                          {wishParts ? 'Anderes Kennzeichen suchen' : 'Wunschkennzeichen suchen'}
                        </button>
                        <Field path="plate.wunschkennzeichen" label="oder direkt eingeben" error={e['plate.wunschkennzeichen']} hint="z. B. OHZ-ME 34 – Ort muss zu Ihrem Wohnsitz gehören">
                          <input
                            id={fieldId('plate.wunschkennzeichen')}
                            className="input--mono"
                            autoComplete="off"
                            value={draft.plate.wunschkennzeichen}
                            onChange={(ev) => update('plate', 'wunschkennzeichen', ev.target.value.toUpperCase())}
                            aria-invalid={!!e['plate.wunschkennzeichen']}
                          />
                        </Field>
                      </div>
                    </div>
                  ) : null}

                  {isPlateChange(service, wahl) ? (
                    <>
                      <h3 className="wizard__sub">Kennzeichenschilder</h3>
                      <div className="choice-grid choice-grid--compact" role="radiogroup" aria-label="Kennzeichenschilder" data-error-anchor="plate.schilder" tabIndex={-1}>
                        <label className={`choice${signs === 'ja' ? ' is-selected' : ''}`}>
                          <input
                            type="radio"
                            name="schilder"
                            checked={signs === 'ja'}
                            onChange={() => {
                              setSigns('ja');
                              update('plate', 'schilder', true);
                            }}
                          />
                          <span className="choice__title">Ja, Schilder mitliefern</span>
                          <span className="choice__text">Geprägt, passend zum Fahrzeug – kommen fertig zu Ihnen.</span>
                          {PRICES_FINAL ? (
                            <span className="choice__price">
                              <strong>je {formatEuro(PRICE_CONFIG.plateSignCents)}</strong>
                              <span className="muted">
                                {draft.vehicle.art ? `${plateSignCount(draft.vehicle.art)} Stück` : 'Pkw: 2 Stück'}
                              </span>
                            </span>
                          ) : null}
                        </label>
                        <label className={`choice${signs === 'nein' ? ' is-selected' : ''}`}>
                          <input
                            type="radio"
                            name="schilder"
                            checked={signs === 'nein'}
                            onChange={() => {
                              setSigns('nein');
                              update('plate', 'schilder', false);
                            }}
                          />
                          <span className="choice__title">Nein, besorge ich selbst</span>
                          <span className="choice__text">Sie lassen die Schilder selbst prägen.</span>
                          {PRICES_FINAL ? (
                            <span className="choice__price">
                              <strong>0,00 €</strong>
                            </span>
                          ) : null}
                        </label>
                      </div>
                      {e['plate.schilder'] ? <p className="field__error">{e['plate.schilder']}</p> : null}
                    </>
                  ) : null}

                  {PRICE_CONFIG.bundleCents[service] !== null && price && !price.bundleSaving ? (
                    <div className="upsell">
                      <strong>
                        {BUNDLE_NAMES[service]}: nur {formatEuro(PRICE_CONFIG.bundleCents[service] ?? 0)}
                      </strong>
                      <span>Wunschkennzeichen, Schilder und Versand zum Paketpreis – günstiger als einzeln.</span>
                      <button
                        type="button"
                        className="btn btn--sm btn--ghost"
                        onClick={() => {
                          setSigns('ja');
                          setDraft((d) => withBundle(d, true));
                          if (!draft.plate.wunschkennzeichen) setPickerOpen(true);
                        }}
                      >
                        Paket wählen
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : def && service ? (
                <p className="wizard__note">Für die Abmeldung senden Sie uns bitte beide Kennzeichenschilder im Original – die Zulassungsbehörde entstempelt sie.</p>
              ) : null}

              {pickerOpen ? (
                <PlateConfigurator
                  initial={wishParts ?? undefined}
                  onClose={() => setPickerOpen(false)}
                  onPick={(plate) => {
                    update('plate', 'wunschkennzeichen', plate);
                    setPickerOpen(false);
                  }}
                />
              ) : null}
            </section>
          )}

          {/* ---------------- 2 Fahrzeug ---------------- */}
          {step === 1 && def && (
            <section aria-labelledby="st-1">
              <h2 id="st-1" tabIndex={-1}>Fahrzeug</h2>
              <div className="form-grid">
                <Field path="vehicle.art" label="Fahrzeugart" error={e['vehicle.art']}>
                  <select id={fieldId('vehicle.art')} value={draft.vehicle.art} onChange={(ev) => update('vehicle', 'art', ev.target.value)} aria-invalid={!!e['vehicle.art']} aria-describedby={describedBy('vehicle.art', e['vehicle.art'])}>
                    <option value="">Bitte wählen</option>
                    {VEHICLE_TYPE_IDS.map((id) => (
                      <option key={id} value={id}>
                        {VEHICLE_TYPES[id].label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field path="vehicle.antrieb" label="Antrieb" error={e['vehicle.antrieb']}>
                  <select id={fieldId('vehicle.antrieb')} value={draft.vehicle.antrieb} onChange={(ev) => update('vehicle', 'antrieb', ev.target.value)} aria-invalid={!!e['vehicle.antrieb']} aria-describedby={describedBy('vehicle.antrieb', e['vehicle.antrieb'])}>
                    <option value="">Bitte wählen</option>
                    {DRIVE_TYPE_IDS.map((id) => (
                      <option key={id} value={id}>
                        {DRIVE_TYPES[id]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field path="vehicle.hersteller" label="Hersteller" error={e['vehicle.hersteller']}>
                  <input id={fieldId('vehicle.hersteller')} list="ek-makes" autoComplete="off" value={draft.vehicle.hersteller} onChange={(ev) => update('vehicle', 'hersteller', ev.target.value)} aria-invalid={!!e['vehicle.hersteller']} aria-describedby={describedBy('vehicle.hersteller', e['vehicle.hersteller'])} />
                  <datalist id="ek-makes">
                    {MANUFACTURER_SUGGESTIONS.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                </Field>
                <Field path="vehicle.modell" label="Modell" error={e['vehicle.modell']}>
                  <input id={fieldId('vehicle.modell')} autoComplete="off" value={draft.vehicle.modell} onChange={(ev) => update('vehicle', 'modell', ev.target.value)} aria-invalid={!!e['vehicle.modell']} aria-describedby={describedBy('vehicle.modell', e['vehicle.modell'])} />
                </Field>
                <div className="form-grid__full">
                  <Field
                    path="vehicle.fin"
                    label="Fahrzeug-Identifizierungsnummer (FIN)"
                    error={e['vehicle.fin']}
                    hint={
                      finCheck?.ok ? (
                        <span className="field__ok">
                          <Check width={12} height={12} /> Format geprüft
                        </span>
                      ) : (
                        'Feld E in der Zulassungsbescheinigung Teil I – 17 Zeichen, ohne I, O und Q.'
                      )
                    }
                  >
                    <input
                      id={fieldId('vehicle.fin')}
                      className="input--mono"
                      autoComplete="off"
                      spellCheck={false}
                      maxLength={24}
                      value={draft.vehicle.fin}
                      onChange={(ev) => update('vehicle', 'fin', ev.target.value.toUpperCase())}
                      onBlur={() => {
                        if (draft.vehicle.fin && finCheck && !finCheck.ok) setErrors((x) => ({ ...x, 'vehicle.fin': finCheck.error }));
                      }}
                      aria-invalid={!!e['vehicle.fin']}
                      aria-describedby={describedBy('vehicle.fin', e['vehicle.fin'], true)}
                    />
                  </Field>
                  <p className="field__count" aria-hidden="true">
                    {draft.vehicle.fin.replace(/[\s-]/g, '').length} / 17
                  </p>
                </div>
                {def.previousPlate !== 'nein' ? (
                  <Field
                    path="vehicle.bisherigesKennzeichen"
                    label="Bisheriges Kennzeichen"
                    optional={def.previousPlate === 'optional'}
                    error={e['vehicle.bisherigesKennzeichen']}
                    hint="Format z. B. M-AB 1234"
                  >
                    <input id={fieldId('vehicle.bisherigesKennzeichen')} className="input--mono" autoComplete="off" value={draft.vehicle.bisherigesKennzeichen} onChange={(ev) => update('vehicle', 'bisherigesKennzeichen', ev.target.value.toUpperCase())} aria-invalid={!!e['vehicle.bisherigesKennzeichen']} aria-describedby={describedBy('vehicle.bisherigesKennzeichen', e['vehicle.bisherigesKennzeichen'], true)} />
                  </Field>
                ) : null}
                {isEKennzeichenEligible(draft.vehicle.antrieb) ? (
                  <label className="check form-grid__full">
                    <input type="checkbox" checked={draft.vehicle.eKennzeichen} onChange={(ev) => update('vehicle', 'eKennzeichen', ev.target.checked)} />
                    <span>
                      E-Kennzeichen beantragen <span className="muted">(sofern die Voraussetzungen erfüllt sind)</span>
                    </span>
                  </label>
                ) : null}
              </div>
            </section>
          )}

          {/* ---------------- 3 Halter ---------------- */}
          {step === 2 && (
            <section aria-labelledby="st-2">
              <h2 id="st-2" tabIndex={-1}>Halter</h2>
              <div className="segmented" role="radiogroup" aria-label="Haltertyp" data-error-anchor="holder.typ" tabIndex={-1}>
                {(['privat', 'firma'] as const).map((t) => (
                  <label key={t} className={draft.holder.typ === t ? 'is-selected' : ''}>
                    <input type="radio" name="holder-typ" value={t} checked={draft.holder.typ === t} onChange={() => update('holder', 'typ', t)} />
                    {t === 'privat' ? 'Privatperson' : 'Firma'}
                  </label>
                ))}
              </div>
              {e['holder.typ'] ? <p className="field__error">{e['holder.typ']}</p> : null}
              <div className="form-grid">
                {draft.holder.typ === 'firma' ? (
                  <>
                    <div className="form-grid__full">
                      <Field path="holder.firmenname" label="Firmenname inkl. Rechtsform" error={e['holder.firmenname']}>
                        <input id={fieldId('holder.firmenname')} autoComplete="organization" value={draft.holder.firmenname} onChange={(ev) => update('holder', 'firmenname', ev.target.value)} aria-invalid={!!e['holder.firmenname']} aria-describedby={describedBy('holder.firmenname', e['holder.firmenname'])} />
                      </Field>
                    </div>
                    <Field path="holder.registernummer" label="Handelsregisternummer" optional>
                      <input id={fieldId('holder.registernummer')} value={draft.holder.registernummer} onChange={(ev) => update('holder', 'registernummer', ev.target.value)} />
                    </Field>
                    <Field path="holder.ansprechpartner" label="Ansprechperson" error={e['holder.ansprechpartner']}>
                      <input id={fieldId('holder.ansprechpartner')} autoComplete="name" value={draft.holder.ansprechpartner} onChange={(ev) => update('holder', 'ansprechpartner', ev.target.value)} aria-invalid={!!e['holder.ansprechpartner']} aria-describedby={describedBy('holder.ansprechpartner', e['holder.ansprechpartner'])} />
                    </Field>
                  </>
                ) : draft.holder.typ === 'privat' ? (
                  <>
                    <Field path="holder.vorname" label="Vorname" error={e['holder.vorname']}>
                      <input id={fieldId('holder.vorname')} autoComplete="given-name" value={draft.holder.vorname} onChange={(ev) => update('holder', 'vorname', ev.target.value)} aria-invalid={!!e['holder.vorname']} aria-describedby={describedBy('holder.vorname', e['holder.vorname'])} />
                    </Field>
                    <Field path="holder.nachname" label="Nachname" error={e['holder.nachname']}>
                      <input id={fieldId('holder.nachname')} autoComplete="family-name" value={draft.holder.nachname} onChange={(ev) => update('holder', 'nachname', ev.target.value)} aria-invalid={!!e['holder.nachname']} aria-describedby={describedBy('holder.nachname', e['holder.nachname'])} />
                    </Field>
                    <Field path="holder.geburtsdatum" label="Geburtsdatum" error={e['holder.geburtsdatum']}>
                      <input id={fieldId('holder.geburtsdatum')} type="date" autoComplete="bday" value={draft.holder.geburtsdatum} onChange={(ev) => update('holder', 'geburtsdatum', ev.target.value)} aria-invalid={!!e['holder.geburtsdatum']} aria-describedby={describedBy('holder.geburtsdatum', e['holder.geburtsdatum'])} />
                    </Field>
                  </>
                ) : null}
                {draft.holder.typ ? (
                  <>
                    <div className="form-grid__full form-grid__split">
                      <Field path="holder.strasse" label="Straße" error={e['holder.strasse']}>
                        <input id={fieldId('holder.strasse')} autoComplete="address-line1" value={draft.holder.strasse} onChange={(ev) => update('holder', 'strasse', ev.target.value)} aria-invalid={!!e['holder.strasse']} aria-describedby={describedBy('holder.strasse', e['holder.strasse'])} />
                      </Field>
                      <Field path="holder.hausnummer" label="Nr." error={e['holder.hausnummer']}>
                        <input id={fieldId('holder.hausnummer')} value={draft.holder.hausnummer} onChange={(ev) => update('holder', 'hausnummer', ev.target.value)} aria-invalid={!!e['holder.hausnummer']} aria-describedby={describedBy('holder.hausnummer', e['holder.hausnummer'])} />
                      </Field>
                    </div>
                    <div className="form-grid__full form-grid__split form-grid__split--plz">
                      <Field path="holder.plz" label="PLZ" error={e['holder.plz']}>
                        <input id={fieldId('holder.plz')} inputMode="numeric" autoComplete="postal-code" maxLength={5} value={draft.holder.plz} onChange={(ev) => update('holder', 'plz', ev.target.value.replace(/\D/g, ''))} aria-invalid={!!e['holder.plz']} aria-describedby={describedBy('holder.plz', e['holder.plz'])} />
                      </Field>
                      <Field path="holder.ort" label="Ort" error={e['holder.ort']}>
                        <input id={fieldId('holder.ort')} autoComplete="address-level2" value={draft.holder.ort} onChange={(ev) => update('holder', 'ort', ev.target.value)} aria-invalid={!!e['holder.ort']} aria-describedby={describedBy('holder.ort', e['holder.ort'])} />
                      </Field>
                    </div>
                    <Field path="holder.email" label="E-Mail" error={e['holder.email']} hint="Für Rückfragen und die Statusabfrage.">
                      <input id={fieldId('holder.email')} type="email" autoComplete="email" value={draft.holder.email} onChange={(ev) => update('holder', 'email', ev.target.value)} aria-invalid={!!e['holder.email']} aria-describedby={describedBy('holder.email', e['holder.email'], true)} />
                    </Field>
                    <Field path="holder.telefon" label="Telefon" error={e['holder.telefon']}>
                      <input id={fieldId('holder.telefon')} type="tel" autoComplete="tel" value={draft.holder.telefon} onChange={(ev) => update('holder', 'telefon', ev.target.value)} aria-invalid={!!e['holder.telefon']} aria-describedby={describedBy('holder.telefon', e['holder.telefon'])} />
                    </Field>
                  </>
                ) : null}
              </div>
            </section>
          )}

          {/* ---------------- 4 Unterlagen ---------------- */}
          {step === 3 && service && (
            <section aria-labelledby="st-3">
              <h2 id="st-3" tabIndex={-1}>Unterlagen hochladen</h2>
              <p className="wizard__note">
                Fotos oder Scans genügen – gut lesbar, alle Ecken sichtbar. {ALLOWED_TYPES_TEXT}, bis zu {MAX_FILES_PER_DOCUMENT} Dateien je Unterlage.
              </p>
              <div className="uploads">
                {documentsFor(service).map(({ kind, requirement }) => {
                  const list = files[kind] ?? [];
                  const err = e[`documents.${kind}`] ?? fileMsg[kind];
                  const inputId = fieldId(`documents.${kind}`);
                  return (
                    <div key={kind} className={`upload${err ? ' upload--error' : ''}${list.length ? ' upload--filled' : ''}`}>
                      <div className="upload__head">
                        <span>
                          <span className="upload__title">{DOCUMENTS[kind].label}</span>
                          <span className="upload__hint">{DOCUMENTS[kind].hint}</span>
                        </span>
                        <span className={`chip ${requirement === 'pflicht' ? 'chip--blue' : ''}`}>{requirement === 'pflicht' ? 'Pflicht' : 'optional'}</span>
                      </div>
                      {list.length < MAX_FILES_PER_DOCUMENT ? (
                        <label
                          className="dropzone"
                          htmlFor={inputId}
                          onDragOver={(ev) => {
                            ev.preventDefault();
                            ev.currentTarget.classList.add('is-over');
                          }}
                          onDragLeave={(ev) => ev.currentTarget.classList.remove('is-over')}
                          onDrop={(ev) => {
                            ev.preventDefault();
                            ev.currentTarget.classList.remove('is-over');
                            if (ev.dataTransfer.files.length) void addFiles(kind, ev.dataTransfer.files);
                          }}
                        >
                          <Doc width={20} height={20} />
                          <span>
                            <strong>Datei auswählen</strong> oder hierher ziehen
                          </span>
                          <input
                            id={inputId}
                            type="file"
                            className="sr-only"
                            accept={ACCEPT_ATTRIBUTE}
                            multiple
                            aria-invalid={!!err}
                            aria-describedby={err ? `${inputId}-err` : undefined}
                            onChange={(ev) => {
                              if (ev.target.files?.length) void addFiles(kind, ev.target.files);
                              ev.target.value = '';
                            }}
                          />
                        </label>
                      ) : null}
                      {list.length ? (
                        <ul className="upload__list" role="list">
                          {list.map((f, i) => (
                            <li key={`${f.name}-${i}`}>
                              <Check width={14} height={14} className="upload__ok" />
                              <span className="upload__name">{f.name}</span>
                              <span className="upload__size">{formatBytes(f.size)}</span>
                              <button type="button" className="icon-btn" onClick={() => removeFile(kind, i)} aria-label={`${f.name} entfernen`}>
                                <Close width={16} height={16} />
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {err ? (
                        <p className="field__error" id={`${inputId}-err`}>
                          {err}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ---------------- 5 Kennzeichen & Zustellung ---------------- */}
          {step === 4 && def && service && (
            <section aria-labelledby="st-4">
              <h2 id="st-4" tabIndex={-1}>Zustellung</h2>
              <p className="wizard__lead">Wie sollen Fahrzeugpapiere{draft.plate.schilder ? ' und Schilder' : ''} zu Ihnen kommen?</p>
              <div className="choice-grid choice-grid--compact" role="radiogroup" aria-label="Zustellung" data-error-anchor="plate.zustellung" tabIndex={-1}>
                {(['versand', 'abholung'] as const).map((z) => (
                  <label key={z} className={`choice${draft.plate.zustellung === z ? ' is-selected' : ''}`}>
                    <input
                      type="radio"
                      name="zustellung"
                      value={z}
                      checked={draft.plate.zustellung === z}
                      onChange={() => {
                        update('plate', 'zustellung', z);
                        if (z === 'versand' && !draft.plate.versanddienst) update('plate', 'versanddienst', 'dhl');
                      }}
                    />
                    <span className="choice__title">{z === 'versand' ? 'Versand mit DHL oder UPS' : 'Abholung'}</span>
                    <span className="choice__text">
                      {z === 'versand' ? 'An die Halteradresse, mit Sendungsverfolgung.' : 'In unserer Geschäftsstelle nach Terminabsprache.'}
                    </span>
                  </label>
                ))}
              </div>
              {e['plate.zustellung'] ? <p className="field__error">{e['plate.zustellung']}</p> : null}
              {draft.plate.zustellung === 'versand' ? (
                <>
                  <h3 className="wizard__sub">Versandpartner</h3>
                  <div className="choice-grid choice-grid--compact" role="radiogroup" aria-label="Versandpartner" data-error-anchor="plate.versanddienst" tabIndex={-1}>
                    {CARRIER_IDS.map((c) => (
                      <label key={c} className={`choice choice--carrier${draft.plate.versanddienst === c ? ' is-selected' : ''}`}>
                        <input type="radio" name="versanddienst" value={c} checked={draft.plate.versanddienst === c} onChange={() => update('plate', 'versanddienst', c)} />
                        <CarrierMark id={c} />
                        <span className="choice__text">{CARRIERS[c].service} – gleicher Preis</span>
                      </label>
                    ))}
                  </div>
                  {e['plate.versanddienst'] ? <p className="field__error">{e['plate.versanddienst']}</p> : null}
                </>
              ) : null}
            </section>
          )}

          {/* ---------------- 6 Abschluss ---------------- */}
          {step === 5 && def && service && (
            <section aria-labelledby="st-5">
              <h2 id="st-5" tabIndex={-1}>Versicherung, Kfz-Steuer &amp; Zustimmung</h2>
              <div className="form-grid">
                {isEvbRequired(service, wahl) ? (
                  <div className="form-grid__full">
                    <Field path="finish.evb" label="eVB-Nummer" error={e['finish.evb']} hint="7-stellige Nummer der elektronischen Versicherungsbestätigung Ihrer Kfz-Versicherung.">
                      <input id={fieldId('finish.evb')} className="input--mono" autoComplete="off" maxLength={9} value={draft.finish.evb} onChange={(ev) => update('finish', 'evb', ev.target.value.toUpperCase())} aria-invalid={!!e['finish.evb']} aria-describedby={describedBy('finish.evb', e['finish.evb'], true)} />
                    </Field>
                  </div>
                ) : null}
                {def.sepa ? (
                  <fieldset className="form-grid__full fieldset">
                    <legend>SEPA-Lastschriftmandat für die Kfz-Steuer</legend>
                    <div className="form-grid">
                      <Field path="finish.kontoinhaber" label="Kontoinhaber" error={e['finish.kontoinhaber']}>
                        <input id={fieldId('finish.kontoinhaber')} autoComplete="name" value={draft.finish.kontoinhaber} onChange={(ev) => update('finish', 'kontoinhaber', ev.target.value)} aria-invalid={!!e['finish.kontoinhaber']} aria-describedby={describedBy('finish.kontoinhaber', e['finish.kontoinhaber'])} />
                      </Field>
                      <Field
                        path="finish.iban"
                        label="IBAN"
                        error={e['finish.iban']}
                        hint={
                          ibanCheck?.ok ? (
                            <span className="field__ok">
                              <Check width={12} height={12} /> Prüfziffer korrekt
                            </span>
                          ) : (
                            'Konto in einem SEPA-Land'
                          )
                        }
                      >
                        <input
                          id={fieldId('finish.iban')}
                          className="input--mono"
                          autoComplete="off"
                          spellCheck={false}
                          value={draft.finish.iban}
                          onChange={(ev) => update('finish', 'iban', ev.target.value.toUpperCase())}
                          onBlur={() => {
                            if (ibanCheck?.ok) update('finish', 'iban', formatIban(ibanCheck.value));
                            else if (draft.finish.iban && ibanCheck && !ibanCheck.ok) setErrors((x) => ({ ...x, 'finish.iban': ibanCheck.error }));
                          }}
                          aria-invalid={!!e['finish.iban']}
                          aria-describedby={describedBy('finish.iban', e['finish.iban'], true)}
                        />
                      </Field>
                      <label className={`check form-grid__full${e['finish.sepaMandat'] ? ' check--error' : ''}`}>
                        <input id={fieldId('finish.sepaMandat')} type="checkbox" checked={draft.finish.sepaMandat} onChange={(ev) => update('finish', 'sepaMandat', ev.target.checked)} aria-invalid={!!e['finish.sepaMandat']} />
                        <span>
                          Ich ermächtige die für die Kraftfahrzeugsteuer zuständige Stelle der Bundeszollverwaltung, die Kfz-Steuer für dieses Fahrzeug
                          von dem angegebenen Konto per SEPA-Lastschrift einzuziehen. EasyKFZ24 übermittelt das Mandat im Rahmen der Zulassung.
                        </span>
                      </label>
                      {e['finish.sepaMandat'] ? <p className="field__error form-grid__full">{e['finish.sepaMandat']}</p> : null}
                    </div>
                  </fieldset>
                ) : null}
                <label className={`check form-grid__full${e['finish.vollmacht'] ? ' check--error' : ''}`}>
                  <input id={fieldId('finish.vollmacht')} type="checkbox" checked={draft.finish.vollmacht} onChange={(ev) => update('finish', 'vollmacht', ev.target.checked)} aria-invalid={!!e['finish.vollmacht']} />
                  <span>
                    Ich bevollmächtige EasyKFZ24, den Vorgang „{def.title}“ für mich bei der zuständigen Zulassungsbehörde zu beantragen. Mir ist bekannt,
                    dass ich die unterschriebene{' '}
                    <Link href="/kfz-anmelden/vollmacht" target="_blank">
                      Vollmacht
                    </Link>{' '}
                    im Original per Post nachreiche.
                  </span>
                </label>
                {e['finish.vollmacht'] ? <p className="field__error form-grid__full">{e['finish.vollmacht']}</p> : null}
                <label className={`check form-grid__full${e['finish.datenschutz'] ? ' check--error' : ''}`}>
                  <input id={fieldId('finish.datenschutz')} type="checkbox" checked={draft.finish.datenschutz} onChange={(ev) => update('finish', 'datenschutz', ev.target.checked)} aria-invalid={!!e['finish.datenschutz']} />
                  <span>
                    Ich habe die{' '}
                    <Link href="/datenschutz" target="_blank">
                      Datenschutzhinweise
                    </Link>{' '}
                    gelesen und bin mit der Verarbeitung meiner Angaben und Unterlagen zur Durchführung des Auftrags einverstanden.
                  </span>
                </label>
                {e['finish.datenschutz'] ? <p className="field__error form-grid__full">{e['finish.datenschutz']}</p> : null}
                <div className="form-grid__full">
                  <Field path="finish.hinweise" label="Hinweise an uns" optional>
                    <textarea id={fieldId('finish.hinweise')} rows={3} maxLength={1000} value={draft.finish.hinweise} onChange={(ev) => update('finish', 'hinweise', ev.target.value)} />
                  </Field>
                </div>
                {/* Honeypot – für Menschen unsichtbar, nicht per display:none */}
                <p className="hp" aria-hidden="true">
                  <label>
                    Website
                    <input tabIndex={-1} autoComplete="off" value={draft.website} onChange={(ev) => setDraft((d) => ({ ...d, website: ev.target.value }))} />
                  </label>
                </p>
              </div>
            </section>
          )}

          {/* ---------------- 7 Prüfen ---------------- */}
          {step === 6 && def && service && (
            <section aria-labelledby="st-6">
              <h2 id="st-6" tabIndex={-1}>Angaben prüfen</h2>
              <Summary title="Leistung" onEdit={() => goTo(0)} rows={[['Vorgang', def.title]]} />
              <Summary
                title="Fahrzeug"
                onEdit={() => goTo(1)}
                rows={[
                  ['Art / Antrieb', `${VEHICLE_TYPES[draft.vehicle.art as keyof typeof VEHICLE_TYPES]?.label ?? '–'} · ${DRIVE_TYPES[draft.vehicle.antrieb as keyof typeof DRIVE_TYPES] ?? '–'}`],
                  ['Hersteller / Modell', `${draft.vehicle.hersteller} ${draft.vehicle.modell}`],
                  ['FIN', draft.vehicle.fin.replace(/[\s-]/g, '')],
                  ...(draft.vehicle.bisherigesKennzeichen ? [['Bisheriges Kennzeichen', draft.vehicle.bisherigesKennzeichen] as [string, string]] : []),
                  ...(draft.vehicle.eKennzeichen && isEKennzeichenEligible(draft.vehicle.antrieb) ? [['E-Kennzeichen', 'gewünscht'] as [string, string]] : []),
                ]}
              />
              <Summary
                title="Halter"
                onEdit={() => goTo(2)}
                rows={[
                  ['Name', draft.holder.typ === 'firma' ? `${draft.holder.firmenname} (Ansprechperson: ${draft.holder.ansprechpartner})` : `${draft.holder.vorname} ${draft.holder.nachname}`],
                  ...(draft.holder.typ === 'privat' ? [['Geburtsdatum', formatIsoDay(draft.holder.geburtsdatum)] as [string, string]] : []),
                  ['Anschrift', `${draft.holder.strasse} ${draft.holder.hausnummer}, ${draft.holder.plz} ${draft.holder.ort}`],
                  ['Kontakt', `${draft.holder.email} · ${draft.holder.telefon}`],
                ]}
              />
              <Summary
                title="Unterlagen"
                onEdit={() => goTo(3)}
                rows={documentsFor(service).map(({ kind }) => [DOCUMENTS[kind].short, (files[kind] ?? []).length ? `${(files[kind] ?? []).length} Datei(en)` : '–'])}
              />
              <Summary
                title="Kennzeichen"
                onEdit={() => goTo(0)}
                rows={[
                  ...(wahl ? [['Kennzeichen', wahl === 'wunsch' ? `Wunsch: ${draft.plate.wunschkennzeichen}` : PLATE_CHOICES[wahl].label] as [string, string]] : []),
                  ...(isPlateChange(service, wahl) ? [['Schilder', draft.plate.schilder ? 'werden mitgeliefert' : 'besorge ich selbst'] as [string, string]] : []),
                ]}
              />
              <Summary
                title="Zustellung"
                onEdit={() => goTo(4)}
                rows={[
                  [
                    'Zustellung',
                    draft.plate.zustellung === 'versand'
                      ? `Versand mit ${isCarrierId(draft.plate.versanddienst) ? CARRIERS[draft.plate.versanddienst].name : '–'}`
                      : 'Abholung',
                  ],
                ]}
              />
              <Summary
                title="Abschluss"
                onEdit={() => goTo(5)}
                rows={[
                  ...(isEvbRequired(service, wahl) ? [['eVB-Nummer', draft.finish.evb] as [string, string]] : []),
                  ...(def.sepa ? [['SEPA-Mandat', `${draft.finish.kontoinhaber} · ${formatIban(draft.finish.iban)}`] as [string, string]] : []),
                  ['Vollmacht & Datenschutz', 'bestätigt'],
                ]}
              />
              <div className="pay-info">
                <h3>Bezahlung</h3>
                <p>
                  {payOnline
                    ? 'Nach dem Absenden geht es direkt zur sicheren Bezahlseite unseres Zahlungsdienstleisters.'
                    : 'Die Zahlungsdetails erhalten Sie nach Prüfung Ihrer Unterlagen – erst dann wird bezahlt.'}
                </p>
                <PaymentMarks label="Möglich mit" />
              </div>
              {submitError ? (
                <div className="alert alert--error" role="alert">
                  {submitError}
                </div>
              ) : null}
            </section>
          )}

          <div className="wizard__nav">
            {step > 0 ? (
              <button type="button" className="btn btn--ghost" onClick={() => goTo(step - 1)} disabled={busy}>
                Zurück
              </button>
            ) : (
              <span />
            )}
            {step < STEPS.length - 1 ? (
              <button type="submit" className="btn" disabled={step === 0 && !service}>
                Weiter <ArrowRight className="btn__icon" />
              </button>
            ) : (
              <button type="submit" className="btn btn--lg" disabled={busy} aria-busy={busy}>
                {busy ? 'Wird übermittelt …' : 'Auftrag verbindlich absenden'}
                {!busy ? <ArrowRight className="btn__icon" /> : null}
              </button>
            )}
          </div>
        </form>

        <aside className="wizard__aside" aria-label="Zusammenfassung">
          <div className="card wizard__summary">
            <p className="label">Ihr Vorgang</p>
            <p className="wizard__summary-title">{def ? def.title : 'Noch keine Leistung gewählt'}</p>
            {price ? (
              <>
                {PRICES_ARE_EXAMPLE_VALUES ? <p className="chip chip--soon wizard__example">Beispielwerte – Preise noch nicht festgelegt</p> : null}
                <dl className="price-lines">
                  {price.lines.map((l) => (
                    <div key={l.key} className={l.key === 'rabatt' || l.key === 'paket' ? 'price-lines__discount' : undefined}>
                      <dt>{l.key === 'rabatt' ? NEW_CUSTOMER_PROMO.label : l.label}</dt>
                      <dd>{l.cents < 0 ? `−${formatEuro(-l.cents)}` : formatEuro(l.cents)}</dd>
                    </div>
                  ))}
                </dl>
                <div className="price-total">
                  <span className="price-total__label">{price.discountCents || price.bundleSaving ? 'Heute nur' : 'Servicekosten EasyKFZ24'}</span>
                  <span className="price-total__row">
                    <strong>{formatEuro(price.totalCents)}</strong>
                    {price.discountCents || price.bundleSaving ? <s>{formatEuro(price.regularCents)}</s> : null}
                  </span>
                  {price.discountCents || price.bundleSaving ? (
                    <span className="price-total__save">Dein Vorteil: {formatEuro(price.discountCents + price.bundleSaving)}</span>
                  ) : null}
                </div>
                {price.discountCents ? (
                  <p className="wizard__fees">
                    Neukundenrabatt auf die Servicepauschale der ersten Beauftragung je E-Mail-Adresse – wird beim Absenden automatisch geprüft.
                  </p>
                ) : null}
                <p className="wizard__fees">{OFFICIAL_FEES_NOTE}</p>
              </>
            ) : (
              <p className="muted">Wählen Sie eine Leistung, um Unterlagen und Kosten zu sehen.</p>
            )}
          </div>
          {def ? (
            <div className="card wizard__originals">
              <p className="label">Per Post im Original</p>
              <ul role="list">
                {def.originals.map((o) => (
                  <li key={o}>{o}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

function Summary({ title, rows, onEdit }: { title: string; rows: [string, string][]; onEdit: () => void }) {
  return (
    <div className="summary">
      <div className="summary__head">
        <h3>{title}</h3>
        <button type="button" className="link" onClick={onEdit}>
          Ändern
        </button>
      </div>
      <dl>
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v || '–'}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ChoicePrice({ id }: { id: ServiceId }) {
  const p = servicePrice(id);
  return (
    <span className="choice__price">
      <strong>{formatEuro(p.savingCents ? p.promoCents : p.regularCents)}</strong>
      {p.savingCents ? <s>{formatEuro(p.regularCents)}</s> : null}
    </span>
  );
}

/** Übernimmt ein im Konfigurator gewähltes Wunschkennzeichen, sofern die Leistung Wunschkennzeichen erlaubt. */
function withWish(draft: OrderInput, wish: string): OrderInput {
  if (!wish) return draft;
  const service = isServiceId(draft.service) ? draft.service : null;
  if (service && !SERVICES[service].plateChoices.includes('wunsch')) return draft;
  return { ...draft, plate: { ...draft.plate, wahl: service ? 'wunsch' : draft.plate.wahl, wunschkennzeichen: wish } };
}

/** Komplett-Paket vorbelegen: Wunschkennzeichen, Schilder, Versand (DHL). */
function withBundle(draft: OrderInput, bundle: boolean): OrderInput {
  if (!bundle) return draft;
  const service = isServiceId(draft.service) ? draft.service : null;
  if (service && !SERVICES[service].plateChoices.includes('wunsch')) return draft;
  return {
    ...draft,
    plate: {
      ...draft.plate,
      wahl: service ? 'wunsch' : draft.plate.wahl,
      schilder: true,
      zustellung: 'versand',
      versanddienst: draft.plate.versanddienst || 'dhl',
    },
  };
}
