import { initHero } from './hero.ts';
import {
  initDealers,
  initDocuments,
  initFinale,
  initMap,
  initPlateScene,
  initProcess,
  initServices,
  initStatusDemo,
} from './sections.ts';

const SCENES: [string, (root: HTMLElement) => () => void][] = [
  ['[data-hero]', initHero],
  ['[data-services]', initServices],
  ['[data-process]', initProcess],
  ['[data-docs]', initDocuments],
  ['[data-statusdemo]', initStatusDemo],
  ['[data-platescene]', initPlateScene],
  ['[data-map]', initMap],
  ['[data-b2b]', initDealers],
  ['[data-finale]', initFinale],
];

/** Jede Szene steigt still aus, wenn ihre Elemente fehlen. */
export function initHomeScenes(): () => void {
  const cleanups: (() => void)[] = [];
  for (const [sel, init] of SCENES) {
    const root = document.querySelector<HTMLElement>(sel);
    if (root) cleanups.push(init(root));
  }
  return () => cleanups.forEach((fn) => fn());
}
