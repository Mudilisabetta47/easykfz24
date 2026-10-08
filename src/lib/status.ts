// Status-Workflow eines Auftrags.
//
//   Neu → In Prüfung ↔ Unterlagen fehlen
//         In Prüfung → Bei Zulassungsstelle → Zugelassen → Versendet | Abgeholt → Abgeschlossen
//   Bei Zulassungsstelle → Unterlagen fehlen (Rückfrage der Behörde)
//   Storno ist bis einschließlich „Bei Zulassungsstelle“ möglich.

import type { ServiceId } from './services.ts';

export const STATUS_IDS = [
  'neu',
  'in_pruefung',
  'unterlagen_fehlen',
  'bei_zulassungsstelle',
  'zugelassen',
  'versendet',
  'abgeholt',
  'abgeschlossen',
  'storniert',
] as const;
export type StatusId = (typeof STATUS_IDS)[number];

export type StatusTone = 'blue' | 'amber' | 'violet' | 'green' | 'slate' | 'red';

export const STATUSES: Record<StatusId, { label: string; publicLabel: string; tone: StatusTone; publicText: string }> = {
  neu: {
    label: 'Neu',
    publicLabel: 'Eingegangen',
    tone: 'blue',
    publicText: 'Ihr Auftrag ist bei uns eingegangen und wird in Kürze geprüft.',
  },
  in_pruefung: {
    label: 'In Prüfung',
    publicLabel: 'In Prüfung',
    tone: 'blue',
    publicText: 'Wir prüfen Ihre Angaben und Unterlagen.',
  },
  unterlagen_fehlen: {
    label: 'Unterlagen fehlen',
    publicLabel: 'Unterlagen fehlen',
    tone: 'amber',
    publicText: 'Es fehlen noch Unterlagen oder Angaben. Bitte beachten Sie unseren Hinweis unten bzw. unsere Nachricht.',
  },
  bei_zulassungsstelle: {
    label: 'Bei Zulassungsstelle',
    publicLabel: 'Bei der Zulassungsstelle',
    tone: 'violet',
    publicText: 'Ihr Vorgang liegt bei der Zulassungsstelle zur Bearbeitung.',
  },
  zugelassen: {
    label: 'Zugelassen',
    publicLabel: 'Zugelassen',
    tone: 'green',
    publicText: 'Die Zulassungsstelle hat den Vorgang abgeschlossen. Versand bzw. Abholung wird vorbereitet.',
  },
  versendet: {
    label: 'Versendet',
    publicLabel: 'Versendet',
    tone: 'green',
    publicText: 'Ihre Unterlagen sind unterwegs zu Ihnen.',
  },
  abgeholt: {
    label: 'Abgeholt',
    publicLabel: 'Abgeholt',
    tone: 'green',
    publicText: 'Sie haben Ihre Unterlagen abgeholt.',
  },
  abgeschlossen: {
    label: 'Abgeschlossen',
    publicLabel: 'Abgeschlossen',
    tone: 'slate',
    publicText: 'Der Auftrag ist abgeschlossen. Vielen Dank!',
  },
  storniert: {
    label: 'Storniert',
    publicLabel: 'Storniert',
    tone: 'red',
    publicText: 'Der Auftrag wurde storniert.',
  },
};

const TRANSITIONS: Record<StatusId, StatusId[]> = {
  neu: ['in_pruefung', 'storniert'],
  in_pruefung: ['unterlagen_fehlen', 'bei_zulassungsstelle', 'storniert'],
  unterlagen_fehlen: ['in_pruefung', 'storniert'],
  bei_zulassungsstelle: ['zugelassen', 'unterlagen_fehlen', 'storniert'],
  zugelassen: ['versendet', 'abgeholt'],
  versendet: ['abgeschlossen'],
  abgeholt: ['abgeschlossen'],
  abgeschlossen: [],
  storniert: [],
};

export interface TransitionContext {
  service: ServiceId;
  delivery: 'versand' | 'abholung';
  checklistComplete: boolean;
  hasAssignedPlate: boolean;
}

export type TransitionCheck = { ok: true } | { ok: false; reason: string };

export function isStatusId(v: unknown): v is StatusId {
  return typeof v === 'string' && (STATUS_IDS as readonly string[]).includes(v);
}

export function isTerminal(s: StatusId): boolean {
  return TRANSITIONS[s].length === 0;
}

/** Bezeichnung abhängig von der Leistung („Zugelassen“ heißt bei der Abmeldung „Abgemeldet“). */
export function statusLabel(s: StatusId, service?: ServiceId, audience: 'intern' | 'kunde' = 'intern'): string {
  if (s === 'zugelassen' && service === 'abmeldung') return 'Abgemeldet';
  return audience === 'kunde' ? STATUSES[s].publicLabel : STATUSES[s].label;
}

/** Laut Workflow erreichbare Folgestatus (ohne Prüfung der Voraussetzungen). */
export function nextStatuses(from: StatusId): StatusId[] {
  return TRANSITIONS[from];
}

export function checkTransition(from: StatusId, to: StatusId, ctx: TransitionContext): TransitionCheck {
  if (!TRANSITIONS[from].includes(to)) {
    return { ok: false, reason: `Von „${STATUSES[from].label}“ nicht nach „${STATUSES[to].label}“ möglich` };
  }
  if (to === 'bei_zulassungsstelle' && !ctx.checklistComplete) {
    return { ok: false, reason: 'Erst alle Pflichtpunkte der Unterlagen-Checkliste abhaken' };
  }
  if (to === 'zugelassen' && ctx.service !== 'abmeldung' && !ctx.hasAssignedPlate) {
    return { ok: false, reason: 'Erst das zugeteilte Kennzeichen eintragen' };
  }
  if (to === 'versendet' && ctx.delivery !== 'versand') {
    return { ok: false, reason: 'Kunde hat Abholung gewählt' };
  }
  if (to === 'abgeholt' && ctx.delivery !== 'abholung') {
    return { ok: false, reason: 'Kunde hat Versand gewählt' };
  }
  return { ok: true };
}

/** Folgestatus samt Prüfergebnis – für die Buttons in der Detailansicht. */
export function transitionOptions(from: StatusId, ctx: TransitionContext): { to: StatusId; check: TransitionCheck }[] {
  return TRANSITIONS[from]
    .map((to) => ({ to, check: checkTransition(from, to, ctx) }))
    // Versand/Abholung: nur die zur gewählten Zustellung passende Option anzeigen.
    .filter((o) => !((o.to === 'versendet' || o.to === 'abgeholt') && !o.check.ok));
}

/** Für Kennzahlen: Aufträge, an denen noch gearbeitet wird. */
export const OPEN_STATUSES: StatusId[] = STATUS_IDS.filter((s) => !isTerminal(s));
