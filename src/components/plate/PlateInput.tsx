'use client';

import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { groupExtent, layoutPlate, PLATE, PLATE_VIEW, type PlateGroup } from '../../lib/plate.ts';
import { lookupDistrict, normalizeWish, parseWishText, searchDistricts, type WishInput } from '../../lib/wish-plate.ts';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';

const GROUPS: PlateGroup[] = ['cityCode', 'letters', 'numbers'];
const LABEL: Record<PlateGroup, string> = { cityCode: 'Ortskennzeichen', letters: 'Buchstaben', numbers: 'Zahlen' };
const MAX: Record<PlateGroup, number> = { cityCode: 3, letters: 2, numbers: 4 };

interface Props {
  value: WishInput;
  onChange: (value: WishInput) => void;
  /** Grau dargestellt, solange eine Gruppe leer ist */
  placeholder?: WishInput;
  size?: number | string;
  id?: string;
  autoFocus?: boolean;
  /** Gruppe mit Fehler (rot hinterlegt) */
  invalid?: PlateGroup | 'all' | null;
  /** Hinweis über dem Schild, z. B. „Kennzeichen eingeben“ */
  bubble?: string;
  /** Ortsname unter dem Schild anzeigen */
  showDistrict?: boolean;
  onEnter?: () => void;
  describedBy?: string;
}

/**
 * Kennzeichen zum direkten Eintippen: Ort → Buchstaben → Zahlen, wie auf dem echten Schild.
 * Unsichtbare Eingabefelder liegen exakt über den Zeichengruppen; die Darstellung übernimmt GermanLicensePlate.
 * Leerzeichen/Bindestrich springen weiter, Rücktaste im leeren Feld zurück, „OHZ-AB 123“ lässt sich einfügen.
 */
