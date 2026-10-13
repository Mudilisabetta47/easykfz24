import type { Metadata } from 'next';
import '../../../../styles/forms.css';
import { OrderWizard } from '../../../../components/order/OrderWizard.tsx';
import { PromoBadge, promoActive } from '../../../../components/Promo.tsx';
import { checkPlate } from '../../../../lib/validation.ts';
import { paymentsEnabled } from '../../../../server/payments.ts';
import { getPlateOffer } from '../../../../server/plates.ts';
import { getExpressOffer } from '../../../../server/express.ts';
import { placeByAgs } from '../../../../server/regions.ts';
import { withdrawalMode } from '../../../../server/withdrawal.ts';
import { poaCreationEnabled } from '../../../../server/power-of-attorney.ts';

export const metadata: Metadata = {
  title: 'Vorgang starten',
  description: 'Kfz-Zulassung, Ummeldung, Wiederzulassung oder Abmeldung online beauftragen.',
};

export default async function AuftragPage({ searchParams }: { searchParams: Promise<{ leistung?: string; wunsch?: string; paket?: string; kennzeichen?: string; fahrzeug?: string; art?: string; ort?: string }> }) {
  const { leistung = '', wunsch = '', paket = '', kennzeichen = '', fahrzeug = '', art = '', ort = '' } = await searchParams;
  const wish = checkPlate(wunsch.slice(0, 20));
  // Begonnenes Wunschkennzeichen (z. B. nur „OHZ“ oder „OHZ-AB“) bleibt beim Neuladen erhalten
  const wishDraft = wish.ok ? wish.value : /^[A-ZÄÖÜ]{1,3}(-[A-Z]{0,2})?$/.test(wunsch) ? wunsch : '';
  const current = checkPlate(kennzeichen.slice(0, 20));
  // Gewählter Ort (Amtlicher Gemeindeschlüssel) – nur übernehmen, wenn das Wunsch-Kürzel amtlich zu ihm gehört
  const found = /^\d{8}$/.test(ort) ? placeByAgs(ort) : null;
  const wishCode = wishDraft.split('-')[0];
  const place = found && found.codes.length && (!wishCode || found.codes.includes(wishCode)) ? { ags: found.ags, name: found.name, ...(found.zusatz ? { zusatz: found.zusatz } : {}), kreis: found.kreisName, codes: found.codes } : null;
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
        <OrderWizard initial={leistung.slice(0, 30)} wish={wishDraft} currentPlate={current.ok ? current.value : ''} vehicleType={fahrzeug.slice(0, 20)} plateKind={art === 'e' || art === 'h' ? art : null} payOnline={paymentsEnabled()} bundle={paket === '1'} wishPlace={place} withdrawalInfo={withdrawalMode() !== 'aus'} birthPlace={poaCreationEnabled()} plateOffer={await getPlateOffer()} expressOffer={await getExpressOffer()} />
      </div>
    </>
  );
}
