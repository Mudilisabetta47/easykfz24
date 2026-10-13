'use client';

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { PLATE, PLATE_VIEW, plateGeometry, type PlateFormat, type PlateGroup } from '../../lib/plate.ts';
import { lookupDistrict, normalizeWish, parseWishText, searchDistricts, type WishInput } from '../../lib/wish-plate.ts';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';

const GROUPS: PlateGroup[] = ['cityCode', 'letters', 'numbers'];
const LABEL: Record<PlateGroup, string> = {
  cityCode: 'Ort oder Ortskennzeichen',
  letters: 'Buchstaben',
  numbers: 'Zahlen',
};
const MAX: Record<PlateGroup, number> = { cityCode: 3, letters: 2, numbers: 4 };

/** Gewählter Ort aus der verifizierten Datenbasis (KBA + Destatis) */
export interface PlacePick {
  ags: string;
  name: string;
  /** Unterscheidung gleichnamiger Gemeinden im selben Kreis („Eifel“, „PLZ 17392“) */
  zusatz?: string;
  kreis: string;
  codes: string[];
}
/** „Lilienthal (Landkreis Osterholz)“; kreisfreie Städte ohne Doppelung („Bremen“) */
export const placeText = (p: PlacePick) => {
  const name = p.zusatz ? `${p.name}, ${p.zusatz}` : p.name;
  return p.kreis === p.name || p.kreis === `Stadt ${p.name}` ? name : `${name} (${p.kreis})`;
};
const nameOf = (p: PlacePick) => (p.zusatz ? `${p.name} (${p.zusatz})` : p.name);

