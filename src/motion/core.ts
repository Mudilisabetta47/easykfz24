// Startpunkt der Motion-Engine. Wird einmal im Seitenlayout gebootet; Szenen registrieren sich danach selbst.

import { env, initEnv, onEnvChange, refreshEnv } from './env.ts';
import { destroyPointer, initPointer } from './pointer.ts';
import { addTick } from './raf.ts';
import { revealAll, scanReveals } from './reveal.ts';
import { initScroll, scrollState, scrollToElement, setSmooth } from './scroll.ts';
import { initTimelines, refreshAll } from './timeline.ts';

let booted = false;

function initHeader(): void {
  let lastY = 0;
  let travel = 0;
  addTick(() => {
    const header = document.querySelector<HTMLElement>('[data-header]');
    if (!header) return;
    const y = scrollState.y;
    const dy = y - lastY;
    lastY = y;
    const solid = y > 24 ? 'true' : 'false';
    if (header.dataset.solid !== solid) header.dataset.solid = solid;
    if (header.dataset.menu === 'open') return;
    // Richtungswechsel mit etwas Toleranz, damit kleine Bewegungen nicht flackern.
    if ((dy > 0 && travel < 0) || (dy < 0 && travel > 0)) travel = 0;
    travel += dy;
    let hidden = header.dataset.hidden === 'true';
    if (y < 160) hidden = false;
    else if (travel > 48) hidden = true;
    else if (travel < -24) hidden = false;
    const v = hidden ? 'true' : 'false';
    if (header.dataset.hidden !== v) header.dataset.hidden = v;
  }, 5);
}

function initAnchors(): void {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element ? e.target.closest<HTMLAnchorElement>('a[href*="#"]') : null;
    if (!a) return;
    const url = new URL(a.href, location.href);
    if (url.pathname !== location.pathname || !url.hash) return;
    const target = document.getElementById(decodeURIComponent(url.hash.slice(1)));
    if (!target) return;
    e.preventDefault();
    history.pushState(null, '', url.hash);
    scrollToElement(target);
    // Fokus für Tastatur- und Screenreader-Nutzer an das Ziel übergeben.
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  });
}

export function bootMotion(): void {
  if (booted) return;
  booted = true;
  initEnv();
  initScroll();
  initTimelines();
  initHeader();
  initAnchors();
  initPointer();
  scanReveals();
  onEnvChange(() => {
    refreshEnv();
    setSmooth(env.finePointer && !env.reduced);
    if (env.reduced) {
      destroyPointer();
      revealAll();
    } else initPointer();
    refreshAll();
  });
}

/** Nach einem Seitenwechsel: neue Reveals beobachten und alle Trigger neu messen. */
export function afterNavigation(): void {
  scanReveals();
  requestAnimationFrame(() => refreshAll());
}
