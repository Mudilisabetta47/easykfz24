import type { ReactNode } from 'react';
import { isPlaceholder } from '../lib/site.ts';

/** Hebt Platzhalter-Angaben sichtbar hervor; echte Werte werden normal ausgegeben. */
export function Ph({ children }: { children: string | ReactNode }) {
  if (typeof children === 'string' && isPlaceholder(children)) {
    return <mark className="placeholder">{children}</mark>;
  }
  return <>{children}</>;
}