interface PlaceView extends PlacePick {
  official: string;
  land: string;
  pending: string[];
}
type Option = { kind: 'code'; code: string; name: string } | { kind: 'place'; place: PlaceView; code: string };
/** Eine Zeile der Auswahl: ein Kürzel aus der KBA-Liste oder eine Gemeinde mit ihren verifizierten Kürzeln */
interface Row {
  key: string;
  items: Option[];
  place?: PlaceView;
  name?: string;
}
/** Kreis und Land, damit gleichnamige Gemeinden eindeutig unterscheidbar sind */
const whereOf = (p: PlaceView) => (p.kreis === p.name ? (p.land === p.name ? `Land ${p.land}` : p.land) : `${p.kreis}, ${p.land}`);
const MAX_ROWS = 12;

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
  /** Text unter dem Schild, solange kein Ort erkannt ist */
  idleText?: string;
  onEnter?: () => void;
  describedBy?: string;
  /** Fester Zusatz hinter den Ziffern: E (Elektro) oder H (Oldtimer) – nicht editierbar */
  suffix?: 'E' | 'H';
  /** Schildform; size gilt für das einzeilige Schild, andere Formen behalten den Maßstab */
  format?: PlateFormat;
  /** Gewählter Ort (Ortssuche im Feld „Ort“) */
  place?: PlacePick | null;
  onPlace?: (place: PlacePick | null) => void;
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
  idleText = 'Ins Schild tippen: Ort, Buchstaben, Zahlen',
  onEnter,
  describedBy,
  suffix,
  format = 'eu',
  place = null,
  onPlace,
}: Props) {
  const auto = useId().replace(/:/g, '');
  const id = idProp ?? `pi-${auto}`;
  const refs = {
    cityCode: useRef<HTMLInputElement>(null),
    letters: useRef<HTMLInputElement>(null),
    numbers: useRef<HTMLInputElement>(null),
  };
  const [focus, setFocus] = useState<PlateGroup | null>(null);
  const [hit, setHit] = useState(0);
  /** Freitext im Feld „Ort“ (Ortsname oder PLZ), solange noch kein Kürzel gewählt ist */
  const [cityText, setCityText] = useState<string | null>(null);
  /** Liste erst nach eigener Eingabe zeigen – nicht schon beim Betreten eines bereits ausgefüllten Felds */
  const [typed, setTyped] = useState(false);
  const [places, setPlaces] = useState<{
    q: string;
    list: PlaceView[];
    more: boolean;
  }>({ q: '', list: [], more: false });
  /** Hinweis nach Ortswechsel (z. B. zurückgesetzte Kombination) */
  const [notice, setNotice] = useState('');
  const tap = useRef<{ key: string; x: number; y: number } | null>(null);
  /** Stand beim Betreten des Ortsfelds – wird bei einer abgebrochenen Namenssuche wiederhergestellt */
  const snap = useRef<{ cityCode: string; place: PlacePick | null }>({ cityCode: '', place: null });
  const selectOnFocus = useRef(false);
  const plateRef = useRef<HTMLDivElement>(null);
  /** Liste nach oben öffnen, wenn unter dem Schild zu wenig sichtbarer Platz ist (z. B. Bildschirmtastatur) */
  const [up, setUp] = useState(false);

  const display = {
    cityCode: value.cityCode || placeholder.cityCode,
    letters: value.letters || placeholder.letters,
    numbers: (value.numbers || placeholder.numbers) + (suffix ?? ''),
  };
  const ghost = {
    cityCode: !value.cityCode,
    letters: !value.letters,
    numbers: !value.numbers,
  };
  const geo = useMemo(
    () => plateGeometry(format, display.cityCode, display.letters, display.numbers),
    [format, display.cityCode, display.letters, display.numbers],
  );
  // Suchtext: Ortsname/PLZ im Namensmodus, sonst das getippte Kürzel
  const query = (cityText ?? value.cityCode).trim();
  useEffect(() => {
    if (focus !== 'cityCode' || query.length < 2) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(() => {
      fetch(`/api/orte?q=${encodeURIComponent(query)}`, { signal: ctrl.signal })
        .then((r) => (r.ok ? r.json() : { places: [] }))
        .then((j: { places?: PlaceView[]; more?: boolean }) => setPlaces({ q: query, list: j.places ?? [], more: !!j.more }))
        .catch(() => undefined);
    }, 160);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query, focus]);
  // Nur Treffer zur aktuellen Eingabe zeigen (keine veralteten Antworten)
  const placeList = places.q === query && query.length >= 2 ? places.list : [];
  const rows = useMemo<Row[]>(() => {
    if (focus !== 'cityCode' || !query) return [];
    const codeRows: Row[] =
      cityText === null && query.length <= 3
        ? searchDistricts(query, 4).map((d) => ({
            key: `c-${d.code}`,
            name: d.name,
            items: [{ kind: 'code' as const, ...d }],
          }))
        : [];
    const placeRows: Row[] = placeList.map((p) => ({
      key: `p-${p.ags}`,
      place: p,
      items: p.codes.map((code) => ({
        kind: 'place' as const,
        place: p,
        code,
      })),
    }));
    return [...codeRows, ...placeRows].slice(0, MAX_ROWS);
  }, [focus, query, cityText, placeList]);
  const options = useMemo(() => rows.flatMap((r) => r.items), [rows]);
  // Namenssuche: Die Liste zeigt immer, was gesucht wird (das Schild selbst kann keinen Ortsnamen darstellen)
  const searching = focus === 'cityCode' && cityText !== null && cityText.trim().length > 0;
  const showList =
    searching || (typed && rows.length > 0 && !(rows.length === 1 && options.length === 1 && options[0].kind === 'code' && options[0].code === value.cityCode));
  const searchState =
    !searching || rows.length
      ? ''
      : query.length < 2
        ? 'Bitte mindestens zwei Buchstaben eingeben'
        : places.q !== query
          ? 'Suche …'
          : 'Kein Ort gefunden – Schreibweise prüfen oder PLZ eingeben';
  const optId = (i: number) => `${id}-opt-${i}`;
  useEffect(() => {
    if (!showList) return;
    const measure = () => {
      const el = plateRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vv = window.visualViewport;
      const top = vv?.offsetTop ?? 0;
      const bottom = top + (vv?.height ?? window.innerHeight);
      const below = bottom - r.bottom;
      const above = r.top - top;
      setUp(below < 280 && above > below);
    };
    measure();
    window.visualViewport?.addEventListener('resize', measure);
    window.visualViewport?.addEventListener('scroll', measure);
    return () => {
      window.visualViewport?.removeEventListener('resize', measure);
      window.visualViewport?.removeEventListener('scroll', measure);
    };
  }, [showList]);
  const districtName = value.cityCode ? lookupDistrict(value.cityCode) : null;
  const placeLabel = place && place.codes.includes(value.cityCode) ? placeText(place) : null;

  const vbW = geo.W + PLATE_VIEW.PAD_X * 2;
  const vbH = geo.H + PLATE_VIEW.PAD_Y + PLATE_VIEW.PAD_B;
  // Gleicher Maßstab wie das einzeilige Schild: zweizeilige Schilder sind entsprechend schmaler
  const ratio = geo.W / PLATE.W;
  const plateWidth = typeof size === 'number' ? `${size * ratio}px` : ratio === 1 ? size : `calc(${size} * ${ratio.toFixed(4)})`;
  // Tippzonen decken das ganze Schild ab – auch auf dem Handy gut zu treffen.
  const box = (g: PlateGroup) => {
    const z = geo.zones[g];
    return {
      left: `${((z.x0 + PLATE_VIEW.PAD_X) / vbW) * 100}%`,
      width: `${((z.x1 - z.x0) / vbW) * 100}%`,
      top: `${((z.y0 + PLATE_VIEW.PAD_Y) / vbH) * 100}%`,
      height: `${((z.y1 - z.y0) / vbH) * 100}%`,
    };
  };

  const focusGroup = (g: PlateGroup) => {
    const el = refs[g].current;
    if (!el) return;
    el.focus();
    selectOnFocus.current = false;
    const end = el.value.length;
    el.setSelectionRange(end, end);
  };
  const emit = (next: WishInput, moveTo?: PlateGroup) => {
    if (notice) setNotice('');
    onChange(normalizeWish(next));
    // Sofort weiterspringen – bei schnellem Tippen darf kein Zeichen im alten Feld landen.
    if (moveTo) focusGroup(moveTo);
  };

  const handle = (g: PlateGroup, raw: string) => {
    const up = raw.toUpperCase();
    // Ganzes Kennzeichen getippt oder eingefügt („ohz ?? ??“, „OHZ-AB 123“)
    // Ortsname bzw. PLZ im Feld „Ort“: mehr als drei Buchstaben, oder bereits im Namensmodus (dann auch Leerzeichen/Bindestrich)
    if (
      g === 'cityCode' &&
      !/[?]/.test(up) &&
      (/^\d+$/.test(up.trim()) || (!/[0-9]/.test(up) && (cityText !== null || up.replace(/[^A-ZÄÖÜ]/g, '').length > 3)))
    ) {
      const t = raw.replace(/^\s+/, '');
      if (t.replace(/[^A-Za-zÄÖÜäöüß0-9]/g, '').length <= 3 && /^[A-Za-zÄÖÜäöü]*$/.test(t)) {
        setCityText(null);
        if (place && !place.codes.includes(t.toUpperCase())) onPlace?.(null);
        return emit({ ...value, cityCode: t.toUpperCase() });
      }
      setCityText(t);
      setHit(0);
      // Die bisherige Auswahl bleibt bestehen, bis ein neuer Ort gewählt wird (auch die ersten getippten Buchstaben
      // zählen noch nicht als Kürzel) – wer das Feld ohne Auswahl verlässt, behält Ort und Kürzel.
      const before = snap.current;
      if (place?.ags !== before.place?.ags) onPlace?.(before.place);
      if (value.cityCode !== before.cityCode) return emit({ ...value, cityCode: before.cityCode });
      return;
    }
    if (g === 'cityCode' && /[\s\-0-9?]/.test(up)) {
      let p: WishInput;
      if (/[\s-]/.test(up.trim())) p = parseWishText(up);
      else {
        // Am Stück getippt („OHZRO87“): Ort = erste drei Buchstaben, dann Buchstaben, dann Ziffern
        const m = /^([A-ZÄÖÜ]*)([A-Z?]*)([0-9?]*)/.exec(up.replace(/[^A-ZÄÖÜ0-9?]/g, '')) ?? ['', '', '', ''];
        const head = m[1] + m[2];
        p = {
          cityCode: head.slice(0, 3),
          letters: head.slice(3, 5),
          numbers: m[3],
        };
      }
      const next = {
        cityCode: p.cityCode,
        letters: p.letters || value.letters,
        numbers: p.numbers || value.numbers,
      };
      return emit(next, p.numbers ? 'numbers' : 'letters');
    }
    if (g === 'letters') {
      const digits = up.replace(/[^0-9]/g, '');
      const clean = up.replace(/[^A-Z?]/g, '');
      if (digits)
        return emit(
          {
            ...value,
            letters: clean,
            numbers: (digits + value.numbers).slice(0, 4),
          },
          'numbers',
        );
      if (/[\s-]/.test(up)) return emit({ ...value, letters: clean }, 'numbers');
      return emit({ ...value, letters: clean }, clean.length >= 2 && clean.length > value.letters.length ? 'numbers' : undefined);
    }
    if (g === 'numbers') return emit({ ...value, numbers: up.replace(/[^0-9?]/g, '') });
    const city = up.replace(/[^A-ZÄÖÜ]/g, '');
    if (place && !place.codes.includes(city)) onPlace?.(null);
    // Nur bei einem amtlich verifizierten Kürzel weiterspringen – sonst kann ein Ortsname weitergetippt werden
    return emit({ ...value, cityCode: city }, city.length >= 3 && city.length > value.cityCode.length && lookupDistrict(city) ? 'letters' : undefined);
  };

  const onKey = (g: PlateGroup, e: KeyboardEvent<HTMLInputElement>) => {
    const i = GROUPS.indexOf(g);
    if (g === 'cityCode' && showList && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setHit((h) => (h + (e.key === 'ArrowDown' ? 1 : options.length - 1)) % options.length);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (g === 'cityCode' && showList) return pick(options[hit] ?? options[0]);
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

  const pick = (o: Option | undefined) => {
    if (!o) return;
    setHit(0);
    setCityText(null);
    setPlaces({ q: '', list: [], more: false });
    if (o.kind === 'place')
      onPlace?.({
        ags: o.place.ags,
        name: o.place.name,
        ...(o.place.zusatz ? { zusatz: o.place.zusatz } : {}),
        kreis: o.place.kreis,
        codes: o.place.codes,
      });
    else if (place && !place.codes.includes(o.code)) onPlace?.(null);
    // Ortswechsel: Buchstaben/Zahlen, die mit dem neuen Kürzel die Höchstlänge (8 Zeichen) sprengen, zurücksetzen
    const next = { ...value, cityCode: o.code };
    const tooLong = o.code.length + value.letters.length + value.numbers.length > 8;
    if (tooLong) {
      onChange(normalizeWish({ cityCode: o.code, letters: '', numbers: '' }));
      setNotice(`Die bisherige Kombination passt mit ${o.code} nicht mehr (höchstens 8 Zeichen) – bitte neu wählen.`);
      return focusGroup('letters');
    }
    emit(next, 'letters');
  };
  // Antippen: Auswahl erst beim Loslassen ohne Wischbewegung – so lässt sich die Liste auf dem Handy auch scrollen.
  // preventDefault beim Aufsetzen hält den Fokus im Feld (sonst schließt die Liste vor der Auswahl).
  const tapProps = (o: Option, key: string) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      tap.current = { key, x: e.clientX, y: e.clientY };
    },
    onPointerUp: (e: PointerEvent<HTMLButtonElement>) => {
      const t = tap.current;
      tap.current = null;
      if (t && t.key === key && Math.hypot(e.clientX - t.x, e.clientY - t.y) < 12) pick(o);
    },
    onPointerCancel: () => {
      tap.current = null;
    },
    // Tastatur bzw. Screenreader lösen einen Klick ohne Zeiger aus
    onClick: (e: { detail: number }) => {
      if (e.detail === 0) pick(o);
    },
  });

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
        ref={plateRef}
        style={{ inlineSize: plateWidth }}
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
          format={format}
          showSealPlaceholder
        />
        {GROUPS.map((g) => (
          <input
            key={g}
            ref={refs[g]}
            className="pi__field"
            style={box(g)}
            value={g === 'cityCode' && cityText !== null ? cityText : value[g]}
            onChange={(e) => {
              if (g === 'cityCode') setTyped(true);
              handle(g, e.target.value);
            }}
            onKeyDown={(e) => onKey(g, e)}
            onPaste={onPaste}
            onFocus={(e) => {
              setFocus(g);
              const end = e.currentTarget.value.length;
              if (g === 'cityCode') {
                snap.current = { cityCode: value.cityCode, place };
                setTyped(false);
                // Ort-Feld beim Antippen markieren: ein neuer Ortsname ersetzt das Kürzel statt angehängt zu werden
                // (springt die Eingabe per Rücktaste hierher, setzt focusGroup die Schreibmarke danach ans Ende)
                if (end) {
                  e.currentTarget.setSelectionRange(0, end);
                  selectOnFocus.current = true;
                  return;
                }
              }
              e.currentTarget.setSelectionRange(end, end);
            }}
            onMouseUp={(e) => {
              // Der Klick würde die Markierung sonst wieder aufheben
              if (selectOnFocus.current) e.preventDefault();
              selectOnFocus.current = false;
            }}
            onBlur={() => {
              setFocus((f) => (f === g ? null : f));
              if (g === 'cityCode') setCityText(null);
            }}
            onSelect={(e) => {
              const el = e.currentTarget;
              if (el.selectionStart !== el.value.length && el.selectionStart === el.selectionEnd && !selectOnFocus.current) el.setSelectionRange(el.value.length, el.value.length);
            }}
            maxLength={g === 'cityCode' ? 40 : MAX[g] + 1}
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
            aria-activedescendant={g === 'cityCode' && showList && options[hit] ? optId(hit) : undefined}
          />
        ))}
        {showList ? (
          <div className={`pi__list${up ? ' pi__list--up' : ''}`}>
            {searching ? (
              <p className="pi__query" aria-hidden="true">
                Suche: <strong>{cityText}</strong>
              </p>
            ) : null}
            {searchState ? (
              <p className="pi__more" role="status">
                {searchState}
              </p>
            ) : null}
            <div id={`${id}-list`} role="listbox" aria-label="Ort oder Ortskennzeichen">
              {rows.map((r) => {
                const first = options.indexOf(r.items[0]);
                const where = r.place ? whereOf(r.place) : '';
                // Zeile mit genau einem Kürzel: ganze Zeile antippbar
                if (r.items.length === 1) {
                  const o = r.items[0];
                  return (
                    <button
                      key={r.key}
                      type="button"
                      tabIndex={-1}
                      id={optId(first)}
                      role="option"
                      aria-selected={first === hit}
                      className="pi__opt"
                      {...tapProps(o, r.key)}
                    >
                      <span className="pi__row-label">
                        {r.place ? nameOf(r.place) : r.name}
                        {r.place ? <span className="pi__muted"> · {where}</span> : null}
                      </span>
                      <span className="pi__chip" aria-hidden="true">
                        {o.code}
                      </span>
                    </button>
                  );
                }
                return (
                  <div key={r.key} className="pi__row" role="group" aria-label={r.place ? `${nameOf(r.place)}, ${where}` : r.name}>
                    <span className="pi__row-label">
                      {r.place && nameOf(r.place)}
                      <span className="pi__muted"> · {where}</span>
                      {r.items.length === 0 ? <span className="pi__muted"> – Ortskennzeichen wird amtlich geprüft</span> : null}
                    </span>
                    {r.items.length ? (
                      <span className="pi__chips">
                        {r.items.map((o) => {
                          const i = options.indexOf(o);
                          return (
                            <button
                              key={o.code}
                              type="button"
                              tabIndex={-1}
                              id={optId(i)}
                              role="option"
                              aria-selected={i === hit}
                              aria-label={`${o.code} – ${r.place && nameOf(r.place)}, ${where}`}
                              className="pi__chip"
                              {...tapProps(o, `${r.key}-${o.code}`)}
                            >
                              {o.code}
                            </button>
                          );
                        })}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {places.more && placeList.length ? (
              <p className="pi__more">Weitere Orte gefunden – Landkreis oder PLZ ergänzen, z. B. „Neuenkirchen Diepholz“.</p>
            ) : null}
          </div>
        ) : null}
      </div>
      {notice ? (
        <p className="pi__notice" role="status">
          {notice}
        </p>
      ) : null}
      {showDistrict ? (
        <p className="pi__district" aria-live="polite">
          {districtName ? (
            <>
              <strong>{value.cityCode}</strong> · {placeLabel ?? districtName}
            </>
          ) : (
            idleText
          )}
        </p>
      ) : null}
    </div>
  );
}
