'use client';

import { useId, useState } from 'react';
import { Plus } from '../icons.tsx';

export interface FaqItem {
  q: string;
  a: string;
}

export function Faq({ items }: { items: FaqItem[] }) {
  const [open, setOpen] = useState<number | null>(0);
  const base = useId();
  return (
    <div className="faq">
      {items.map((it, i) => {
        const isOpen = open === i;
        const btn = `${base}-b${i}`;
        const panel = `${base}-p${i}`;
        return (
          <div key={it.q} className="faq__item" data-open={isOpen}>
            <h3 className="faq__q">
              <button
                type="button"
                id={btn}
                aria-expanded={isOpen}
                aria-controls={panel}
                onClick={() => setOpen(isOpen ? null : i)}
              >
                <span>{it.q}</span>
                <span className="faq__icon" aria-hidden="true">
                  <Plus width={18} height={18} />
                </span>
              </button>
            </h3>
            <div id={panel} role="region" aria-labelledby={btn} className="faq__a" inert={!isOpen}>
              <div>
                <p>{it.a}</p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
