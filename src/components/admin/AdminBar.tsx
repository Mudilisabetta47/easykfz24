import Link from 'next/link';
import { logoutAction } from '../../app/admin/actions.ts';
import { LogoMark } from '../Logo.tsx';

export function AdminBar() {
  return (
    <header className="admin-bar no-print">
      <div className="admin-shell admin-bar__inner">
        <Link href="/admin" className="admin-bar__brand">
          <LogoMark />
          <span>
            EasyKFZ24 <span className="muted">Verwaltung</span>
          </span>
        </Link>
        <nav className="admin-bar__nav" aria-label="Verwaltung">
          <Link href="/admin">Aufträge</Link>
          <Link href="/" target="_blank">
            Website
          </Link>
        </nav>
        <form action={logoutAction}>
          <button type="submit" className="btn btn--ghost btn--sm">
            Abmelden
          </button>
        </form>
      </div>
    </header>
  );
}
