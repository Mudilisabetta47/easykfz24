import Link from 'next/link';
import { SITE } from '../lib/site.ts';
import { Logo } from './Logo.tsx';
import { Ph } from './Ph.tsx';
import { CarrierMarks, PaymentMarks } from './Brands.tsx';

export function SiteFooter() {
  return (
    <footer className="site-footer on-dark">
      <div className="shell">
        <div className="site-footer__grid">
          <div className="site-footer__brand">
            <Logo />
            <p>
              Digitaler Kfz-Zulassungsservice. Wir übernehmen mit Ihrer Vollmacht Zulassung, Ummeldung,
              Wiederzulassung und Abmeldung. EasyKFZ24 ist keine Behörde.
            </p>
          </div>
          <div>
            <h2>Leistungen</h2>
            <ul>
              <li><Link href="/kfz-anmelden#neuzulassung">Zulassung</Link></li>
              <li><Link href="/kfz-anmelden#ummeldung">Ummeldung</Link></li>
              <li><Link href="/kfz-anmelden#wiederzulassung">Wiederzulassung</Link></li>
              <li><Link href="/kfz-anmelden#abmeldung">Abmeldung</Link></li>
            </ul>
          </div>
          <div>
            <h2>Service</h2>
            <ul>
              <li><Link href="/kfz-anmelden/auftrag">Vorgang starten</Link></li>
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
              <li><Link href="/kfz-anmelden/vollmacht">Vollmacht (Vorlage)</Link></li>
            </ul>
          </div>
        </div>
        <div className="site-footer__partners">
          <PaymentMarks />
          <CarrierMarks />
        </div>
        <div className="site-footer__bottom">
          <span>
            Ein Service der <Ph>{SITE.company}</Ph>
          </span>
          <span>Alle Fahrzeug- und Kennzeichendarstellungen sind schematisch.</span>
        </div>
      </div>
    </footer>
  );
}
