// Zeiger-Interaktionen (nur feine Zeiger, nicht bei reduced-motion):
//  - Custom Cursor mit Labels   [data-cursor="Start"]
//  - Magnetische Buttons        [data-magnetic="0.25"]
//  - Tiefenreaktion für Karten  [data-tilt]
// Alles läuft in der zentralen rAF-Schleife.

import { env } from './env.ts';
import { damp } from './math.ts';
import { addTick } from './raf.ts';

interface Spring {
  el: HTMLElement;
  rect: DOMRect;
  tx: number;
  ty: number;
  x: number;
  y: number;
  strength: number;
  kind: 'magnetic' | 'tilt';
}

let active = false;
let cursorEl: HTMLDivElement | null = null;
let labelEl: HTMLSpanElement | null = null;
let mx = -100;
let my = -100;
let cx = -100;
let cy = -100;
let seen = false;
const springs = new Map<HTMLElement, Spring>();
const cleanups: (() => void)[] = [];

function springFor(el: HTMLElement, kind: Spring['kind']): Spring {
  let s = springs.get(el);
  if (!s) {
    s = { el, rect: el.getBoundingClientRect(), tx: 0, ty: 0, x: 0, y: 0, strength: 0, kind };
    springs.set(el, s);
  }
  s.rect = el.getBoundingClientRect();
  s.strength = kind === 'magnetic' ? parseFloat(el.dataset.magnetic || '0.25') || 0.25 : 1;
  return s;
}

function onMove(e: PointerEvent): void {
  if (e.pointerType !== 'mouse') return;
  mx = e.clientX;
  my = e.clientY;
  if (!seen) {
    cx = mx;
    cy = my;
    seen = true;
    cursorEl?.setAttribute('data-hidden', 'false');
  }
  const target = e.target instanceof Element ? e.target : null;
  const mag = target?.closest<HTMLElement>('[data-magnetic]');
  const tilt = target?.closest<HTMLElement>('[data-tilt]');
  for (const s of springs.values()) {
    if (s.el !== mag && s.el !== tilt) {
      s.tx = 0;
      s.ty = 0;
    }
  }
  if (mag) {
    const s = springs.get(mag) ?? springFor(mag, 'magnetic');
    const relX = mx - (s.rect.left + s.rect.width / 2);
    const relY = my - (s.rect.top + s.rect.height / 2);
    s.tx = relX * s.strength;
    s.ty = relY * s.strength;
    mag.style.setProperty('--mx', `${((mx - s.rect.left) / s.rect.width) * 100}%`);
    mag.style.setProperty('--my', `${((my - s.rect.top) / s.rect.height) * 100}%`);
  }
  if (tilt) {
    const s = springs.get(tilt) ?? springFor(tilt, 'tilt');
    s.tx = ((mx - s.rect.left) / s.rect.width - 0.5) * 2;
    s.ty = ((my - s.rect.top) / s.rect.height - 0.5) * 2;
  }
}

function onOver(e: PointerEvent): void {
  if (e.pointerType !== 'mouse' || !cursorEl || !labelEl) return;
  const target = e.target instanceof Element ? e.target : null;
  const mag = target?.closest<HTMLElement>('[data-magnetic]');
  if (mag) springFor(mag, 'magnetic');
  const tilt = target?.closest<HTMLElement>('[data-tilt]');
  if (tilt) springFor(tilt, 'tilt');
  const labelled = target?.closest<HTMLElement>('[data-cursor]');
  if (labelled) {
    labelEl.textContent = labelled.dataset.cursor || '';
    cursorEl.dataset.state = 'label';
  } else if (target?.closest('a, button, [role="button"], summary, label, select')) {
    cursorEl.dataset.state = 'hover';
  } else {
    cursorEl.dataset.state = 'idle';
  }
}

function onLeaveWindow(): void {
  cursorEl?.setAttribute('data-hidden', 'true');
  seen = false;
}

function tick(_t: number, dt: number): void {
  if (cursorEl && seen) {
    cx = damp(cx, mx, 22, dt);
    cy = damp(cy, my, 22, dt);
    cursorEl.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0)`;
  }
  for (const s of springs.values()) {
    s.x = damp(s.x, s.tx, s.kind === 'magnetic' ? 12 : 9, dt);
    s.y = damp(s.y, s.ty, s.kind === 'magnetic' ? 12 : 9, dt);
    const settled = Math.abs(s.x) < 0.01 && Math.abs(s.y) < 0.01 && s.tx === 0 && s.ty === 0;
    if (s.kind === 'magnetic') {
      s.el.style.transform = settled ? '' : `translate3d(${s.x.toFixed(2)}px,${s.y.toFixed(2)}px,0)`;
    } else {
      s.el.style.transform = settled
        ? ''
        : `perspective(900px) rotateX(${(-s.y * 2.4).toFixed(2)}deg) rotateY(${(s.x * 3).toFixed(2)}deg) translateZ(0)`;
    }
    if (settled) springs.delete(s.el);
  }
}

export function initPointer(): void {
  if (active || !env.finePointer || env.reduced) return;
  active = true;
  document.documentElement.classList.add('has-cursor');
  cursorEl = document.createElement('div');
  cursorEl.className = 'cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.dataset.hidden = 'true';
  const ring = document.createElement('div');
  ring.className = 'cursor__ring';
  labelEl = document.createElement('span');
  labelEl.className = 'cursor__label';
  ring.appendChild(labelEl);
  cursorEl.appendChild(ring);
  document.body.appendChild(cursorEl);

  window.addEventListener('pointermove', onMove, { passive: true });
  document.addEventListener('pointerover', onOver, { passive: true });
  document.documentElement.addEventListener('pointerleave', onLeaveWindow);
  cleanups.push(addTick(tick, 30));
}

export function destroyPointer(): void {
  if (!active) return;
  active = false;
  window.removeEventListener('pointermove', onMove);
  document.removeEventListener('pointerover', onOver);
  document.documentElement.removeEventListener('pointerleave', onLeaveWindow);
  cleanups.splice(0).forEach((fn) => fn());
  cursorEl?.remove();
  cursorEl = null;
  document.documentElement.classList.remove('has-cursor');
  for (const s of springs.values()) s.el.style.transform = '';
  springs.clear();
}
