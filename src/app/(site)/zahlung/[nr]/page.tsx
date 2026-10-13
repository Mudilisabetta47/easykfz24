import type { Metadata } from 'next';
import Link from 'next/link';
import '../../../../styles/forms.css';
import { MethodMarks, PaymentMarks } from '../../../../components/Brands.tsx';
import { formatEuro } from '../../../../lib/format.ts';
import { MOLLIE_METHOD_MARKS, PAY_TEXT, type PayView } from '../../../../lib/mollie.ts';
import { normalizeOrderNumber } from '../../../../lib/order-number.ts';
import { PAYMENT_STATUS_LABEL } from '../../../../lib/payment.ts';
import { mollieMethodIds, mollieMode, mollieTestAvailable, paymentStateForOrder } from '../../../../server/mollie.ts';
import { getOrderForPayment } from '../../../../server/orders.ts';
import { paymentProvider } from '../../../../server/payments.ts';
import { RefreshWhilePending } from './RefreshWhilePending.tsx';

export const metadata: Metadata = { title: 'Zahlung', robots: { index: false }, referrer: 'no-referrer' };
export const dynamic = 'force-dynamic';

export default async function ZahlungPage({
  params,
  searchParams,
}: {
  params: Promise<{ nr: string }>;
  searchParams: Promise<{ t?: string; abgebrochen?: string; fehler?: string; rueckkehr?: string; runde?: string }>;
}) {
  const { nr } = await params;
  const { t = '', abgebrochen, fehler, rueckkehr, runde } = await searchParams;
  const number = normalizeOrderNumber(nr);
  const order = number ? await getOrderForPayment(number, t.slice(0, 64)) : null;
  const provider = paymentProvider();
  const mollie = provider === 'mollie';
  // Nur der über die Mollie-API bestätigte Stand zählt – nie die Rückleitung selbst (auch für Testzahlungen aus dem OS)
  const state = order && (mollie || mollieTestAvailable()) ? await paymentStateForOrder(order.id) : null;
  // Testzahlung bei Live-Hauptschlüssel: zählt nie als echte Zahlung
  const testOnly = state?.attempt?.mode === 'test' && mollieMode() !== 'test';
  const view: PayView = order?.paymentStatus === 'bezahlt' ? 'bezahlt' : (state?.view ?? 'keine');
  const pending = !!order && order.paymentStatus === 'offen' && !!state?.attempt && (view === 'in_pruefung' || (!!rueckkehr && view === 'offen'));
  const round = Math.min(Number(runde) || 0, 99);
  const marks = mollie
    ? [
        ...new Map(
          (await mollieMethodIds()).flatMap((id) => MOLLIE_METHOD_MARKS[id.startsWith('klarna') ? 'klarna' : id] ?? []).map((m) => [m.name, m]),
        ).values(),
      ]
    : [];
  const text = PAY_TEXT[view];

  return (
    <div className="shell shell--narrow confirm">
      <div className="card confirm__card">
        <p className="label">Zahlung</p>
        {!order ? (
          <>
            <h1>Zahlungslink ungültig</h1>
            <p>
              Bitte rufen Sie Ihren Vorgang über die <Link href="/status">Statusabfrage</Link> auf.
            </p>
          </>
        ) : (
          <>
            <h1>Auftrag {order.number}</h1>
            {(mollie && mollieMode() === 'test') || state?.attempt?.mode === 'test' ? (
              <p className="alert alert--error" role="note">
                <strong>TESTMODUS</strong> – es wird kein echtes Geld bewegt. Diese Zahlung dient nur zum Testen.
              </p>
            ) : null}
            <div className="confirm__number">
              <span>Servicekosten</span>
              <strong>{formatEuro(order.totalCents)}</strong>
            </div>
            <p>Status: {PAYMENT_STATUS_LABEL[order.paymentStatus]}</p>
            {testOnly ? (
              <div className="alert alert--info" aria-live="polite">
                <strong>Testzahlung: {text.title}</strong> Kein echtes Geld – der Auftrag bleibt „Zahlung offen“.
              </div>
            ) : null}
            {mollie && !testOnly && view !== 'keine' && order.paymentStatus !== 'erstattet' ? (
              <div className={`alert ${text.tone === 'ok' ? 'alert--ok' : text.tone === 'error' ? 'alert--error' : 'alert--info'}`} aria-live="polite">
                <strong>{text.title}</strong> {text.text}
                {state?.checkFailed && order.paymentStatus === 'offen'
                  ? ' Der aktuelle Stand konnte gerade nicht abgerufen werden – wir prüfen automatisch erneut.'
                  : ''}
              </div>
            ) : null}
            {pending ? <RefreshWhilePending round={round} /> : null}
            {abgebrochen ? <p className="alert alert--info">Die Zahlung wurde abgebrochen. Sie können sie jederzeit neu starten.</p> : null}
            {fehler ? <p className="alert alert--error">Die Bezahlseite konnte gerade nicht geöffnet werden. Bitte später erneut versuchen.</p> : null}
            {order.paymentStatus === 'offen' ? (
              provider ? (
                view === 'in_pruefung' ? (
                  <p className="muted">Sobald die Bestätigung vorliegt, aktualisiert sich diese Seite. Bitte nicht erneut bezahlen.</p>
                ) : (
                  <form action="/api/zahlung/start" method="post" className="confirm__actions">
                    <input type="hidden" name="nr" value={order.number} />
                    <input type="hidden" name="t" value={t} />
                    <button type="submit" className="btn btn--lg">
                      {view === 'offen'
                        ? 'Zahlung fortsetzen'
                        : view === 'fehlgeschlagen' || view === 'abgebrochen' || view === 'abgelaufen'
                          ? 'Erneut bezahlen'
                          : 'Jetzt sicher bezahlen'}
                    </button>
                  </form>
                )
              ) : (
                <p className="alert alert--info">Die Online-Zahlung wird in Kürze freigeschaltet. Bis dahin erhalten Sie die Zahlungsdetails von uns.</p>
              )
            ) : null}
            {mollie ? <MethodMarks marks={marks} /> : <PaymentMarks label="Möglich mit" />}
            {mollie ? <p className="muted small">Die Zahlung wickelt unser Zahlungsdienstleister Mollie ab. Ihre Zahlungsdaten erhalten wir nicht.</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
