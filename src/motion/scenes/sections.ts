// Bühnen der Startseite nach dem Hero. Gleiches Prinzip: Spur misst, Bühne klebt, p (0..1) treibt alles.

import { env } from '../env.ts';
import { band, ease, lerp, win } from '../math.ts';
import { scrollState } from '../scroll.ts';
import { clearPose, flag, pose, setText } from '../style.ts';
import { track } from '../timeline.ts';
import { plateRig, renderPlate } from './plate.ts';

type Cleanup = () => void;
const noop: Cleanup = () => {};

const qa = (root: ParentNode, sel: string) => Array.from(root.querySelectorAll<HTMLElement>(sel));

/* ---------- Leistungen: horizontale Schiene auf großen Bildschirmen ---------- */
export function initServices(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const rail = root.querySelector<HTMLElement>('[data-rail]');
  const meter = root.querySelector<HTMLElement>('[data-meter]');
  const cards = qa(root, '[data-card]');
  const arts = qa(root, '[data-card-art]');
  if (!trackEl || !rail || env.reduced) return noop;

  let enabled = false;
  let shift = 0;
  let vw = 1;
  const lefts: number[] = [];
  const widths: number[] = [];

  return track(trackEl, {
    onRefresh: () => {
      enabled = matchMedia('(min-width: 1100px)').matches;
      vw = scrollState.vw || innerWidth;
      clearPose(rail);
      cards.forEach((c) => clearPose(c));
      arts.forEach((a) => clearPose(a));
      cards.forEach((c, i) => {
        lefts[i] = c.offsetLeft;
        widths[i] = c.offsetWidth;
      });
      const vp = rail.parentElement;
      if (enabled && vp) {
        const cs = getComputedStyle(vp);
        const inner = vp.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
        shift = Math.max(0, rail.offsetWidth - inner);
      } else shift = 0;
    },
    onUpdate: (p) => {
      if (!enabled) {
        pose(meter, { scaleX: 1 });
        return;
      }
      const t = ease.inOutSine(win(p, 0.06, 0.94));
      const x = -shift * t;
      pose(rail, { x });
      pose(meter, { scaleX: Math.max(0.04, t) });
      cards.forEach((c, i) => {
        const left = lefts[i] + x;
        const enter = win(vw * 1.02 - left, 0, vw * 0.32);
        pose(c, { opacity: 0.25 + 0.75 * enter, y: (1 - enter) * 24 });
        const center = left + widths[i] / 2 - vw / 2;
        pose(arts[i], { x: center * -0.03 });
      });
    },
  });
}

/* ---------- Ablauf: 01 → 02 → 03 mit wachsender Route ---------- */
export function initProcess(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const route = root.querySelector<HTMLElement>('[data-route]');
  const steps = qa(root, '[data-step]');
  const screens = qa(root, '[data-screen]');
  const bars = qa(root, '[data-bar]');
  const pick = root.querySelector<HTMLElement>('[data-pick]');
  const device = root.querySelector<HTMLElement>('[data-device]');
  if (!trackEl || env.reduced) return noop;
  let enabled = true;

  return track(trackEl, {
    onRefresh: () => {
      enabled = matchMedia('(min-width: 900px)').matches;
      if (!enabled) {
        [route, device, ...screens, ...bars].forEach((el) => clearPose(el));
        steps.forEach((s) => {
          flag(s, 'is-active', false);
          flag(s, 'is-done', false);
        });
      }
    },
    onUpdate: (p) => {
      if (!enabled) return;
      const active = Math.min(2, Math.floor(win(p, 0.04, 0.96) * 3));
      steps.forEach((s, i) => {
        flag(s, 'is-active', i === active);
        flag(s, 'is-done', i < active);
      });
      pose(route, { scaleY: ease.inOutCubic(win(p, 0.04, 0.92)) });
      const o = [1 - win(p, 0.3, 0.36), Math.min(win(p, 0.3, 0.36), 1 - win(p, 0.63, 0.69)), win(p, 0.63, 0.69)];
      screens.forEach((s, i) => pose(s, { opacity: o[i], y: (1 - o[i]) * 18, scale: 0.98 + 0.02 * o[i] }));
      flag(pick, 'is-picked', p > 0.12);
      bars.forEach((b, i) => pose(b, { scaleX: ease.outCubic(win(p, 0.37 + i * 0.06, 0.5 + i * 0.06)) }));
      pose(device, { y: (0.5 - p) * 40 });
    },
  });
}

/* ---------- Unterlagen: Karten kommen zusammen → „Vorgang vollständig“ ---------- */
const DOC_START: [number, number, number][] = [
  [-0.36, -0.2, -10],
  [0.34, -0.24, 8],
  [-0.32, 0.24, 6],
  [0.36, 0.2, -7],
  [0.04, 0.32, 4],
];

