// Hero-Bühne in fünf Akten. Jeder Wert ist eine reine Funktion des Fortschritts p (0..1):
// vorwärts und rückwärts scrollen ergibt framegenau dasselbe Bild.

import { env } from '../env.ts';
import { band, ease, lerp, win } from '../math.ts';
import { scrollState } from '../scroll.ts';
import { flag, pose } from '../style.ts';
import { track } from '../timeline.ts';
import { plateRig, renderPlate } from './plate.ts';

/** Aktfenster: [einblenden ab, voll ab, ausblenden ab, weg ab]. */
export const HERO_ACTS: [number, number, number, number][] = [
  [0.07, 0.11, 0.22, 0.27],
  [0.26, 0.3, 0.43, 0.47],
  [0.46, 0.5, 0.61, 0.65],
  [0.64, 0.68, 0.79, 0.83],
  [0.82, 0.86, 1, 1],
];

const DOC_START: [number, number, number][] = [
  [-0.4, -0.3, -9],
  [0.4, -0.3, 8],
  [-0.38, 0.27, 7],
  [0.4, 0.27, -7],
];

export function initHero(root: HTMLElement): () => void {
  const q = <T extends Element = HTMLElement>(sel: string) => root.querySelector<T & HTMLElement>(sel);
  const qa = (sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));
  const trackEl = q('[data-track]');
  const stage = q('[data-stage]');
  if (!trackEl || !stage || env.reduced) return () => {};

  const intro = q('[data-intro]');
  const hint = q('[data-hint]');
  const grid = q('[data-grid]');
  const aurora = q('[data-aurora]');
  const acts = qa('[data-act]');
  const car = q('[data-car]');
  const glow = q('[data-glow]');
  const scan = q('[data-scan]');
  const chips = qa('[data-chip]');
  const docs = qa('[data-doc]');
  const core = q('[data-core]');
  const flowEl = q('[data-flow]');
  const flowFill = q('[data-flow-fill]');
  const nodes = qa('[data-node]');
  const ready = q('[data-ready]');
  const plate = q('[data-plate]');
  const rig = plate ? plateRig(plate) : null;
  const segs = qa('[data-seg]');
  const wheels = Array.from(root.querySelectorAll<SVGGElement>('[data-wheel]'));
  const sweep = root.querySelector<SVGGElement>('[data-sweep]');

  let vw = 1;
  let vh = 1;
  let carW = 1;
  let small = false;
  let radius = -1;

  const render = (p: number) => {
    // Intro (Headline + CTAs) gibt die Bühne frei
    const introOut = ease.inOutCubic(win(p, 0.015, 0.09));
    pose(intro, { y: -introOut * vh * 0.08, opacity: 1 - introOut, blur: introOut * 6 });
    pose(hint, { opacity: 1 - win(p, 0, 0.03) });

    // Hintergrund: leichte Parallaxe
    pose(grid, { y: -p * vh * 0.12 });
    pose(aurora, { x: lerp(-0.06, 0.06, p) * vw, opacity: 0.55 + 0.45 * band(p, 0.05, 0.2, 0.8, 1) });

    // Akt-Texte
    acts.forEach((el, i) => {
      const [a, b, c, d] = HERO_ACTS[i];
      const inT = ease.outCubic(win(p, a, b));
      const outT = c >= 1 ? 0 : ease.inOutCubic(win(p, c, d));
      const o = Math.min(inT, 1 - outT);
      pose(el, { y: (1 - inT) * 36 - outT * 28, opacity: o, blur: (1 - o) * 8 });
    });

    // Fahrzeug
    const enter = ease.inOutCubic(win(p, 0, 0.14));
    const dim = ease.inOutCubic(band(p, 0.46, 0.52, 0.8, 0.87));
    const drive = ease.inOutCubic(win(p, 0.87, 1));
    const x = lerp(small ? 0 : vw * 0.1, 0, enter) + drive * vw * (small ? 0.22 : 0.17);
    const push = 1 + 0.07 * ease.inOutSine(win(p, 0.06, 0.45));
    pose(car, {
      x,
      y: dim * vh * 0.05,
      scale: push * lerp(1, 0.86, dim),
      opacity: 1 - 0.8 * dim,
    });
    // Räder drehen sich passend zur zurückgelegten Strecke
    const wheelR = (carW * 68) / 1200 || 1;
    const deg = ((x - (small ? 0 : vw * 0.1)) / wheelR) * (180 / Math.PI);
    wheels.forEach((w) => pose(w, { rotate: deg }));

    const glowO = 0.5 + 0.5 * Math.max(band(p, 0.06, 0.14, 0.44, 0.5), win(p, 0.84, 0.94));
    pose(glow, { opacity: glowO * (1 - 0.6 * dim), scale: 0.9 + 0.16 * glowO });

    // Lichtkante über die Karosserie: einmal in Akt 1, einmal in Akt 5
    const sweepT = p < 0.6 ? win(p, 0.08, 0.27) : win(p, 0.84, 0.99);
    if (sweep) pose(sweep, { x: lerp(-40, 1640, ease.inOutSine(sweepT)) });

    // Akt 2: Datenscan und Fahrzeugdaten
    const scanT = win(p, 0.29, 0.44);
    pose(scan, { x: scanT * carW, opacity: band(p, 0.28, 0.3, 0.43, 0.46) });
    chips.forEach((el, i) => {
      const inT = ease.outCubic(win(p, 0.3 + i * 0.025, 0.36 + i * 0.025));
      const out = win(p, 0.45, 0.5);
      pose(el, { y: (1 - inT) * 18, scale: 0.94 + 0.06 * inT, opacity: Math.min(inT, 1 - out), blur: (1 - inT) * 6 });
    });

    // Akt 3: Dokumente fliegen ein, ordnen sich und verschmelzen zum Vorgang
    const dx = Math.min(vw * (small ? 0.22 : 0.13), 200);
    const dy = Math.min(vh * 0.12, 96);
    const merge = ease.inOutCubic(win(p, 0.58, 0.635));
    const docsOut = win(p, 0.625, 0.66);
    docs.forEach((el, i) => {
      const [sx, sy, sr] = DOC_START[i];
      const t = ease.outCubic(win(p, 0.47 + i * 0.025, 0.55 + i * 0.025));
      const slotX = (i % 2 === 0 ? -1 : 1) * dx;
      const slotY = (i < 2 ? -1 : 1) * dy;
      const startX = sx * vw * (small ? 0.75 : 1);
      const startY = sy * vh;
      pose(el, {
        x: lerp(lerp(startX, slotX, t), 0, merge),
        y: lerp(lerp(startY, slotY, t), 0, merge),
        rotate: lerp(sr, 0, t),
        scale: lerp(0.92, 1, t) * lerp(1, 0.45, merge),
        opacity: Math.min(win(p, 0.46 + i * 0.025, 0.5 + i * 0.025), 1 - docsOut),
      });
    });
    const coreIn = win(p, 0.57, 0.63);
    pose(core, { scale: 0.6 + 0.4 * ease.outCubic(coreIn), opacity: band(p, 0.57, 0.62, 0.655, 0.69) });

    // Akt 4: Prozesskette
    pose(flowEl, { opacity: band(p, 0.65, 0.69, 0.8, 0.84) });
    const k = ease.inOutCubic(win(p, 0.68, 0.79));
    if (flowFill) pose(flowFill, small ? { scaleY: k } : { scaleX: k });
    nodes.forEach((el, i) => {
      const t = ease.outCubic(win(p, 0.66 + i * 0.02, 0.7 + i * 0.02));
      pose(el, { y: (1 - t) * 14, opacity: t });
      flag(el, 'is-on', k >= i / (nodes.length - 1) - 0.001);
    });

    // Akt 5: Kennzeichen und CTA
    const readyT = ease.outCubic(win(p, 0.86, 0.95));
    pose(ready, { opacity: win(p, 0.86, 0.91) });
    pose(plate, { y: (1 - readyT) * 40, scale: 0.92 + 0.08 * readyT });
    if (rig) renderPlate(rig, win(p, 0.855, 0.985));

    // Fortschrittsanzeige
    segs.forEach((el, i) => {
      const [a, , c, d] = HERO_ACTS[i];
      pose(el, { scaleX: win(p, a, c >= 1 ? 1 : d) });
    });

    // Bühnen-Rückzug: Die dunkle Bühne wird an die helle Seite zurückgegeben
    const pull = ease.inOutCubic(win(p, 0.94, 1));
    pose(stage, { scale: 1 - pull * 0.07 });
    const rad = Math.round(pull * 32);
    if (rad !== radius) {
      stage.style.borderRadius = rad ? `${rad}px` : '';
      radius = rad;
    }
  };

  return track(trackEl, {
    start: 'top top',
    end: 'bottom bottom',
    onRefresh: () => {
      vw = scrollState.vw || innerWidth;
      vh = scrollState.vh || innerHeight;
      small = vw <= 760;
      carW = car?.offsetWidth || vw * 0.6;
    },
    onUpdate: render,
  });
}
