'use client';
import { useEffect, useRef, useState } from 'react';
import { CUSTOMER_FIELD_LABELS, plateSearchSchema } from '../../lib/kennzeichen-api.ts';
import type { Catalog, PlateSearch, Requirements } from '../../lib/kennzeichen-api.ts';
import type { WishInput } from '../../lib/wish-plate.ts';

const VEHICLES = ['PKW', 'MOTORRAD', 'LEICHTKRAFTRAD', 'ANHAENGER', 'ZUGMASCHINE', 'LKW'] as const;
const VEHICLE_LABEL: Record<(typeof VEHICLES)[number], string> = {
  PKW: 'Pkw',
  MOTORRAD: 'Motorrad',
  LEICHTKRAFTRAD: 'Leichtkraftrad',
  ANHAENGER: 'Anhänger',
  ZUGMASCHINE: 'Zugmaschine / Traktor',
  LKW: 'Lkw',
};
interface Result {
  outcome: string;
  checkedAt?: string;
  reference: string;
}
/** Vorschläge sind kostenlos. Eine kostenpflichtige Einzelprüfung startet ausschließlich per Klick. */
export function AuthorityCatalog({
  cityCode,
  selection,
  onChecked,
}: {
  cityCode: string;
  selection: WishInput | null;
  onChecked: (plate: string, status: 'frei' | 'vergeben' | 'unbekannt') => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [ks, setKs] = useState('');
  const [vehicleType, setVehicleType] = useState<PlateSearch['vehicleType']>('PKW');
  const [usage, setUsage] = useState('normal');
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ key: string; value?: Result; error?: string } | null>(null);
  const references = useRef(new Map<string, string>());
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/kennzeichen/bezirke', { signal: controller.signal, cache: 'no-store' })
      .then((r) => r.json())
      .then((r: { catalog: Catalog | null; searchEnabled: boolean }) => {
        setCatalog(r.catalog);
        setEnabled(r.searchEnabled);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    setKs('');
    setRequirements(null);
  }, [cityCode]);
  useEffect(() => {
    setRequirements(null);
    if (!ks) return;
    const controller = new AbortController();
    void fetch(`/api/kennzeichen/bezirke/${ks}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((r: { requirements: Requirements | null }) => setRequirements(r.requirements))
      .catch(() => {});
    return () => controller.abort();
  }, [ks]);
  const districts = catalog?.bezirke.filter((d) => d.codes.includes(cityCode)) ?? [];
  const plate = {
    ks,
    uz: cityCode,
    buchstaben: selection?.letters ?? '',
    ziffern: selection?.numbers ?? '',
    vehicleType,
    electric: usage === 'electric',
    historic: usage === 'historic',
  };
  const key = JSON.stringify(plate);
  const current = result?.key === key ? result : null;
  const complete = plateSearchSchema.safeParse(plate).success;
  const label = `${cityCode}-${plate.buchstaben} ${plate.ziffern}`;
  const check = async () => {
    if (!complete || busy) return;
    if (!references.current.has(key)) references.current.set(key, `public:${crypto.randomUUID()}`);
    const reference = references.current.get(key)!;
    setBusy(true);
    try {
      const response = await fetch('/api/kennzeichen/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plate, reference, confirmed: true }),
      });
      const data = (await response.json()) as Result & { error?: string };
      if (!response.ok) throw new Error(data.error || 'Prüfung derzeit nicht möglich. Bitte erneut versuchen.');
      setResult({ key, value: data });
      onChecked(label, data.outcome === 'AVAILABLE' ? 'frei' : data.outcome === 'NOT_AVAILABLE' ? 'vergeben' : 'unbekannt');
    } catch (e) {
      setResult({ key, error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  const outcome = current?.value?.outcome;
  const tone = current?.error ? 'fehler' : outcome === 'AVAILABLE' ? 'frei' : outcome === 'NOT_AVAILABLE' ? 'vergeben' : outcome ? 'unbekannt' : '';
  return (
    <section className="pc-check" aria-label="Kennzeichenverfügbarkeit">
      <div className="pc-check__head">
        <h3>Verfügbarkeit prüfen</h3>
        <p>Live-Abfrage bei der zuständigen Zulassungsbehörde – nur auf Klick.</p>
      </div>
      {districts.length ? (
        <>
          <div className="pc-check__fields">
            <label className="pc-check__field">
              <span>Zuständige Zulassungsbehörde</span>
              <select disabled={busy} value={ks} onChange={(e) => setKs(e.target.value)}>
                <option value="">Bitte auswählen</option>
                {districts.map((d) => (
                  <option key={d.ks} value={d.ks}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
            {enabled ? (
              <>
                <label className="pc-check__field">
                  <span>Fahrzeugart</span>
                  <select disabled={busy} value={vehicleType} onChange={(e) => setVehicleType(e.target.value as PlateSearch['vehicleType'])}>
                    {VEHICLES.map((v) => (
                      <option key={v} value={v}>
                        {VEHICLE_LABEL[v]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="pc-check__field">
                  <span>Kennzeichenart</span>
                  <select disabled={busy} value={usage} onChange={(e) => setUsage(e.target.value)}>
                    <option value="normal">Normal</option>
                    <option value="electric">Elektro (E)</option>
                    <option value="historic">Oldtimer (H)</option>
                  </select>
                </label>
              </>
            ) : null}
          </div>
          {enabled ? (
            <div className="pc-check__action">
              <p>
                Geprüft wird <strong className="pc-check__plate">{label}</strong>
                {!ks ? (
                  <span className="pc-check__hint"> · zuerst die Behörde wählen</span>
                ) : !complete ? (
                  <span className="pc-check__hint"> · unten eine Kombination wählen</span>
                ) : null}
              </p>
              <button type="button" className="btn btn--sm" disabled={!complete || busy} onClick={() => void check()}>
                {busy ? 'Wird geprüft …' : current?.error ? 'Erneut prüfen' : current?.value ? 'Ergebnis erneut anzeigen' : 'Verfügbarkeit prüfen'}
              </button>
            </div>
          ) : (
            <p className="pc-check__note">Die Verfügbarkeitsprüfung ist derzeit nicht verfügbar.</p>
          )}
          <p role="status" aria-live="polite" className={tone ? `pc-check__result pc-check__result--${tone}` : 'pc-check__result-empty'}>
            {current?.error ??
              (current?.value
                ? `${outcome === 'AVAILABLE' ? 'Verfügbar' : outcome === 'NOT_AVAILABLE' ? 'Nicht verfügbar' : 'Verfügbarkeit unbekannt'}${current.value.checkedAt ? ` · Stand ${new Date(current.value.checkedAt).toLocaleString('de-DE')}` : ''}`
                : '')}
          </p>
        </>
      ) : (
        <p className="pc-check__note">
          {enabled ? 'Für dieses Kürzel ist derzeit keine Behörde im Katalog verfügbar.' : 'Die Verfügbarkeitsprüfung ist derzeit nicht verfügbar.'}
        </p>
      )}
      {requirements ? (
        <p className="pc-check__note">
          Diese Behörde benötigt für Privatpersonen:{' '}
          {requirements.customerFields.private
            .filter((f) => f.required)
            .map((f) => CUSTOMER_FIELD_LABELS[f.name] ?? f.name)
            .join(', ')}
          . Für Firmen:{' '}
          {requirements.customerFields.company
            .filter((f) => f.required)
            .map((f) => CUSTOMER_FIELD_LABELS[f.name] ?? f.name)
            .join(', ')}
          .
        </p>
      ) : null}
      <p className="pc-check__note">Die Auskunft reserviert das Kennzeichen nicht. Endgültig bestätigt wird die Verfügbarkeit erst bei der Reservierung.</p>
    </section>
  );
}
