import Link from 'next/link';
import { BRAND_NOTE } from '../lib/site.ts';
import { NOTICE_PATH, WITHDRAW_LABEL, WITHDRAW_PATH } from '../lib/withdrawal.ts';
import { withdrawalMode } from '../server/withdrawal.ts';
import { Logo } from './Logo.tsx';
import { CarrierMarks, PaymentMarks } from './Brands.tsx';

export function SiteFooter() {
  // Widerrufsfunktion (§ 356a BGB) auf jeder Seite erreichbar – erst nach Freischaltung (WIDERRUF_AKTIV=1) bzw. lokal als Vorschau
  const withdrawal = withdrawalMode() !== 'aus';
  return (
    <footer className="site-footer on-dark">
      <div className="shell">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Logo id="logo-fuss" />
            <p>
              Digitaler Kfz-Zulassungsservice. Wir übernehmen mit Ihrer Vollmacht Zulassung, Ummeldung,
              Wiederzulassung und Abmeldung. EasyKFZ24 ist keine Behörde.
            </p>
          </div>
          <div>
            <h2>Leistungen</h2>
            <ul>
              <li><Link href="/kfz-anmelden#neuzulassung">Zulassung</Link></li>
              <li><Link href="/auto-ummelden">Ummeldung</Link></li>
              <li><Link href="/kfz-anmelden#wiederzulassung">Wiederzulassung</Link></li>
              <li><Link href="/auto-abmelden">Abmeldung</Link></li>
            </ul>
          </div>
          <div>
            <h2>Service</h2>
            <ul>
              <li><Link href="/kfz-anmelden/auftrag">Vorgang starten</Link></li>
              <li><Link href="/wunschkennzeichen">Wunschkennzeichen</Link></li>
              <li><Link href="/kennzeichen">Kennzeichen A–Z</Link></li>
              <li><Link href="/status">Status abrufen</Link></li>
              <li><Link href="/#ablauf">So funktioniert&apos;s</Link></li>
              <li><Link href="/#faq">Hilfe &amp; FAQ</Link></li>
            </ul>
          </div>
          <div>
            <h2>Rechtliches</h2>
            <ul>
              <li><Link href="/impressum">Impressum</Link></li>
              <li><Link href="/datenschutz">Datenschutz</Link></li>
              <li><Link href="/kundeninformationen">Kundeninformationen</Link></li>
              <li><Link href="/kfz-anmelden/vollmacht">Vollmacht (Vorlage)</Link></li>
              {withdrawal ? <li><Link href={NOTICE_PATH}>Widerrufsbelehrung</Link></li> : null}
              {withdrawal ? <li><Link href={WITHDRAW_PATH}>{WITHDRAW_LABEL}</Link></li> : null}
            </ul>
          </div>
        </div>
        <div className="site-footer__partners">
          <PaymentMarks />
          <CarrierMarks />
        </div>
        <div className="site-footer__bottom">
          <span>{BRAND_NOTE}</span>
          <span>Alle Fahrzeug- und Kennzeichendarstellungen sind schematisch.</span>
        </div>
      </div>
    </footer>
  );
}
