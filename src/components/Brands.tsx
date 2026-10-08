import { PAYMENT_METHOD_IDS, PAYMENT_METHODS } from '../lib/payment.ts';
import { CARRIER_IDS, CARRIERS, type CarrierId } from '../lib/shipping.ts';

/** Marke eines Anbieters: offizielles Logo, sobald unter public/brands/ hinterlegt – sonst neutrale Schriftmarke. */
function Mark({ name, logo, className = '' }: { name: string; logo: string | null; className?: string }) {
  if (logo) {
    return (
      <span className={`brand-mark brand-mark--logo ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={name} loading="lazy" decoding="async" />
      </span>
    );
  }
  return <span className={`brand-mark ${className}`}>{name}</span>;
}

export function CarrierMark({ id }: { id: CarrierId }) {
  return <Mark name={CARRIERS[id].name} logo={CARRIERS[id].logo} className={`brand-mark--${id}`} />;
}

export function CarrierMarks({ label = 'Versand mit' }: { label?: string }) {
  return (
    <div className="brand-row" aria-label={`${label} ${CARRIER_IDS.map((c) => CARRIERS[c].name).join(' und ')}`}>
      <span className="brand-row__label" aria-hidden="true">
        {label}
      </span>
      <span className="brand-row__marks" aria-hidden="true">
        {CARRIER_IDS.map((c) => (
          <CarrierMark key={c} id={c} />
        ))}
      </span>
    </div>
  );
}

export function PaymentMarks({ label = 'Bezahlen mit' }: { label?: string }) {
  return (
    <div className="brand-row" aria-label={`${label} ${PAYMENT_METHOD_IDS.map((p) => PAYMENT_METHODS[p].name).join(', ')}`}>
      <span className="brand-row__label" aria-hidden="true">
        {label}
      </span>
      <span className="brand-row__marks" aria-hidden="true">
        {PAYMENT_METHOD_IDS.map((p) => (
          <Mark key={p} name={PAYMENT_METHODS[p].name} logo={PAYMENT_METHODS[p].logo} />
        ))}
      </span>
    </div>
  );
}
