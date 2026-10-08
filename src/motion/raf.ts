// Eine einzige requestAnimationFrame-Schleife für die ganze Seite.
// Reihenfolge: Scroll (0) → Timelines (10) → Szenen (20) → Cursor/Magnet (30). Pausiert bei verstecktem Tab.

export type Tick = (time: number, dt: number) => void;

interface Sub {
  fn: Tick;
  order: number;
}

const subs: Sub[] = [];
let frame = 0;
let last = 0;
let running = false;

function loop(time: number): void {
  const dt = last ? Math.min(0.05, (time - last) / 1000) : 1 / 60;
  last = time;
  for (let i = 0; i < subs.length; i++) subs[i].fn(time, dt);
  frame = requestAnimationFrame(loop);
}

function start(): void {
  if (running || document.hidden || subs.length === 0) return;
  running = true;
  last = 0;
  frame = requestAnimationFrame(loop);
}

function stop(): void {
  running = false;
  cancelAnimationFrame(frame);
}

let visibilityBound = false;
function bindVisibility(): void {
  if (visibilityBound) return;
  visibilityBound = true;
  document.addEventListener('visibilitychange', () => (document.hidden ? stop() : start()));
}

export function addTick(fn: Tick, order = 20): () => void {
  bindVisibility();
  const sub = { fn, order };
  subs.push(sub);
  subs.sort((a, b) => a.order - b.order);
  start();
  return () => {
    const i = subs.indexOf(sub);
    if (i >= 0) subs.splice(i, 1);
    if (subs.length === 0) stop();
  };
}
