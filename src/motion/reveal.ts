// Reveals: ein IntersectionObserver setzt .is-in, den Rest erledigt CSS (Typen fade, up, blur, clip, mask,
// mask-fast, soft, scale). Das Wort-Splitting passiert bereits beim Rendern (components/Split.tsx).

import { env } from './env.ts';

let io: IntersectionObserver | null = null;

export function scanReveals(root: ParentNode = document): void {
  const els = root.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)');
  if (env.reduced || !('IntersectionObserver' in window)) {
    els.forEach((el) => el.classList.add('is-in'));
    return;
  }
  if (!io) {
    io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            io?.unobserve(e.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.12 },
    );
  }
  els.forEach((el) => {
    // Bereits vollständig oberhalb des Viewports (z. B. nach Rücksprung) → direkt sichtbar.
    if (el.getBoundingClientRect().bottom < 0) el.classList.add('is-in');
    else io?.observe(el);
  });
}

export function revealAll(): void {
  document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
}
