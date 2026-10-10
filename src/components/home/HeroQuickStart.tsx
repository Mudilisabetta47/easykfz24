'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { formatEuro } from '../../lib/format.ts';
import { fromPrice } from '../../lib/pricing.ts';
import type { ServiceId } from '../../lib/services.ts';
import { checkPlate } from '../../lib/validation.ts';
import type { WishInput } from '../../lib/wish-plate.ts';
import { ArrowRight } from '../icons.tsx';
import { PlateConfigurator } from '../plate/PlateConfigurator.tsx';
import { PlateInput } from '../plate/PlateInput.tsx';

type Mode = 'anmelden' | 'ummelden' | 'abmelden';

const MODES: Record<Mode, { label: string; service: string; priceOf: ServiceId[]; bubble: string; hint: string }> = {
  anmelden: {
    label: 'Anmelden',
    service: 'neuzulassung',
    priceOf: ['neuzulassung'],
    bubble: 'Wunschkennzeichen eingeben',
    hint: 'Nur den Ort tippen – wir schlagen freie Kombinationen vor. Oder leer lassen.',
  },
  ummelden: {
    label: 'Ummelden',
    service: 'ummeldung',
    priceOf: ['halterwechsel', 'umzug'],
    bubble: 'Neues Wunschkennzeichen?',
    hint: 'Optional: neues Wunschkennzeichen eintippen – oder dein bisheriges behalten.',
  },
  abmelden: {
    label: 'Abmelden',
    service: 'abmeldung',
    priceOf: ['abmeldung'],
    bubble: 'Dein Kennzeichen eingeben',
    hint: 'Das Kennzeichen, das abgemeldet werden soll.',
  },
};

const EMPTY: WishInput = { cityCode: '', letters: '', numbers: '' };

/** Schnellstart im ersten Bildschirm: Leistung wählen, Kennzeichen direkt ins Schild tippen, weiter zum Auftrag. */
export function HeroQuickStart() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('anmelden');
  const [plate, setPlate] = useState<WishInput>(EMPTY);
  const [picker, setPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const m = MODES[mode];
  const price = fromPrice(m.priceOf);

  const text = `${plate.cityCode}-${plate.letters} ${plate.numbers}`;
  const empty = !plate.cityCode && !plate.letters && !plate.numbers;
  const complete = !!plate.cityCode && !!plate.letters && !!plate.numbers;

  const go = (params: Record<string, string>) => {
    const q = new URLSearchParams({ leistung: m.service, ...params });
    router.push(`/kfz-anmelden/auftrag?${q}`);
  };

  const submit = () => {
    setError(null);
    if (empty) {
      if (mode === 'abmelden') return setError('Bitte das Kennzeichen eingeben, das abgemeldet werden soll.');
      return go({});
    }
    if (!complete) {
      if (mode === 'abmelden') return setError('Bitte das vollständige Kennzeichen eingeben, z. B. HB-EZ 24.');
      // Nur Ort (oder Teil) eingegeben → Vorschläge zeigen
      return setPicker(true);
    }
    const check = checkPlate(text);
    if (!check.ok) return setError(check.error);
    return go(mode === 'abmelden' ? { kennzeichen: check.value } : { wunsch: check.value });
  };

  return (
    <form
      className="quick"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      aria-label="Schnellstart"
    >
      <div className="quick__tabs" role="radiogroup" aria-label="Was möchtest du erledigen?">
        {(Object.keys(MODES) as Mode[]).map((k) => (
          <label key={k} className={`quick__tab${mode === k ? ' is-active' : ''}`}>
            <input
              type="radio"
              name="quick-mode"
              value={k}
              checked={mode === k}
              onChange={() => {
                setMode(k);
                setError(null);
              }}
            />
            {MODES[k].label}
          </label>
        ))}
      </div>

      <PlateInput
        id="hero-quick"
        value={plate}
        onChange={(v) => {
          setPlate(v);
          setError(null);
        }}
        placeholder={{ cityCode: 'HB', letters: 'EZ', numbers: '24' }}
        size="100%"
        bubble={m.bubble}
        idleText=""
        invalid={error ? 'all' : null}
        describedBy="quick-hint"
        onEnter={submit}
      />

      <p className="quick__hint" id="quick-hint" aria-live="polite">
        {error ? <span className="quick__error">{error}</span> : m.hint}
      </p>

      <div className="quick__foot">
        <p className="quick__price">
          <span className="quick__price-label">Servicepauschale</span>
          <span>
            {price.promoCents !== price.regularCents ? <s>{formatEuro(price.regularCents)}</s> : null}{' '}
            <strong>ab {formatEuro(price.promoCents)}</strong>
          </span>
        </p>
        <button type="submit" className="btn btn--lg" data-magnetic="0.2" data-cursor="Start">
          {mode === 'abmelden' ? 'Abmeldung starten' : complete || empty ? 'Weiter' : 'Kennzeichen finden'}
          <ArrowRight className="btn__icon" />
        </button>
      </div>

      {picker ? (
        <PlateConfigurator
          initial={plate}
          onClose={() => setPicker(false)}
          onPick={(p) => {
            setPicker(false);
            go({ wunsch: p });
          }}
        />
      ) : null}
    </form>
  );
}
