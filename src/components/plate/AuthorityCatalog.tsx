'use client';
import { useEffect, useState } from 'react';
import { CUSTOMER_FIELD_LABELS } from '../../lib/kennzeichen-api.ts';
import type { Catalog, Requirements } from '../../lib/kennzeichen-api.ts';

/** Kataloginformationen aus dem internen Cache; Besucher lösen weder Anbieterabfragen noch Buchungen aus. */
export function AuthorityCatalog({ cityCode }: { cityCode: string }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [ks, setKs] = useState('');
  const [requirements, setRequirements] = useState<Requirements | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/kennzeichen/bezirke', { signal: controller.signal }).then((r) => r.json()).then((r: { catalog: Catalog | null }) => setCatalog(r.catalog)).catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => { setKs(''); setRequirements(null); }, [cityCode]);
  useEffect(() => {
    setRequirements(null);
    if (!ks) return;
    const controller = new AbortController();
    void fetch(`/api/kennzeichen/bezirke/${ks}`, { signal: controller.signal }).then((r) => r.json()).then((r: { requirements: Requirements | null }) => setRequirements(r.requirements)).catch(() => {});
    return () => controller.abort();
  }, [ks]);
  const districts = catalog?.bezirke.filter((d) => d.codes.includes(cityCode)) ?? [];
  return <section className="pc__note" aria-label="Zuständige Zulassungsbehörde">
    {districts.length ? <label>Welche Behörde ist für dich zuständig? <select value={ks} onChange={(e) => setKs(e.target.value)}>
      <option value="">Bitte ausdrücklich auswählen</option>{districts.map((d) => <option key={d.ks} value={d.ks}>{d.name} ({d.ks})</option>)}
    </select></label> : null}
    {requirements ? <p>Diese Behörde benötigt für Privatpersonen: {requirements.customerFields.private.filter((f) => f.required).map((f) => CUSTOMER_FIELD_LABELS[f.name] ?? f.name).join(', ')}. Für Firmen: {requirements.customerFields.company.filter((f) => f.required).map((f) => CUSTOMER_FIELD_LABELS[f.name] ?? f.name).join(', ')}.</p> : null}
    <p>Die Auswahl dient zur Information. Eine Online-Verfügbarkeitsabfrage und direkte Reservierung sind derzeit gesperrt. Dein Kennzeichenwunsch bleibt unverbindlich; die zuständige Behörde wird vor einer Reservierung nochmals bestätigt.</p>
  </section>;
}
