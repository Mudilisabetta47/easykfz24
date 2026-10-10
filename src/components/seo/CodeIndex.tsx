'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';

export interface CodeEntry {
  code: string;
  slug: string;
  name: string;
  state: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Alle Ortskennzeichen mit Suche (Kürzel, Bezirk, Bundesland) und Sprungmarken A–Z. */
export function CodeIndex({ entries }: { entries: CodeEntry[] }) {
  const [query, setQuery] = useState('');
  const q = norm(useDeferredValue(query).trim());
  const filtered = useMemo(
    () =>
      q
        ? entries.filter((e) => norm(e.code).startsWith(q) || norm(e.name).includes(q) || norm(e.state).includes(q))
        : entries,
    [entries, q],
  );
  const groups = useMemo(() => {
    const m = new Map<string, CodeEntry[]>();
    for (const e of filtered) {
      const letter = norm(e.code[0]).toUpperCase();
      m.set(letter, [...(m.get(letter) ?? []), e]);
    }
    return [...m.entries()];
  }, [filtered]);

  return (
    <div className="code-index">
      <div className="code-index__bar">
        <label className="code-index__search">
          <span className="sr-only">Kennzeichen suchen</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Kürzel, Stadt, Landkreis oder Bundesland – z. B. OHZ oder Bremen"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        {!q ? (
          <nav className="code-index__letters" aria-label="Anfangsbuchstaben">
            {groups.map(([l]) => (
              <a key={l} href={`#buchstabe-${l}`}>
                {l}
              </a>
            ))}
          </nav>
        ) : (
          <p className="code-index__count" aria-live="polite">
            {filtered.length === 1 ? '1 Kennzeichen' : `${filtered.length} Kennzeichen`}
          </p>
        )}
      </div>
      {groups.map(([letter, list]) => (
        <section key={letter} id={`buchstabe-${letter}`} className="code-index__group" aria-label={`Kennzeichen mit ${letter}`}>
          <h2>{letter}</h2>
          <ul role="list">
            {list.map((e) => (
              <li key={e.code}>
                <Link href={`/kennzeichen/${e.slug}`}>
                  <strong>{e.code}</strong>
                  <span>{e.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {!filtered.length ? <p className="code-index__empty">Kein Kennzeichen gefunden. Versuch es mit dem Kürzel oder dem Namen des Landkreises.</p> : null}
    </div>
  );
}
