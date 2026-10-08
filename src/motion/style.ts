// Schreibt nur transform / opacity / filter / visibility – und nur, wenn sich der Wert geändert hat.

export interface Pose {
  x?: number;
  y?: number;
  z?: number;
  scale?: number;
  scaleX?: number;
  scaleY?: number;
  rotate?: number;
  rotateX?: number;
  rotateY?: number;
  opacity?: number;
  blur?: number;
}

const cache = new WeakMap<Element, { t: string; o: string; f: string; v: string }>();

const r = (n: number, d = 2): number => Math.round(n * 10 ** d) / 10 ** d;

export function pose(el: HTMLElement | SVGElement | null | undefined, p: Pose): void {
  if (!el) return;
  let c = cache.get(el);
  if (!c) {
    c = { t: '', o: '', f: '', v: '' };
    cache.set(el, c);
  }
  let t = '';
  if (p.x !== undefined || p.y !== undefined || p.z !== undefined) t += `translate3d(${r(p.x ?? 0)}px,${r(p.y ?? 0)}px,${r(p.z ?? 0)}px)`;
  if (p.rotateX !== undefined) t += ` rotateX(${r(p.rotateX)}deg)`;
  if (p.rotateY !== undefined) t += ` rotateY(${r(p.rotateY)}deg)`;
  if (p.rotate !== undefined) t += ` rotate(${r(p.rotate)}deg)`;
  if (p.scale !== undefined) t += ` scale(${r(p.scale, 4)})`;
  if (p.scaleX !== undefined || p.scaleY !== undefined) t += ` scale(${r(p.scaleX ?? 1, 4)},${r(p.scaleY ?? 1, 4)})`;
  if (t && t !== c.t) {
    el.style.transform = t;
    c.t = t;
  }
  if (p.opacity !== undefined) {
    const o = String(r(p.opacity, 3));
    if (o !== c.o) {
      el.style.opacity = o;
      c.o = o;
    }
    const v = p.opacity < 0.01 ? 'hidden' : 'visible';
    if (v !== c.v) {
      el.style.visibility = v;
      c.v = v;
    }
  }
  if (p.blur !== undefined) {
    const f = p.blur > 0.05 ? `blur(${r(p.blur, 1)}px)` : 'none';
    if (f !== c.f) {
      el.style.filter = f;
      c.f = f;
    }
  }
}

/** Setzt eine CSS-Variable nur bei Änderung (für einzelne kleine Elemente, z. B. Fortschrittslinien). */
export function setVar(el: HTMLElement | null | undefined, name: string, value: number): void {
  if (!el) return;
  const v = String(r(value, 4));
  if (el.style.getPropertyValue(name) !== v) el.style.setProperty(name, v);
}

/** Schaltet eine Klasse nur bei Zustandswechsel. */
export function flag(el: Element | null | undefined, cls: string, on: boolean): void {
  if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
}

export function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

export function clearPose(el: HTMLElement | SVGElement | null | undefined): void {
  if (!el) return;
  el.style.transform = '';
  el.style.opacity = '';
  el.style.filter = '';
  el.style.visibility = '';
  cache.delete(el);
}
