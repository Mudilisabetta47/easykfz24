// Kleine, reine Hilfsfunktionen für Bewegung. Jede Szene ist eine Funktion des Fortschritts p (0..1).

export const clamp = (v: number, min = 0, max = 1): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Fortschritt von p innerhalb [a, b], geklemmt auf 0..1. */
export const win = (p: number, a: number, b: number): number => (b === a ? (p >= b ? 1 : 0) : clamp((p - a) / (b - a)));

/** Einblenden zwischen a→b, voll bis c, ausblenden c→d. c ≥ 1 bedeutet: bleibt bis zum Ende sichtbar. */
export const band = (p: number, a: number, b: number, c: number, d: number): number =>
  Math.min(win(p, a, b), c >= 1 ? 1 : 1 - win(p, c, d));

/** Rahmenratenunabhängige Dämpfung (exponentiell). */
export const damp = (current: number, target: number, lambda: number, dt: number): number =>
  lerp(current, target, 1 - Math.exp(-lambda * dt));

export const ease = {
  linear: (t: number) => t,
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inOutSine: (t: number) => -(Math.cos(Math.PI * t) - 1) / 2,
};
