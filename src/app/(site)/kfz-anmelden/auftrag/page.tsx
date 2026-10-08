import type { Metadata } from 'next';
import '../../../../styles/forms.css';
import { OrderWizard } from '../../../../components/order/OrderWizard.tsx';

export const metadata: Metadata = {
  title: 'Vorgang starten',
  description: 'Kfz-Zulassung, Ummeldung, Wiederzulassung oder Abmeldung online beauftragen.',
};

export default async function AuftragPage({ searchParams }: { searchParams: Promise<{ leistung?: string }> }) {
  const { leistung = '' } = await searchParams;
  return (
    <>
      <header className="page-head page-head--compact">
        <div className="shell">
          <p className="label">Online beauftragen</p>
          <h1>Vorgang starten</h1>
          <p className="lead">In sechs Schritten zum vollständigen Auftrag. Ihre Angaben werden erst mit dem letzten Schritt übermittelt.</p>
        </div>
      </header>
      <div className="shell wizard-shell">
        <OrderWizard initial={leistung.slice(0, 30)} />
      </div>
    </>
  );
}
