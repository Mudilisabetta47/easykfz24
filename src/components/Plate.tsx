import type { CSSProperties } from 'react';
import { EuStars } from './icons.tsx';

interface PlateProps {
  district: string;
  letters: string;
  digits: string;
  height?: number | string;
  className?: string;
  /** Datenattribute für Szenen-Animationen an einzelnen Bestandteilen. */
  animated?: boolean;
}

/** Schematisches deutsches Kennzeichen – bewusst ohne Plaketten oder Siegel. */
export function Plate({ district, letters, digits, height = 64, className = '', animated = false }: PlateProps) {
  const style = { '--plate-h': typeof height === 'number' ? `${height}px` : height } as CSSProperties;
  const label = `Beispielkennzeichen ${district} ${letters} ${digits}`;
  return (
    <div className={`plate ${className}`} style={style} role="img" aria-label={label}>
      <span className="plate__band" data-plate-part={animated ? 'band' : undefined}>
        <EuStars className="plate__stars" />D
      </span>
      <span className="plate__text">
        <span data-plate-part={animated ? 'district' : undefined}>{district}</span>
        <span className="plate__gap" />
        <span data-plate-part={animated ? 'letters' : undefined}>{letters}</span>
        <span data-plate-part={animated ? 'digits' : undefined}>{digits}</span>
      </span>
    </div>
  );
}
