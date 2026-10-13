import Link from 'next/link';
import { BRAND_NOTE } from '../lib/site.ts';

/** Seite nicht gefunden – schlicht, mit Weg zurück und den Rechtstexten (Impressum auf jeder öffentlichen Seite erreichbar). */
export default function NotFound() {
  return (
    <main className="shell section-pad prose">
      <p className="label">Fehler 404</p>
      <h1>Seite nicht gefunden</h1>
      <p>Die aufgerufene Seite gibt es nicht oder nicht mehr.</p>
      <p>
        <Link href="/">Zur Startseite</Link> · <Link href="/kfz-anmelden">Vorgang starten</Link> · <Link href="/status">Status abrufen</Link>
      </p>
      <p className="muted">
        {BRAND_NOTE} <Link href="/impressum">Impressum</Link> · <Link href="/datenschutz">Datenschutz</Link>
      </p>
    </main>
  );
}