export function PlateInput({
  value,
  onChange,
  placeholder = { cityCode: 'HB', letters: 'EZ', numbers: '24' },
  size = '100%',
  id: idProp,
  autoFocus,
  invalid = null,
  bubble,
  showDistrict = true,
  onEnter,
  describedBy,
}: Props) {
  const auto = useId().replace(/:/g, '');
  const id = idProp ?? `pi-${auto}`;
  const refs = { cityCode: useRef<HTMLInputElement>(null), letters: useRef<HTMLInputElement>(null), numbers: useRef<HTMLInputElement>(null) };
  const [focus, setFocus] = useState<PlateGroup | null>(null);
  const [hit, setHit] = useState(0);

  const display = {
    cityCode: value.cityCode || placeholder.cityCode,
    letters: value.letters || placeholder.letters,
    numbers: value.numbers || placeholder.numbers,
  };
  const ghost = { cityCode: !value.cityCode, letters: !value.letters, numbers: !value.numbers };
  const layout = useMemo(() => layoutPlate(display.cityCode, display.letters, display.numbers), [display.cityCode, display.letters, display.numbers]);
  const districts = useMemo(() => (focus === 'cityCode' && value.cityCode ? searchDistricts(value.cityCode, 6) : []), [focus, value.cityCode]);
  const showList = districts.length > 0 && !(districts.length === 1 && districts[0].code === value.cityCode);
  const districtName = value.cityCode ? lookupDistrict(value.cityCode) : null;

  const vbW = PLATE.W + PLATE_VIEW.PAD_X * 2;
  const vbH = PLATE.H + PLATE_VIEW.PAD_Y + PLATE_VIEW.PAD_B;
  // Tippzonen: das ganze Schild wird in drei Bereiche geteilt – auch auf dem Handy gut zu treffen.
  const zones = (() => {
    const c = groupExtent(layout, 'cityCode');
    const l = groupExtent(layout, 'letters');
    const n = groupExtent(layout, 'numbers');
    const start = PLATE.BAND_X + PLATE.BAND_W;
    const end = PLATE.W;
    const cut1 = c && l ? (c.x1 + l.x0) / 2 : layout.sealX + layout.sealW / 2;
    const cut2 = l && n ? (l.x1 + n.x0) / 2 : (cut1 + end) / 2;
    return { cityCode: [start, cut1], letters: [cut1, cut2], numbers: [cut2, end] } as Record<PlateGroup, [number, number]>;
  })();
  const box = (g: PlateGroup) => {
    const [x0, x1] = zones[g];
    return {
      left: `${((x0 + PLATE_VIEW.PAD_X) / vbW) * 100}%`,
      width: `${((x1 - x0) / vbW) * 100}%`,
      top: `${(PLATE_VIEW.PAD_Y / vbH) * 100}%`,
      height: `${(PLATE.H / vbH) * 100}%`,
    };
  };

  const focusGroup = (g: PlateGroup) => {
    const el = refs[g].current;
    if (!el) return;
    el.focus();
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  const emit = (next: WishInput, moveTo?: PlateGroup) => {
    onChange(normalizeWish(next));
    // Sofort weiterspringen – bei schnellem Tippen darf kein Zeichen im alten Feld landen.
    if (moveTo) focusGroup(moveTo);
  };

  const handle = (g: PlateGroup, raw: string) => {
    const up = raw.toUpperCase();
    // Ganzes Kennzeichen getippt oder eingefügt („ohz ?? ??“, „OHZ-AB 123“)
    if (g === 'cityCode' && (/[\s\-0-9?]/.test(up) || up.replace(/[^A-ZÄÖÜ]/g, '').length > 3)) {
      let p: WishInput;
      if (/[\s-]/.test(up.trim())) p = parseWishText(up);
      else {
        // Am Stück getippt („OHZRO87“): Ort = erste drei Buchstaben, dann Buchstaben, dann Ziffern
        const m = /^([A-ZÄÖÜ]*)([A-Z?]*)([0-9?]*)/.exec(up.replace(/[^A-ZÄÖÜ0-9?]/g, '')) ?? ['', '', '', ''];
        const head = m[1] + m[2];
        p = { cityCode: head.slice(0, 3), letters: head.slice(3, 5), numbers: m[3] };
      }
      const next = { cityCode: p.cityCode, letters: p.letters || value.letters, numbers: p.numbers || value.numbers };
      return emit(next, p.numbers ? 'numbers' : 'letters');
    }
    if (g === 'letters') {
      const digits = up.replace(/[^0-9]/g, '');
      const clean = up.replace(/[^A-Z?]/g, '');
      if (digits) return emit({ ...value, letters: clean, numbers: (digits + value.numbers).slice(0, 4) }, 'numbers');
      if (/[\s-]/.test(up)) return emit({ ...value, letters: clean }, 'numbers');
      return emit({ ...value, letters: clean }, clean.length >= 2 && clean.length > value.letters.length ? 'numbers' : undefined);
    }
    if (g === 'numbers') return emit({ ...value, numbers: up.replace(/[^0-9?]/g, '') });
    const city = up.replace(/[^A-ZÄÖÜ]/g, '');
    return emit({ ...value, cityCode: city }, city.length >= 3 && city.length > value.cityCode.length ? 'letters' : undefined);
  };

  const onKey = (g: PlateGroup, e: KeyboardEvent<HTMLInputElement>) => {
    const i = GROUPS.indexOf(g);
    if (g === 'cityCode' && showList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHit((h) => (h + (e.key === 'ArrowDown' ? 1 : districts.length - 1)) % districts.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (g === 'cityCode' && showList) return pickDistrict(districts[hit]?.code ?? value.cityCode);
      if (i < 2) return focusGroup(GROUPS[i + 1]);
      onEnter?.();
      return;
    }
    if (e.key === 'Backspace' && !e.currentTarget.value && i > 0) {
      e.preventDefault();
      focusGroup(GROUPS[i - 1]);
    } else if (e.key === 'ArrowLeft' && i > 0) {
      e.preventDefault();
      focusGroup(GROUPS[i - 1]);
    } else if (e.key === 'ArrowRight' && i < 2) {
      e.preventDefault();
      focusGroup(GROUPS[i + 1]);
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text');
    if (!/[\s-]/.test(text.trim())) return;
    e.preventDefault();
    const p = parseWishText(text);
    emit(p, p.numbers ? 'numbers' : p.letters ? 'numbers' : 'letters');
  };

  const pickDistrict = (code: string) => {
    setHit(0);
    emit({ ...value, cityCode: code }, 'letters');
  };

  const err = (g: PlateGroup) => invalid === g || invalid === 'all';

  return (
    <div className={`pi${focus ? ' is-focused' : ''}`}>
      {bubble ? (
        <span className="pi__bubble" aria-hidden="true">
          {bubble}
        </span>
      ) : null}
      <div
        className="pi__plate"
        style={{ inlineSize: typeof size === 'number' ? `${size}px` : size }}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).tagName === 'INPUT') return;
          e.preventDefault();
          focusGroup(GROUPS.find((g) => !value[g]) ?? 'numbers');
        }}
      >
        <GermanLicensePlate
          id={id}
          cityCode={display.cityCode}
          letters={display.letters}
          numbers={display.numbers}
          size="100%"
          ghost={ghost}
          caret={focus}
          invalid={invalid}
          showSealPlaceholder
        />
        {GROUPS.map((g) => (
          <input
            key={g}
            ref={refs[g]}
            className="pi__field"
            style={box(g)}
            value={value[g]}
            onChange={(e) => handle(g, e.target.value)}
            onKeyDown={(e) => onKey(g, e)}
            onPaste={onPaste}
            onFocus={(e) => {
              setFocus(g);
              const end = e.currentTarget.value.length;
              e.currentTarget.setSelectionRange(end, end);
            }}
            onBlur={() => setFocus((f) => (f === g ? null : f))}
            onSelect={(e) => {
              const el = e.currentTarget;
              if (el.selectionStart !== el.value.length && el.selectionStart === el.selectionEnd) el.setSelectionRange(el.value.length, el.value.length);
            }}
            maxLength={g === 'cityCode' ? 12 : MAX[g] + 1}
            aria-label={LABEL[g]}
            aria-invalid={err(g)}
            aria-describedby={describedBy}
            autoFocus={autoFocus && g === 'cityCode'}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="characters"
            spellCheck={false}
            inputMode={g === 'numbers' ? 'numeric' : 'text'}
            enterKeyHint={g === 'numbers' ? 'done' : 'next'}
            role={g === 'cityCode' ? 'combobox' : undefined}
            aria-expanded={g === 'cityCode' ? showList : undefined}
            aria-controls={g === 'cityCode' ? `${id}-list` : undefined}
            aria-autocomplete={g === 'cityCode' ? 'list' : undefined}
          />
        ))}
        {showList ? (
          <ul className="pi__list" id={`${id}-list`} role="listbox" aria-label="Ortskennzeichen">
            {districts.map((d, i) => (
              <li key={d.code} role="option" aria-selected={i === hit}>
                <button type="button" tabIndex={-1} onMouseDown={(e) => e.preventDefault()} onClick={() => pickDistrict(d.code)}>
                  <strong>{d.code}</strong> {d.name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      {showDistrict ? (
        <p className="pi__district" aria-live="polite">
          {districtName ? (
            <>
              <strong>{value.cityCode}</strong> · {districtName}
            </>
          ) : (
            'Ins Schild tippen: Ort, Buchstaben, Zahlen'
          )}
        </p>
      ) : null}
    </div>
  );
}
