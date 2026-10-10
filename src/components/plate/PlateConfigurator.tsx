'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { checkWish, normalizeWish, type WishInput } from '../../lib/wish-plate.ts';
import { GermanLicensePlate } from '../GermanLicensePlate.tsx';
import { PlateInput } from './PlateInput.tsx';
import { ArrowRight, Close, Restart } from '../icons.tsx';

type Status = 'frei' | 'vergeben' | 'unbekannt';
interface Suggestion extends WishInput {
  plate: string;
  status: Status;
}
interface ApiResult {
  ok: boolean;
  error?: string;
  field?: string;
  district?: { code: string; name: string };
  provider?: 'keiner' | 'extern';
  suggestions?: Suggestion[];
}

const STATUS_TEXT: Record<Status, string> = {
  frei: 'Frei',
  vergeben: 'Vergeben',
  unbekannt: 'Wird bei Reservierung geprüft',
};

/** Macht ein beliebiges Kennzeichen anklickbar und öffnet den Konfigurator. */
export function PlateTrigger({ children, className = '', initial }: { children: ReactNode; className?: string; initial?: WishInput }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`plate-trigger ${className}`}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        aria-label="Wunschkennzeichen zusammenstellen"
        data-cursor="Ändern"
      >
        {children}
        <span className="plate-trigger__hint" aria-hidden="true">
          Kennzeichen ändern
        </span>
      </button>
      {open ? (
        <PlateConfigurator
          initial={initial}
          onClose={() => {
            setOpen(false);
            btn.current?.focus();
          }}
        />
      ) : null}
    </>
  );
}

export function PlateConfigurator({
  onClose,
  initial,
  onPick,
}: {
  onClose: () => void;
  initial?: WishInput;
  /** Übernahme-Modus (im Auftrag): gewähltes Kennzeichen zurückgeben statt zum Auftrag zu verlinken */
  onPick?: (plate: string) => void;
}) {
  const [wish, setWish] = useState<WishInput>(initial ?? { cityCode: '', letters: '', numbers: '' });
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<ApiResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Suggestion | null>(null);
  const dialog = useRef<HTMLDivElement>(null);

  // Leere Buchstaben/Zahlen bedeuten „beliebig“ – dann kommen Vorschläge.
  const local = useMemo(() => checkWish({ ...wish, letters: wish.letters || '??', numbers: wish.numbers || '??' }), [wish]);

  // Scrollsperre, Fokus, Escape, Fokusfalle
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-scroll-lock', '');
    const prevOverflow = root.style.overflow;
    root.style.overflow = 'hidden';
    dialog.current?.querySelector<HTMLInputElement>('.pi__field')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key !== 'Tab' || !dialog.current) return;
      const items = dialog.current.querySelectorAll<HTMLElement>('button:not([disabled]), a, input');
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.removeAttribute('data-scroll-lock');
      root.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  // Vorschläge laden (entprellt)
  useEffect(() => {
    if (!local.ok) {
      setResult(null);
      return;
    }
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      setLoading(true);
      try {
        const q = new URLSearchParams({ ort: local.pattern.cityCode, buchstaben: local.pattern.letters, zahlen: local.pattern.numbers, seite: String(page) });
        const res = await fetch(`/api/kennzeichen?${q}`, { signal: ctrl.signal });
        const json = (await res.json()) as ApiResult;
        setResult(json);
        setSelected(json.suggestions?.[0] ?? null);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') setResult({ ok: false, error: 'Vorschläge konnten nicht geladen werden.' });
      } finally {
        setLoading(false);
      }
    }, 260);
    return () => {
      ctrl.abort();
      window.clearTimeout(t);
    };
  }, [local, page]);

  const update = useCallback((next: WishInput) => {
    setWish(normalizeWish(next));
    setPage(0);
    setSelected(null);
  }, []);

  const fieldError = !local.ok && wish.cityCode ? local : null;
  // Offene Stellen zeigen grau die gerade gewählte Kombination
  const placeholder = { cityCode: 'HB', letters: selected?.letters ?? 'EZ', numbers: selected?.numbers ?? '24' };

  return createPortal(
    <div className="pc" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="pc__panel" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="pc-title" data-native-scroll>
        <header className="pc__head">
          <div>
            <p className="label">Wunschkennzeichen</p>
            <h2 id="pc-title">Dein Kennzeichen zusammenstellen</h2>
          </div>
          <button type="button" className="pc__close" onClick={onClose} aria-label="Schließen">
            <Close width={20} height={20} />
          </button>
        </header>

        <div className="pc__preview">
          <PlateInput
            id="pc-input"
            value={wish}
            onChange={update}
            placeholder={placeholder}
            size="min(100%, 620px)"
            bubble="Kennzeichen eingeben"
            showDistrict={false}
            invalid={fieldError ? fieldError.field : null}
            describedBy="pc-district"
            onEnter={() => selected && onPick?.(selected.plate)}
          />
        </div>
        <p className="pc__district" id="pc-district" aria-live="polite">
          {local.ok ? (
            <>
              <strong>{local.pattern.cityCode}</strong> · {local.districtName}
            </>
          ) : fieldError ? (
            <span className="pc__error">{fieldError.error}</span>
          ) : (
            'Einfach ins Schild tippen: Ort, dann Buchstaben und Zahlen. Lässt du die leer, schlagen wir Kombinationen vor.'
          )}
        </p>

        {local.ok ? (
          <section className="pc__results" aria-label="Vorschläge" aria-busy={loading}>
            <div className="pc__results-head">
              <h3>{local.openSlots ? 'Vorschläge' : 'Deine Kombination'}</h3>
              {local.openSlots ? (
                <button type="button" className="pc__more" onClick={() => setPage((p) => p + 1)} disabled={loading}>
                  <Restart width={16} height={16} /> Neue Vorschläge
                </button>
              ) : null}
            </div>
            {result && !result.ok ? <p className="pc__error">{result.error}</p> : null}
            <ul className="pc__grid" role="list">
              {(result?.suggestions ?? []).map((s, i) => (
                <li key={s.plate}>
                  <button
                    type="button"
                    className={`pc__option${selected?.plate === s.plate ? ' is-selected' : ''}`}
                    onClick={() => setSelected(s)}
                    disabled={s.status === 'vergeben'}
                    aria-pressed={selected?.plate === s.plate}
                  >
                    <GermanLicensePlate id={`pc-s${page}-${i}`} cityCode={s.cityCode} letters={s.letters} numbers={s.numbers} size="100%" detail="lite" />
                    <span className={`pc__status pc__status--${s.status}`}>{STATUS_TEXT[s.status]}</span>
                  </button>
                </li>
              ))}
            </ul>
            {result?.provider !== 'extern' ? (
              <p className="pc__note">
                Ob eine Kombination frei ist, prüfen wir bei der Reservierung durch die Zulassungsstelle in {local.districtName}. Ist sie
                vergeben, melden wir uns mit Alternativen.
              </p>
            ) : null}
          </section>
        ) : null}

        <footer className="pc__foot">
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Schließen
          </button>
          {selected && onPick ? (
            <button type="button" className="btn" onClick={() => onPick(selected.plate)}>
              {selected.plate} übernehmen <ArrowRight className="btn__icon" />
            </button>
          ) : selected ? (
            <Link href={`/kfz-anmelden/auftrag?wunsch=${encodeURIComponent(selected.plate)}`} className="btn" onClick={onClose}>
              {selected.plate} reservieren lassen <ArrowRight className="btn__icon" />
            </Link>
          ) : null}
        </footer>
      </div>
    </div>,
    document.body,
  );
}
