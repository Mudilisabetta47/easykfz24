import type { Metadata } from 'next';
import '../../../../styles/forms.css';
import { OrderWizard } from '../../../../components/order/OrderWizard.tsx';
import { PromoBadge, promoActive } from '../../../../components/Promo.tsx';
import { checkPlate } from '../../../../lib/validation.ts';
import { paymentsEnabled } from '../../../../server/payments.ts';

export const metadata: Metadata = {
  title: 'Vorgang starten',
  description: 'Kfz-Zulassung, Ummeldung, Wiederzulassung oder Abmeldung online beauftragen.',
};

export default async function AuftragPage({ searchParams }: { searchParams: Promise<{ leistung?: string; wunsch?: string; paket?: string; kennzeichen?: string; fahrzeug?: string; art?: string }> }) {
  const { leistung = '', wunsch = '', paket = '', kennzeichen = '', fahrzeug = '', art = '' } = await searchParams;
  const wish = checkPlate(wunsch.slice(0, 20));
  const current = checkPlate(kennzeichen.slice(0, 20));
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Online beauftragen</p>
          <h1>Vorgang starten</h1>
          <p className="lead">In sechs Schritten zum vollständigen Auftrag. Ihre Angaben werden erst mit dem letzten Schritt übermittelt.</p>
          {promoActive() ? (
            <p className="page-head__promo">
              <PromoBadge /> Ihr Einführungsvorteil: 10 % auf die Servicepauschale Ihrer ersten Beauftragung – automatisch abgezogen.
            </p>
          ) : null}
        </div>
      </header>
      <div className="shell wizard-shell">
        <OrderWizard initial={leistung.slice(0, 30)} wish={wish.ok ? wish.value : ''} currentPlate={current.ok ? current.value : ''} vehicleType={fahrzeug.slice(0, 20)} plateKind={art === 'e' || art === 'h' ? art : null} payOnline={paymentsEnabled()} bundle={paket === '1'} />
      </div>
    </>
  );
}