export function initDocuments(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const cards = qa(root, '[data-dcard]');
  const complete = root.querySelector<HTMLElement>('[data-complete]');
  const count = root.querySelector<HTMLElement>('[data-count]');
  if (!trackEl || env.reduced) return noop;
  let vw = 1;
  let vh = 1;
  let k = 1;

  return track(trackEl, {
    onRefresh: () => {
      vw = scrollState.vw || innerWidth;
      vh = scrollState.vh || innerHeight;
      k = vw <= 760 ? 0.55 : 1;
    },
    onUpdate: (p) => {
      let docked = 0;
      const squeeze = ease.inOutCubic(win(p, 0.74, 0.86));
      cards.forEach((c, i) => {
        const [sx, sy, sr] = DOC_START[i];
        const t = ease.outCubic(win(p, 0.06 + i * 0.12, 0.2 + i * 0.12));
        const off = i - 2;
        const dockX = off * Math.min(vw * 0.11, 160) * k;
        const dockY = Math.abs(off) * 16 * k;
        const x = lerp(lerp(sx * vw * k, dockX, t), off * 6, squeeze);
        const y = lerp(lerp(sy * vh, dockY, t), off * -5, squeeze) - squeeze * vh * 0.04;
        pose(c, {
          x,
          y,
          rotate: lerp(lerp(sr, off * 3, t), 0, squeeze),
          scale: lerp(0.9, 1, t) * lerp(1, 0.94, squeeze),
          opacity: 0.25 + 0.75 * win(p, 0.02 + i * 0.12, 0.1 + i * 0.12),
        });
        const isDocked = t > 0.98;
        flag(c, 'is-docked', isDocked);
        if (isDocked) docked++;
      });
      setText(count, `${docked} / ${cards.length}`);
      const done = ease.outCubic(win(p, 0.8, 0.9));
      pose(complete, { opacity: done, y: (1 - done) * 24 + vh * 0.12 * k, scale: 0.86 + 0.14 * done });
    },
  });
}

/* ---------- Status-Demo: Zeilen aktivieren sich nacheinander ---------- */
const STATUS_AT = [0.08, 0.26, 0.44, 0.62, 0.8, 0.92];

export function initStatusDemo(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const rows = qa(root, '[data-row]');
  const line = root.querySelector<HTMLElement>('[data-line]');
  const current = root.querySelector<HTMLElement>('[data-current]');
  const mock = root.querySelector<HTMLElement>('[data-mock]');
  const float = root.querySelector<HTMLElement>('[data-float]');
  if (!trackEl || env.reduced) return noop;
  const labels = rows.map((r) => r.querySelector('.sdemo__row-label')?.textContent ?? '');

  return track(trackEl, {
    onUpdate: (p) => {
      let cur = -1;
      rows.forEach((r, i) => {
        const state = p >= STATUS_AT[i + 1] ? 'done' : p >= STATUS_AT[i] ? 'current' : 'pending';
        if (state === 'current') cur = i;
        if (r.dataset.state !== state) r.dataset.state = state;
      });
      setText(current, cur >= 0 ? labels[cur] : p >= STATUS_AT[STATUS_AT.length - 1] ? 'Abgeschlossen' : labels[0]);
      pose(line, { scaleY: win(p, STATUS_AT[0], STATUS_AT[STATUS_AT.length - 1]) });
      pose(mock, { y: (0.5 - p) * 36 });
      pose(float, { y: (0.5 - p) * -50, opacity: win(p, 0.04, 0.12) });
    },
  });
}

/* ---------- Kennzeichen: Schild erscheint, wird bestückt und einmal vom Licht überstrichen ---------- */
export function initPlateScene(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const wrap = root.querySelector<HTMLElement>('[data-bigplate]');
  const opts = qa(root, '[data-opt]');
  if (!trackEl || !wrap || env.reduced) return noop;
  const rig = plateRig(wrap);

  return track(trackEl, {
    onUpdate: (p) => {
      // Leichte Perspektive, die sich beim Scrollen frontal ausrichtet
      const t0 = ease.outCubic(win(p, 0, 0.3));
      pose(wrap, {
        y: (1 - t0) * 40 + (0.5 - p) * 20,
        rotateX: lerp(14, 3, t0),
        rotateY: lerp(-16, -3, t0),
        scale: 0.9 + 0.1 * t0,
        opacity: 0.15 + 0.85 * win(p, 0, 0.12),
      });
      renderPlate(rig, win(p, 0.04, 0.66));
      opts.forEach((o, i) => {
        const t = ease.outCubic(win(p, 0.62 + i * 0.07, 0.74 + i * 0.07));
        pose(o, { y: (1 - t) * 30, opacity: t });
      });
    },
  });
}

