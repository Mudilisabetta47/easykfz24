'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { ArrowRight, Close } from './icons.tsx';
import { Logo } from './Logo.tsx';

export const NAV_ITEMS = [
  { href: '/kfz-anmelden#neuzulassung', label: 'Zulassung' },
  { href: '/kfz-anmelden#ummeldung', label: 'Ummeldung' },
  { href: '/kfz-anmelden#abmeldung', label: 'Abmeldung' },
  { href: '/#ablauf', label: "So funktioniert's" },
  { href: '/#haendler', label: 'Für Händler' },
  { href: '/#preise', label: 'Preise' },
  { href: '/#faq', label: 'Hilfe' },
];

/** Seiten mit dunklem Bühnenkopf bekommen anfangs helle Schrift im Header. */
const DARK_TOP = new Set(['/']);

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const burgerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    burgerRef.current?.focus();
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    if (open) {
      root.setAttribute('data-scroll-lock', '');
      root.style.overflow = 'hidden';
      menuRef.current?.querySelector<HTMLElement>('a, button')?.focus();
    } else {
      root.removeAttribute('data-scroll-lock');
      root.style.overflow = '';
    }
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key !== 'Tab' || !menuRef.current) return;
      const items = menuRef.current.querySelectorAll<HTMLElement>('a, button');
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
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);

  const tone = DARK_TOP.has(pathname) ? 'dark' : 'light';

  return (
    <>
      <header className="site-header" data-header data-tone={tone} data-menu={open ? 'open' : 'closed'}>
        <div className="shell site-header__inner">
          <Logo />
          <nav className="nav" aria-label="Hauptnavigation">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="site-header__actions">
            <Link href="/status" className="btn btn--ghost btn--sm">
              Anmelden
            </Link>
            <Link href="/kfz-anmelden/auftrag" className="btn btn--sm" data-magnetic="0.2" data-cursor="Start">
              Jetzt starten
            </Link>
            <button
              ref={burgerRef}
              type="button"
              className="burger"
              aria-expanded={open}
              aria-controls="mobile-nav"
              aria-label="Menü öffnen"
              onClick={() => setOpen(true)}
            >
              <span />
            </button>
          </div>
        </div>
      </header>

      <div
        id="mobile-nav"
        ref={menuRef}
        className="mobile-nav on-dark"
        data-open={open}
        role="dialog"
        aria-modal="true"
        aria-label="Menü"
        inert={!open}
      >
        <div className="mobile-nav__top">
          <Logo />
          <button type="button" className="mobile-nav__close" aria-label="Menü schließen" onClick={close}>
            <Close width={20} height={20} />
          </button>
        </div>
        <ul>
          {NAV_ITEMS.map((item, i) => (
            <li key={item.href} style={{ '--i': i } as CSSProperties}>
              <Link href={item.href} onClick={() => setOpen(false)}>
                {item.label}
                <ArrowRight width={20} height={20} />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mobile-nav__cta">
          <Link href="/kfz-anmelden/auftrag" className="btn btn--lg" onClick={() => setOpen(false)}>
            Jetzt starten <ArrowRight className="btn__icon" />
          </Link>
          <Link href="/status" className="btn btn--glass btn--lg" onClick={() => setOpen(false)}>
            Anmelden – Vorgang abrufen
          </Link>
        </div>
      </div>
    </>
  );
}
