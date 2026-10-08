// Scroll-Timelines nach ScrollTrigger-Prinzip:
//   track(el, { start: 'top top', end: 'bottom bottom', onUpdate: p => … })
// Gemessen wird ausschließlich in refreshAll() – für alle Trigger in einem Durchgang. Pro Frame wird nur gerechnet.

import { addTick } from './raf.ts';
import { measureScroll, scrollState } from './scroll.ts';

type Edge = 'top' | 'center' | 'bottom' | number;

export interface TrackOptions {
  /** "<Elementkante> <Viewportkante>", z. B. "top top", "top bottom", "center center", "top 80%". */
  start?: string;
  end?: string;
  onUpdate: (p: number) => void;
  /** Wird nach jeder Messung aufgerufen (z. B. um Größen zu cachen). */
  onRefresh?: () => void;
}

interface Trigger {
  el: Element;
  start: [number, number];
  end: [number, number];
  onUpdate: (p: number) => void;
  onRefresh?: () => void;
  startY: number;
  endY: number;
  last: number;
}

const triggers: Trigger[] = [];
let removeTick: (() => void) | null = null;
let resizeTimer = 0;
let observer: ResizeObserver | null = null;

function edge(v: string): number {
  const e = v as Edge;
  if (e === 'top') return 0;
  if (e === 'center') return 0.5;
  if (e === 'bottom') return 1;
  if (v.endsWith('%')) return parseFloat(v) / 100;
  return 0;
}

function parse(spec: string): [number, number] {
  const [a = 'top', b = 'top'] = spec.trim().split(/\s+/);
  return [edge(a), edge(b)];
}

function measure(t: Trigger): void {
  const rect = t.el.getBoundingClientRect();
  const top = rect.top + window.scrollY;
  const vh = innerHeight;
  t.startY = top + t.start[0] * rect.height - t.start[1] * vh;
  t.endY = top + t.end[0] * rect.height - t.end[1] * vh;
  t.last = -1;
}

function update(t: Trigger, y: number): void {
  const span = t.endY - t.startY;
  const raw = span <= 0 ? (y >= t.startY ? 1 : 0) : (y - t.startY) / span;
  const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
  if (p === t.last) return;
  t.last = p;
  t.onUpdate(p);
}

function tick(): void {
  const y = scrollState.y;
  for (let i = 0; i < triggers.length; i++) update(triggers[i], y);
}

export function refreshAll(): void {
  measureScroll();
  for (const t of triggers) t.onRefresh?.();
  for (const t of triggers) measure(t);
  tick();
}

function scheduleRefresh(): void {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(refreshAll, 160);
}

export function initTimelines(): void {
  if (removeTick) return;
  removeTick = addTick(tick, 10);
  window.addEventListener('resize', scheduleRefresh);
  window.addEventListener('load', refreshAll);
  // Höhenänderungen (Akkordeon, späte Bilder) verschieben Trigger → neu messen.
  observer = new ResizeObserver(scheduleRefresh);
  observer.observe(document.body);
  document.fonts?.ready.then(refreshAll).catch(() => {});
}

export function track(el: Element, opts: TrackOptions): () => void {
  const t: Trigger = {
    el,
    start: parse(opts.start ?? 'top top'),
    end: parse(opts.end ?? 'bottom bottom'),
    onUpdate: opts.onUpdate,
    onRefresh: opts.onRefresh,
    startY: 0,
    endY: 0,
    last: -1,
  };
  triggers.push(t);
  opts.onRefresh?.();
  measure(t);
  update(t, scrollState.y || window.scrollY);
  return () => {
    const i = triggers.indexOf(t);
    if (i >= 0) triggers.splice(i, 1);
  };
}
