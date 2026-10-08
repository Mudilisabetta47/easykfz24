import { formatEuro } from '../lib/format.ts';
import { NEW_CUSTOMER_PROMO, PRICES_FINAL } from '../lib/pricing.config.ts';
import { fromPrice, isPromoActive } from '../lib/pricing.ts';
import type { ServiceId } from '../lib/services.ts';

export const promoActive = () => PRICES_FINAL && isPromoActive();

/** Dezentes Aktions-Badge: „−10 % Neukunden“ */
export function PromoBadge({ tone = 'light', label = 'Neukunden' }: { tone?: 'light' | 'dark'; label?: string }) {
  if (!promoActive()) return null;
  return (
    <span className={`promo-badge promo-badge--${tone}`}>
      <span className="promo-badge__pct">−{NEW_CUSTOMER_PROMO.percent} %</span>
      <span className="promo-badge__label">{label}</span>
    </span>
  );
}

/** „Bis 31.12.“ nur, wenn ein echtes Enddatum hinterlegt ist. */
export function promoUntilText(): string {
  const until = NEW_CUSTOMER_PROMO.validUntil;
  if (!until) return '';
  const [y, m, d] = until.split('-');
  return ` – nur bis ${d}.${m}.${y}`;
}

interface PriceTagProps {
  services: ServiceId[];
  size?: 'sm' | 'lg';
  /** „ab“ voranstellen (mehrere Leistungen oder variable Zusatzposten) */
  from?: boolean;
  tone?: 'light' | 'dark';
}

/** Preis der Servicepauschale: Neukundenpreis groß, regulärer Preis durchgestrichen, Ersparnis daneben. */
export function PriceTag({ services, size = 'lg', from = false, tone = 'light' }: PriceTagProps) {
  if (!PRICES_FINAL) return null;
  const p = fromPrice(services);
  const promo = p.savingCents > 0;
  return (
    <span className={`price-tag price-tag--${size} price-tag--${tone}`}>
      <span className="price-tag__main">
        <span className="price-tag__from">{from ? 'ab' : promo ? 'nur' : ''}</span>
        <span className="price-tag__value">{formatEuro(promo ? p.promoCents : p.regularCents)}</span>
        {promo ? (
          <s className="price-tag__was">
            <span className="sr-only">statt </span>
            {formatEuro(p.regularCents)}
          </s>
        ) : null}
      </span>
      {promo ? <span className="price-tag__save">Du sparst {formatEuro(p.savingCents)}</span> : null}
    </span>
  );
}
