// Weiches Scrollen nach Lenis-Prinzip – aber es wird der ECHTE Scrollwert gesetzt (window.scrollTo),
// nicht der Inhalt transformiert. Dadurch funktionieren sticky, fixed, Anker, Suche und Screenreader unverändert.
// Nur auf Geräten mit feinem Zeiger; Touch und reduced-motion behalten den nativen Scroll.

import { env } from './env.ts';
import { clamp, damp } from './math.ts';
import { addTick } from './raf.ts';

const WHEEL_FACTOR = 1;
const DAMPING = 10.5;

let smooth = false;
let y = 0;
let target = 0;
let lastSet = -1;
let animating = false;
let maxScroll = 0;
let velocity = 0;
let removeTick: (() => void) | null = null;

/** Aktueller Scrollwert, einmal pro Frame ermittelt – alle Szenen lesen diesen Wert. */
export const scrollState = { y: 0, vh: 0, vw: 0, direction: 0 as -1 | 0 | 1, velocity: 0 };

export function measureScroll(): void {
  scrollState.vh = innerHeight;
  scrollState.vw = document.documentElement.clientWidth;
  maxScroll = Math.max(0, document.documentElement.scrollHeight - innerHeight);
}

function isLocked(): boolean {
  return document.documentElement.hasAttribute('data-scroll-lock');
}

function scrollableAncestor(target: EventTarget | null, deltaY: number): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement && el.dataset.nativeScroll !== undefined) return true;
    if (el.scrollHeight > el.clientHeight + 1) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll') {
        const atTop = el.scrollTop <= 0;
        const atBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 1;
        if ((deltaY < 0 && !atTop) || (deltaY > 0 && !atBottom)) return true;
      }
    }
    el = el.parentElement;
  }
  return false;
}

function onWheel(e: WheelEvent): void {
  if (!smooth || e.ctrlKey || e.defaultPrevented || isLocked()) return;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
  if (scrollableAncestor(e.target, e.deltaY)) return;
  e.preventDefault();
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? innerHeight : 1;
  if (!animating) {
    y = target = window.scrollY;
    lastSet = y;
  }
  target = clamp(target + e.deltaY * unit * WHEEL_FACTOR, 0, maxScroll);
  animating = true;
}

function tick(_t: number, dt: number): void {
  const native = window.scrollY;
  const prev = scrollState.y;
  if (smooth && animating) {
    // Jemand anderes hat gescrollt (Tastatur, Scrollbalken, Anker) → hart synchronisieren.
    if (Math.abs(native - lastSet) > 2) {
      y = target = native;
      animating = false;
    } else {
      y = damp(y, target, DAMPING, dt);
      if (Math.abs(target - y) < 0.3) {
        y = target;
        animating = false;
      }
      window.scrollTo(0, y);
      lastSet = window.scrollY;
    }
  } else {
    y = target = native;
  }
  scrollState.y = smooth ? y : native;
  const delta = scrollState.y - prev;
  velocity = dt > 0 ? delta / dt : 0;
  scrollState.velocity = velocity;
  if (Math.abs(delta) > 0.5) scrollState.direction = delta > 0 ? 1 : -1;
}

export function initScroll(): void {
  measureScroll();
  y = target = scrollState.y = window.scrollY;
  smooth = env.finePointer && !env.reduced;
  if (!removeTick) {
    removeTick = addTick(tick, 0);
    window.addEventListener('wheel', onWheel, { passive: false });
  }
}

export function setSmooth(enabled: boolean): void {
  smooth = enabled;
  animating = false;
}

/** Sanft zu einer Position scrollen – mit der Engine, nativ smooth auf Touch, sofort bei reduced-motion. */
export function scrollToY(top: number): void {
  const dest = clamp(top, 0, maxScroll || document.documentElement.scrollHeight);
  if (env.reduced) {
    window.scrollTo(0, dest);
    return;
  }
  if (smooth) {
    if (!animating) {
      y = window.scrollY;
      lastSet = y;
    }
    target = dest;
    animating = true;
    return;
  }
  window.scrollTo({ top: dest, behavior: 'smooth' });
}

export function scrollToElement(el: Element): void {
  const offset = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  scrollToY(top);
}
