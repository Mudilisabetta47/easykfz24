// Gemeinsame Kennzeichen-Sequenz (Fortschritt t 0..1):
//   leeres Schild → Eurofeld → Unterscheidungszeichen geprägt → Buchstaben + Ziffern → eine langsame Lichtreflexion

import { band, ease, lerp, win } from '../math.ts';
import { pose } from '../style.ts';

type Part = SVGGElement | null;

export interface PlateRig {
  body: Part;
  band: Part;
  seal: Part;
  district: Part;
  letters: Part;
  digits: Part;
  sweep: Part;
}

export function plateRig(root: ParentNode): PlateRig {
  const q = (sel: string) => root.querySelector<SVGGElement>(sel);
  return {
    body: q('[data-plate-part="body"]'),
    band: q('[data-plate-part="band"]'),
    seal: q('[data-plate-part="seal"]'),
    district: q('[data-plate-part="district"]'),
    letters: q('[data-plate-part="letters"]'),
    digits: q('[data-plate-part="digits"]'),
    sweep: q('[data-plate-sweep]'),
  };
}

/** Prägen: Zeichen sinken aus leichter Überhöhung und Unschärfe in die Fläche. */
function stamp(el: Part, t: number): void {
  const e = ease.outCubic(t);
  pose(el, { opacity: e, scale: 1.07 - 0.07 * e, blur: (1 - e) * 1.4 });
}

export function renderPlate(rig: PlateRig, t: number): void {
  const e0 = ease.outCubic(win(t, 0, 0.18));
  pose(rig.body, { opacity: e0, scale: 0.97 + 0.03 * e0 });

  const e1 = ease.inOutCubic(win(t, 0.16, 0.32));
  pose(rig.band, { scaleX: Math.max(0.001, e1), opacity: Math.min(1, e1 * 3) });

  pose(rig.seal, { opacity: ease.outCubic(win(t, 0.3, 0.44)) });
  stamp(rig.district, win(t, 0.3, 0.48));
  stamp(rig.letters, win(t, 0.46, 0.64));
  stamp(rig.digits, win(t, 0.52, 0.7));

  // Reflexion: breit, weich und langsam – genau ein Durchlauf
  const s = ease.inOutSine(win(t, 0.7, 1));
  pose(rig.sweep, { x: lerp(-40, 660, s), opacity: band(t, 0.7, 0.78, 0.93, 1) * 0.9 });
}
