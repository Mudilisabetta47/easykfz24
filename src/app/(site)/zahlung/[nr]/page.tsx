import type { Metadata } from 'next';
import Link from 'next/link';
import '../../../../styles/forms.css';
import { PaymentMarks } from '../../../../components/Brands.tsx';
import { formatEuro } from '../../../../lib/format.ts';
import { normalizeOrderNumber } from '../../../../lib/order-number.ts';
import { PAYMENT_STATUS_LABEL } from '../../../../lib/payment.ts';
import { getOrderForPayment } from '../../../../server/orders.ts';
import { paymentsEnabled } from '../../../../server/payments.ts';

export const metadata: Metadata = { title: 'Zahlung', robots: { index: false } };
export const dynamic = 'force-dynamic';

export default async function ZahlungPage({
  params,
  searchParams,
}: {
  params: Promise<{ nr: string }>;
  searchParams: Promise<{ t?: string; abgebrochen?: string; fehler?: string }>;
}) {
  const { nr } = await params;
  const { t = '', abgebrochen, fehler } = await searchParams;
  const number = normalizeOrderNumber(nr);
  const order = number ? getOrderForPayment(number, t.slice(0, 64)) : null;

  return (
    <div className="shell shell--narrow confirm">
      <div className="card confirm__card">
        <p className="label">Zahlung</p>
        {!order ? (
          <>
            <h1>Zahlungslink ungültig</h1>
            <p>Bitte rufen Sie Ihren Vorgang über die <Link href="/status">Statusabfrage</Link> auf.</p>
          </>
        ) : (
          <>
            <h1>Auftrag {order.number}</h1>
            <div className="confirm__number">
              <span>Servicekosten</span>
              <strong>{formatEuro(order.totalCents)}</strong>
            </div>
            <p>Status: {PAYMENT_STATUS_LABEL[order.paymentStatus]}</p>
            {abgebrochen ? <p className="alert alert--info">Die Zahlung wurde abgebrochen. Sie können sie jederzeit neu starten.</p> : null}
            {fehler ? <p className="alert alert--error">Die Bezahlseite konnte gerade nicht geöffnet werden. Bitte später erneut versuchen.</p> : null}
            {order.paymentStatus === 'offen' ? (
              paymentsEnabled() ? (
                <form action="/api/zahlung/start" method="post" className="confirm__actions">
                  <input type="hidden" name="nr" value={order.number} />
                  <input type="hidden" name="t" value={t} />
                  <button type="submit" className="btn btn--lg">
                    Jetzt sicher bezahlen
                  </button>
                </form>
              ) : (
                <p className="alert alert--info">Die Online-Zahlung wird in Kürze freigeschaltet. Bis dahin erhalten Sie die Zahlungsdetails von uns.</p>
              )
            ) : null}
            <PaymentMarks label="Möglich mit" />
          </>
        )}
      </div>
    </div>
  );
}