/* ---------- Deutschlandkarte: Umriss, Knoten, Verbindungen ---------- */
export function initMap(root: HTMLElement): Cleanup {
  const stage = root.querySelector<HTMLElement>('[data-map-stage]');
  const outline = root.querySelector<SVGPathElement>('[data-outline]');
  const land = root.querySelector<SVGPathElement>('[data-land]');
  const links = Array.from(root.querySelectorAll<SVGPathElement>('[data-link]'));
  const cities = Array.from(root.querySelectorAll<SVGGElement>('[data-city]'));
  const hub = root.querySelector<SVGGElement>('[data-hub]');
  const badge = root.querySelector<HTMLElement>('[data-badge]');
  if (!stage || env.reduced) return noop;
  const dash = (el: SVGElement | null, v: number) => {
    if (!el) return;
    const s = v.toFixed(4);
    if (el.style.strokeDashoffset !== s) el.style.strokeDashoffset = s;
  };

  return track(stage, {
    start: 'top bottom',
    end: 'bottom 70%',
    onUpdate: (p) => {
      dash(outline, 1 - ease.inOutCubic(win(p, 0, 0.45)));
      pose(land, { opacity: win(p, 0.2, 0.5) });
      pose(hub, { opacity: win(p, 0.32, 0.42), scale: 0.6 + 0.4 * ease.outCubic(win(p, 0.32, 0.46)) });
      cities.forEach((c, i) => {
        const t = ease.outCubic(win(p, 0.38 + i * 0.022, 0.46 + i * 0.022));
        pose(c, { opacity: t, scale: 0.4 + 0.6 * t });
      });
      links.forEach((l, i) => dash(l, 1 - ease.inOutCubic(win(p, 0.4 + i * 0.022, 0.56 + i * 0.022))));
      pose(badge, { opacity: win(p, 0.8, 0.92), y: (1 - win(p, 0.8, 0.92)) * 12 });
      pose(stage, { y: (0.5 - p) * 30 });
    },
  });
}

/* ---------- Händler: Warteschlange wächst ---------- */
const QUEUE_STEPS: [number, number][] = [
  [0, 1],
  [0.14, 5],
  [0.32, 12],
  [0.5, 38],
  [0.68, 102],
];

export function initDealers(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const stage = root.querySelector<HTMLElement>('[data-stage]');
  const list = root.querySelector<HTMLElement>('[data-qlist]');
  const rows = qa(root, '[data-qrow]');
  const count = root.querySelector<HTMLElement>('[data-qcount]');
  if (!trackEl || !stage || env.reduced) return noop;
  let rowH = 52;
  let visibleRows = 6;
  let radius = -1;

  return track(trackEl, {
    onRefresh: () => {
      rowH = rows[0]?.offsetHeight || 52;
      const vp = list?.parentElement?.clientHeight || rowH * 6;
      visibleRows = Math.max(3, Math.floor(vp / rowH));
    },
    onUpdate: (p) => {
      let shown = 0;
      rows.forEach((r, i) => {
        const t = ease.outCubic(win(p, 0.04 + i * 0.055, 0.1 + i * 0.055));
        shown += t;
        pose(r, { y: (1 - t) * 26, opacity: t });
      });
      pose(list, { y: -Math.max(0, shown - visibleRows) * rowH });
      let n = 1;
      for (const [at, v] of QUEUE_STEPS) if (p >= at) n = v;
      setText(count, String(n));
      const pull = ease.inOutCubic(win(p, 0.9, 1));
      pose(stage, { scale: 1 - pull * 0.06 });
      const rad = Math.round(pull * 28);
      if (rad !== radius) {
        stage.style.borderRadius = rad ? `${rad}px` : '';
        radius = rad;
      }
    },
  });
}

/* ---------- Finale: Bühne übernimmt, Lichtkante fährt über das Fahrzeug ---------- */
export function initFinale(root: HTMLElement): Cleanup {
  const trackEl = root.querySelector<HTMLElement>('[data-track]');
  const stage = root.querySelector<HTMLElement>('[data-stage]');
  const edge = root.querySelector<HTMLElement>('[data-edge]');
  const car = root.querySelector<HTMLElement>('[data-fcar]');
  if (!trackEl || !stage || env.reduced) return noop;
  let vw = 1;
  let radius = -1;

  return track(trackEl, {
    start: 'top bottom',
    end: 'bottom bottom',
    onRefresh: () => {
      vw = scrollState.vw || innerWidth;
    },
    onUpdate: (p) => {
      const enter = ease.outCubic(win(p, 0, 0.42));
      pose(stage, { scale: 0.9 + 0.1 * enter });
      const rad = Math.round((1 - enter) * 32);
      if (rad !== radius) {
        stage.style.borderRadius = rad ? `${rad}px` : '';
        radius = rad;
      }
      pose(edge, { x: lerp(-0.3, 1.3, ease.inOutSine(win(p, 0.25, 0.95))) * vw, opacity: band(p, 0.22, 0.32, 0.88, 0.98) });
      pose(car, { x: lerp(-0.08, 0.04, p) * vw, opacity: 0.25 + 0.5 * win(p, 0.2, 0.6) });
    },
  });
}
