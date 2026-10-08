// Laufzeitumgebung – wird einmal ermittelt; alle Module fragen dieses Objekt statt selbst matchMedia aufzurufen.

export interface MotionEnv {
  reduced: boolean;
  finePointer: boolean;
  touch: boolean;
  small: boolean;
  wide: boolean;
}

export const env: MotionEnv = { reduced: false, finePointer: false, touch: false, small: false, wide: false };

let listening = false;
const listeners = new Set<() => void>();

function read(): void {
  env.reduced =
    matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motionForce === 'reduced';
  env.finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
  env.touch = !env.finePointer && (navigator.maxTouchPoints > 0 || 'ontouchstart' in window);
  env.small = innerWidth <= 760;
  env.wide = innerWidth >= 1100;
  const root = document.documentElement;
  root.dataset.motion = env.reduced ? 'reduced' : 'full';
}

export function initEnv(): void {
  read();
  if (listening) return;
  listening = true;
  const mq = matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', () => {
    read();
    listeners.forEach((fn) => fn());
  });
}

export function refreshEnv(): void {
  read();
}

export function onEnvChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
